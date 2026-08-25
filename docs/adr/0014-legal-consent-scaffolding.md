---
status: accepted
---

# Scaffolding légal/RGPD : pages CGU/CGV/confidentialité versionnées, capture du consentement, attestation vétérinaire write-once

Demande produit (2026-08-25) : Redlink collecte des PII sensibles (identité, géolocalisation,
données animales) sans jamais avoir capturé de consentement explicite ni tracé l'attestation
du vétérinaire à la validation d'un donneur — trou de conformité RGPD identifié avant la
mise en production. Portée explicitement limitée à l'**architecture technique** : aucun
contenu juridique (texte de CGU/CGV/confidentialité, texte d'attestation définitif) n'a été
rédigé ici — uniquement du contenu placeholder, clairement marqué comme tel (voir section 1),
en attendant le texte réel fourni séparément après relecture par un juriste.

## 1. Pages légales versionnées, contenu hors code

4 vues dédiées (`src/views/legal/{CGUView,CGVView,PrivacyPolicyView,LegalNoticeView}.vue`),
toutes de fins wrappers autour d'un composant de présentation partagé
(`src/components/legal/LegalDocumentPage.vue`) — évite de dupliquer 4 fois la même structure
(titre, bandeau version, état de chargement/erreur, rendu markdown).

Contenu stocké en dehors du code applicatif : un fichier markdown par document et par langue
(`public/legal/{cgu,cgv,privacy-policy,legal-notice}.{fr,en}.md`), servi tel quel par Vite
(pas bundlé dans le JS) et chargé via `fetch()` au montage de la vue
(`useLegalDocument.js`), rendu en HTML via `marked` (nouvelle dépendance — voir
`src/services/legal-content-service.js` pour le raisonnement sur ce choix plutôt qu'un
parseur markdown maison). Objectif : le repo owner peut mettre à jour le texte légal en
éditant uniquement ces fichiers `.md`, sans toucher au code Vue/JS. Re-fetch réactif sur
changement de langue (`watch(locale, ...)`, vue-i18n) — un document légal existe en fr ET en,
contrairement au reste de l'i18n du repo (mêmes clés dans les deux fichiers `fr.json`/
`en.json`, pas de contenu séparé par langue).

Versioning : `src/constants/legal.js` (`LEGAL_DOCUMENT_VERSIONS`) est la source de vérité
unique pour la version EN VIGUEUR de chaque document — écrite en dur, mise à jour
manuellement à chaque publication (pas de mécanisme automatique type hash de contenu : une
version est une décision éditoriale/juridique, pas un fait dérivable du texte). Séparé du
contenu lui-même (`.md`) : le texte peut changer de forme (typo, reformulation) sans
justifier une nouvelle version, alors qu'un changement de fond (nouvelle clause) doit en
créer une.

CGV incluse dès maintenant (`LegalDocumentType.CGV`, schéma ET front) même si Stripe n'est
pas implémenté (CONTEXT.md, hors périmètre V1) — page volontairement minimale, prête à être
complétée en priorité à l'activation des paiements plutôt que d'ajouter le type plus tard.

## 2. Capture du consentement : `ConsentRecord`, pas des champs sur Owner/Clinic

Deux options considérées (présentées au repo owner avant implémentation) :

- **Champs sur Owner/Clinic** (`cguAcceptedVersion`/`cguAcceptedAt`/...) : rejetée. Un champ
  n'a qu'une valeur — un futur re-consentement (CGU mises à jour) écraserait silencieusement
  la preuve d'acceptation précédente, sans historique. Va à l'encontre direct du point 4
  ci-dessous (traçabilité CNIL/litige, infalsifiable).
- **Modèle `ConsentRecord` dédié** (retenue) : une ligne par `(userID, documentType,
  documentVersion)`, jamais modifiée ni supprimée après création — garde un historique
  complet, y compris à travers plusieurs versions successives d'un même document.

`userID` générique (= `Owner.id`/`Veterinarian.id`, tous deux = `cognitoUserId` sur ce
schéma) plutôt qu'une relation `belongsTo` dédiée par côté : Gen2 n'a pas de relation
polymorphe, et une relation formelle par côté serait un couplage inutile pour un simple
horodatage de preuve. `userRole` (`AccountRole`, nouvel enum) distingue les deux côtés
puisque `userID` seul ne suffit pas à savoir dans quelle table chercher le profil
correspondant — ni `Owner` ni `Veterinarian` ne portent de champ "rôle" explicite par
ailleurs (le rôle se déduit du modèle lui-même partout ailleurs dans ce schéma).

