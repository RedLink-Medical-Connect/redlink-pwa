// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Context, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda'
import { handler } from './handler'

/**
 * Test du handler `request-matcher-notifier` (système de notifications, 2026-09-18) -- le plus
 * complexe des Lambdas de ce système (matching + fan-out). Portée : le pipeline de décision
 * complet (Scan Animal filtré -> revérification JS -> dédoublonnage par Owner -> distance ->
 * disponibilité RDV) et le best-effort par Owner. Le détail des fonctions pures de matching est
 * déjà couvert par `../shared/eligibility.test.ts` -- pas redécalqué ici.
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
  PutCommand: class {
    readonly commandName = 'Put'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

type SentCommand = { commandName: string; input: Record<string, any> }

const CLINIC_TABLE = 'Clinic-test-table'
const ANIMAL_TABLE = 'Animal-test-table'
const OWNER_TABLE = 'Owner-test-table'
const AVAILABILITY_TABLE = 'OwnerAvailability-test-table'
const NOTIFICATION_TABLE = 'Notification-test-table'
const SENDER_EMAIL = 'sender@test.example'

const FAR_FUTURE = '2099-01-01T00:00:00.000Z'

const insertRequestRecord = (overrides: Partial<{
  requestId: string
  clinicId: string
  requiredSpecies: string
  requiredBloodGroup: string
  requestType: string
  appointmentDatetime: string
  appointmentWindowStart: string
  appointmentWindowEnd: string
}> = {}): DynamoDBRecord => ({
  eventName: 'INSERT',
  dynamodb: {
    NewImage: {
      id: { S: overrides.requestId ?? 'request-1' },
      clinicID: { S: overrides.clinicId ?? 'clinic-1' },
      requiredSpecies: { S: overrides.requiredSpecies ?? 'DOG' },
      requiredBloodGroup: { S: overrides.requiredBloodGroup ?? 'DEA 1.1+' },
      requestType: { S: overrides.requestType ?? 'EMERGENCY' },
      ...(overrides.appointmentDatetime ? { appointmentDatetime: { S: overrides.appointmentDatetime } } : {}),
      ...(overrides.appointmentWindowStart
        ? { appointmentWindowStart: { S: overrides.appointmentWindowStart } }
        : {}),
      ...(overrides.appointmentWindowEnd
        ? { appointmentWindowEnd: { S: overrides.appointmentWindowEnd } }
        : {}),
    },
  },
})

const streamEvent = (...Records: DynamoDBRecord[]): DynamoDBStreamEvent => ({ Records })
const invoke = async (event: DynamoDBStreamEvent): Promise<void> => {
  await handler(event, {} as Context, () => {})
}
const calls = () => dynamoSendMock.mock.calls.map((call: any[]) => call[0] as SentCommand)
const putCalls = () => calls().filter((c) => c.commandName === 'Put')

/** Mock DynamoDB générique : Get par table+id, Scan renvoie la liste fournie pour sa table. */
function setupDynamoMock(config: {
  getItems?: Record<string, Record<string, Record<string, unknown>>>
  scanItems?: Record<string, Record<string, unknown>[]>
}) {
  dynamoSendMock.mockImplementation((command: SentCommand) => {
    if (command.commandName === 'Get') {
      const { TableName, Key } = command.input as { TableName: string; Key: { id: string } }
      return Promise.resolve({ Item: config.getItems?.[TableName]?.[Key.id] })
    }
    if (command.commandName === 'Scan') {
      const { TableName } = command.input as { TableName: string }
      return Promise.resolve({ Items: config.scanItems?.[TableName] ?? [] })
    }
    return Promise.resolve({})
  })
}

const CLINIC = { name: 'Clinique Alfort', latitude: 48.8, longitude: 2.35 }
const validAnimal = (overrides: Record<string, unknown> = {}) => ({
  id: 'animal-1',
  ownerID: 'owner-1',
  species: 'DOG',
  bloodGroup: 'DEA 1.1+',
  isValidatedDonor: true,
  validationExpiresAt: FAR_FUTURE,
  ...overrides,
})
const ownerNearby = (overrides: Record<string, unknown> = {}) => ({
  owner: 'owner-1-sub::owner@test.example',
  email: 'owner@test.example',
  latitude: 48.81,
  longitude: 2.36,
  maxTravelDistance: 50,
  ...overrides,
})

