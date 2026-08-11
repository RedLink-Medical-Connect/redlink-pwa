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
    console.error(`❌ ERREUR ajout groupe:`, error);
  }

  return event;
};
