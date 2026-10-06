import { describe, it, expect, vi, beforeEach } from 'vitest'

// Popup post-inscription "se lier à une clinique" (ClinicLinkDialog.vue). Même convention de
// mock que useAnimalValidation.test.js : un mock dédié par méthode `client.models.X.*`.

const clinicListMock = vi.fn()
const relationListMock = vi.fn()
const relationCreateMock = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('@/services/bff-graphql-client', () => ({
  generateClient: () => ({
    models: {
      Clinic: { list: (...args) => clinicListMock(...args) },
      ClinicOwnerRelation: {
        list: (...args) => relationListMock(...args),
        create: (...args) => relationCreateMock(...args),
      },
    },
  }),
}))

vi.mock('@/services/bff-auth-session', () => ({
  getCurrentUser: (...args) => getCurrentUserMock(...args),
}))

import { useClinicLink, mapClinicLinkErrorKey } from '@/composables/useClinicLink'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getCurrentUserMock.mockResolvedValue({ userId: 'owner-1', username: 'owner-1' })
})

describe('fetchClinics', () => {
  it('charge toutes les pages (nextToken), en ne sélectionnant que id/name/address', async () => {
    clinicListMock
      .mockResolvedValueOnce({ data: [{ id: 'c1', name: 'A', address: 'x' }], nextToken: 'tok' })
      .mockResolvedValueOnce({ data: [{ id: 'c2', name: 'B', address: 'y' }], nextToken: null })

    const { clinics, loadError, isLoading, fetchClinics } = useClinicLink()
    await fetchClinics()

    expect(clinics.value.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(loadError.value).toBeNull()
    expect(isLoading.value).toBe(false)
    expect(clinicListMock).toHaveBeenCalledTimes(2)
    expect(clinicListMock.mock.calls[0][0]).toMatchObject({
      selectionSet: ['id', 'name', 'address'],
      nextToken: null,
    })
    expect(clinicListMock.mock.calls[1][0]).toMatchObject({ nextToken: 'tok' })
    // Pas de filtre sur verificationStatus : champ non lisible par un Owner.
    expect(clinicListMock.mock.calls[0][0].filter).toBeUndefined()
  })

  it('erreur GraphQL : loadError posé, liste inchangée', async () => {
    clinicListMock.mockResolvedValue({ data: null, errors: [{ message: 'boom' }] })

    const { clinics, loadError, fetchClinics } = useClinicLink()
    await fetchClinics()

    expect(loadError.value).toBeTruthy()
    expect(clinics.value).toEqual([])
  })
})

describe('linkToClinic', () => {
  it('première relation de l\'Owner : créée en isPrimaryClinic true, ownerID = sub de l\'appelant', async () => {
    relationListMock.mockResolvedValue({ data: [] })
    relationCreateMock.mockResolvedValue({ data: { id: 'r1' } })

    const { linkToClinic, isLinking } = useClinicLink()
    const created = await linkToClinic('c1')

    expect(created).toBe(true)
    expect(isLinking.value).toBe(false)
    expect(relationListMock.mock.calls[0][0]).toMatchObject({
      filter: { ownerID: { eq: 'owner-1' } },
    })
    expect(relationCreateMock).toHaveBeenCalledWith({
      clinicID: 'c1',
      ownerID: 'owner-1',
      isPrimaryClinic: true,
    })
  })

  it('déjà lié à cette clinique : aucune création (idempotent)', async () => {
    relationListMock.mockResolvedValue({ data: [{ clinicID: 'c1', isPrimaryClinic: true }] })

    const { linkToClinic } = useClinicLink()
    const created = await linkToClinic('c1')

    expect(created).toBe(false)
    expect(relationCreateMock).not.toHaveBeenCalled()
  })

  it('déjà lié à une autre clinique : relation secondaire (isPrimaryClinic false)', async () => {
    relationListMock.mockResolvedValue({ data: [{ clinicID: 'c9', isPrimaryClinic: true }] })
    relationCreateMock.mockResolvedValue({ data: { id: 'r2' } })

    const { linkToClinic } = useClinicLink()
    await linkToClinic('c1')

    expect(relationCreateMock).toHaveBeenCalledWith({
      clinicID: 'c1',
      ownerID: 'owner-1',
      isPrimaryClinic: false,
    })
  })

  it('erreur de création : relance (action explicite, échec visible)', async () => {
    relationListMock.mockResolvedValue({ data: [] })
    relationCreateMock.mockResolvedValue({ errors: [{ errorType: 'Unauthorized' }] })

    const { linkToClinic, isLinking } = useClinicLink()
    await expect(linkToClinic('c1')).rejects.toThrow()
    expect(isLinking.value).toBe(false)
  })

  it('sans session : NOT_AUTHENTICATED, aucune lecture/écriture', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: null })

    const { linkToClinic } = useClinicLink()
    await expect(linkToClinic('c1')).rejects.toThrow('NOT_AUTHENTICATED')
    expect(relationListMock).not.toHaveBeenCalled()
  })

  it('sans clinicID : CLINIC_REQUIRED', async () => {
    const { linkToClinic } = useClinicLink()
    await expect(linkToClinic('')).rejects.toThrow('CLINIC_REQUIRED')
  })
})

describe('mapClinicLinkErrorKey', () => {
  it('mappe les cas connus vers une clé i18n', () => {
    expect(mapClinicLinkErrorKey(new Error('NOT_AUTHENTICATED'))).toBe(
      'dashboard.clinic_link.errors.session',
    )
    expect(mapClinicLinkErrorKey({ errors: [{ errorType: 'Unauthorized' }] })).toBe(
      'dashboard.clinic_link.errors.unauthorized',
    )
    expect(mapClinicLinkErrorKey(new Error('other'))).toBe('dashboard.clinic_link.errors.generic')
    expect(mapClinicLinkErrorKey(undefined)).toBe('dashboard.clinic_link.errors.generic')
  })
})
