import { DonationFrequency, DonorStatus } from '@/constants/enums'

/**
 * Calcule la distance en km entre deux points GPS (Formule de Haversine)
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity

  const R = 6371 // Rayon de la Terre en km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const toRad = (value) => {
  return (value * Math.PI) / 180
}

/**
 * Vérifie si une demande est compatible avec un animal
 * @param {string} reqSpecies - Espèce demandée (DOG, CAT)
 * @param {string} reqBlood - Groupe demandé (A, B, ou UNKNOWN)
 * @param {string} animalSpecies - Espèce de l'animal du propriétaire
 * @param {string} animalBlood - Groupe de l'animal du propriétaire
 */
export const isBloodCompatible = (reqSpecies, reqBlood, animalSpecies, animalBlood) => {
  // 1. Espèce différente = Incompatible
  if (reqSpecies !== animalSpecies) return false

  // 2. Si le véto demande "UNKNOWN" (Indifférent ou Urgence absolue), c'est compatible
  if (reqBlood === 'UNKNOWN') return true

  // 3. Si l'animal n'a pas de groupe sanguin renseigné, on évite pour l'instant (sécurité)
  if (!animalBlood || animalBlood === 'UNKNOWN') return false

  // 4. Pour le MVP : Compatibilité stricte (A pour A, B pour B)
  // TODO V2 : Implémenter la matrice complète (A peut donner à AB, etc.)
  return reqBlood === animalBlood
}

/**
 * Critère 1 de l'Eligibility (CONTEXT.md) : statut de Validated Donor.
 *
 * Un Animal n'est un Validated Donor que si un vétérinaire l'a explicitement validé
 * (`isValidatedDonor === true`) ET que cette validation n'a pas expiré. Une validation
 * sans date d'expiration renseignée est traitée comme jamais valide (fail-safe) plutôt
 * que comme "valide indéfiniment".
 *
 * @param {{ isValidatedDonor?: boolean, validationExpiresAt?: string|null }} animal
 * @param {Date} now
 * @returns {boolean}
 */
export const isValidatedDonor = (animal, now = new Date()) => {
  if (!animal?.isValidatedDonor) return false
  if (!animal.validationExpiresAt) return false

  const expiresAt = new Date(animal.validationExpiresAt)
  if (Number.isNaN(expiresAt.getTime())) return false

  return expiresAt.getTime() > now.getTime()
}

/**
 * Statut d'affichage "donneur validé" pour la fiche animal (AnimalsView.vue, sous-tâche
 * 6.1) — classification pure dérivée d'`isValidatedDonor()`, distingue "jamais validé"
 * (le flag brut `isValidatedDonor` n'a jamais été passé à `true`) de "validation
 * expirée" (le flag brut est `true` en base mais `validationExpiresAt` est dépassée ou
 * absente) plutôt que de retomber sur un état générique "non validé".
 *
 * @param {{ isValidatedDonor?: boolean, validationExpiresAt?: string|null }} animal
 * @param {Date} now
 * @returns {string} une valeur de `DonorStatus` (src/constants/enums.js)
 */
export const getDonorStatus = (animal, now = new Date()) => {
  if (isValidatedDonor(animal, now)) return DonorStatus.VALIDATED
  if (animal?.isValidatedDonor) return DonorStatus.EXPIRED
  return DonorStatus.NEVER_VALIDATED
}

// Nombre minimum de jours devant séparer deux dons d'un même Animal, par
// DonationFrequency (critère 3 de l'Eligibility, "Frequency Rule" — CONTEXT.md).
//
// ⚠️ Interprétation d'ingénierie : le CdC demande de "respecter la date du dernier don
// et le temps d'attente avant un nouveau prélèvement" mais ne fournit AUCUN nombre de
// jours exact. Ces valeurs (365 / 182 / 0) sont une estimation raisonnable à valider
// avec l'encadrement médical de l'école vétérinaire partenaire avant d'ouvrir le pilote
// à de vrais donneurs. Exportée séparément pour être facile à retrouver et surcharger.
export const MIN_DAYS_BETWEEN_DONATIONS = Object.freeze({
  [DonationFrequency.ONCE_YEAR]: 365,
  [DonationFrequency.TWICE_YEAR]: 182,
  [DonationFrequency.ASAP]: 0,
})

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Critère 3 de l'Eligibility (CONTEXT.md) : Frequency Rule.
 *
 * Un Animal qui n'a jamais donné (`lastDonationDate` absent) satisfait toujours la
 * règle. Sinon, on compare le nombre de jours écoulés depuis le dernier don au minimum
 * requis par sa `donationFrequency` (voir MIN_DAYS_BETWEEN_DONATIONS ci-dessus). Une
 * `donationFrequency` non reconnue ou absente est traitée comme le cas le plus strict
 * (ONCE_YEAR) — on échoue de façon sûre plutôt que de laisser passer un don trop
 * rapproché par défaut (même logique que le fix du speciesMap sur
 * fix/data-model-risks).
 *
 * @param {{ lastDonationDate?: string|null, donationFrequency?: string }} animal
 * @param {Date} now
 * @returns {boolean}
 */
