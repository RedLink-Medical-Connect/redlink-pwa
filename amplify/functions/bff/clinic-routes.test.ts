// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { InvokeCommand } from '@aws-sdk/client-lambda'
import * as clinicRoutes from './clinic-routes'
import { ACCESS_TOKEN_COOKIE } from './cookies'

/**
 * `GetUserCommand` (identité de l'appelant, `requireCaller`) : même pattern que
 * `auth-routes.test.ts` (stub direct de `.prototype.send`).
 *
 * `veterinarianAccountAdmin` (`AdminCreateUser`/`AdminAddUserToGroup`/`AdminDeleteUser`) N'EST
 * PLUS appelé directement par ce fichier (voir le commentaire de `clinic-routes.ts` -- deux
 * tentatives de donner ces permissions à `bff` ont chacune cassé un déploiement réel) : ce
 * comportement est maintenant testé dans
 * `amplify/functions/veterinarian-account-admin/handler.test.ts`. Ici, `@aws-sdk/client-lambda`
 * est mocké au niveau MODULE (même idiome que `rating-aggregation/handler.test.ts` pour
 * `@aws-sdk/lib-dynamodb`) pour simuler les réponses de cette invocation.
 *
 * DynamoDB : même pattern (`vi.mock` du module, `sendMock` hissé) -- `clinic-routes.ts` écrit
 * en direct sur les tables managées, voir son commentaire de fichier pour le "pourquoi" (le
 * champ caché `owner` doit porter l'identité de la COLLÈGUE invitée, jamais celle du référent
 * qui appelle cette route).
 */
const cognitoSendSpy = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send')

