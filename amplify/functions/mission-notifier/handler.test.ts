// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Context, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda'
import { handler } from './handler'

/**
 * Test du handler `mission-notifier` (système de notifications, 2026-09-18) -- couvre les
 * TROIS branches (INSERT -> MISSION_ACCEPTED, MODIFY -> PENDING_VALIDATION ->
 * MISSION_VALIDATION_REMINDER, MODIFY -> DISPUTED -> MISSION_DISPUTED). Même forme que les
 * autres `handler.test.ts` de ce système : SDK mockés au niveau MODULE.
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

type SentCommand = { commandName: string; input: Record<string, any> }

const REQUEST_TABLE = 'Request-test-table'
const CLINIC_TABLE = 'Clinic-test-table'
const ANIMAL_TABLE = 'Animal-test-table'
const OWNER_TABLE = 'Owner-test-table'
const NOTIFICATION_TABLE = 'Notification-test-table'
const SENDER_EMAIL = 'sender@test.example'
const ADMIN_EMAIL = 'admin@test.example'

const CLINIC_OWNER = 'clinic-vet-sub::vet@test.example'
const CLINIC_EMAIL = 'clinic@test.example'
const OWNER_OWNER = 'owner-sub::owner@test.example'
const OWNER_EMAIL = 'owner@test.example'

/** Table de données en mémoire pour le mock GetCommand, par TableName + id. */
function setupGetItemMock(rows: Record<string, Record<string, Record<string, unknown>>>) {
  dynamoSendMock.mockImplementation((command: SentCommand) => {
    if (command.commandName === 'Get') {
      const { TableName, Key } = command.input as { TableName: string; Key: { id: string } }
      const item = rows[TableName]?.[Key.id]
      return Promise.resolve({ Item: item })
    }
    return Promise.resolve({})
  })
}

const streamEvent = (...Records: DynamoDBRecord[]): DynamoDBStreamEvent => ({ Records })
const invoke = async (event: DynamoDBStreamEvent): Promise<void> => {
  await handler(event, {} as Context, () => {})
}
const putCalls = () =>
  dynamoSendMock.mock.calls
    .map((call: any[]) => call[0] as SentCommand)
    .filter((c: SentCommand) => c.commandName === 'Put')