export const satisfiesFrequencyRule = (animal, now = new Date()) => {
  if (!animal?.lastDonationDate) return true

  const lastDonation = new Date(animal.lastDonationDate)
  if (Number.isNaN(lastDonation.getTime())) return true

  const daysSinceLastDonation = (now.getTime() - lastDonation.getTime()) / MS_PER_DAY

  const minDays = Object.prototype.hasOwnProperty.call(
    MIN_DAYS_BETWEEN_DONATIONS,
    animal.donationFrequency,
  )
    ? MIN_DAYS_BETWEEN_DONATIONS[animal.donationFrequency]
    : MIN_DAYS_BETWEEN_DONATIONS[DonationFrequency.ONCE_YEAR]

  return daysSinceLastDonation >= minDays
}

/**
 * Critère 5 de l'Eligibility (CONTEXT.md) : Clinic Priority.
 *
 * "Favorise, sans exclure" (CONTEXT.md) : un critère de TRI secondaire uniquement — ne
 * jamais s'en servir pour exclure un Animal par ailleurs éligible. `ownerClinicIds` est
 * la liste des IDs de Clinic déjà liés à l'Owner via ClinicOwnerRelation ; récupérée par
 * l'appelant, cette fonction reste pure (pas d'appel GraphQL ici).
 *
 * @param {string[]} ownerClinicIds
 * @param {string} requestClinicId
 * @returns {boolean}
 */
export const hasClinicPriority = (ownerClinicIds, requestClinicId) => {
  if (!Array.isArray(ownerClinicIds) || !requestClinicId) return false
  return ownerClinicIds.includes(requestClinicId)
}

/**
 * Normalise un `AWSTime` (`OwnerAvailability.startTime`/`endTime`, ex. `"09:00"`,
 * `"09:00:00"`, `"09:00:00.000"`) en `"HH:mm"` comparable lexicographiquement — même
 * troncature que `AvailabilityView.vue` (`slot.startTime.substring(0, 5)`), pour rester
 * cohérent avec ce que l'Owner voit déjà affiché.
 *
 * @param {string|null|undefined} awsTime
 * @returns {string|null}
 */
const normalizeTimeOfDay = (awsTime) => {
  if (typeof awsTime !== 'string' || awsTime.length < 5) return null
  return awsTime.slice(0, 5)
}

/**
 * Filtre EXCLUSIF supplémentaire pour les Requests de type APPOINTMENT (Phase 6.5, voir
 * `docs/adr/0005-appointment-availability-matching.md`) — volontairement séparé des 5
 * critères hiérarchisés de `checkEligibility()` (CONTEXT.md : "Frequency Rule" != "Disponibilité",
 * un concept distinct réservé aux créneaux `OwnerAvailability`). Cette fonction n'est PAS
 * appelée depuis `checkEligibility()` ; `useMatchingRequests.js` l'appelle séparément, en
 * plus, uniquement quand `request.requestType === RequestType.APPOINTMENT`.
 *
 * Vérifie que `appointmentDatetime` (`Request.appointmentDatetime`, choisi par la clinique à
 * la création) tombe dans au moins un créneau `OwnerAvailability` (`dayOfWeek` +
 * `startTime`/`endTime`) de l'Owner. `dayOfWeek` suit la même convention que
 * `Date.prototype.getDay()` (0 = dimanche ... 6 = samedi), déjà utilisée telle quelle par
 * `src/constants/date-constants.js`/`AvailabilityView.vue` — aucune conversion nécessaire ici.
 *
 * Décision produit révisée (amendement ADR-0005, 2026-08-17) : une `OwnerAvailability`
 * absente (l'Owner n'a renseigné AUCUN créneau) est traitée comme "toujours disponible",
 * pas comme "jamais disponible" — objectif : inciter l'Owner à renseigner ses disponibilités
 * réelles plutôt que de le faire disparaître silencieusement de tout matching RDV tant qu'il
 * ne l'a pas fait. Remplace le fail-closed d'origine (Phase 6.5) sur ce seul cas ; dès qu'AU
 * MOINS un créneau existe, le filtre redevient exclusif comme avant : un rendez-vous hors des
 * créneaux réellement déclarés reste exclu, seule l'absence totale de créneaux bascule
 * désormais vers `true`. `appointmentDatetime` absent/invalide reste `false` (ce n'est pas
 * une question de disponibilité de l'Owner, la Request elle-même est inexploitable).
 *
 * ⚠️ Limite assumée pour ce pilote (voir ADR-0005) : compare heure/minute en fuseau horaire
 * LOCAL du navigateur des deux côtés (celui qui saisit ses disponibilités et celui qui fait
 * matcher), sans stocker ni convertir de fuseau horaire explicite — cohérent avec le reste du
 * repo (`AvailabilityView.vue` stocke déjà `startTime`/`endTime` en heure locale non
 * qualifiée), mais suppose un seul fuseau horaire pour tous les utilisateurs (pilote école
 * vétérinaire française, hypothèse raisonnable pour ce périmètre).
 *
 * @param {Array<{dayOfWeek: number, startTime: string, endTime: string}>} availabilities
 * @param {string|null|undefined} appointmentDatetime - AWSDateTime (ISO 8601)
 * @returns {boolean}
 */
