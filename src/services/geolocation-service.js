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
