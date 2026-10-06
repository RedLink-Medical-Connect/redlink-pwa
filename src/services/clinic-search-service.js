/**
 * Recherche de cliniques côté client pour le choix d'une clinique de rattachement par un Owner
 * (popup post-inscription, `ClinicLinkDialog.vue`). Fonctions pures : la liste complète est
 * chargée une fois par `useClinicLink.fetchClinics()`, le filtrage se fait ici à chaque frappe
 * (pas de requête GraphQL par caractère tapé -- le nombre de cliniques reste faible en pilote).
 */

/**
 * Minuscules + accents retirés (`"Clinique Vétérinaire"` -> `"clinique veterinaire"`), pour
 * qu'une recherche tapée sans accents sur mobile trouve quand même la clinique.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
  return (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Filtre les cliniques dont le nom OU l'adresse contient chacun des mots de `query` (ordre
 * libre : "paris bernard" trouve "Clinique St-Bernard, 12 rue X, Paris"). Requête vide :
 * toutes les cliniques. Résultat toujours trié par nom.
 *
 * @param {Array<{id: string, name: string, address?: string|null}>} clinics
 * @param {string|null|undefined} query
 * @returns {Array<{id: string, name: string, address?: string|null}>}
 */
export function filterClinics(clinics, query) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean)

  const matches = terms.length
    ? clinics.filter((clinic) => {
        const haystack = normalizeSearchText(`${clinic.name} ${clinic.address || ''}`)
        return terms.every((term) => haystack.includes(term))
      })
    : clinics

  return [...matches].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}