export const matchesAvailability = (availabilities, appointmentDatetime) => {
  if (!appointmentDatetime) return false
  // Aucun créneau renseigné (ou lecture indisponible) : "toujours disponible" par défaut,
  // voir amendement ADR-0005 ci-dessus.
  if (!Array.isArray(availabilities) || availabilities.length === 0) return true

  const date = new Date(appointmentDatetime)
  if (Number.isNaN(date.getTime())) return false

  const dayOfWeek = date.getDay()
  const timeOfDay = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  return availabilities.some((availability) => {
    if (availability?.dayOfWeek !== dayOfWeek) return false

    const start = normalizeTimeOfDay(availability?.startTime)
    const end = normalizeTimeOfDay(availability?.endTime)
    if (!start || !end) return false

    return timeOfDay >= start && timeOfDay <= end
  })
}

/**
 * Composite : évalue les 5 critères hiérarchisés de l'Eligibility (CONTEXT.md) pour un
 * couple (Animal, Request) donné, dans l'ordre imposé par le CdC :
 *   1. Validated Donor
 *   2. Compatibilité sanguine
 *   3. Frequency Rule
 *   4. Proximité géographique
 *   5. Clinic Priority (jamais exclusif — ne fait que qualifier le résultat)
 *
 * Court-circuite au premier critère exclusif (1 à 4) qui échoue. C'est le point d'appui
 * futur (Phase 0.3/0.4) pour faire converger `useMatchingRequests.searchMatches` et
 * `useOwnerMissions.acceptMission`, qui divergent aujourd'hui sur ces mêmes règles.
 *
 * @param {object} params
 * @param {object} params.animal - { isValidatedDonor, validationExpiresAt, species, bloodGroup, lastDonationDate, donationFrequency }
 * @param {object} params.request - { requiredSpecies, requiredBloodGroup, clinic: { id, latitude, longitude } }
 * @param {number} params.ownerLatitude
 * @param {number} params.ownerLongitude
 * @param {number} params.maxTravelDistance - en km, depuis le profil de l'Owner
 * @param {string[]} [params.ownerClinicIds]
 * @param {Date} [params.now]
 * @returns {{ eligible: boolean, reason: string|null, distanceKM: number|null, hasClinicPriority: boolean }}
 */
export function checkEligibility({
  animal,
  request,
  ownerLatitude,
  ownerLongitude,
  maxTravelDistance,
  ownerClinicIds = [],
  now = new Date(),
}) {
  const clinicPriority = hasClinicPriority(ownerClinicIds, request?.clinic?.id)

  // 1. Validated Donor
  if (!isValidatedDonor(animal, now)) {
    return {
      eligible: false,
      reason: 'NOT_VALIDATED_DONOR',
      distanceKM: null,
      hasClinicPriority: clinicPriority,
    }
  }

  // 2. Compatibilité sanguine
  const bloodCompatible = isBloodCompatible(
    request?.requiredSpecies,
    request?.requiredBloodGroup,
    animal?.species,
    animal?.bloodGroup,
  )
  if (!bloodCompatible) {
    return {
      eligible: false,
      reason: 'BLOOD_INCOMPATIBLE',
      distanceKM: null,
      hasClinicPriority: clinicPriority,
    }
  }

  // 3. Frequency Rule
  if (!satisfiesFrequencyRule(animal, now)) {
    return {
      eligible: false,
      reason: 'FREQUENCY_RULE',
      distanceKM: null,
      hasClinicPriority: clinicPriority,
    }
  }

  // 4. Proximité géographique
  const distanceKM = calculateDistance(
    ownerLatitude,
    ownerLongitude,
    request?.clinic?.latitude,
    request?.clinic?.longitude,
  )
  if (distanceKM > maxTravelDistance) {
    return {
      eligible: false,
      reason: 'TOO_FAR',
      distanceKM,
      hasClinicPriority: clinicPriority,
    }
  }

  // 5. Clinic Priority — ne peut jamais exclure, uniquement présent pour le tri par
  // l'appelant.
  return {
    eligible: true,
    reason: null,
    distanceKM,
    hasClinicPriority: clinicPriority,
  }
}
