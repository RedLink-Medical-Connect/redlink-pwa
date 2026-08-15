import { describe, it, expect } from 'vitest'
import { createApp } from 'vue'

// Sous-tâche Phase 7.4 (R-06) : `usePassword.js` (utilisé par RegisterOwnerView.vue et
// RegisterClinicView.vue pour valider le mot de passe au inscription) n'avait aucun test.
// Aucune modification de code de production ici — seulement des tests — sauf constat d'un
// vrai bug (voir la note ci-dessous sur `isValid`).
//
// `usePassword()` appelle `useI18n()`/`t()` directement (contrairement à la convention
// documentée dans CLAUDE.md pour les composables — qui doivent renvoyer une CLÉ i18n et
// laisser le composant appelant traduire, cf. `mapValidationErrorKey` dans
// useAnimalValidation.js). C'est une exception préexistante, pas introduite par cette
// sous-tâche (hors périmètre : la consigne est "aucune modification de code de production
// attendue ici"). Conséquence pour ce fichier de test : `useI18n()` exige d'être appelé
// dans un contexte de composant Vue actif avec le plugin vue-i18n installé (`legacy:
// false` dans src/i18n.js -> useI18n() sans options locales lit l'instance globale) --
// `withSetup` ci-dessous reproduit ce contexte minimal sans monter de vrai composant `.vue`
// (voir AppMobileMenu.test.js pour le seul autre précédent de ce repo montant un vrai
// composant ; ici un composant hôte vide suffit, plus léger que @vue/test-utils pour une
// simple exécution de composable).
import i18n from '@/i18n'

const withSetup = (composable) => {
  let result
  const app = createApp({
    setup() {
      result = composable()
      return () => null
    },
  })
  app.use(i18n)
  const el = document.createElement('div')
  app.mount(el)
  return { result, unmount: () => app.unmount() }
}

import { usePassword } from '@/composables/usePassword'

describe('usePassword.isValid', () => {
  it('est true (permissif) tant que le mot de passe est vide -- pas d’erreur affichée sur un champ non encore rempli', () => {
    const { result, unmount } = withSetup(usePassword)
    expect(result.password.value).toBe('')
    expect(result.isValid.value).toBe(true)
    unmount()
  })

  it('est false pour un mot de passe non vide de moins de 8 caractères', () => {
    const { result, unmount } = withSetup(usePassword)
    result.password.value = 'abc123'
    expect(result.isValid.value).toBe(false)
    unmount()
  })

  it('est true à partir de 8 caractères (limite incluse)', () => {
    const { result, unmount } = withSetup(usePassword)
    result.password.value = '12345678'
    expect(result.isValid.value).toBe(true)
    unmount()
  })

  it('est false juste en dessous de la limite (7 caractères)', () => {
    const { result, unmount } = withSetup(usePassword)
    result.password.value = '1234567'
    expect(result.isValid.value).toBe(false)
    unmount()
  })
})

describe('usePassword.doMatch', () => {
  it('est true quand password et confirmPassword sont tous deux vides (état initial)', () => {
    const { result, unmount } = withSetup(usePassword)
    expect(result.doMatch.value).toBe(true)
    unmount()
  })

  it('est true quand les deux valeurs sont identiques', () => {
    const { result, unmount } = withSetup(usePassword)
    result.password.value = 'motdepasse1'
    result.confirmPassword.value = 'motdepasse1'
    expect(result.doMatch.value).toBe(true)
    unmount()
  })

  it('est false quand les deux valeurs diffèrent', () => {
    const { result, unmount } = withSetup(usePassword)
    result.password.value = 'motdepasse1'
    result.confirmPassword.value = 'motdepasse2'
    expect(result.doMatch.value).toBe(false)
    unmount()
  })
})

describe('usePassword.validate', () => {
  it('renvoie null (aucune erreur) quand le mot de passe est valide et les deux champs correspondent', () => {
    const { result, unmount } = withSetup(usePassword)
    result.password.value = 'motdepasse1'
    result.confirmPassword.value = 'motdepasse1'
    expect(result.validate()).toBeNull()
    unmount()
  })

  it('priorise l’erreur de longueur sur l’erreur de correspondance quand les deux gates échouent à la fois', () => {
    // password trop court ET différent de confirmPassword : `validate()` teste isValid
    // avant doMatch (voir l'implémentation), donc l'erreur de longueur doit sortir en
    // premier, pas celle de correspondance.
    const { result, unmount } = withSetup(usePassword)
    result.password.value = 'abc'
    result.confirmPassword.value = 'xyz'

    expect(result.validate()).toBe(i18n.global.t('errors.password_length'))
    unmount()
  })

  it('renvoie l’erreur de correspondance quand le mot de passe est valide (>= 8) mais ne correspond pas à confirmPassword', () => {
    const { result, unmount } = withSetup(usePassword)
    result.password.value = 'motdepasse1'
    result.confirmPassword.value = 'autrechose1'

    expect(result.validate()).toBe(i18n.global.t('errors.passwords_not_match'))
    unmount()
  })

  // Comportement à noter (pas un bug exploitable) : un champ password VIDE est traité
  // comme "valide" par isValid (cf. describe ci-dessus, `if (!password.value) return
  // true`), donc validate() ne bloque QUE sur doMatch. Avec confirmPassword également vide,
  // `validate()` renvoie `null`. Ce n'est pas exploitable en pratique : les deux appelants
  // (RegisterOwnerView.vue, RegisterClinicView.vue) vérifient `!password.value` AVANT
  // d'appeler validate() (garde-fou côté composant, pas dans le composable) -- vérifié en
  // lisant ces deux vues, pas supposé. Documenté ici pour que ce garde-fou externe reste
  // visible si `validate()` était un jour appelé ailleurs sans cette vérification amont.
  it('ne signale aucune erreur quand les deux champs sont vides -- reflète le comportement actuel (validate() seul ne suffit pas à rejeter un mot de passe vide ; voir commentaire ci-dessus sur le garde-fou côté appelants)', () => {
    const { result, unmount } = withSetup(usePassword)
    expect(result.validate()).toBeNull()
    unmount()
  })
})
