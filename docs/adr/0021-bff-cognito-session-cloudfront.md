---
status: accepted (implémenté et testé sur la branche feat/bff-cognito-session, PAS déployé
  ni mergé -- voir §6 pour ce qui reste à vérifier au premier déploiement réel)
supersedes: none (ferme le Différé 2 du plan de durcissement sécurité, 2026-09-02/04 —
  voir ~/.claude/plans/cozy-dazzling-lagoon.md)
---

# BFF pour la session Cognito : reverse-proxy transparent derrière CloudFront

## 0. Contexte et ce que ça ferme

Ré-audit sécurité du 2026-09-04 : les tokens Cognito (ID/Access/Refresh) vivent côté
navigateur via `sharedInMemoryStorage` (`src/main.js`, posé lors du Groupe 2 du
durcissement du 2026-09-02) — mitigation immédiate contre l'exfiltration XSS (les tokens
ne touchent plus le disque), mais avec trois limites assumées à l'époque :

1. Pas de cookie `HttpOnly` — un XSS actif PENDANT une session ouverte peut toujours lire
   les tokens en mémoire JS.
2. La session ne survit pas à un rechargement/fermeture d'onglet (effet de bord assumé).
3. Corollaire découvert le 2026-09-04 : c'est CE point précis qui force `VerifyEmailView.vue`
   à redemander un mot de passe si la page est rechargée entre `signUp()` et la
   confirmation du code (`registrationData`/tokens perdus, repli sur un mot de passe qui
   n'a jamais été utilisé).

Un BFF (composant serveur qui termine la session Cognito et ne renvoie au navigateur
qu'un cookie `HttpOnly`/`Secure`/`SameSite=Strict`) ferme les trois. C'est le chantier
"Différé 2" du plan de durcissement, explicitement reporté à son propre ADR avant tout
code — ce document est cet ADR.

## 1. Le risque de conception qui a failli tout faire dérailler : réécrire les 13 composables

Le réflexe naturel est : "les tokens ne doivent plus jamais atteindre le JS du
navigateur, donc plus aucun composable ne peut appeler `generateClient()` (`aws-amplify/data`)
directement — il faut un client de remplacement, appelé par les 13 composables listés
dans CLAUDE.md, qui parle au BFF au lieu d'AppSync." Chiffré, ça veut dire : réécrire
`useAnimals.js`, `useOwnerProfile.js`, `useOwnerAvailability.js`,
`useRegistrationCompletion.js`, `useClinicDonors.js`, `useClinicRequest.js`,
`useClinicSettings.js`, `useClinicStats.js`, `useAnimalValidation.js`,
`useMatchingRequests.js`, `useMissionClosure.js`, `useOwnerMissions.js`, `useRatings.js`
**ET** chacun de leurs fichiers de test (la plupart mockent `aws-amplify/data` directement,
`vi.mock('aws-amplify/data', () => ({ generateClient: ... }))` — voir
`useOwnerProfile.test.js`). C'est le chantier que Différé 2 redoutait ("nouveau composant
d'infra, latence, CORS, coût de maintenance").

**Ce n'est pas nécessaire.** Vérifié dans le code source installé (`@aws-amplify/api-graphql`
6.20.0, pas dans la doc — le comportement exact d'authentification n'est documenté nulle
part de façon fiable) :

- `headerBasedAuth()` (`node_modules/@aws-amplify/api-graphql/src/internals/graphqlAuth.ts`)
  est la fonction qui décide, à CHAQUE appel `client.models.X.*()`, quel header
  `Authorization` envoyer. Pour `authMode: 'userPool'` (le mode actuel, seul déclaré dans
  `amplify/data/resource.ts`), elle appelle `Auth.fetchAuthSession()` et **échoue tout
  de suite côté client** (`NO_SIGNED_IN_USER`) si aucune session Cognito locale n'existe
  — exactement le cas si les tokens ne vivent plus que côté BFF. C'est cette ligne qui
  aurait forcé la réécriture des 13 composables.
- Mais `authMode: 'lambda'` a une garde beaucoup plus faible (ligne 68-79 du même
  fichier) : elle exige seulement qu'`additionalHeaders.Authorization` soit une chaîne
  NON VIDE — **peu importe sa valeur**, aucun appel réseau ni vérification de session
  n'est fait côté client.
- `generateClient({ endpoint, authMode, authToken })` (`.../internals/generateClient.ts`,
  lignes 44-45, 62-69) accepte un `endpoint`/`authMode`/`authToken` **au niveau du
  client**, pas par appel — posé UNE FOIS, hérité par tous les appels `.models.X.*()`
  faits sur ce client.

**Correction (en écrivant le code, pas seulement en le concevant)** : `authToken` (le
header `Authorization` bidon nécessaire pour passer la garde `lambda`, voir §1 ci-dessus)
n'a PAS d'équivalent au niveau GLOBAL `Amplify.configure()` -- vérifié dans
`@aws-amplify/core` (`GraphQLProviderConfig`, aucun champ `authToken`/`headers`
n'atteint le chemin AppSync réel, seulement `endpoint`/`region`/`apiKey`/
`defaultAuthMode`) et dans `InternalGraphQLAPI.ts` (`authToken` vient exclusivement du
`generateClient({ authToken })` posé À LA CONSTRUCTION du client, jamais d'une config
globale). Impossible donc de le faire hériter automatiquement par les 13 `generateClient()`
sans arguments déjà en place.

**Conséquence corrigée** : pas zéro changement, mais un changement minimal, uniforme et
mécanique -- un module partagé unique, `src/services/bff-graphql-client.js`, exporte un
`generateClient()` qui embarque UNE FOIS `{ authMode: 'lambda', authToken: 'bff-session' }`
(SANS `endpoint` -- voir le piège documenté dans ce même fichier : passer un `endpoint` au
client désactive le chargement du schéma, `.models` resterait un Proxy vide ; l'URL réelle
est surchargée au niveau de la config GLOBALE, `Amplify.configure()`/`outputs.data.url`
dans `src/main.js`, qui continue de fournir la vraie introspection de schéma) ; chaque
composable change **une seule ligne**, son import (`from 'aws-amplify/data'` -> `from
'@/services/bff-graphql-client'`), jamais l'appel lui-même (`client.models.Animal.create(...)`,
`selectionSet`, `filter` : inchangés à l'octet près). Leurs fichiers de test changent la
même ligne (la cible de leur `vi.mock(...)`), jamais leurs assertions métier. AppSync, lui,
ne voit jamais ce header bidon — voir §3.

## 2. Pourquoi CloudFront, sans domaine personnalisé aujourd'hui

Un cookie `SameSite=Strict` posé par un service sur un domaine différent de celui de la
SPA n'est JAMAIS envoyé par le navigateur vers ce service — exactement ce que
`SameSite=Strict` est censé empêcher. Aujourd'hui, l'app tourne sur le domaine par
défaut Amplify Hosting (`AmplifyAppId: d20qrsdkzeugxd`, pas de domaine personnalisé —
confirmé, `amplify/team-provider-info.json`) ; un Lambda séparé (Function URL ou API
Gateway) vivrait sur un domaine AWS complètement différent — cookie jamais transmis, le
mécanisme serait cassé silencieusement.

Une distribution CloudFront a son propre domaine `*.cloudfront.net` généré à la
création, **sans dépendre d'un nom de domaine possédé**. Deux origines/behaviors sur
cette même distribution :
- `/*` (défaut) → origine = domaine Hosting Amplify actuel (la SPA, inchangée)
- `/api/*` → origine = le Lambda BFF (Function URL)

Les deux deviennent same-origin sous le domaine de la distribution CloudFront — les
cookies `SameSite=Strict` fonctionnent dès aujourd'hui, sans attendre le domaine dédié
prévu à terme (confirmé par le repo owner, 2026-09-06 : hosting Amplify restera
utilisé pour le pre-prod, un domaine dédié arrivera pour le prod). **Migration prévue
dès la conception** : quand ce domaine existe, il s'ajoute comme alias sur cette MÊME
distribution (+ certificat ACM) — aucune réarchitecture, juste un DNS CNAME de plus.

## 3. Le proxy GraphQL : relais brut, pas une réimplémentation du client Data

Recherche faite (et son cul-de-sac, documenté pour ne pas être refait) : `aws-amplify/data/server`
existe bien (`node_modules/aws-amplify`, exports 6.20.0) mais résout vers
`@aws-amplify/api-graphql/server` — le client GraphQL BRUT (`client.graphql(contextSpec,
{ query, variables })`), PAS l'équivalent serveur du client typé `.models.X` utilisé par
ce repo. L'équivalent typé server-side (`generateServerClientUsingCookies`) n'existe que
dans `@aws-amplify/adapter-nextjs/data` — un package Next.js, inutilisable ici (Vue/Vite,
pas de framework serveur). Reconstruire `.models.X` à la main côté Lambda aurait voulu
dire réintroduire des documents GraphQL écrits à la main — régression directe contre la
Phase 8 sous-tâche 6 (suppression de `src/graphql/{queries,mutations,...}.js`, CLAUDE.md).

Solution retenue, cohérente avec §1 (le client CONTINUE de construire lui-même le
document GraphQL, exactement comme aujourd'hui) : le Lambda BFF ne fait QUE relayer le
corps brut de la requête POST `/graphql` déjà construite par `generateClient()` côté
navigateur, en réécrivant un seul header avant de la transmettre telle quelle à la
vraie URL AppSync :

1. Lit le cookie de session (voir §4), résout/rafraîchit le vrai token Cognito
   (`fetchAuthSession` de `aws-amplify/auth/server`, cf. §4 — c'est CETTE fonction, pas
   le client Data, qui a un vrai équivalent server-side framework-agnostic, confirmé
   dans le pattern Nuxt officiel via `aws-amplify/adapter-core`).
2. Remplace le header `Authorization` bidon (`bff-session`, voir §1) par le VRAI token
   Cognito.
3. Transmet le body JSON (`{ query, variables, operationName }`) tel quel à l'URL AppSync
   réelle (`outputs.data.url`, connue du Lambda via variable d'environnement posée à la
   synthèse CDK).
4. Renvoie la réponse AppSync telle quelle au navigateur.

`amplify/data/resource.ts` ne change PAS : `authorizationModes.defaultAuthorizationMode:
'userPool'` reste le seul mode déclaré côté AppSync — AppSync ne voit jamais le header
bidon `lambda`, seulement un vrai JWT `userPool`, geré exactement comme aujourd'hui (pas
de nouveau mode d'auth AppSync, pas de nouvelle surface).

## 4. Session : SDK Cognito direct, pas `aws-amplify/adapter-core`

`aws-amplify/adapter-core` (`createKeyValueStorageFromCookieStorageAdapter`,
`createUserPoolsTokenProvider`, `runWithAmplifyServerContext`) EXISTE et est
framework-agnostic (confirmé §1/§3 par l'intégration Nuxt officielle, sans aucun package
`@aws-amplify/adapter-nextjs`) — mais son usage documenté couvre la LECTURE de session
(`getCurrentUser`/`fetchAuthSession` ont un équivalent `/server` confirmé) ; rien
d'aussi bien établi pour les opérations qui ÉCRIVENT une nouvelle session
(`signIn`/`signUp` classiques, pas `/server`) sous ce mécanisme.

Décision : **SDK Cognito Identity Provider direct**
(`@aws-sdk/client-cognito-identity-provider`, déjà une dépendance du projet — utilisé
nulle part encore côté runtime, seulement dans `package.json`) plutôt que
`adapter-core`. Le Lambda BFF appelle lui-même `InitiateAuth`
(`USER_PASSWORD_AUTH`)/`SignUp`/`ConfirmSignUp`/`ResendConfirmationCode`/
`RespondToAuthChallenge` (MFA TOTP)/`ForgotPassword`/`ConfirmForgotPassword`/
`GlobalSignOut`/`DeleteUser` — ce sont des opérations PUBLIQUES de l'API Cognito
Identity Provider, scopées par le seul `ClientId` de l'App Client (aucune permission
IAM requise sur le rôle du Lambda, exactement le même modèle de confiance que le SDK
navigateur aujourd'hui). Chaque appel réussi renvoie directement `IdToken`/
`AccessToken`/`RefreshToken`/`ExpiresIn` (`AuthenticationResult`) — posés en cookies par
le Lambda lui-même (`HttpOnly`/`Secure`/`SameSite=Strict`/`Path=/api`), sans passer par
aucune couche d'abstraction de stockage. Le rafraîchissement (`InitiateAuth
REFRESH_TOKEN_AUTH`) est un appel du même SDK, pas une mécanique différente à apprendre.

**AppSync attend l'ID TOKEN, pas l'Access token**, dans l'`Authorization` header pour
`authMode: userPool` — le claim `cognito:groups` (utilisé par `allow.group('Veterinarians')`
etc., partout dans `amplify/data/resource.ts`) vit dans l'ID token, pas l'Access token.
C'est CE token qui est relayé à l'étape 2 du §3, et c'est CE cookie que le refresh met à
jour.

Le cookie ne contient donc bien le JWT que sous protection `HttpOnly` (illisible en JS,
c'est tout l'objectif ; pas de chiffrement supplémentaire du contenu — hors périmètre de
la demande initiale, `HttpOnly`+`Secure`+`SameSite=Strict` est le mécanisme demandé, pas
un chiffrement applicatif en plus).

Corollaire infra : `InitiateAuth` en `USER_PASSWORD_AUTH` (mot de passe transmis
directement, protégé par TLS -- pas `USER_SRP_AUTH`, le flux par défaut du SDK
navigateur Amplify, qui échange une preuve zero-knowledge sans jamais transmettre le mot
de passe). Réimplémenter SRP côté serveur (calculs sur grands nombres, sel/vérificateur)
aurait été un risque de sécurité EN SOI (code cryptographique maison, jamais audité) pour
un gain marginal ici : le mot de passe transite déjà en clair jusqu'au Lambda via TLS,
seule différence avec SRP est où s'arrête cette protection -- TLS partout dans cette
architecture (navigateur -> CloudFront -> Lambda -> Cognito), pas de segment non chiffré.
`USER_PASSWORD_AUTH` n'est PAS activé par défaut sur l'App Client généré par
`defineAuth` (Gen2 privilégie SRP, comme Amplify) -- à activer explicitement
(`cfnUserPoolClient.explicitAuthFlows`, échappatoire CDK déjà en place pour ce même objet
dans `amplify/backend.ts`) en GARDANT `ALLOW_USER_SRP_AUTH` (le client Amplify actuel
d'`AddAnimalPhoto`/etc. ne l'utilise plus pour l'auth utilisateur après ce chantier, mais
rien ne force à le retirer, et `ALLOW_REFRESH_TOKEN_AUTH` reste nécessaire pour le
rafraîchissement).

## 5. Endpoints du BFF qui ne sont PAS un relais GraphQL

Le proxy du §3 ne couvre que `/api/graphql` (les 13 composables, inchangés côté appel —
voir §5bis pour une nuance découverte en implémentation). Les opérations qui établissent
OU changent une session (`signIn`, `signUp`, `confirmSignUp`, `resendSignUpCode`,
`confirmSignIn` MFA, `resetPassword`, `confirmResetPassword`, `signOut`, `deleteUser`)
étaient des appels directs `aws-amplify/auth` dans `src/stores/auth.js` — réécrits pour
taper sur des routes du Lambda BFF (`/api/auth/signin`, `/api/auth/signup`, etc., §4) via
un helper partagé (`src/services/bff-fetch.js`) au lieu du SDK Amplify côté navigateur.
**Ici, contrairement au client Data (§1), la réécriture de `stores/auth.js` est
nécessaire et assumée** — un seul fichier (pas 13), déjà dans le périmètre "surface
d'authentification" annoncé au repo owner. Fait, testé (`stores/__tests__/auth.test.js`).

## 5bis. Découvert en implémentation : `getCurrentUser()`/`deleteUser()` hors du store, et MFA

Deux points absents de la conception initiale (§0-§4), trouvés en écrivant le code :

1. **~10 composables appellent `getCurrentUser()`/`deleteUser()` (`aws-amplify/auth`)
   directement**, pas seulement `stores/auth.js` — pour scoper leurs requêtes (`ownerID`,
   `veterinarianID`...) ou dupliquer la suppression de compte
   (`useClinicSettings.js`/`useOwnerProfile.js`). Pattern uniforme (`const { userId } =
   await getCurrentUser()`, ~16 occurrences identiques) : fermé par le même principe que
   `bff-graphql-client.js` (§1) — un module partagé, `src/services/bff-auth-session.js`,
   dont `getCurrentUser()` lit `useAuthStore().user` (déjà peuplé par `auth.init()` avant
   toute vue, `src/router/index.js`) au lieu d'interroger un SDK local, et dont
   `deleteUser()` appelle `/api/auth/delete-account`. Chaque composable ne change qu'une
   ligne, son import. Fait, testé (`services/__tests__/bff-auth-session.test.js`).
2. **`useMfa.js`** (enrôlement/désactivation TOTP) : `setUpTOTP`/`verifyTOTPSetup`/
   `updateMFAPreference`/`fetchMFAPreference` sont des opérations Cognito authentifiées,
   besoin de l'ACCESS TOKEN (pas l'ID token, qui ne sert qu'au proxy GraphQL du §3) --
   structurellement impossible côté navigateur maintenant. 4 nouvelles routes BFF
   (`amplify/functions/bff/auth-routes.ts`) : `getMfaStatus`/`startMfaSetup`/
   `confirmMfaSetup`/`disableMfa`, toutes exigeant l'access token. Le format de l'URI
   `otpauth://` (contenu du QR code) est repris à l'IDENTIQUE de l'implémentation Amplify
   (`getTOTPSetupDetails`, vérifié dans le paquet installé) pour ne rien changer à
   l'expérience d'enrôlement. Fait, testé (`auth-routes.test.ts` + `useMfa.test.js`).

## 6bis. Développement local (`npm run dev`)

Pas encore traité. `bff-graphql-client.js`/`bff-fetch.js` pointent vers des chemins
relatifs (`/api/graphql`, `/api/auth/*`) -- en local (Vite dev server, `localhost:5173`),
rien n'écoute sur ces chemins tant qu'un proxy Vite (`vite.config.js`, `server.proxy`)
n'est pas configuré vers un environnement BFF réellement déployé (sandbox ou pre-prod).
Avant ce chantier, le développement local parlait directement à AppSync/Cognito avec une
session locale (`ampx sandbox`) -- ce n'est plus possible pour AUCUN flux authentifié
(données ET auth) une fois ces modules en place partout. À trancher avec le repo owner
avant que quiconque développe localement une fonctionnalité touchant l'un de ces flux.

## 6. Ce que ce document ne tranche pas encore

- Aucun `ampx sandbox`/`pipeline-deploy` n'a été lancé pour ce chantier (aucun agent ne
  déploie, CLAUDE.md) — la mécanique cookies/CloudFront/Lambda Function URL/OAC est
  vérifiée par lecture de code (y compris les types CDK réellement installés,
  `FunctionUrlOrigin.withOriginAccessControl` confirmé disponible dans
  `aws-cdk-lib@2.265.0`) et tests unitaires avec mocks, PAS par un test de bout en bout
  contre AWS réel. Premier vrai test possible seulement au premier déploiement du repo
  owner — en particulier la reconstruction du domaine Hosting par défaut à partir de
  `$AWS_APP_ID`/`$AWS_BRANCH` (`amplify/backend.ts`), jamais vérifiée contre un vrai build
  CI.
- Développement local (`npm run dev`) — voir §6bis.

## 7. Ce que ça NE règle PAS

- L'atomicité de l'inscription (R-25, `useRegistrationCompletion.js`) — problème
  orthogonal, sa solution documentée est `TransactWriteItems` (CLAUDE.md, section
  Backend/Infra), sans rapport avec où vit la session.
- La vérification d'identité clinique/vétérinaire à l'inscription (Différé 1) — workflow
  métier sans rapport.