describe('request-matcher-notifier handler', () => {
  beforeEach(() => {
    sesSendMock.mockReset()
    sesSendMock.mockResolvedValue({})
    dynamoSendMock.mockReset()
    process.env.SES_SENDER_EMAIL = SENDER_EMAIL
    process.env.CLINIC_TABLE_NAME = CLINIC_TABLE
    process.env.ANIMAL_TABLE_NAME = ANIMAL_TABLE
    process.env.OWNER_TABLE_NAME = OWNER_TABLE
    process.env.OWNER_AVAILABILITY_TABLE_NAME = AVAILABILITY_TABLE
    process.env.NOTIFICATION_TABLE_NAME = NOTIFICATION_TABLE
  })

  afterEach(() => {
    delete process.env.SES_SENDER_EMAIL
    delete process.env.CLINIC_TABLE_NAME
    delete process.env.ANIMAL_TABLE_NAME
    delete process.env.OWNER_TABLE_NAME
    delete process.env.OWNER_AVAILABILITY_TABLE_NAME
    delete process.env.NOTIFICATION_TABLE_NAME
  })

  it('notifie (badge + email) un Owner dont un Animal est pleinement compatible (EMERGENCY, proximité OK)', async () => {
    setupDynamoMock({
      getItems: {
        [CLINIC_TABLE]: { 'clinic-1': CLINIC },
        [OWNER_TABLE]: { 'owner-1': ownerNearby() },
      },
      scanItems: { [ANIMAL_TABLE]: [validAnimal()] },
    })

    await invoke(streamEvent(insertRequestRecord()))

    expect(putCalls()).toHaveLength(1)
    expect(putCalls()[0].input.Item).toMatchObject({
      recipientID: 'owner-1-sub::owner@test.example',
      type: 'NEW_COMPATIBLE_REQUEST',
      data: { clinicName: 'Clinique Alfort' },
    })
    expect(sesSendMock).toHaveBeenCalledTimes(1)
    expect(sesSendMock.mock.calls[0][0].input.Destination).toEqual({
      ToAddresses: ['owner@test.example'],
    })
  })

  it('ignore un Animal de groupe sanguin incompatible', async () => {
    setupDynamoMock({
      getItems: { [CLINIC_TABLE]: { 'clinic-1': CLINIC } },
      scanItems: { [ANIMAL_TABLE]: [validAnimal({ bloodGroup: 'DEA 4' })] },
    })

    await invoke(streamEvent(insertRequestRecord()))

    expect(putCalls()).toHaveLength(0)
  })

  it("accepte n'importe quel groupe connu quand la Request est UNKNOWN (indifférent)", async () => {
    setupDynamoMock({
      getItems: {
        [CLINIC_TABLE]: { 'clinic-1': CLINIC },
        [OWNER_TABLE]: { 'owner-1': ownerNearby() },
      },
      scanItems: { [ANIMAL_TABLE]: [validAnimal({ bloodGroup: 'DEA 4' })] },
    })

    await invoke(streamEvent(insertRequestRecord({ requiredBloodGroup: 'UNKNOWN' })))

    expect(putCalls()).toHaveLength(1)
  })

  it('re-vérifie en JS la validation expirée même si le Scan la laisse passer (défense en profondeur)', async () => {
    setupDynamoMock({
      getItems: { [CLINIC_TABLE]: { 'clinic-1': CLINIC } },
      scanItems: { [ANIMAL_TABLE]: [validAnimal({ validationExpiresAt: '2000-01-01T00:00:00.000Z' })] },
    })

    await invoke(streamEvent(insertRequestRecord()))

    expect(putCalls()).toHaveLength(0)
  })

  it('exclut un Animal qui ne respecte pas la Frequency Rule (don trop récent)', async () => {
    const recentDate = new Date().toISOString()
    setupDynamoMock({
      getItems: { [CLINIC_TABLE]: { 'clinic-1': CLINIC } },
      scanItems: {
        [ANIMAL_TABLE]: [
          validAnimal({ lastDonationDate: recentDate, donationFrequency: 'ONCE_YEAR' }),
        ],
      },
    })

    await invoke(streamEvent(insertRequestRecord()))

    expect(putCalls()).toHaveLength(0)
  })

  it("exclut un Owner trop loin (distance > maxTravelDistance)", async () => {
    setupDynamoMock({
      getItems: {
        [CLINIC_TABLE]: { 'clinic-1': CLINIC },
        [OWNER_TABLE]: { 'owner-1': ownerNearby({ latitude: 10, longitude: 10, maxTravelDistance: 5 }) },
      },
      scanItems: { [ANIMAL_TABLE]: [validAnimal()] },
    })

    await invoke(streamEvent(insertRequestRecord()))

    expect(putCalls()).toHaveLength(0)
  })

  it("déduplique : deux Animals compatibles du MÊME Owner -> une seule notification", async () => {
    setupDynamoMock({
      getItems: {
        [CLINIC_TABLE]: { 'clinic-1': CLINIC },
        [OWNER_TABLE]: { 'owner-1': ownerNearby() },
      },
      scanItems: {
        [ANIMAL_TABLE]: [
          validAnimal({ id: 'animal-1' }),
          validAnimal({ id: 'animal-2' }),
        ],
      },
    })

    await invoke(streamEvent(insertRequestRecord()))

    expect(putCalls()).toHaveLength(1)
  })

  describe('Request APPOINTMENT -- filtre disponibilité RDV', () => {
    it('notifie si le créneau (heure précise) correspond à une disponibilité déclarée', async () => {
      // 2026-09-21 est un lundi (dayOfWeek 1).
      setupDynamoMock({
        getItems: {
          [CLINIC_TABLE]: { 'clinic-1': CLINIC },
          [OWNER_TABLE]: { 'owner-1': ownerNearby() },
        },
        scanItems: {
          [ANIMAL_TABLE]: [validAnimal()],
          [AVAILABILITY_TABLE]: [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }],
        },
      })

      await invoke(
        streamEvent(
          insertRequestRecord({
            requestType: 'APPOINTMENT',
            appointmentDatetime: '2026-09-21T10:00:00.000Z',
          }),
        ),
      )

      expect(putCalls()).toHaveLength(1)
    })

    it('ignore si le créneau ne correspond à aucune disponibilité déclarée', async () => {
      setupDynamoMock({
        getItems: {
          [CLINIC_TABLE]: { 'clinic-1': CLINIC },
          [OWNER_TABLE]: { 'owner-1': ownerNearby() },
        },
        scanItems: {
          [ANIMAL_TABLE]: [validAnimal()],
          [AVAILABILITY_TABLE]: [{ dayOfWeek: 2, startTime: '09:00', endTime: '18:00' }],
        },
      })

      await invoke(
        streamEvent(
          insertRequestRecord({
            requestType: 'APPOINTMENT',
            appointmentDatetime: '2026-09-21T10:00:00.000Z',
          }),
        ),
      )

      expect(putCalls()).toHaveLength(0)
    })

    it('mode plage horaire (appointmentWindowStart/End) : notifie sur recouvrement', async () => {
      setupDynamoMock({
        getItems: {
          [CLINIC_TABLE]: { 'clinic-1': CLINIC },
          [OWNER_TABLE]: { 'owner-1': ownerNearby() },
        },
        scanItems: {
          [ANIMAL_TABLE]: [validAnimal()],
          [AVAILABILITY_TABLE]: [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }],
        },
      })

      await invoke(
        streamEvent(
          insertRequestRecord({
            requestType: 'APPOINTMENT',
            appointmentWindowStart: '2026-09-21T10:00:00.000Z',
            appointmentWindowEnd: '2026-09-21T11:00:00.000Z',
          }),
        ),
      )

      expect(putCalls()).toHaveLength(1)
    })
  })

  it("n'envoie rien si la Clinic est introuvable", async () => {
    setupDynamoMock({ getItems: {}, scanItems: {} })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await invoke(streamEvent(insertRequestRecord()))

    expect(putCalls()).toHaveLength(0)
    consoleErrorSpy.mockRestore()
  })

  it('ignore les enregistrements MODIFY/REMOVE', async () => {
    const modifyRecord: DynamoDBRecord = { eventName: 'MODIFY', dynamodb: { NewImage: {} } }
    await invoke(streamEvent(modifyRecord))

    expect(dynamoSendMock).not.toHaveBeenCalled()
  })

  it('best-effort PAR OWNER : un échec SES pour un Owner ne bloque pas la notification des autres', async () => {
    setupDynamoMock({
      getItems: {
        [CLINIC_TABLE]: { 'clinic-1': CLINIC },
        [OWNER_TABLE]: {
          'owner-1': ownerNearby({ owner: 'owner-1-sub::a@test.example', email: 'a@test.example' }),
          'owner-2': ownerNearby({ owner: 'owner-2-sub::b@test.example', email: 'b@test.example' }),
        },
      },
      scanItems: {
        [ANIMAL_TABLE]: [
          validAnimal({ id: 'animal-1', ownerID: 'owner-1' }),
          validAnimal({ id: 'animal-2', ownerID: 'owner-2' }),
        ],
      },
    })
    sesSendMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(invoke(streamEvent(insertRequestRecord()))).resolves.not.toThrow()

    expect(putCalls()).toHaveLength(2)
    expect(sesSendMock).toHaveBeenCalledTimes(2)
    consoleErrorSpy.mockRestore()
  })
})