const { dynamoSendMock, lambdaSendMock } = vi.hoisted(() => ({
  dynamoSendMock: vi.fn(),
  lambdaSendMock: vi.fn(),
}))

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: dynamoSendMock }) },
  GetCommand: class {
    readonly commandName = 'Get'
    constructor(readonly input: Record<string, unknown>) {}
  },
  PutCommand: class {
    readonly commandName = 'Put'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = lambdaSendMock
  },
  InvokeCommand: class {
    readonly commandName = 'Invoke'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

afterAll(() => {
  cognitoSendSpy.mockRestore()
})

beforeEach(() => {
  cognitoSendSpy.mockReset()
  dynamoSendMock.mockReset()
  lambdaSendMock.mockReset()
  process.env.COGNITO_USER_POOL_ID = 'pool-123'
  process.env.VETERINARIAN_TABLE_NAME = 'Veterinarian-test-table'
  process.env.CLINIC_TABLE_NAME = 'Clinic-test-table'
  process.env.VETERINARIAN_ACCOUNT_ADMIN_FUNCTION_NAME = 'veterinarian-account-admin-test'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const REFERENT_COOKIES = [`${ACCESS_TOKEN_COOKIE}=access-referent`]

/** Réponses successives, dans l'ordre d'appel de chaque client mocké. */
function queueCognito(...responses: unknown[]) {
  for (const response of responses) {
    cognitoSendSpy.mockImplementationOnce(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response as never),
    )
  }
}
function queueDynamo(...responses: unknown[]) {
  for (const response of responses) {
    dynamoSendMock.mockImplementationOnce(() => Promise.resolve(response))
  }
}
/** Simule le payload JSON renvoyé par une invocation réussie de `veterinarianAccountAdmin`. */
function queueLambdaResult(result: unknown) {
  lambdaSendMock.mockImplementationOnce(() =>
    Promise.resolve({ Payload: Buffer.from(JSON.stringify(result)) }),
  )
}

/** `GetUserCommand` (identité de l'appelant, `requireCaller`) -- toujours la 1ère commande Cognito. */
const referentGetUser = {
  Username: 'referent@example.com',
  UserAttributes: [
    { Name: 'sub', Value: 'referent-sub' },
    { Name: 'email', Value: 'referent@example.com' },
  ],
}

describe('inviteVeterinarian', () => {
  it('renvoie 400 si email manque', async () => {
    const result = await clinicRoutes.inviteVeterinarian({}, REFERENT_COOKIES)
    expect(result.statusCode).toBe(400)
    expect(cognitoSendSpy).not.toHaveBeenCalled()
  })

  it('renvoie 401 sans cookie access token', async () => {
    const result = await clinicRoutes.inviteVeterinarian({ email: 'a@b.com' }, undefined)
    expect(result.statusCode).toBe(401)
    expect(cognitoSendSpy).not.toHaveBeenCalled()
  })

  it("renvoie 403 NOT_A_VETERINARIAN si l'appelant n'a pas de ligne Veterinarian", async () => {
    queueCognito(referentGetUser)
    queueDynamo({ Item: undefined })

    const result = await clinicRoutes.inviteVeterinarian({ email: 'a@b.com' }, REFERENT_COOKIES)

    expect(result).toEqual({ statusCode: 403, body: { error: 'NOT_A_VETERINARIAN' } })
  })

  it("renvoie 403 NOT_CLINIC_REFERENT si l'appelant n'est pas le owner de sa Clinic", async () => {
    queueCognito(referentGetUser)
    queueDynamo(
      { Item: { id: 'referent-sub', clinicID: 'clinic-1' } },
      { Item: { id: 'clinic-1', owner: 'quelquun-dautre::autre@example.com' } },
    )

    const result = await clinicRoutes.inviteVeterinarian({ email: 'a@b.com' }, REFERENT_COOKIES)

    expect(result).toEqual({ statusCode: 403, body: { error: 'NOT_CLINIC_REFERENT' } })
    expect(lambdaSendMock).not.toHaveBeenCalled() // jamais invoqué veterinarianAccountAdmin
  })

  it('renvoie 409 EMAIL_ALREADY_EXISTS si veterinarianAccountAdmin le signale', async () => {
    queueCognito(referentGetUser)
    queueDynamo(
      { Item: { id: 'referent-sub', clinicID: 'clinic-1' } },
      { Item: { id: 'clinic-1', owner: 'referent-sub::referent@example.com' } },
    )
    queueLambdaResult({ ok: false, error: 'EMAIL_ALREADY_EXISTS' })

    const result = await clinicRoutes.inviteVeterinarian({ email: 'a@b.com' }, REFERENT_COOKIES)

    expect(result).toEqual({ statusCode: 409, body: { error: 'EMAIL_ALREADY_EXISTS' } })
  })

  it("succès : invoque veterinarianAccountAdmin avec le bon payload, et écrit la ligne DynamoDB avec SON identité comme owner", async () => {
    queueCognito(referentGetUser)
    queueDynamo(
      { Item: { id: 'referent-sub', clinicID: 'clinic-1' } },
      { Item: { id: 'clinic-1', owner: 'referent-sub::referent@example.com' } },
    )
    queueLambdaResult({ ok: true, sub: 'collegue-sub', username: 'collegue@example.com' })
    queueDynamo({}) // PutCommand

    const result = await clinicRoutes.inviteVeterinarian(
      { email: 'Collegue@Example.com', locale: 'fr' },
      REFERENT_COOKIES,
    )

    expect(result).toEqual({ statusCode: 200, body: { status: 'INVITED', id: 'collegue-sub' } })

    const [invokeCommand] = lambdaSendMock.mock.calls[0]
    expect(invokeCommand).toBeInstanceOf(InvokeCommand)
    expect(invokeCommand.input).toMatchObject({ FunctionName: 'veterinarian-account-admin-test' })
    expect(JSON.parse(Buffer.from(invokeCommand.input.Payload).toString('utf-8'))).toEqual({
      action: 'create',
      userPoolId: 'pool-123',
      email: 'collegue@example.com', // normalisé en minuscules avant transmission
      locale: 'fr',
    })

    const [putCommand] = dynamoSendMock.mock.calls[2]
    expect(putCommand.input).toMatchObject({
      TableName: 'Veterinarian-test-table',
      Item: expect.objectContaining({
        id: 'collegue-sub',
        clinicID: 'clinic-1',
        email: 'collegue@example.com',
        // Jamais l'identité du référent qui appelle cette route -- voir le commentaire de
        // fichier de clinic-routes.ts.
        owner: 'collegue-sub::collegue@example.com',
      }),
    })
  })

  it('rollback (revue devsecops-aws) : si la ligne DynamoDB échoue APRÈS la création du compte, invoque veterinarianAccountAdmin en rollback plutôt que de le laisser orphelin', async () => {
    queueCognito(referentGetUser)
    queueDynamo(
      { Item: { id: 'referent-sub', clinicID: 'clinic-1' } },
      { Item: { id: 'clinic-1', owner: 'referent-sub::referent@example.com' } },
    )
    queueLambdaResult({ ok: true, sub: 'collegue-sub', username: 'collegue@example.com' }) // create
    dynamoSendMock.mockImplementationOnce(() => Promise.reject(new Error('ProvisionedThroughputExceeded'))) // PutCommand
    queueLambdaResult({ ok: true }) // rollback

    const result = await clinicRoutes.inviteVeterinarian({ email: 'collegue@example.com' }, REFERENT_COOKIES)

    expect(result).toEqual({ statusCode: 500, body: { error: 'INVITE_FAILED' } })

    const [rollbackCommand] = lambdaSendMock.mock.calls[1]
    expect(rollbackCommand).toBeInstanceOf(InvokeCommand)
    expect(JSON.parse(Buffer.from(rollbackCommand.input.Payload).toString('utf-8'))).toEqual({
      action: 'rollback',
      userPoolId: 'pool-123',
      username: 'collegue@example.com',
    })
  })
})
