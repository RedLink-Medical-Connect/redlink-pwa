/**
 * Traduction de la réponse `{ data, errors }` du client Gen2 (`aws-amplify/data`,
 * `client.models.X.*`) en exception JS, pour préserver le contrat d'erreur que les
 * composables et les vues consommatrices avaient déjà sous Gen1.
 *
 * Contexte (Phase 8, sous-tâche 5 -- migration composable-par-composable Gen1 -> Gen2) :
 * en Gen1, `generateClient()` (`aws-amplify/api`) exposait `client.graphql({ query,
 * variables })`, qui LÈVE une exception JS sur toute erreur GraphQL/`@auth` -- y compris un
 * succès partiel (un objet erreur qui porte lui-même `.data`/`.errors`, cf. le pattern
 * `catch (error) { if (error.data && error.data.xxx) { ... succès malgré tout ... } }` que ce
 * repo utilisait avant cette migration). En Gen2, `client.models.X.method(...)` (toujours
 * `generateClient()`, mais version `.models.*`) NE LÈVE PLUS d'exception pour une erreur
 * GraphQL/`@auth` -- il RÉSOUT normalement avec `{ data, errors }` (`data` peut être `null`,
 * `errors` un tableau de `GraphQLFormattedError` si l'opération a échoué ou a réussi
 * partiellement). Confirmé via `context7` (`/aws-amplify/amplify-data`,
 * `SingularReturnValue<T>`) et en lisant
 * `node_modules/@aws-amplify/data-schema-types/src/client/index.ts` pendant la sous-tâche 5.
 *
 * Sans ce fichier, chaque composable devait réintroduire manuellement
 * `Object.assign(new Error('Erreur GraphQL <opName>'), { errors })` à chaque appel --
 * exactement le même motif 16 fois dans les 4 composables du lot 1 (`useAnimals.js`,
 * `useOwnerProfile.js`, `useOwnerAvailability.js`, `useRegistrationCompletion.js`), et ~40+
 * fois prévues une fois les 8 composables restants (lots 2/3) migrés -- extrait ici en
 * fonctions pures (convention "Services (deep modules)", `CLAUDE.md`/`.cursorrules` :
 * aucune réactivité Vue, aucun appel réseau/GraphQL, aucun accès DOM -- uniquement la
 * transformation d'un `{ data, errors }` déjà résolu par l'appelant).
 *
 * Les deux formes déjà observées dans le lot 1 :
 * - `throwIfGraphqlError` : le composable Gen1 levait TOUJOURS sur une erreur GraphQL, sans
 *   notion de succès partiel (ex. une simple lecture -- `fetchAnimals`, `fetchProfile` --, ou
 *   une écriture dont Gen1 ne gérait déjà aucun cas `error.data.xxx` -- `updateProfile`,
 *   chaque `create()` de `useRegistrationCompletion.js`, `addAvailabilityForDays`,
 *   `removeAvailability`).
 * - `resolveOrThrowOnFailure` : le composable Gen1 gérait explicitement un succès partiel
 *   (`error.data.xxx` présent malgré `error.errors`) comme un succès plutôt que de relancer
 *   -- `updateAnimalDetails`/`deleteAnimalById` (`useAnimals.js`). `data` présent (même
 *   accompagné d'`errors`) est traité comme un succès et retourné tel quel ; seule l'absence
 *   de `data` exploitable accompagnée d'`errors` déclenche l'exception. Un éventuel besoin de
 *   signaler ce succès partiel à l'appelant (ex. `console.warn`) reste à la charge du
 *   composable -- ce service ne fait que trancher "succès ou échec", pas la présentation.
 *
 * Dans les deux cas, l'exception synthétisée porte le message `Erreur GraphQL <opName>` et
 * une propriété `.errors` (le tableau `GraphQLFormattedError` d'origine) -- format déjà
 * stabilisé dans le lot 1 et lu tel quel par les vues consommatrices
 * (`AddAnimalView.vue`/`VerifyEmailView.vue`, `err.errors[0].message`). Ne pas changer ce
 * contrat sans vérifier ces deux vues.
 */

/**
 * Lève une exception si `errors` est présent -- traduction directe d'un appel Gen1 qui
 * n'avait aucune notion de succès partiel : toute erreur GraphQL/`@auth` doit se comporter
 * comme l'exception que `client.graphql()` aurait levée.
 *
 * @param {Array<{message: string}>|undefined|null} errors Le champ `errors` d'une réponse
 *   `{ data, errors }` résolue par `client.models.X.method(...)`.
 * @param {string} opName Nom de l'opération GraphQL d'origine (ex. `'getOwner'`,
 *   `'createAnimal'`) -- utilisé tel quel dans le message `Erreur GraphQL <opName>`, pour
 *   rester lisible dans un `console.error`/`console.warn` appelant.
 * @throws {Error} Une erreur dont le message est `Erreur GraphQL <opName>` et dont la
 *   propriété `.errors` porte le tableau d'origine, si `errors` est présent.
 */
export function throwIfGraphqlError(errors, opName) {
  if (errors) {
    throw Object.assign(new Error(`Erreur GraphQL ${opName}`), { errors })
  }
}

/**
 * Résout un `{ data, errors }` en traitant un succès partiel (`data` exploitable malgré
 * `errors`, ex. une relation annexe non résolue) comme un succès -- traduction du pattern
 * Gen1 `catch (error) { if (error.data && error.data.xxx) { ... } else { throw error } }`.
 *
 * @param {{data: *, errors: Array<{message: string}>|undefined|null}} result La réponse
 *   `{ data, errors }` résolue par `client.models.X.method(...)`.
 * @param {string} opName Nom de l'opération GraphQL d'origine, voir `throwIfGraphqlError`.
 * @returns {*} `data`, que `errors` soit présent (succès partiel) ou non (succès plein).
 * @throws {Error} Si `errors` est présent ET qu'aucun `data` exploitable n'est disponible --
 *   même format d'exception que `throwIfGraphqlError`.
 */
export function resolveOrThrowOnFailure({ data, errors }, opName) {
  if (errors && !data) {
    throw Object.assign(new Error(`Erreur GraphQL ${opName}`), { errors })
  }
  return data
}
