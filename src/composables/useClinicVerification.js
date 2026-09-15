import { generateClient } from '@/services/bff-graphql-client'
import { getCurrentUser } from '@/services/bff-auth-session'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

// Vérification d'identité vétérinaire (RPPS + numéro d'ordre) avant activation d'une Clinic --
// plan de durcissement sécurité "Différé 1" (ré-audit 2026-09-04). Une seule fonction exposée,
// appelée par la garde de navigation (`src/router/index.js`) sur chaque route `role: 'vet'`.
//
// Pas de cache (contrairement à `useOwnerProfile.js`/`isLoaded`, R-19) : c'est une garde de
// NAVIGATION, pas un état affiché à l'écran -- une valeur périmée après une approbation admin
// pendant la session en cours (onglet resté ouvert) laisserait un vétérinaire fraîchement
// activé bloqué sur l'écran d'attente jusqu'au prochain rechargement complet. Un aller-retour
// GraphQL supplémentaire par navigation `role: 'vet'` est le compromis assumé -- requête légère
// (un seul champ scalaire imbriqué), pilote de petite échelle (CLAUDE.md).
//
// Cette garde est purement UX, PAS une garantie de sécurité (voir `clinicVerificationStatusFieldAuth`,
// amplify/data/resource.ts) : le groupe Cognito `Veterinarians` est attribué immédiatement à
// l'inscription (décision produit, garder l'auto-assignation existante plutôt que la retarder
// jusqu'à validation admin) -- un vétérinaire PENDING a donc déjà un accès GraphQL réel via
// `@auth`, cette garde ne fait que l'empêcher de voir un dashboard vide/confus avant validation.

export function useClinicVerification() {
  const client = generateClient()

  const fetchVerificationStatus = async () => {
    const { userId } = await getCurrentUser()
    if (!userId) return null

    const { data, errors } = await client.models.Veterinarian.get(
      { id: userId },
      { selectionSet: ['clinic.verificationStatus'] },
    )
    throwIfGraphqlError(errors, 'getVeterinarian')

    return data?.clinic?.verificationStatus ?? null
  }

  return { fetchVerificationStatus }
}
