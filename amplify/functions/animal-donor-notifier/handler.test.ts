// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Context, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda'
import { handler } from './handler'

/**
 * Test du handler `animal-donor-notifier` (système de notifications, 2026-09-18) -- même forme
 * que `clinic-verification-notifier/handler.test.ts` : SDK mockés au niveau MODULE, portée
 * limitée à ce qui porte une vraie garantie (filtrage de transition, contenu envoyé,
 * best-effort réellement best-effort).
 */

const { sesSendMock, dynamoSendMock } = vi.hoisted(() => ({
  sesSendMock: vi.fn(),
  dynamoSendMock: vi.fn(),
}))

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: class {
    send = sesSendMock
  },
  SendEmailCommand: class {
    readonly commandName = 'SendEmail'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}))

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

const OWNER_TABLE = 'Owner-test-table'
const NOTIFICATION_TABLE = 'Notification-test-table'
const SENDER_EMAIL = 'admin@test.example'

type SentCommand = { commandName: string; input: Record<string, any> }

const animalModifyRecord = (overrides: {
  wasValidated?: boolean
  isValidated?: boolean
  animalId?: string
  animalName?: string
  ownerId?: string
} = {}): DynamoDBRecord => ({
  eventName: 'MODIFY',
  dynamodb: {
    OldImage: { isValidatedDonor: { BOOL: overrides.wasValidated ?? false } },
    NewImage: {
      id: { S: overrides.animalId ?? 'animal-1' },
      name: { S: overrides.animalName ?? 'Rex' },
      ownerID: { S: overrides.ownerId ?? 'owner-1' },
      isValidatedDonor: { BOOL: overrides.isValidated ?? true },
    },
  },
})

const streamEvent = (...Records: DynamoDBRecord[]): DynamoDBStreamEvent => ({ Records })

const invoke = async (event: DynamoDBStreamEvent): Promise<void> => {
  await handler(event, {} as Context, () => {})
}

describe('animal-donor-notifier handler', () => {
  beforeEach(() => {
    sesSendMock.mockReset()
    sesSendMock.mockResolvedValue({})
    dynamoSendMock.mockReset()
    process.env.SES_SENDER_EMAIL = SENDER_EMAIL
    process.env.OWNER_TABLE_NAME = OWNER_TABLE
    process.env.NOTIFICATION_TABLE_NAME = NOTIFICATION_TABLE
  })

  afterEach(() => {
    delete process.env.SES_SENDER_EMAIL
    delete process.env.OWNER_TABLE_NAME
    delete process.env.NOTIFICATION_TABLE_NAME
  })

  const mockOwnerGet = (owner: string | null, email: string | null) => {
    dynamoSendMock.mockImplementation((command: SentCommand) => {
      if (command.commandName === 'Get') {
        return Promise.resolve({ Item: owner && email ? { owner, email } : undefined })
      }
      return Promise.resolve({})
    })
  }

  it('notifie (badge + email) quand isValidatedDonor transitionne vers true', async () => {
    mockOwnerGet('owner-1::owner@test.example', 'owner@test.example')

    await invoke(streamEvent(animalModifyRecord({ animalName: 'Rex' })))

    const putCall = dynamoSendMock.mock.calls.find((call: any[]) => (call[0] as SentCommand).commandName === 'Put')
    expect(putCall).toBeDefined()
    const item = (putCall![0] as SentCommand).input.Item as Record<string, unknown>
    expect(item.recipientID).toBe('owner-1::owner@test.example')
    expect(item.type).toBe('ANIMAL_VALIDATED')
    expect(item.data).toEqual({ animalName: 'Rex' })

    expect(sesSendMock).toHaveBeenCalledTimes(1)
    const [sesCommand] = sesSendMock.mock.calls[0]
    expect((sesCommand as SentCommand).input.Destination).toEqual({
      ToAddresses: ['owner@test.example'],
    })
    expect((sesCommand as SentCommand).input.Message.Subject.Data).toContain('Rex')
  })

  it('ignore un MODIFY qui ne transitionne PAS vers isValidatedDonor=true (déjà validé avant)', async () => {
    mockOwnerGet('owner-1::owner@test.example', 'owner@test.example')

    await invoke(streamEvent(animalModifyRecord({ wasValidated: true, isValidated: true })))

    expect(sesSendMock).not.toHaveBeenCalled()
    expect(dynamoSendMock.mock.calls.some((call: any[]) => (call[0] as SentCommand).commandName === 'Put')).toBe(false)
  })

  it('ignore une transition vers false (invalidation, si jamais elle existait un jour)', async () => {
    await invoke(streamEvent(animalModifyRecord({ wasValidated: true, isValidated: false })))

    expect(sesSendMock).not.toHaveBeenCalled()
  })

  it('ignore les enregistrements INSERT/REMOVE', async () => {
    const insertRecord: DynamoDBRecord = {
      eventName: 'INSERT',
      dynamodb: { NewImage: { isValidatedDonor: { BOOL: true } } },
    }
    await invoke(streamEvent(insertRecord))

    expect(sesSendMock).not.toHaveBeenCalled()
  })

  it("n'envoie rien si l'Owner est introuvable/incomplet (owner/email)", async () => {
    mockOwnerGet(null, null)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await invoke(streamEvent(animalModifyRecord()))

    expect(sesSendMock).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it("best-effort : un échec SES n'empêche pas l'écriture du badge, et inversement", async () => {
    mockOwnerGet('owner-1::owner@test.example', 'owner@test.example')
    sesSendMock.mockRejectedValue(new Error('Email address is not verified'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(invoke(streamEvent(animalModifyRecord()))).resolves.not.toThrow()

    const putCall = dynamoSendMock.mock.calls.find((call: any[]) => (call[0] as SentCommand).commandName === 'Put')
    expect(putCall).toBeDefined()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
