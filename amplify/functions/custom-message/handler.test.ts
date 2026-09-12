// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { handler as rawHandler } from './handler'

// Même approche que post-confirmation/handler.test.ts : la signature réelle d'un
// CustomMessageTriggerHandler prend (event, context, callback), ce handler n'utilise que
// `event` -- on caste vers un type permissif plutôt que de fabriquer des fixtures
// Context/Callback sans valeur pour le test.
const handler = rawHandler as unknown as (
  event: ReturnType<typeof buildEvent>,
) => Promise<ReturnType<typeof buildEvent>>

function buildEvent(triggerSource: string, clientMetadata?: Record<string, string>) {
  return {
    triggerSource,
    request: {
      codeParameter: '123456',
      clientMetadata,
    },
    response: {
      emailSubject: undefined as string | undefined,
      emailMessage: undefined as string | undefined,
    },
  }
}

describe('custom-message handler', () => {
  it('CustomMessage_SignUp : rend l\'email de vérification (français par défaut)', async () => {
    const event = await handler(buildEvent('CustomMessage_SignUp'))
    expect(event.response.emailSubject).toBe('Confirmez votre adresse email Redlink')
    expect(event.response.emailMessage).toContain('123456')
  })

  it('CustomMessage_ResendCode : même email que CustomMessage_SignUp', async () => {
    const event = await handler(buildEvent('CustomMessage_ResendCode'))
    expect(event.response.emailSubject).toBe('Confirmez votre adresse email Redlink')
  })

  it('CustomMessage_ForgotPassword : rend l\'email de réinitialisation', async () => {
    const event = await handler(buildEvent('CustomMessage_ForgotPassword'))
    expect(event.response.emailSubject).toBe('Réinitialisation de votre mot de passe Redlink')
    expect(event.response.emailMessage).toContain('123456')
  })

  it('propage clientMetadata.locale jusqu\'au template (en)', async () => {
    const event = await handler(buildEvent('CustomMessage_SignUp', { locale: 'en' }))
    expect(event.response.emailSubject).toBe('Confirm your Redlink email address')
  })

  it('triggerSource non géré (ex. AdminCreateUser) : ne modifie pas la réponse, laisse Cognito appliquer son template par défaut', async () => {
    const event = await handler(buildEvent('CustomMessage_AdminCreateUser'))
    expect(event.response.emailSubject).toBeUndefined()
    expect(event.response.emailMessage).toBeUndefined()
  })
})
