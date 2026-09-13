// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { handler } from './handler'
import type { Context } from 'aws-lambda'

const sendSpy = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send')

afterAll(() => {
  sendSpy.mockRestore()
})

beforeEach(() => {
  sendSpy.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const invoke = (event: Parameters<typeof handler>[0]) => handler(event, {} as Context, () => {})

function queue(...responses: unknown[]) {
  for (const response of responses) {
    sendSpy.mockImplementationOnce(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response as never),
    )
  }
}

describe('action "create"', () => {
  it('succès : AdminCreateUser puis AdminAddUserToGroup, renvoie { ok: true, sub, username }', async () => {
    queue(
      { User: { Username: 'collegue@example.com', Attributes: [{ Name: 'sub', Value: 'collegue-sub' }] } },
      {},
    )

    const result = await invoke({ action: 'create', userPoolId: 'pool-123', email: 'Collegue@Example.com' })

    expect(result).toEqual({ ok: true, sub: 'collegue-sub', username: 'collegue@example.com' })

    const [createCommand] = sendSpy.mock.calls[0]
    expect(createCommand).toBeInstanceOf(AdminCreateUserCommand)
    expect(createCommand.input).toMatchObject({
      UserPoolId: 'pool-123',
      Username: 'Collegue@Example.com',
      UserAttributes: expect.arrayContaining([{ Name: 'profile', Value: 'vet' }]),
    })

    const [groupCommand] = sendSpy.mock.calls[1]
    expect(groupCommand).toBeInstanceOf(AdminAddUserToGroupCommand)
    expect(groupCommand.input).toMatchObject({
      UserPoolId: 'pool-123',
      Username: 'collegue@example.com',
      GroupName: 'Veterinarians',
    })
  })

  it('email déjà utilisé : { ok: false, error: EMAIL_ALREADY_EXISTS }, jamais de deuxième appel', async () => {
    sendSpy.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('exists'), { name: 'UsernameExistsException' })),
    )

    const result = await invoke({ action: 'create', userPoolId: 'pool-123', email: 'a@b.com' })

    expect(result).toEqual({ ok: false, error: 'EMAIL_ALREADY_EXISTS' })
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it("échec AdminAddUserToGroup après un AdminCreateUser réussi : rollback (AdminDeleteUser) puis { ok: false, error: INVITE_FAILED }", async () => {
    queue(
      { User: { Username: 'collegue@example.com', Attributes: [{ Name: 'sub', Value: 'collegue-sub' }] } },
      new Error('AddUserToGroup transient failure'),
      {}, // AdminDeleteUser (rollback)
    )

    const result = await invoke({ action: 'create', userPoolId: 'pool-123', email: 'a@b.com' })

    expect(result).toEqual({ ok: false, error: 'INVITE_FAILED' })
    const [rollbackCommand] = sendSpy.mock.calls[2]
    expect(rollbackCommand).toBeInstanceOf(AdminDeleteUserCommand)
    expect(rollbackCommand.input).toMatchObject({ UserPoolId: 'pool-123', Username: 'collegue@example.com' })
  })
})

describe('action "rollback"', () => {
  it('succès : AdminDeleteUser, renvoie { ok: true }', async () => {
    queue({})

    const result = await invoke({ action: 'rollback', userPoolId: 'pool-123', username: 'collegue@example.com' })

    expect(result).toEqual({ ok: true })
    const [command] = sendSpy.mock.calls[0]
    expect(command).toBeInstanceOf(AdminDeleteUserCommand)
    expect(command.input).toMatchObject({ UserPoolId: 'pool-123', Username: 'collegue@example.com' })
  })

  it('échec : { ok: false, error: ROLLBACK_FAILED }, ne relance jamais', async () => {
    queue(new Error('boom'))

    const result = await invoke({ action: 'rollback', userPoolId: 'pool-123', username: 'collegue@example.com' })

    expect(result).toEqual({ ok: false, error: 'ROLLBACK_FAILED' })
  })
})

describe('action inconnue', () => {
  it('renvoie { ok: false, error: UNKNOWN_ACTION }, aucun appel SDK', async () => {
    // @ts-expect-error -- action volontairement invalide pour ce test
    const result = await invoke({ action: 'nope' })
    expect(result).toEqual({ ok: false, error: 'UNKNOWN_ACTION' })
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
