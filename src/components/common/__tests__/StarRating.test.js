import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

// Correctif a11y (revues accessibilité + lead-dev, 2026-08-31) sur StarRating.vue -- deux
// bugs BLOQUANTS signalés indépendamment par les deux revues :
// 1. `aria-checked="true"` était posé sur TOUTES les étoiles <= modelValue (une note de 3
//    marquait 1, 2 ET 3 comme cochées) -- un `role="radiogroup"` ne doit jamais avoir plus
//    d'une option cochée à la fois.
// 2. Chaque `<button role="radio">` n'avait aucun `aria-label` propre.
//
// Second test de composant `.vue` de ce repo après AppMobileMenu.test.js -- justifié ici de
// la même façon (CLAUDE.md) : la logique testée (calcul d'`aria-checked`/`aria-label` par
// étoile) vit uniquement dans le template de ce composant, pas de seam composable/service
// équivalent, et c'est exactement la régression qu'une revue a11y ultérieure re-détecterait
// si elle repartait sans filet.
//
// i18n : instance RÉELLE (`@/i18n.js`, pas un mock `$t: key => key`) pour que ce test prouve
// aussi que les clés `common.star_rating.star_1..5` ajoutées par ce correctif résolvent
// vraiment dans fr.json/en.json, pas seulement que le composant les référence.

import StarRating from '@/components/common/StarRating.vue'
import i18n from '@/i18n.js'

// Locale déterministe pour ce fichier (indépendante de `navigator.language` de
// l'environnement jsdom, qui pilote la locale par défaut de `@/i18n.js`).
i18n.global.locale.value = 'fr'

const mountStars = (props) =>
  mount(StarRating, {
    props,
    global: { plugins: [i18n] },
  })

describe('StarRating.vue — accessibilité (radiogroup) après correctif 2026-08-31', () => {
  it('aria-checked est true sur UNE SEULE étoile (celle == modelValue), false sur toutes les autres, pour une note de 3', () => {
    const wrapper = mountStars({ modelValue: 3, ariaLabel: 'Note de la clinique' })
    const radios = wrapper.findAll('button[role="radio"]')

    expect(radios).toHaveLength(5)
    const checkedStates = radios.map((r) => r.attributes('aria-checked'))
    expect(checkedStates).toEqual(['false', 'false', 'true', 'false', 'false'])
  })

  it('aucune étoile cochée quand modelValue vaut 0 (aucune sélection)', () => {
    const wrapper = mountStars({ modelValue: 0, ariaLabel: 'Note' })
    const radios = wrapper.findAll('button[role="radio"]')

    expect(radios.every((r) => r.attributes('aria-checked') === 'false')).toBe(true)
  })

  it('modelValue=5 (borne haute) : seule la 5e étoile est cochée', () => {
    const wrapper = mountStars({ modelValue: 5, ariaLabel: 'Note' })
    const radios = wrapper.findAll('button[role="radio"]')
    const checkedStates = radios.map((r) => r.attributes('aria-checked'))

    expect(checkedStates).toEqual(['false', 'false', 'false', 'false', 'true'])
  })

  it('le remplissage VISUEL (icônes pleines) reste cumulatif <= modelValue, indépendamment de aria-checked', () => {
    const wrapper = mountStars({ modelValue: 3, ariaLabel: 'Note' })
    const icons = wrapper.findAll('button i')
    const fillStates = icons.map((i) => i.classes().includes('pi-star-fill'))

    // 3 pleines, 2 vides -- inchangé par le correctif (seule la logique aria-checked change).
    expect(fillStates).toEqual([true, true, true, false, false])
  })

  it('chaque étoile interactive porte un aria-label individuel distinct, en plus du aria-label du groupe', () => {
    const wrapper = mountStars({ modelValue: 0, ariaLabel: 'Note de la clinique' })
    const radios = wrapper.findAll('button[role="radio"]')

    expect(radios.map((r) => r.attributes('aria-label'))).toEqual([
      '1 étoile',
      '2 étoiles',
      '3 étoiles',
      '4 étoiles',
      '5 étoiles',
    ])
    // Le aria-label du groupe (posé par l'appelant) reste, lui, inchangé -- un ajout
    // complémentaire, pas un remplacement.
    expect(wrapper.attributes('aria-label')).toBe('Note de la clinique')
  })

  it('mode lecture seule : ni role="radio" ni aria-checked/aria-label individuel sur les boutons (désactivés, hors du contrôle) -- le groupe porte role="img" et le seul nom accessible', () => {
    const wrapper = mountStars({ modelValue: 3.5, readonly: true, ariaLabel: 'Note moyenne' })

    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('Note moyenne')

    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(5)
    buttons.forEach((b) => {
      expect(b.attributes('role')).toBeUndefined()
      expect(b.attributes('aria-checked')).toBeUndefined()
      expect(b.attributes('aria-label')).toBeUndefined()
      expect(b.attributes('disabled')).toBeDefined()
    })
  })
})
