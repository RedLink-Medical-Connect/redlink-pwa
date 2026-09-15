// @vitest-environment node
//
// Environnement `node` explicite (le défaut du repo est `jsdom`) : ce fichier teste un handler
// Lambda, qui ne s'exécute jamais dans un navigateur. `@aws-sdk/client-ses` est entièrement
// mocké ci-dessous, aucun appel réseau n'est possible.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Context, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda'
import { handler } from './handler'

/**
 * Test du handler de la Lambda `clinic-verification-notifier` (vérification d'identité RPPS +
 * numéro d'ordre avant activation d'une Clinic, plan de durcissement sécurité "Différé 1") --
 * même forme que `rating-aggregation/handler.test.ts` (SDK mocké au niveau MODULE, le handler
 * instancie son client au chargement du module, pas d'injection de dépendance à exploiter).
 * Portée : ce qui est réellement ENVOYÉ à SES (destinataire/expéditeur/contenu), le filtrage
 * `eventName !== 'INSERT'`, et que ce handler ne rejette JAMAIS (best-effort, voir l'en-tête de
 * `handler.ts`) -- pas un décalque de l'implémentation.
 */

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: class {
    send = sendMock
  },
  SendEmailCommand: class {
    readonly commandName = 'SendEmail'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

const SENDER_EMAIL = 'admin@test.example'
const ADMIN_EMAIL = 'admin@test.example'

type SentCommand = { commandName: string; input: Record<string, any> }

const insertRecord = (id: string, name: string, rpps?: string): DynamoDBRecord => ({
  eventName: 'INSERT',
  dynamodb: {
    NewImage: {
      id: { S: id },
      name: { S: name },
      ...(rpps !== undefined ? { rpps: { S: rpps } } : {}),
    },
  },
})

const streamEvent = (...Records: DynamoDBRecord[]): DynamoDBStreamEvent => ({ Records })

const invoke = async (event: DynamoDBStreamEvent): Promise<void> => {
  await handler(event, {} as Context, () => {})
}

const sentCommands = (): SentCommand[] =>
  sendMock.mock.calls.map(([command]) => ({
    commandName: (command as SentCommand).commandName,
    input: (command as SentCommand).input,
  }))

describe('clinic-verification-notifier handler', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockResolvedValue({})
    process.env.SES_SENDER_EMAIL = SENDER_EMAIL
    process.env.ADMIN_NOTIFICATION_EMAIL = ADMIN_EMAIL
  })

  afterEach(() => {
    delete process.env.SES_SENDER_EMAIL
    delete process.env.ADMIN_NOTIFICATION_EMAIL
  })

  it('envoie un seul email SES pour un INSERT Clinic, vers ADMIN_NOTIFICATION_EMAIL, depuis SES_SENDER_EMAIL', async () => {
    await invoke(streamEvent(insertRecord('clinic-1', 'Clinique Alfort', '12345678901')))

    const commands = sentCommands()
    expect(commands).toHaveLength(1)
    expect(commands[0].commandName).toBe('SendEmail')
    expect(commands[0].input.Source).toBe(SENDER_EMAIL)
    expect(commands[0].input.Destination).toEqual({ ToAddresses: [ADMIN_EMAIL] })
    expect(commands[0].input.Message.Subject.Data).toContain('Clinique Alfort')
    expect(commands[0].input.Message.Body.Html.Data).toContain('Clinique Alfort')
    expect(commands[0].input.Message.Body.Html.Data).toContain('clinic-1')
  })

  it("échappe le HTML d'un nom de clinique saisi par l'utilisateur (contenu externe non fiable)", async () => {
    await invoke(streamEvent(insertRecord('clinic-1', '<img src=x onerror=alert(1)>')))

    const html = sentCommands()[0].input.Message.Body.Html.Data
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('ignore les enregistrements MODIFY/REMOVE (défense en profondeur, même si le filtre EventSourceMapping les exclut déjà côté infra)', async () => {
    const modifyRecord: DynamoDBRecord = {
      eventName: 'MODIFY',
      dynamodb: { NewImage: { id: { S: 'clinic-1' }, name: { S: 'Clinique Alfort' } } },
    }

    await invoke(streamEvent(modifyRecord))

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('traite chaque enregistrement INSERT du lot indépendamment (un email par nouvelle Clinic)', async () => {
    await invoke(
      streamEvent(
        insertRecord('clinic-1', 'Clinique Alfort'),
        insertRecord('clinic-2', 'Clinique Lyon'),
      ),
    )

    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it("n'envoie rien et ne lève pas si l'enregistrement est incomplet (id/name absents)", async () => {
    const incompleteRecord: DynamoDBRecord = { eventName: 'INSERT', dynamodb: { NewImage: {} } }

    await expect(invoke(streamEvent(incompleteRecord))).resolves.not.toThrow()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("best-effort : un échec SES est logué mais ne fait jamais rejeter le handler (pas de retry côté EventSourceMapping, voir amplify/backend.ts)", async () => {
    sendMock.mockRejectedValue(new Error('Email address is not verified'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(invoke(streamEvent(insertRecord('clinic-1', 'Clinique Alfort')))).resolves.not.toThrow()

    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
