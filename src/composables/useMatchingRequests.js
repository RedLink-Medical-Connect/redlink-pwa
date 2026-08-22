import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'
import { checkEligibility, matchesAvailability } from '@/services/eligibility-service'
import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { useAnimals } from '@/composables/useAnimals'
import { useOwnerProfile } from '@/composables/useOwnerProfile'
import { useOwnerAvailability } from '@/composables/useOwnerAvailability'
import { RequestStatus, RequestType } from '@/constants/enums'

// Phase 8, sous-tâche 5 (lot 3/3, le dernier) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.ClinicOwnerRelation.*`/`client.models.Request.*`). `myClinicRelationsByOwnerID`/
// `listOpenRequestsWithClinic` (custom-queries.js, Gen1) n'ont plus lieu d'être ici -- voir
// CLAUDE.md / roadmap Phase 8. `useAnimals()`/`useOwnerProfile()`/`useOwnerAvailability()`
// (instanciés ci-dessous) sont déjà migrés depuis le lot 1/3, aucun changement requis ici.
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 et `throwIfGraphqlError` : voir le
// JSDoc de `src/services/graphql-error-service.js`. Les deux appels ci-dessous reprennent
// `throwIfGraphqlError` : le Gen1 d'origine faisait un simple `await client.graphql(...)` sans
// jamais destructurer/inspecter `errors` (aucune notion de succès partiel).
//
// selectionSet de `listOpenRequestsWithClinic` (remplacé par `client.models.Request.list()`) :
// construit en vérifiant EXACTEMENT quels champs `clinic.*` sont consommés (pas les 10 champs
// sélectionnés par la query Gen1 -- même discipline que `useClinicDonors.js`, lot 2). Vérifié en
// lisant `eligibility-service.js` (checkEligibility()/hasClinicPriority() ne lisent que
// `request.clinic.id`/`request.clinic.latitude`/`request.clinic.longitude`) ET l'unique vue
// consommatrice de `matches` (DashboardView.vue, qui n'affiche que `req.clinic?.name` -- ni
// address/phone/rpps/email/hasEmergencyService/transfusionsDone/donorOwnersCount/timestamps,
// tous sélectionnés par la query Gen1 mais jamais lus par ce flux). `requestType`/
// `requiredSpecies`/`requiredBloodGroup`/`appointmentDatetime` restent des scalaires top-niveau
// de Request, tous consommés par ce composable ou DashboardView.vue -- reproduits tels quels.

// Rayon (en km) sous lequel Clinic Priority (critère 5 de l'Eligibility, CONTEXT.md)
// peut faire passer une Request en tête de tri (voir le comparateur dans
// searchMatches() ci-dessous). Un paramètre de TRI/UX, pas un critère d'Eligibility :
// il n'a donc pas sa place dans eligibility-service.js, et checkEligibility()/
// hasClinicPriority() (qui restent des indicateurs bruts "cette clinique est-elle déjà
// connue de l'Owner ?") n'en ont pas connaissance.
//
// ⚠️ Interprétation d'ingénierie : ni le CdC ni CONTEXT.md ne chiffrent de rayon pour
// "favorise, sans exclure". 15km est une estimation raisonnable (même statut que
// MIN_DAYS_BETWEEN_DONATIONS dans eligibility-service.js) à valider avec l'école
// vétérinaire partenaire avant un vrai déploiement.
const CLINIC_PRIORITY_BOOST_RADIUS_KM = 15

