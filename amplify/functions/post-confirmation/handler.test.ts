import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { handler as rawHandler } from './handler'

// La signature réelle d'un PostConfirmationTriggerHandler AWS Lambda prend
// (event, context, callback). Ce handler n'utilise que `event` (comme son
// équivalent Gen1) -- on caste vers un type permissif ici, plutôt que de
// fabriquer des fixtures `Context`/`Callback` complètes sans valeur pour le
// test, pour rester au plus près du style d'appel du fichier Gen1
// (`handler(buildEvent(...))`, un seul argument).
const handler = rawHandler as unknown as (
  event: ReturnType<typeof buildEvent>,
) => Promise<ReturnType<typeof buildEvent>>

// Équivalent Gen2 de
// amplify/backend/function/redlinkpwa056b43b0056b43b0PostConfirmation/src/add-to-group.spec.js
// (Phase 8, sous-tâche 3 -- voir ADR-0008). Cas retirés par rapport au fichier Gen1 : la
// création paresseuse du groupe (GetGroupCommand/CreateGroupCommand) et la gestion de la
// fenêtre de course GroupExistsException n'existent plus structurellement -- les groupes
// sont créés au déploiement par `defineAuth({ groups: [...] })`, avant qu'aucun signup ne
// puisse avoir lieu. Cas conservés : mapping profil -> groupe, no-op sur profil non reconnu,
// et surtout le comportement fail-loud (ne pas avaler un AdminAddUserToGroupCommand qui
// échoue) qui reste la garantie centrale héritée de la Phase 7.3.
//
// Même contrainte technique que le fichier Gen1 : handler.ts n'a pas de mock du SDK par
// module (vi.mock ne serait pas fiable ici pour la même raison que documentée dans le
// fichier Gen1 -- mais surtout, ici, l'objectif est de stubber uniquement l'appel réseau,
// pas de réimplémenter la classe). On stub directement `CognitoIdentityProviderClient.prototype.send`.

const sendSpy = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send')

afterAll(() => {
  sendSpy.mockRestore()
})

// `profile` optionnel (pas de valeur par défaut) : reflète que Cognito peut
// réellement envoyer `userAttributes` sans la clé `profile` (jamais
// renseignée au signup) -- un paramètre par défaut JS masquerait ce cas
// (`buildEvent(undefined)` retomberait silencieusement sur une valeur par
// défaut plutôt que d'omettre la clé).
function buildEvent(profile?: string) {
  return {
    userPoolId: 'pool-123',
    userName: 'user-abc',
    request: {
      userAttributes: profile !== undefined ? { profile } : {},
    },
  }
}

describe('PostConfirmation post-confirmation handler (Gen2)', () => {
  beforeEach(() => {
    sendSpy.mockReset()
  })

  it('adds a vet to the Veterinarians group and resolves with the event', async () => {
    // `send` est surchargé (style callback vs. style Promise) : le cast `as never` lève
    // l'ambiguïté de surcharge que TypeScript résout autrement sur le mauvais overload
    // (callback, retour `void`) -- pattern courant pour mocker les clients AWS SDK v3.
    sendSpy.mockResolvedValue({} as never)

    const event = buildEvent('vet')
    await expect(handler(event)).resolves.toBe(event)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    const [command] = sendSpy.mock.calls[0]
    expect(command).toBeInstanceOf(AdminAddUserToGroupCommand)
    expect(command.input).toEqual({
      GroupName: 'Veterinarians',
      UserPoolId: 'pool-123',
      Username: 'user-abc',
    })
  })

  it('adds an owner to the Owners group and resolves with the event', async () => {
    sendSpy.mockResolvedValue({} as never)

    const event = buildEvent('owner')
    await expect(handler(event)).resolves.toBe(event)

    const [command] = sendSpy.mock.calls[0]
    expect(command.input).toMatchObject({ GroupName: 'Owners' })
  })

  it('does not call the SDK and returns the event untouched for an unrecognized profile', async () => {
    const event = buildEvent('not-a-real-profile')
    await expect(handler(event)).resolves.toBe(event)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('does not call the SDK and returns the event untouched when profile is absent (not just unrecognized)', async () => {
    // Distinct de "profil non reconnu" : ici `profile` lui-même est falsy, ce
    // qui emprunte la branche `profile ? PROFILE_TO_GROUP[profile] : undefined`
    // côté condition (pas un lookup qui échoue), plutôt qu'un accès
    // `PROFILE_TO_GROUP['not-a-real-profile']` qui renvoie `undefined`. Même
    // comportement observable, mais un branchement de code distinct -- vaut
    // son propre cas plutôt que d'être supposé couvert par le cas précédent.
    const event = buildEvent()
    await expect(handler(event)).resolves.toBe(event)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('re-throws (does not swallow) when AdminAddUserToGroupCommand rejects, without a silent retry or fallback success', async () => {
    const rejection = new Error('AccessDenied: cannot add user to group')
    sendSpy.mockRejectedValue(rejection)

    const event = buildEvent('vet')
    // Le point central de la Phase 7.3 (fail-loud) : pas de deuxième tentative
    // silencieuse, pas de retour "normal" (`resolves.toBe(event)`) qui
    // masquerait l'échec à Cognito -- seul un rejet avec l'erreur d'origine,
    // intacte, est acceptable ici.
    await expect(handler(event)).rejects.toBe(rejection)
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })
})
