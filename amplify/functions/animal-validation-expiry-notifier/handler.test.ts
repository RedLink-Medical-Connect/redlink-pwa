// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Context } from 'aws-lambda'
import { handler } from './handler'

/**
 * Test du handler PLANIFIÉ `animal-validation-expiry-notifier` (système de notifications,
 * 2026-09-18) -- même forme que `mission-validation-auto-finalizer/handler.test.ts` (pas
 * d'événement en entrée, juste un contexte factice). Portée : le Scan filtré, la notification
 * (badge + email), le marquage anti-double-notification, et le best-effort (jamais fail-loud,
 * à la différence de `mission-validation-auto-finalizer`).
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
  ScanCommand: class {
    readonly commandName = 'Scan'
    constructor(readonly input: Record<string, unknown>) {}
  },
  UpdateCommand: class {
    readonly commandName = 'Update'
    constructor(readonly input: Record<string, unknown>) {}
  },
  PutCommand: class {
    readonly commandName = 'Put'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

type SentCommand = { commandName: string; input: Record<string, any> }

const ANIMAL_TABLE = 'Animal-test-table'
const OWNER_TABLE = 'Owner-test-table'
const NOTIFICATION_TABLE = 'Notification-test-table'
const SENDER_EMAIL = 'sender@test.example'

const invoke = async () => (await handler({}, {} as Context, () => {})) as Record<string, unknown>
const calls = () => dynamoSendMock.mock.calls.map((call: any[]) => call[0] as SentCommand)
const callsByName = (name: string) => calls().filter((c) => c.commandName === name)

describe('animal-validation-expiry-notifier handler', () => {
  beforeEach(() => {
    sesSendMock.mockReset()
    sesSendMock.mockResolvedValue({})
    dynamoSendMock.mockReset()
    process.env.SES_SENDER_EMAIL = SENDER_EMAIL
    process.env.ANIMAL_TABLE_NAME = ANIMAL_TABLE
    process.env.OWNER_TABLE_NAME = OWNER_TABLE
    process.env.NOTIFICATION_TABLE_NAME = NOTIFICATION_TABLE
  })

  afterEach(() => {
    delete process.env.SES_SENDER_EMAIL
    delete process.env.ANIMAL_TABLE_NAME
    delete process.env.OWNER_TABLE_NAME
    delete process.env.NOTIFICATION_TABLE_NAME
  })

  it('la FilterExpression du Scan compare bien validationExpiresAt à donorValidationExpiryNotifiedAt (pas une simple présence/absence)', async () => {
    dynamoSendMock.mockResolvedValue({ Items: [] })

    await invoke()

    const scan = callsByName('Scan')[0]
    expect(scan.input.FilterExpression).toContain('validationExpiresAt <= :now')
    expect(scan.input.FilterExpression).toContain('donorValidationExpiryNotifiedAt < validationExpiresAt')
  })

  it('notifie (badge + email) un Animal expiré jamais notifié, puis marque donorValidationExpiryNotifiedAt', async () => {
    dynamoSendMock.mockImplementation((command: SentCommand) => {
      if (command.commandName === 'Scan') {
        return Promise.resolve({
          Items: [{ id: 'animal-1', name: 'Rex', ownerID: 'owner-1', validationExpiresAt: '2026-01-01T00:00:00.000Z' }],
        })
      }
      if (command.commandName === 'Get') {
        return Promise.resolve({ Item: { owner: 'owner-1-sub::owner@test.example', email: 'owner@test.example' } })
      }
      return Promise.resolve({})
    })

    const summary = await invoke()

    const puts = callsByName('Put')
    expect(puts).toHaveLength(1)
    expect(puts[0].input.Item).toMatchObject({
      recipientID: 'owner-1-sub::owner@test.example',
      type: 'ANIMAL_VALIDATION_EXPIRED',
      data: { animalName: 'Rex' },
    })

    expect(sesSendMock).toHaveBeenCalledTimes(1)
    expect(sesSendMock.mock.calls[0][0].input.Destination).toEqual({ ToAddresses: ['owner@test.example'] })

    const updates = callsByName('Update')
    expect(updates).toHaveLength(1)
    expect(updates[0].input.Key).toEqual({ id: 'animal-1' })
    expect(updates[0].input.ConditionExpression).toContain(
      'donorValidationExpiryNotifiedAt < validationExpiresAt',
    )

    expect(summary).toMatchObject({ candidatesScanned: 1, notified: 1, skippedIncomplete: 0 })
  })

  it('ignore un Animal sans name/ownerID (données incomplètes)', async () => {
    dynamoSendMock.mockImplementation((command: SentCommand) => {
      if (command.commandName === 'Scan') {
        return Promise.resolve({ Items: [{ id: 'animal-1', validationExpiresAt: '2026-01-01T00:00:00.000Z' }] })
      }
      return Promise.resolve({})
    })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const summary = await invoke()

    expect(callsByName('Put')).toHaveLength(0)
    expect(sesSendMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ notified: 0, skippedIncomplete: 1 })
    consoleErrorSpy.mockRestore()
  })

  it("n'envoie rien si l'Owner est introuvable/incomplet", async () => {
    dynamoSendMock.mockImplementation((command: SentCommand) => {
      if (command.commandName === 'Scan') {
        return Promise.resolve({
          Items: [{ id: 'animal-1', name: 'Rex', ownerID: 'owner-1', validationExpiresAt: '2026-01-01T00:00:00.000Z' }],
        })
      }
      if (command.commandName === 'Get') return Promise.resolve({ Item: undefined })
      return Promise.resolve({})
    })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const summary = await invoke()

    expect(sesSendMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ notified: 0, skippedIncomplete: 1 })
    consoleErrorSpy.mockRestore()
  })

  it('best-effort JAMAIS fail-loud : un échec SES ne fait pas rejeter le handler (contrairement à mission-validation-auto-finalizer)', async () => {
    dynamoSendMock.mockImplementation((command: SentCommand) => {
      if (command.commandName === 'Scan') {
        return Promise.resolve({
          Items: [{ id: 'animal-1', name: 'Rex', ownerID: 'owner-1', validationExpiresAt: '2026-01-01T00:00:00.000Z' }],
        })
      }
      if (command.commandName === 'Get') {
        return Promise.resolve({ Item: { owner: 'owner-1-sub::owner@test.example', email: 'owner@test.example' } })
      }
      return Promise.resolve({})
    })
    sesSendMock.mockRejectedValue(new Error('Email address is not verified'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(invoke()).resolves.not.toThrow()

    // Le badge et le marquage anti-double-notification restent tentés même après l'échec SES.
    expect(callsByName('Put')).toHaveLength(1)
    expect(callsByName('Update')).toHaveLength(1)
    consoleErrorSpy.mockRestore()
  })

  it('aucun candidat -> aucune écriture', async () => {
    dynamoSendMock.mockResolvedValue({ Items: [] })

    const summary = await invoke()

    expect(sesSendMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ candidatesScanned: 0, notified: 0 })
  })
})
