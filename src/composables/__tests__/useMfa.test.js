import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMfa } from '@/composables/useMfa'

// BFF Cognito (2026-09-06, docs/adr/0021-bff-cognito-session-cloudfront.md §6bis) :
// `useMfa.js` n'appelait jusqu'ici aucun test, mais parlait à `aws-amplify/auth` directement
// (opérations authentifiées TOTP) -- réécrit pour appeler 4 routes BFF via `fetch()`. Ce
// fichier couvre les 4 fonctions exposées, avec un focus sur le contenu exact du QR code
// (`buildTotpUri`, format repris à l'identique d'Amplify -- voir le commentaire de tête de
// useMfa.js) puisqu'une régression y serait invisible sans test (un QR code légèrement faux
// ne "plante" pas, il échoue silencieusement à l'enrôlement).

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

describe('useMfa().fetchStatus', () => {
  it('GET /api/auth/mfa/status, isEnabled reflète enabled', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) })

    const { fetchStatus, isEnabled } = useMfa()
    await fetchStatus()

    expect(isEnabled.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/mfa/status',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('échec réseau : error posé, isEnabled inchangé', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'MFA_STATUS_FAILED' }) })

    const { fetchStatus, error, isEnabled } = useMfa()
    await fetchStatus()

    expect(error.value).toBe('errors.mfa_status_failed')
    expect(isEnabled.value).toBe(false)
  })
})

describe('useMfa().startEnrollment', () => {
  it('construit un URI otpauth:// au format EXACT attendu par une app TOTP', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ secretCode: 'JBSWY3DPEHPK3PXP' }) })

    const { startEnrollment, setupDetails } = useMfa()
    const result = await startEnrollment('jean@example.com')

    expect(result).toBe(true)
    expect(setupDetails.value).toEqual({
      sharedSecret: 'JBSWY3DPEHPK3PXP',
      uri: 'otpauth://totp/Redlink:jean@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Redlink',
    })
  })

  it('échec : setupDetails reste null, error posé', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'MFA_SETUP_FAILED' }) })

    const { startEnrollment, setupDetails, error } = useMfa()
    const result = await startEnrollment('jean@example.com')

    expect(result).toBe(false)
    expect(setupDetails.value).toBeNull()
    expect(error.value).toBe('errors.mfa_setup_failed')
  })
})

describe('useMfa().cancelEnrollment', () => {
  it('efface setupDetails sans appel réseau', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ secretCode: 'ABC' }) })
    const { startEnrollment, cancelEnrollment, setupDetails } = useMfa()
    await startEnrollment('jean@example.com')

    cancelEnrollment()

    expect(setupDetails.value).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('useMfa().confirmEnrollment', () => {
  it('succès : POST /api/auth/mfa/verify avec le code, isEnabled true, setupDetails effacé', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'ENABLED' }) })

    const { confirmEnrollment, isEnabled, setupDetails } = useMfa()
    const result = await confirmEnrollment('123456')

    expect(result).toBe(true)
    expect(isEnabled.value).toBe(true)
    expect(setupDetails.value).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/mfa/verify',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: '123456' }) }),
    )
  })

  it('code invalide : isEnabled reste false, error posé', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'MFA_VERIFICATION_FAILED' }) })

    const { confirmEnrollment, isEnabled, error } = useMfa()
    const result = await confirmEnrollment('000000')

    expect(result).toBe(false)
    expect(isEnabled.value).toBe(false)
    expect(error.value).toBe('errors.mfa_verification_failed')
  })
})

describe('useMfa().disable', () => {
  it('succès : isEnabled false', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'DISABLED' }) })

    const { disable, isEnabled } = useMfa()
    const result = await disable()

    expect(result).toBe(true)
    expect(isEnabled.value).toBe(false)
  })

  it('échec : error posé', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'MFA_DISABLE_FAILED' }) })

    const { disable, error } = useMfa()
    const result = await disable()

    expect(result).toBe(false)
    expect(error.value).toBe('errors.mfa_disable_failed')
  })
})