// Phase 4.1 (rafraîchissement dashboard) : le vrai push PWA est hors périmètre V1,
// remplacé par ce fallback dashboard + email (décision produit actée, voir
// `docs/adr/` / roadmap Phase 4). Pour un pilote à faible nombre d'utilisateurs,
// un polling en arrière-plan toutes les minutes suffit à afficher une urgence sans
// que l'Owner ait besoin de cliquer sur "Actualiser" — combiné à un refresh
// immédiat au retour de focus de l'onglet (voir `startAutoRefresh` ci-dessous),
// pour ne pas faire attendre jusqu'à une minute pleine un Owner qui rouvre
// l'application après une absence.
//
// ⚠️ Interprétation d'ingénierie, même statut que CLINIC_PRIORITY_BOOST_RADIUS_KM /
// MIN_DAYS_BETWEEN_DONATIONS (eligibility-service.js) : ni le CdC ni CONTEXT.md ne
// chiffrent d'intervalle. 60s est une estimation raisonnable pour un pilote (assez
// réactif pour une urgence, assez léger pour ne pas solliciter AppSync en continu
// avec peu d'utilisateurs) — à revalider si le pilote grossit.
const DASHBOARD_REFRESH_INTERVAL_MS = 60_000

export function useMatchingRequests() {
  const client = generateClient()
  const matches = ref([])
  const isLoading = ref(false)
  // Phase 7.6 (R-09) : distingue "recherche en erreur" d'une absence réelle d'urgence à
  // proximité -- écran le plus critique de l'app (radar d'urgence Owner, DashboardView.vue,
  // roadmap Phase 6.2). Ne couvre QUE l'échec du flux principal (résolution du profil/
  // animaux/Requests OPEN), jamais la lecture Clinic Priority (ownerClinicIds) ni le filtre
  // OwnerAvailability des Requests APPOINTMENT ci-dessous, qui ont chacun leur propre
  // try/catch dédié et doivent continuer à dégrader silencieusement (repli neutre/fail-closed)
  // sans jamais remonter jusqu'ici -- voir les commentaires sur ces deux blocs.
  //
  // Comme `isLoading`/`matches.value` (voir le commentaire juste au-dessus sur
  // `searchMatches({ silent: true })`), un refresh silencieux (polling/retour de focus) ne
  // doit jamais faire APPARAÎTRE une bannière d'erreur au-dessus de résultats déjà affichés
  // pour un hoquet transitoire d'arrière-plan -- seul un appel explicite (montage, clic
  // "Actualiser") peut poser `loadError = true`. Un succès, silencieux ou non, efface
  // toujours un `loadError` précédent : un refresh d'arrière-plan qui aboutit doit pouvoir
  // faire disparaître une bannière d'erreur laissée par un appel explicite antérieur.
  const loadError = ref(false)

  // On réutilise vos composables existants pour avoir les données du user
  const { animals, fetchAnimals } = useAnimals()
  // useOwnerProfile() expose `form` (et non `ownerProfile`) : on l'alias ici
  // pour ne pas toucher au reste de la logique de ce composable.
  const { form: ownerProfile, fetchProfile } = useOwnerProfile()
  // Phase 6.5 (ADR-0005) : même pattern que useAnimals/useOwnerProfile ci-dessus -- instance
  // propre à ce composable, réutilise le composable/la query existants
  // (useOwnerAvailability.js / listMyAvailabilities, custom-queries.js) plutôt que d'écrire un
  // nouvel aller-retour GraphQL dédié. Ne sert qu'au filtre EXCLUSIF supplémentaire des
  // Requests APPOINTMENT (voir plus bas) -- jamais lu par checkEligibility() lui-même.
  const { availabilities: ownerAvailabilities, fetchAvailabilities: fetchOwnerAvailabilities } =
    useOwnerAvailability()

  // `searchMatches({ silent: true })` est utilisé par le polling/retour de focus
  // (voir `refreshIfVisibleAndIdle` ci-dessous) : contrairement à un chargement
  // explicite (montage, clic "Actualiser"), un refresh en arrière-plan ne doit ni
  // vider `matches.value` ni piloter `isLoading` — sinon le panneau de résultats
  // entier est remplacé par le spinner plein écran toutes les 60s (ou à chaque
  // retour de focus), avec un risque de clic perdu/mal dirigé sur "J'accepte
  // d'aider" si le DOM sous le curseur est détruit pendant l'interaction, dans un
  // flux dont tout l'enjeu est justement de ne pas rater une urgence (relevé en
  // Lead Dev review). `matches.value` n'est réassigné qu'une fois les nouveaux
  // résultats prêts (fin de la fonction), silencieux ou non.
  const searchMatches = async ({ silent = false } = {}) => {
    isFetching = true
    if (!silent) {
      isLoading.value = true
      matches.value = []
      loadError.value = false
    }

    try {
      // 1. S'assurer qu'on a bien les infos du propriétaire et ses animaux
      // `form` (alias ownerProfile) est toujours un objet non-nul par défaut,
      // donc on ne peut pas se fier à sa nullité pour savoir s'il faut le
      // récupérer : on le charge systématiquement.
      await fetchProfile()
      if (animals.value.length === 0) await fetchAnimals()

      // Si pas d'animaux, on ne peut rien faire
      if (animals.value.length === 0) {
        return
      }

      const myLat = ownerProfile.value.latitude
      const myLon = ownerProfile.value.longitude
      // Par défaut 50km si non renseigné
      const maxDist = ownerProfile.value.maxTravelDistance || 50

      // 2. Récupérer les Clinic déjà liées à cet Owner (ClinicOwnerRelation), pour le
      // critère 5 de l'Eligibility (Clinic Priority, CONTEXT.md). Refetché à chaque appel
      // de searchMatches() plutôt que mémoïsé comme fetchClinicId() ailleurs dans ce repo :
      // une recherche est déjà une action de rafraîchissement complet, donc le coût d'un
      // aller-retour GraphQL de plus ici est négligeable face à la complexité d'un cache.
      //
      // Try/catch dédié (relevé en Lead Dev review) : Clinic Priority est un critère
      // explicitement non-exclusif ("favorise, sans exclure", CONTEXT.md/eligibility-service.js).
      // Sans ce bloc séparé, un échec transitoire de CET appel précis (throttling, hoquet
      // @auth...) faisait avorter tout `searchMatches()` et vidait `matches.value` en entier —
      // un critère purement consultatif aurait alors accidentellement exclu TOUTES les
      // Requests, pas seulement désactivé son propre tri. Repli sur [] : dégrade la sous-tâche
      // en "aucune priorité connue", jamais en "aucun résultat".
      let ownerClinicIds = []
      try {
        const { userId } = await getCurrentUser()
        const { data: relations, errors: relationsErrors } = await client.models.ClinicOwnerRelation.list({
          filter: { ownerID: { eq: userId } },
          selectionSet: ['clinicID'],
        })
        throwIfGraphqlError(relationsErrors, 'clinicOwnerRelationsByOwnerID')
        ownerClinicIds = (relations || []).map((item) => item.clinicID)
      } catch (e) {
        console.error('Erreur chargement des cliniques déjà liées (Clinic Priority) :', e)
      }

      // 3. Récupérer TOUTES les demandes ouvertes
      // Note : Pour un MVP, filtrer côté client est acceptable et plus simple
      const { data, errors } = await client.models.Request.list({
        filter: { status: { eq: RequestStatus.OPEN } },
        selectionSet: [
          'id',
          'requestType',
          'requiredSpecies',
          'requiredBloodGroup',
          'appointmentDatetime',
          'clinic.id',
          'clinic.name',
          'clinic.latitude',
          'clinic.longitude',
        ],
      })

      throwIfGraphqlError(errors, 'listRequests')

      const allRequests = data || []

      // 3.5. Phase 6.5 (ADR-0005) : les Requests APPOINTMENT ont besoin des
      // OwnerAvailability de l'Owner pour un filtre EXCLUSIF supplémentaire
      // (matchesAvailability(), eligibility-service.js), appliqué APRÈS checkEligibility()
      // dans la boucle ci-dessous -- jamais à sa place, jamais pour EMERGENCY. On ne charge
      // les disponibilités que si au moins une Request ouverte est de type APPOINTMENT, pour
      // ne pas payer un aller-retour GraphQL inutile aux Owners qui ne voient que des
      // urgences (cas le plus fréquent pour ce pilote).
      //
      // Pas de try/catch dédié ici (à la différence de Clinic Priority juste au-dessus) :
      // fetchOwnerAvailabilities() (useOwnerAvailability.js) n'expose déjà aucune erreur --
      // elle avale tout en interne dans un console.error et ne rethrow jamais. En cas
      // d'échec réseau, `ownerAvailabilities.value` retombe donc simplement sur son état par
      // défaut ([] au premier appel), jamais réassigné par le catch de ce composable-là.
      // Depuis l'amendement ADR-0005 (2026-08-17), matchesAvailability(..., []) renvoie
      // désormais `true` ("toujours disponible" par défaut, voir eligibility-service.js) :
      // un échec de cette lecture inclut donc prudemment les Requests APPOINTMENT plutôt que
      // de les exclure -- même repli que Clinic Priority en pratique, mais pour une raison
      // différente (ici, c'est le comportement par défaut de "pas de créneau renseigné", pas
      // une dégradation de critère non-exclusif).
      if (allRequests.some((req) => req.requestType === RequestType.APPOINTMENT)) {
        await fetchOwnerAvailabilities()
      }

      // 4. Le Moteur de Matching : on passe par le composite checkEligibility()
      // (src/services/eligibility-service.js) pour que les 5 critères de
      // l'Eligibility (CONTEXT.md) soient réellement appliqués ici, et pas
      // seulement dans useOwnerMissions.acceptMission comme avant ce fix.
      const compatibleRequests = allRequests.filter(req => {
        for (const animal of animals.value) {
          const result = checkEligibility({
            animal,
            request: req,
            ownerLatitude: myLat,
            ownerLongitude: myLon,
            maxTravelDistance: maxDist,
            ownerClinicIds,
          })

          if (!result.eligible) continue

          // Phase 6.5 (ADR-0005) : filtre EXCLUSIF additionnel, uniquement pour APPOINTMENT
          // -- appliqué une fois que checkEligibility() a déjà rendu son verdict, jamais
          // inséré DANS checkEligibility() (les 5 critères de l'Eligibility, CONTEXT.md,
          // restent une hiérarchie fixe et universelle, pas spécifique au type de Request).
          if (
            req.requestType === RequestType.APPOINTMENT &&
            !matchesAvailability(ownerAvailabilities.value, req.appointmentDatetime)
          ) {
            continue
          }

          // On attache l'animal qui matche, la distance et le critère Clinic Priority
          // pour l'affichage, même arrondi qu'avant ce fix.
          req.matchingAnimal = animal
          req.distanceKM = Math.round(result.distanceKM * 10) / 10
          req.hasClinicPriority = result.hasClinicPriority
          return true
        }

        return false
      })

      // 5. Trier : Clinic Priority (critère 5, CONTEXT.md) ne fait passer une Request en
      // tête de tri que si elle reste à une distance raisonnable (CLINIC_PRIORITY_BOOST_RADIUS_KM,
      // voir la constante ci-dessus) ; au-delà, le tri redevient une pure distance croissante,
      // sans notion de groupe.
      //
      // Décision produit actée avec le repo owner (remplace le groupement inconditionnel
      // précédemment implémenté ici) : un groupement inconditionnel ferait remonter en tête
      // une Request de Clinic Priority arbitrairement lointaine, y compris devant une Request
      // toute proche d'une clinique inconnue de l'Owner — inacceptable pour une app d'urgence
      // sanguine, où une urgence lointaine ne doit jamais masquer une urgence proche. Le
      // plafond de distance garde un effet réel à Clinic Priority (départage utile entre
      // Requests proches) tout en respectant "favorise, sans exclure" : rien n'est jamais
      // retiré de la liste, seulement réordonné, et jamais au prix de faire disparaître de vue
      // une Request très proche derrière une Request lointaine.
      //
      // `hasClinicPriority` sur chaque Request n'est pas modifié ici : il reste le booléen brut
      // (clinique déjà connue ou non), utilisé tel quel par le badge "Clinique connue" de
      // DashboardView.vue, indépendamment de la distance.
      matches.value = compatibleRequests.sort((a, b) => {
        const aBoosted = a.hasClinicPriority && a.distanceKM <= CLINIC_PRIORITY_BOOST_RADIUS_KM
        const bBoosted = b.hasClinicPriority && b.distanceKM <= CLINIC_PRIORITY_BOOST_RADIUS_KM
        if (aBoosted !== bBoosted) {
          return aBoosted ? -1 : 1
        }
        return a.distanceKM - b.distanceKM
      })

      // Un succès complet (silencieux ou non) efface un `loadError` précédent : un refresh
      // d'arrière-plan qui aboutit doit pouvoir faire disparaître une bannière d'erreur
      // laissée par un appel explicite antérieur (voir le commentaire sur `loadError` plus haut).
      loadError.value = false
    } catch (e) {
      console.error("Erreur matching:", e)
      // Un échec silencieux (polling/retour de focus) ne doit jamais faire APPARAÎTRE une
      // bannière d'erreur au-dessus de résultats déjà affichés pour un hoquet transitoire
      // d'arrière-plan -- même logique que `isLoading`/`matches.value` ci-dessus, voir le
      // commentaire sur `searchMatches({ silent: true })`. Seul un appel explicite peut poser
      // loadError = true.
      if (!silent) {
        loadError.value = true
      }
    } finally {
      isFetching = false
      if (!silent) {
        isLoading.value = false
      }
    }
  }

  // Identifiant du `setInterval` de polling léger, gardé dans la closure (jamais
  // exposé) — `startAutoRefresh`/`stopAutoRefresh` sont les seules à devoir le lire.
  let refreshIntervalId = null

  // Vrai pendant N'IMPORTE QUEL appel de searchMatches() en cours, silencieux ou
  // non — guard interne uniquement (jamais exposé), sert à `refreshIfVisibleAndIdle`
  // pour éviter d'empiler des appels GraphQL concurrents si le réseau est lent
  // (polling + retour de focus peuvent se déclencher à quelques secondes d'écart
  // l'un de l'autre). Distinct de `isLoading`, qui ne pilote que le spinner plein
  // écran des chargements explicites (voir le commentaire sur `searchMatches`).
  let isFetching = false

  /**
   * Relance `searchMatches({ silent: true })` si l'onglet est visible et qu'aucune
   * recherche n'est déjà en cours.
   */
  const refreshIfVisibleAndIdle = () => {
    if (document.visibilityState === 'visible' && !isFetching) {
      searchMatches({ silent: true })
    }
  }

  /**
   * Démarre le rafraîchissement automatique du dashboard (Phase 4.1) : polling
   * léger toutes les `DASHBOARD_REFRESH_INTERVAL_MS` (skip silencieux si l'onglet
   * est en arrière-plan, pour ne pas solliciter AppSync inutilement) + un refresh
   * immédiat au retour de focus de l'onglet (`visibilitychange`), pour ne pas
   * faire attendre un Owner qui revient après une absence jusqu'au prochain tick.
   *
   * Idempotent (via `stopAutoRefresh()` en tête) : un appel répété n'empile pas
   * plusieurs intervals/listeners. À appeler depuis `onMounted` du composant
   * consommateur ; `stopAutoRefresh()` doit être appelée symétriquement depuis son
   * `onUnmounted` pour éviter une fuite mémoire (interval + listener survivant à la
   * navigation SPA hors du dashboard).
   */
  const startAutoRefresh = () => {
    stopAutoRefresh()
    refreshIntervalId = setInterval(refreshIfVisibleAndIdle, DASHBOARD_REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', refreshIfVisibleAndIdle)
  }

  /** Arrête le polling et retire le listener `visibilitychange`. Sûre à appeler
   * plusieurs fois ou sans `startAutoRefresh()` préalable (no-op). */
  const stopAutoRefresh = () => {
    if (refreshIntervalId !== null) {
      clearInterval(refreshIntervalId)
      refreshIntervalId = null
    }
    document.removeEventListener('visibilitychange', refreshIfVisibleAndIdle)
  }

  return {
    matches,
    isLoading,
    loadError,
    searchMatches,
    startAutoRefresh,
    stopAutoRefresh
  }
}
