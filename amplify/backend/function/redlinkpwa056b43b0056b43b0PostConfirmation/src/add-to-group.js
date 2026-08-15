/* amplify/backend/function/redlinkpwa056b43b0056b43b0PostConfirmation/src/add-to-group.js */

const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  GetGroupCommand,
  CreateGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient({});

exports.handler = async (event) => {
  // 1. Récupérer l'attribut "profile"
  const profile = event.request.userAttributes['custom:profile'] || event.request.userAttributes['profile'];
  
  console.log(`🔍 Nouvel utilisateur inscrit. Profil détecté : ${profile}`);

  let groupName = null;

  // 2. Déterminer le bon groupe
  if (profile === 'vet') {
    groupName = 'Veterinarians'; 
  } else if (profile === 'owner') {
    groupName = 'Owners';
  } else {
    console.log("⚠️ Aucun profil valide ('vet' ou 'owner') trouvé.");
    return event;
  }

  const groupParams = {
    GroupName: groupName,
    UserPoolId: event.userPoolId,
  };

  const addUserParams = {
    GroupName: groupName,
    UserPoolId: event.userPoolId,
    Username: event.userName,
  };

  try {
    // 3. Vérifier si le groupe existe, sinon le créer
    try {
      await client.send(new GetGroupCommand(groupParams));
    } catch (e) {
      console.log(`⚙️ Création du groupe '${groupName}'...`);
      await client.send(new CreateGroupCommand(groupParams));
    }

    // 4. Ajouter l'utilisateur
    await client.send(new AdminAddUserToGroupCommand(addUserParams));
    console.log(`✅ SUCCÈS : Utilisateur ajouté au groupe ${groupName}`);

  } catch (error) {
    // Phase 7.3 (R-04) : `GroupExistsException` ferme une fenêtre de course sur la
    // création du tout premier groupe ('Veterinarians'/'Owners') d'un environnement
    // encore neuf -- deux signups quasi simultanés peuvent tous les deux échouer sur
    // GetGroupCommand ("not found") puis tenter CreateGroupCommand juste au-dessus : un
    // seul gagne, l'autre reçoit `GroupExistsException`. Ce n'est PAS un échec réel (le
    // groupe existe bel et bien) : on ne le rethrow donc pas, et on retente l'ajout au
    // groupe ici plutôt que de laisser cet utilisateur CONFIRMED mais sans groupe --
    // exactement le bug que le `throw error` ci-dessous existe pour empêcher dans le cas
    // général. On loggue quand même `error.name` (même sur ce chemin non fatal) pour que
    // ce type d'erreur reste visible en CloudWatch, plutôt que de disparaître
    // silencieusement du côté "bénin".
    if (error.name === 'GroupExistsException') {
      console.error(`⚠️ ${error.name} (bénin, course de création du groupe '${groupName}') :`, error);
      await client.send(new AdminAddUserToGroupCommand(addUserParams));
      console.log(`✅ SUCCÈS (après course de création de groupe) : Utilisateur ajouté au groupe ${groupName}`);
      return event;
    }

    console.error(`❌ ERREUR ajout groupe:`, error);
    // On re-throw volontairement plutôt que d'avaler l'erreur : un échec silencieux ici
    // laisserait l'utilisateur CONFIRMED côté Cognito mais sans groupe (Veterinarians/Owners),
    // donc sans autorisation, sans qu'aucun signal ne remonte nulle part.
    // PostConfirmation est invoqué par Cognito de façon synchrone APRÈS que le statut de
    // l'utilisateur soit passé à CONFIRMED : un throw ici ne fait donc PAS revenir cet
    // utilisateur en non-confirmé, mais fait échouer l'appel ConfirmSignUp/AdminConfirmSignUp
    // côté client (erreur remontée à l'appelant) et apparaît comme une erreur d'invocation
    // Lambda dans les métriques CloudWatch/Amplify de cette fonction — donc monitorable.
    // Pas de retry/DLQ ici (hors de propos pour un projet à échelle pilote) : l'objectif est
    // seulement de rendre l'échec visible au lieu de le laisser passer inaperçu.
    throw error;
  }

  return event;
};
