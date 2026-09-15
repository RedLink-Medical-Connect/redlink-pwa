import { describe, it, expect, vi, beforeEach } from 'vitest'

// Vérification d'identité vétérinaire (RPPS + numéro d'ordre) avant activation d'une Clinic --
// plan de durcissement sécurité "Différé 1". `useClinicVerification()` n'expose qu'une seule
// fonction (`fetchVerificationStatus`), appelée par la garde de navigation
// (`src/router/index.js`) -- même convention de mock que `useAnimalValidation.test.js`
// (mock dédié par méthode plutôt qu'un unique `graphqlMock`).

const vetGetMock = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('@/services/bff-graphql-client', () => ({
  generateClient: () => ({
    models: {
      Veterinarian: {
        get: (...args) => vetGetMock(...args),
      },
    },
  }),
}))

vi.mock('@/services/bff-auth-session', () => ({
  getCurrentUser: (...args) => getCurrentUserMock(...args),
}))

import { useClinicVerification } from '@/composables/useClinicVerification'

const resetAllMocks = () => {
  vetGetMock.mockReset()
  getCurrentUserMock.mockReset()
}

describe('useClinicVerification.fetchVerificationStatus', () => {
  beforeEach(resetAllMocks)

  it("retourne le statut de vérification de la Clinic du vétérinaire courant, avec un selectionSet réduit au seul champ nécessaire", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({
      data: { clinic: { verificationStatus: 'PENDING' } },
      errors: undefined,
    })

    const { fetchVerificationStatus } = useClinicVerification()
    const status = await fetchVerificationStatus()

    expect(status).toBe('PENDING')
    expect(vetGetMock).toHaveBeenCalledWith(
      { id: 'vet-1' },
      { selectionSet: ['clinic.verificationStatus'] },
    )
  })

  it('retourne null si aucun utilisateur courant (pas de session résolue)', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: null })

    const { fetchVerificationStatus } = useClinicVerification()
    const status = await fetchVerificationStatus()

    expect(status).toBeNull()
    expect(vetGetMock).not.toHaveBeenCalled()
  })

  it("retourne null si le Veterinarian n'a pas encore de clinic résolue (donnée absente plutôt qu'une exception)", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({ data: { clinic: null }, errors: undefined })

    const { fetchVerificationStatus } = useClinicVerification()
    const status = await fetchVerificationStatus()

    expect(status).toBeNull()
  })

  it('relance (propage) une erreur GraphQL/@auth résolue par le client Gen2 -- la garde de navigation doit pouvoir la catcher (fail-open, voir src/router/index.js)', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access getVeterinarian' }],
    })

    const { fetchVerificationStatus } = useClinicVerification()

    await expect(fetchVerificationStatus()).rejects.toThrow()
  })
})