describe('mission-notifier handler', () => {
  beforeEach(() => {
    sesSendMock.mockReset()
    sesSendMock.mockResolvedValue({})
    dynamoSendMock.mockReset()
    process.env.SES_SENDER_EMAIL = SENDER_EMAIL
    process.env.ADMIN_NOTIFICATION_EMAIL = ADMIN_EMAIL
    process.env.REQUEST_TABLE_NAME = REQUEST_TABLE
    process.env.CLINIC_TABLE_NAME = CLINIC_TABLE
    process.env.ANIMAL_TABLE_NAME = ANIMAL_TABLE
    process.env.OWNER_TABLE_NAME = OWNER_TABLE
    process.env.NOTIFICATION_TABLE_NAME = NOTIFICATION_TABLE
  })

  afterEach(() => {
    delete process.env.SES_SENDER_EMAIL
    delete process.env.ADMIN_NOTIFICATION_EMAIL
    delete process.env.REQUEST_TABLE_NAME
    delete process.env.CLINIC_TABLE_NAME
    delete process.env.ANIMAL_TABLE_NAME
    delete process.env.OWNER_TABLE_NAME
    delete process.env.NOTIFICATION_TABLE_NAME
  })

  describe('INSERT -> MISSION_ACCEPTED (Clinic)', () => {
    const insertRecord = (): DynamoDBRecord => ({
      eventName: 'INSERT',
      dynamodb: {
        NewImage: {
          id: { S: 'mission-1' },
          requestID: { S: 'request-1' },
          animalID: { S: 'animal-1' },
          status: { S: 'PENDING_ARRIVAL' },
        },
      },
    })

    it('notifie la Clinic référente (badge + email) avec le nom de l’animal', async () => {
      setupGetItemMock({
        [REQUEST_TABLE]: { 'request-1': { clinicID: 'clinic-1' } },
        [CLINIC_TABLE]: { 'clinic-1': { owner: CLINIC_OWNER, name: 'Clinique Alfort', email: CLINIC_EMAIL } },
        [ANIMAL_TABLE]: { 'animal-1': { name: 'Rex', ownerID: 'owner-1' } },
      })

      await invoke(streamEvent(insertRecord()))

      const put = putCalls()[0]
      expect(put.input.Item.recipientID).toBe(CLINIC_OWNER)
      expect(put.input.Item.type).toBe('MISSION_ACCEPTED')
      expect(put.input.Item.data).toEqual({ animalName: 'Rex' })

      expect(sesSendMock).toHaveBeenCalledTimes(1)
      const sesCall = sesSendMock.mock.calls[0][0] as SentCommand
      expect(sesCall.input.Destination).toEqual({ ToAddresses: [CLINIC_EMAIL] })
    })

    it("n'envoie rien si la Clinic est introuvable", async () => {
      setupGetItemMock({
        [REQUEST_TABLE]: { 'request-1': { clinicID: 'clinic-1' } },
        [ANIMAL_TABLE]: { 'animal-1': { name: 'Rex', ownerID: 'owner-1' } },
      })
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await invoke(streamEvent(insertRecord()))

      expect(sesSendMock).not.toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('MODIFY -> PENDING_VALIDATION -> MISSION_VALIDATION_REMINDER', () => {
    const modifyRecord = (opts: {
      oldStatus: string
      ownerValidationOutcome?: string
      clinicValidationOutcome?: string
    }): DynamoDBRecord => ({
      eventName: 'MODIFY',
      dynamodb: {
        OldImage: { status: { S: opts.oldStatus } },
        NewImage: {
          id: { S: 'mission-1' },
          requestID: { S: 'request-1' },
          animalID: { S: 'animal-1' },
          status: { S: 'PENDING_VALIDATION' },
          ...(opts.ownerValidationOutcome
            ? { ownerValidationOutcome: { S: opts.ownerValidationOutcome } }
            : {}),
          ...(opts.clinicValidationOutcome
            ? { clinicValidationOutcome: { S: opts.clinicValidationOutcome } }
            : {}),
        },
      },
    })

    it("relance la Clinic quand l'Owner a voté en premier", async () => {
      setupGetItemMock({
        [REQUEST_TABLE]: { 'request-1': { clinicID: 'clinic-1' } },
        [CLINIC_TABLE]: { 'clinic-1': { owner: CLINIC_OWNER, name: 'Clinique Alfort', email: CLINIC_EMAIL } },
        [ANIMAL_TABLE]: { 'animal-1': { name: 'Rex', ownerID: 'owner-1' } },
      })

      await invoke(
        streamEvent(modifyRecord({ oldStatus: 'ARRIVED', ownerValidationOutcome: 'CONFIRMED' })),
      )

      const put = putCalls()[0]
      expect(put.input.Item.recipientID).toBe(CLINIC_OWNER)
      expect(put.input.Item.type).toBe('MISSION_VALIDATION_REMINDER')
      expect(sesSendMock).toHaveBeenCalledTimes(1)
      expect((sesSendMock.mock.calls[0][0] as SentCommand).input.Destination).toEqual({
        ToAddresses: [CLINIC_EMAIL],
      })
    })

    it("relance l'Owner quand la Clinic a voté en premier", async () => {
      setupGetItemMock({
        [ANIMAL_TABLE]: { 'animal-1': { name: 'Rex', ownerID: 'owner-1' } },
        [OWNER_TABLE]: { 'owner-1': { owner: OWNER_OWNER, email: OWNER_EMAIL } },
      })

      await invoke(
        streamEvent(modifyRecord({ oldStatus: 'ARRIVED', clinicValidationOutcome: 'CONFIRMED' })),
      )

      const put = putCalls()[0]
      expect(put.input.Item.recipientID).toBe(OWNER_OWNER)
      expect(put.input.Item.type).toBe('MISSION_VALIDATION_REMINDER')
      expect(sesSendMock).toHaveBeenCalledTimes(1)
      expect((sesSendMock.mock.calls[0][0] as SentCommand).input.Destination).toEqual({
        ToAddresses: [OWNER_EMAIL],
      })
    })

    it("ignore si le statut était déjà PENDING_VALIDATION (pas une transition fraîche)", async () => {
      await invoke(
        streamEvent(
          modifyRecord({ oldStatus: 'PENDING_VALIDATION', ownerValidationOutcome: 'CONFIRMED' }),
        ),
      )

      expect(sesSendMock).not.toHaveBeenCalled()
      expect(putCalls()).toHaveLength(0)
    })

    it('ignore un résidu de donnée : les deux outcomes déjà renseignés', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await invoke(
        streamEvent(
          modifyRecord({
            oldStatus: 'ARRIVED',
            ownerValidationOutcome: 'CONFIRMED',
            clinicValidationOutcome: 'CONFIRMED',
          }),
        ),
      )

      expect(sesSendMock).not.toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('MODIFY -> DISPUTED -> MISSION_DISPUTED (broadcast Admins)', () => {
    const disputedRecord = (oldStatus: string): DynamoDBRecord => ({
      eventName: 'MODIFY',
      dynamodb: {
        OldImage: { status: { S: oldStatus } },
        NewImage: {
          id: { S: 'mission-1' },
          requestID: { S: 'request-1' },
          animalID: { S: 'animal-1' },
          status: { S: 'DISPUTED' },
          ownerDisputeReason: { S: "L'animal n'a pas été prélevé" },
        },
      },
    })

    it('écrit un broadcast Admins et envoie un email admin', async () => {
      await invoke(streamEvent(disputedRecord('PENDING_VALIDATION')))

      const put = putCalls()[0]
      expect(put.input.Item.recipientGroup).toBe('Admins')
      expect(put.input.Item.recipientID).toBeNull()
      expect(put.input.Item.type).toBe('MISSION_DISPUTED')
      expect(put.input.Item.data).toEqual({
        missionId: 'mission-1',
        disputeReason: "L'animal n'a pas été prélevé",
      })

      expect(sesSendMock).toHaveBeenCalledTimes(1)
      expect((sesSendMock.mock.calls[0][0] as SentCommand).input.Destination).toEqual({
        ToAddresses: [ADMIN_EMAIL],
      })
    })

    it('ignore si le statut était déjà DISPUTED', async () => {
      await invoke(streamEvent(disputedRecord('DISPUTED')))

      expect(sesSendMock).not.toHaveBeenCalled()
      expect(putCalls()).toHaveLength(0)
    })
  })

  it('best-effort : un échec SES sur une branche ne bloque pas les enregistrements suivants du même lot', async () => {
    setupGetItemMock({
      [REQUEST_TABLE]: { 'request-1': { clinicID: 'clinic-1' } },
      [CLINIC_TABLE]: { 'clinic-1': { owner: CLINIC_OWNER, name: 'Clinique Alfort', email: CLINIC_EMAIL } },
      [ANIMAL_TABLE]: { 'animal-1': { name: 'Rex', ownerID: 'owner-1' } },
    })
    sesSendMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const first: DynamoDBRecord = {
      eventName: 'INSERT',
      dynamodb: {
        NewImage: {
          id: { S: 'mission-1' },
          requestID: { S: 'request-1' },
          animalID: { S: 'animal-1' },
          status: { S: 'PENDING_ARRIVAL' },
        },
      },
    }
    const second: DynamoDBRecord = {
      eventName: 'INSERT',
      dynamodb: {
        NewImage: {
          id: { S: 'mission-2' },
          requestID: { S: 'request-1' },
          animalID: { S: 'animal-1' },
          status: { S: 'PENDING_ARRIVAL' },
        },
      },
    }

    await expect(invoke(streamEvent(first, second))).resolves.not.toThrow()

    expect(sesSendMock).toHaveBeenCalledTimes(2)
    expect(putCalls()).toHaveLength(2)
    consoleErrorSpy.mockRestore()
  })
})
