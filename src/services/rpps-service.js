// Vérification de FORMAT du numéro RPPS (Répertoire Partagé des Professionnels de Santé),
// PAS une vérification d'existence/activité réelle -- ça reste hors périmètre (voir le
// commentaire de `RegisterClinicView.vue`/`SettingsView.vue` sur `clinicVerificationStatusFieldAuth`,
// amplify/data/resource.ts : la seule vraie garde reste la revue manuelle d'un Admin avant
// `approveClinicVerification`, RPPS/numéro d'ordre confirmés RÉELLEMENT existants uniquement
// auprès de l'Ordre National des Vétérinaires).
//
// Format confirmé (ANS -- esante.gouv.fr, "Comprendre la différence entre identifiants RPPS,
// ADELI et AM") : 11 chiffres, sans lettre ni séparateur, le dernier chiffre étant une clé de
// Luhn calculée sur l'ensemble des 11 chiffres. Une valeur qui échoue cette vérification est
// structurellement invalide (faute de frappe, nombre inventé) -- une valeur qui la passe n'est
// PAS garantie appartenir à un professionnel réellement inscrit (l'algorithme de Luhn ne
// vérifie qu'une propriété arithmétique, pas une existence en base), d'où la revue manuelle
// qui reste nécessaire en aval.
//
// Aucun standard de format confirmé pour le numéro d'ordre (Ordre National des Vétérinaires) --
// recherché explicitement (2026-09-16), rien de publié publiquement au-delà de son usage comme
// identifiant de connexion à l'extranet de l'Ordre. Volontairement PAS de validation de format
// sur ce champ : une regex inventée sans standard confirmé rejetterait potentiellement des
// numéros réels.

/**
 * @param {string} digits - une chaîne de chiffres, du poids le plus fort au plus faible,
 *   clé de contrôle INCLUSE (dernier caractère).
 * @returns {number} la somme de Luhn modulo 10 -- 0 si la clé est valide.
 */
function luhnChecksumMod10(digits) {
  let sum = 0
  let shouldDouble = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48
    if (shouldDouble) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    shouldDouble = !shouldDouble
  }
  return sum % 10
}

/**
 * @param {string} rpps
 * @returns {boolean} true si `rpps` est structurellement un numéro RPPS valide (11 chiffres,
 *   clé de Luhn correcte) -- PAS une preuve que ce numéro existe réellement, voir l'en-tête.
 */
export function isValidRpps(rpps) {
  if (typeof rpps !== 'string') return false
  const trimmed = rpps.trim()
  if (!/^\d{11}$/.test(trimmed)) return false
  return luhnChecksumMod10(trimmed) === 0
}