`documentVersion` écrite depuis `LEGAL_DOCUMENT_VERSIONS` (constants/legal.js) au moment de
la création, JAMAIS une valeur transmise par le client (`useRegistrationCompletion.js`
ignore tout `documentVersion` qui viendrait du payload d'inscription) — une preuve de
consentement doit toujours référencer une version qui a réellement existé.

`createdAt` (auto, généré par AppSync côté serveur) sert d'horodatage d'acceptation, pas de
champ dédié — léger décalage assumé avec l'instant réel du clic sur la case à cocher (le
flux d'inscription confirme d'abord le code Cognito avant d'écrire cette ligne, voir
`VerifyEmailView.vue`/`useRegistrationCompletion.js`) : acceptable, la demande produit
n'exige un timestamp SERVEUR strict que pour l'attestation vétérinaire (section 3), pas pour
le consentement RGPD.

**Write-once au niveau `@auth`, pas seulement dans l'UI** : `allow.ownerDefinedIn('userID')
.to(['create', 'read'])`, aucun `update`/`delete` accordé à personne, même l'auteur de la
ligne. Nouvel idiome pour ce schéma (les deux helpers `.authorization()` existants,
`ownerCreateReadOnlyVetReadUpdate`/`ownerReadOnlyVetReadUpdate`, laissent tous deux quelqu'un
faire `update` — voir `amplify/data/resource.ts`, commentaire de tête de fichier).

Capturé à l'inscription (Owner ET Veterinarian) via deux cases à cocher SÉPARÉES (CGU,
confidentialité), jamais pré-cochées — `RegisterOwnerView.vue`/`RegisterClinicView.vue`
bloquent la progression tant que les deux ne sont pas cochées ; `useRegistrationCompletion.js`
répète le même garde-fou (`CONSENT_REQUIRED`) en défense en profondeur, au cas où cette
fonction serait appelée par un autre chemin. Écriture des deux `ConsentRecord`
**critique, pas best-effort** : contrairement à la convention "écriture secondaire
best-effort" déjà établie dans ce repo (`upsertClinicOwnerRelation`,
`useMissionClosure.js`/`useAnimalValidation.js`), un échec ici rethrow et bloque
l'inscription — la preuve de consentement EST la fonctionnalité, pas un confort d'annuaire
ajouté après une écriture déjà réussie.

## 3. Attestation sur l'honneur du vétérinaire : `DonorValidationAttestation`

Enregistrement DISTINCT de `Animal.isValidatedDonor`/`validationExpiresAt` (ADR-0002) : ces
deux derniers restent le statut opérationnel courant (`correctCriticalFields` peut en théorie
corriger une erreur de ligne), alors que `DonorValidationAttestation` est la preuve immuable
de l'acte d'attestation lui-même — qui (`veterinarianID`, `clinicID` dénormalisé et
best-effort), quand (`createdAt` auto, serveur — exigence produit explicite : "timestamp
serveur, pas côté client"), quelle version du texte affiché (`attestationVersion`,
`src/constants/legal.js`).

Même idiome write-once que `ConsentRecord` (`allow.group('Veterinarians').to(['create',
'read'])`, jamais `update`/`delete`) — "ne doit JAMAIS pouvoir être modifié ou supprimé après
coup, y compris par le vétérinaire lui-même" appliqué au niveau `@auth`, pas seulement dans
l'UI (`ValidationsView.vue` désactive déjà le bouton de confirmation tant que la case n'est
pas cochée — défense en profondeur, pas la seule garde).

### Ordre d'écriture délibéré : attestation AVANT le flip `isValidatedDonor`

`useAnimalValidation.js`, `validateAnimal()` : la `DonorValidationAttestation` est créée
**avant** la mutation `Animal.update({ isValidatedDonor: true, ... })`, et son échec
**bloque** cette mutation (rethrow, pas de flip). C'est l'INVERSE du pattern best-effort déjà
établi pour `upsertClinicOwnerRelation` dans ce même fichier (best-effort, APRÈS la mutation
critique, jamais bloquant). Divergence assumée et documentée en commentaire à l'endroit
précis : ici, l'attestation EST la partie critique du point de vue légal — un
`isValidatedDonor: true` sans `DonorValidationAttestation` associée serait exactement le
risque que ce scaffolding existe pour éliminer (donneur marqué validé sans aucune preuve
d'attestation). `clinicID` (dénormalisé, résolution `fetchVetClinicId()`) reste, lui,
best-effort — un clinicID non résolu ne dégrade qu'un champ de confort, pas la preuve
elle-même (`veterinarianID`/`attestationVersion`/`createdAt` restent toujours présents).

### Révocation : schéma prêt, aucune UI livrée

`eventType` (`DonorValidationEventType`, `ATTESTATION`/`REVOCATION`) +
`revokedAttestationID`/`revocationReason` : la demande produit exige que, si une validation
est un jour annulée, l'attestation d'origine ne soit jamais supprimée mais qu'un nouvel
enregistrement de révocation soit créé à côté. Aucune fonctionnalité de révocation
n'existe aujourd'hui dans ce repo (grep confirmé sur `revoke`/`annul`/`unvalidate` avant
implémentation, 2026-08-25) — ces champs sont câblés en avance, pas en réaction à un besoin
actuel, même statut que `Veterinarian.validatedMissions`/`Mission.activeForRequest`
(ADR-0010) : mécanique de schéma imposée par la demande produit, pas une fonctionnalité
livrée dans cette PR.

## 4. Traçabilité générale (plan, non implémenté)

Demande produit : pouvoir retrouver, en cas de contrôle CNIL ou de litige, qui a consenti à
quoi et quand, et qui a attesté quoi et quand, de façon infalsifiable. `ConsentRecord`/
`DonorValidationAttestation` (sections 2-3) couvrent déjà l'infalsifiabilité au niveau
donnée (write-once `@auth`) — ce qui manque est une **vue d'audit** exploitable côté humain,
volontairement non construite dans cette PR (scaffolding technique demandé, pas cette
fonctionnalité précise) :

- Une vue Admin (groupe Cognito `Admins`, déjà référencé dans le schéma mais jamais
  provisionné par l'IaC — gap préexistant documenté dans `amplify/data/resource.ts`/
  ADR-0010, section "Gaps préexistants") listant/filtrant `ConsentRecord`/
  `DonorValidationAttestation` par utilisateur/animal/période.
- Un export (CSV/PDF) de ces enregistrements pour une demande CNIL ou un litige, plutôt qu'un
  accès direct à DynamoDB.
- Alerte/rapport sur les comptes n'ayant PAS de `ConsentRecord` pour la version en vigueur
  d'un document (utile après une mise à jour des CGU, pour identifier qui doit re-consentir —
  aucun mécanisme de re-consentement forcé n'existe non plus à ce jour : un Owner/Veterinarian
  déjà inscrit avant un changement de version n'est jamais invité à re-accepter).
- Journal d'accès aux enregistrements d'audit eux-mêmes (qui a consulté quelle preuve de
  consentement/attestation, et quand) — nécessaire pour que l'audit trail reste lui-même
  infalsifiable de bout en bout, pas seulement à l'écriture.

## 5. Ce qui n'a pas été fait, volontairement

- Aucun contenu juridique rédigé (voir en-tête) — placeholders structurels uniquement,
  clairement marqués, dans `public/legal/*.md`.
- Pas de sanitization HTML (DOMPurify) sur le rendu markdown — le contenu vient exclusivement
  de fichiers écrits par l'équipe (`src/legal/*.md`), jamais d'une saisie utilisateur ni
  d'une source distante (voir `legal-content-service.js`).
- Pas de mécanisme de re-consentement forcé à une mise à jour de version (section 4).
- Pas d'UI de révocation d'attestation (section 3) — schéma prêt, fonctionnalité non livrée.
- Pas de vue d'audit Admin (section 4) — plan seulement.

## Relation avec le reste des ADR

Introduit un troisième idiome `.authorization()` pour ce schéma (write-once véritable,
`create+read` seul sans jamais `update`/`delete`), en complément des deux déjà établis
(`ownerCreateReadOnlyVetReadUpdate`/`ownerReadOnlyVetReadUpdate`, voir ADR-0002/ADR-0006) —
ne les remplace pas, s'ajoute pour un besoin structurellement différent (preuve immuable vs.
champ verrouillé mais toujours corrigible par un rôle). Suit le même principe de traduction
`@auth` que ADR-0009 (`ownerDefinedIn` explicite plutôt que le champ caché par défaut, pour
`ConsentRecord.userID`) et le même réflexe de pairage de relations que ADR-0010
(`Animal.validationAttestations`/`Veterinarian.donorValidationAttestations`, contrepartie
obligatoire des deux `belongsTo` de `DonorValidationAttestation`).
