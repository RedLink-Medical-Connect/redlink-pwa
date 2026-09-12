---
status: accepted
supersedes: none
---

# Emails transactionnels de marque (trigger `CustomMessage`), avec i18n

Jusqu'ici, les deux emails transactionnels du produit (code de confirmation d'inscription, code
de réinitialisation de mot de passe) étaient le texte brut par défaut de Cognito — aucune
personnalisation, aucune i18n, pas de cohérence avec le reste du produit (`src/locales/{fr,en}.json`).

## 0. Décision

Un trigger Cognito **`CustomMessage`** (`amplify/functions/custom-message/`), QUATRIÈME trigger
Lambda du projet après `post-confirmation/` (ADR-0008), `mission-validation-auto-finalizer/`
(ADR-0016) et `rating-aggregation/` (ADR-0017) — référencé depuis `amplify/auth/resource.ts`
exactement comme `post-confirmation` (`triggers: { postConfirmation, customMessage }`).

Pas de moteur de templates (MJML/Handlebars) ni de nouvelle dépendance npm : des **fonctions TS
pures qui renvoient des strings HTML**, même philosophie que les *deep modules*
`src/services/*-service.js` du front (CLAUDE.md, section Conventions), transposée côté
`amplify/**/*.ts`. Justifié par le volume actuel (2 emails) — voir §3 pour quand ce choix devrait
être reconsidéré.

```
amplify/functions/custom-message/
  resource.ts                  → defineFunction, pas de resourceGroupName (voir §2)
  handler.ts                   → dispatch sur event.triggerSource
  templates/
    layout.ts                  → renderLayout({ locale, preheader, heading, bodyHtml }) : string
                                   + renderCodeBlock(label, code) : string (bloc partagé)
    verification-email.ts      → renderVerificationEmail({ code, locale })
    forgot-password-email.ts   → renderForgotPasswordEmail({ code, locale })
  i18n/
    messages.ts                → emailMessages: Record<'fr'|'en', ...>, resolveEmailLocale()
```

`layout.ts` est le "template global" dont parlait la demande produit : chaque email spécifique ne
fournit que son `bodyHtml`, `renderLayout()` pose le header de marque, le footer, et la structure
HTML compatible email (tables + CSS inline — Outlook/Gmail ignorent tout `<style>` externe, ce
n'est pas un choix de style de code). `renderCodeBlock()` est le second niveau d'héritage : les
deux templates actuels affichent un code Cognito de la même façon.

## 1. `triggerSource` couverts, et pourquoi pas les autres

Cognito invoque `CustomMessage` avec un `triggerSource` différent selon le flux :
`CustomMessage_SignUp`, `CustomMessage_ResendCode`, `CustomMessage_ForgotPassword`,
`CustomMessage_AdminCreateUser`, `CustomMessage_UpdateUserAttribute`,
`CustomMessage_VerifyUserAttribute`, `CustomMessage_Authentication`.

Seuls les trois premiers sont branchés (`handler.ts`) :
- `CustomMessage_SignUp` et `CustomMessage_ResendCode` partagent le même email
  (`renderVerificationEmail`) — même geste produit (confirmer son adresse), que ce soit le
  premier envoi ou un renvoi (`resendCode`/`signUp`'s `UsernameExistsException` branch,
  `amplify/functions/bff/auth-routes.ts`).
- `CustomMessage_ForgotPassword` → `renderForgotPasswordEmail`.

Les autres ne sont déclenchés par **aucun** flux applicatif de ce repo aujourd'hui (pas de
`AdminCreateUserCommand`, pas de changement d'email en libre-service, pas d'auth passwordless) —
`handler.ts` les laisse passer inchangés (`default: break`), Cognito applique alors son propre
template par défaut plutôt qu'un design à moitié fini pour un cas qui ne peut pas se produire. Si
un futur flux les déclenche, ça se remarquera immédiatement (email non stylé), pas silencieusement.

## 2. `resourceGroupName` : pas nécessaire (les deux angles du critère CLAUDE.md vérifiés)

Cette Lambda n'a ni permission IAM sur `data` (premier angle du critère), ni `addEnvironment()`
cross-stack dans `backend.ts` référençant une ressource `auth`/`data`/`bff` (second angle, ajouté
après le bug circulaire du BFF — voir CLAUDE.md, ADR-0021 §6ter) : elle ne fait qu'assembler des
strings à partir de `event.request.codeParameter`/`event.request.clientMetadata`, aucun appel SDK.
Elle rejoint donc, comme `post-confirmation`, la stack imbriquée partagée par défaut — c'est
d'ailleurs la même famille de trigger Cognito, référencée au même endroit
(`amplify/auth/resource.ts`).

## 3. Locale : `clientMetadata`, résolue côté Lambda, pas côté BFF

`event.request.clientMetadata.locale` est posé par le BFF (`amplify/functions/bff/auth-routes.ts`)
via `ClientMetadata` sur `SignUpCommand`/`ResendConfirmationCodeCommand`/`ForgotPasswordCommand` —
seul canal Cognito qui fait transiter une donnée arbitraire du client jusqu'au trigger
`CustomMessage`. Le BFF ne valide ni ne résout cette valeur (`localeMetadata()` se contente de
l'omettre si absente — `ClientMetadata` du SDK est `Record<string, string>`, pas
`Record<string, string | undefined>`) : la résolution de repli (`resolveEmailLocale`,
`i18n/messages.ts`) vit uniquement côté `custom-message`, seule source de vérité — le BFF
serait un second endroit à maintenir en synchronisation pour aucun bénéfice.

Le front envoie la locale courante (`i18n.global.locale.value`, `src/i18n.js`) depuis
`stores/auth.js` (`register`/`forgotPass`) et `VerifyEmailView.vue` (`resend-code`, via
`useI18n().locale`). Repli serveur sur `fr` (pas `en` comme le `fallbackLocale` du front) : la
locale n'arrive jamais ici via un `navigator.language` fiable, seulement via ce
`clientMetadata.locale` optionnel — `fr` reste le choix le plus sûr pour la base d'utilisateurs
actuelle (cliniques vétérinaires partenaires, cf. CLAUDE.md).

## 4. Ce qui n'a pas été vérifié (à confirmer au premier déploiement réel)

Les durées de validité affichées dans les emails (24h pour le code de confirmation, 1h pour le
code de réinitialisation) sont les valeurs par défaut documentées de Cognito — ce repo ne les
configure nulle part explicitement (`amplify/auth/resource.ts` ne pose aucun
`userVerification`/`AccountRecoverySetting` custom), donc rien ne les override. Comme pour
`profilePage` (`amplify/auth/resource.ts`), non vérifiable via `context7`/`amplify-docs` dans
cette session (Gen1 uniquement pour ce dernier) — à confirmer par un vrai `ampx sandbox` avant
tout déploiement. Une divergence serait une correction locale des deux chaînes concernées
(`i18n/messages.ts`), pas une remise en cause du design.

Si les emails transactionnels se multiplient significativement au-delà des deux couverts ici, ou
si le design attendu devient trop riche pour des tables + CSS inline écrites à la main (mise en
page complexe, plusieurs colonnes), introduire MJML (compilé en HTML à la construction, pas au
runtime Lambda) devient justifié — pas aujourd'hui (YAGNI).
