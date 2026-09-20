/**
 * Port TypeScript d'un sous-ensemble de `src/services/eligibility-service.js` (frontend JS),
 * pour `request-matcher-notifier` (système de notifications, 2026-09-18) -- une Lambda ne peut
 * PAS importer depuis `src/` (ADR-0007, séparation stricte backend TS / frontend JS ; `src/`
 * n'est de toute façon jamais bundlé par esbuild pour une Lambda).
 *
 * DUPLICATION ASSUMÉE, même raisonnement documenté par `mission-validation-auto-finalizer`
 * vis-à-vis de `useMissionClosure.js` ("runtimes différents, aucun module partageable") : les
 * fonctions ci-dessous sont des PORTS FIDÈLES (même logique, même signature réduite aux
 * paramètres utiles ici), pas une réinvention. Si une des deux copies évolue, l'autre doit être
 * mise à jour manuellement -- pas de mécanisme qui les garde synchronisées.
 *
 * Sous-ensemble PORTÉ (les 4 critères EXCLUSIFS de `checkEligibility()`, jamais le 5e "Clinic
 * Priority" qui ne sert qu'au TRI, sans objet pour une notification) + le filtre disponibilité
 * RDV (`matchesAvailability`/`matchesAvailabilityWindow`) :
 * 1. Validated Donor (`isValidatedDonor`)
 * 2. Compatibilité sanguine (`isBloodCompatible`)
 * 3. Frequency Rule (`satisfiesFrequencyRule`)
 * 4. Proximité géographique (`calculateDistance`)
 * + disponibilité RDV pour les Requests `APPOINTMENT` uniquement (`matchesAvailability`/
 *   `matchesAvailabilityWindow`), demandée explicitement par le repo owner pour cette
 *   notification (contrairement au RAPPEL de rendez-vous, différé à une sous-tâche ultérieure).
 */

export interface EligibilityAnimal {
  isValidatedDonor?: boolean | null
  validationExpiresAt?: string | null
  species?: string | null
  bloodGroup?: string | null
  lastDonationDate?: string | null
  donationFrequency?: string | null
}

export interface EligibilityAvailability {
  dayOfWeek: number
  startTime: string
  endTime: string
}

/** Port fidèle de `calculateDistance` (Haversine) -- `eligibility-service.js`. */
export function calculateDistance(
  lat1: number | null | undefined,
  lon1: number | null | undefined,
  lat2: number | null | undefined,
  lon2: number | null | undefined,
): number {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity

  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(value: number): number {
  return (value * Math.PI) / 180
}

/** Port fidèle d'`isBloodCompatible` -- comparaison stricte, sans matrice de compatibilité. */
export function isBloodCompatible(
  reqSpecies: string | null | undefined,
  reqBlood: string | null | undefined,
  animalSpecies: string | null | undefined,
  animalBlood: string | null | undefined,
): boolean {
  if (reqSpecies !== animalSpecies) return false
  if (reqBlood === 'UNKNOWN') return true
  if (!animalBlood || animalBlood === 'UNKNOWN') return false
  return reqBlood === animalBlood
}

/** Port fidèle d'`isValidatedDonor` -- validation présente ET non expirée. */
export function isValidatedDonor(animal: EligibilityAnimal, now: Date = new Date()): boolean {
  if (!animal?.isValidatedDonor) return false
  if (!animal.validationExpiresAt) return false

  const expiresAt = new Date(animal.validationExpiresAt)
  if (Number.isNaN(expiresAt.getTime())) return false

  return expiresAt.getTime() > now.getTime()
}

const MIN_DAYS_BETWEEN_DONATIONS: Record<string, number> = {
  ONCE_YEAR: 365,
  TWICE_YEAR: 182,
  ASAP: 0,
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Port fidèle de `satisfiesFrequencyRule`. */
export function satisfiesFrequencyRule(animal: EligibilityAnimal, now: Date = new Date()): boolean {
  if (!animal?.lastDonationDate) return true

  const lastDonation = new Date(animal.lastDonationDate)
  if (Number.isNaN(lastDonation.getTime())) return true

  const daysSinceLastDonation = (now.getTime() - lastDonation.getTime()) / MS_PER_DAY

  const minDays = Object.prototype.hasOwnProperty.call(
    MIN_DAYS_BETWEEN_DONATIONS,
    animal.donationFrequency ?? '',
  )
    ? MIN_DAYS_BETWEEN_DONATIONS[animal.donationFrequency as string]
    : MIN_DAYS_BETWEEN_DONATIONS.ONCE_YEAR

  return daysSinceLastDonation >= minDays
}

function normalizeTimeOfDay(awsTime: string | null | undefined): string | null {
  if (typeof awsTime !== 'string' || awsTime.length < 5) return null
  return awsTime.slice(0, 5)
}

/** Port fidèle de `matchesAvailability` (mode heure précise, `Request.appointmentDatetime`). */
export function matchesAvailability(
  availabilities: EligibilityAvailability[] | null | undefined,
  appointmentDatetime: string | null | undefined,
): boolean {
  if (!appointmentDatetime) return false
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

/** Port fidèle de `matchesAvailabilityWindow` (mode plage horaire, recouvrement d'intervalles). */
export function matchesAvailabilityWindow(
  availabilities: EligibilityAvailability[] | null | undefined,
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
): boolean {
  if (!windowStart || !windowEnd) return false

  const start = new Date(windowStart)
  const end = new Date(windowEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
  if (start.getTime() >= end.getTime()) return false

  if (!Array.isArray(availabilities) || availabilities.length === 0) return true

  const dayOfWeek = start.getDay()
  const windowStartTod = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
  const windowEndTod = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`

  return availabilities.some((availability) => {
    if (availability?.dayOfWeek !== dayOfWeek) return false

    const availStart = normalizeTimeOfDay(availability?.startTime)
    const availEnd = normalizeTimeOfDay(availability?.endTime)
    if (!availStart || !availEnd) return false

    return availStart < windowEndTod && windowStartTod < availEnd
  })
}
