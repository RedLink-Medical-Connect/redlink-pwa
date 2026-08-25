// Bornes validées avec le repo owner (2026-08-17) : 8h-12h / 12h-18h / 18h-22h -- source de
// vérité unique pour les raccourcis horaires d'`AvailabilityView.vue` (boutons de preset) et
// pour `mergeConsecutiveHourRanges` ci-dessous (fusion de presets contigus).
export const TIME_PRESETS = Object.freeze([
  { key: 'morning', startHour: 8, endHour: 12 },
  { key: 'afternoon', startHour: 12, endHour: 18 },
  { key: 'evening', startHour: 18, endHour: 22 },
])

/**
 * Fusionne les presets sélectionnés ENSEMBLE et CONSÉCUTIFS (matin+après-midi, après-midi+
 * soir, ou les trois) en un seul groupe d'heures plutôt que de les garder comme autant de
 * plages séparées — demande produit 2026-08-24 (`AvailabilityView.vue`) : évite de
 * surcharger l'affichage d'un Owner avec des créneaux qui se touchent bout à bout (ex.
 * 08:00-12:00 + 12:00-18:00 → un seul 08:00-18:00). `TIME_PRESETS` est trié par
 * `startHour` croissant, donc `.filter()` préserve cet ordre : la fusion compare chaque
 * preset sélectionné au dernier groupe en cours de construction. Un "trou" dans la
 * sélection (matin+soir SANS après-midi) reste volontairement deux groupes distincts — pas
 * de fusion à travers un preset non coché.
 *
 * Portée volontairement limitée à UNE sélection de presets (une soumission du formulaire) :
 * ne fusionne jamais avec des créneaux déjà enregistrés en base (voir
 * `addAvailabilityForDays`, `useOwnerAvailability.js`, best-effort par jour/plage
 * indépendante) — décision produit du 2026-08-24, pour rester une fonction pure sans appel
 * réseau, cohérente avec la convention "services" du repo (CLAUDE.md).
 *
 * @param {string[]} selectedKeys Clés de `TIME_PRESETS` sélectionnées (ordre indifférent).
 * @returns {Array<{startHour: number, endHour: number}>}
 */
export function mergeConsecutiveHourRanges(selectedKeys) {
  const selected = TIME_PRESETS.filter((preset) => selectedKeys.includes(preset.key))

  const merged = []
  for (const preset of selected) {
    const lastGroup = merged[merged.length - 1]
    if (lastGroup && lastGroup.endHour === preset.startHour) {
      lastGroup.endHour = preset.endHour
    } else {
      merged.push({ startHour: preset.startHour, endHour: preset.endHour })
    }
  }
  return merged
}
