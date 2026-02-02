# Solution - Problème des Paramètres Clinique

## Le Problème

Les données de la clinique ne se chargent pas car **l'utilisateur connecté n'a pas de profil vétérinaire** dans la base de données.

## Diagnostic Rapide

1. Ouvrir http://localhost:5174/dashboard/settings
2. Ouvrir la console du navigateur (F12)
3. Regarder les messages d'erreur

Vous devriez voir :

```
❌ Error fetching settings: Error: Aucun profil vétérinaire trouvé pour cet utilisateur
```

## Solution Automatique

Dans la console du navigateur, tapez :

```javascript
// 1. Vérifier les données existantes
debugData()

// 2. Créer des données de test si nécessaire
createTestData()
```

## Solution Manuelle

Si la solution automatique ne fonctionne pas :

### 1. Vérifier l'ID utilisateur

```javascript
import { getCurrentUser } from 'aws-amplify/auth'
const { userId } = await getCurrentUser()
console.log('User ID:', userId)
```

### 2. Créer une clinique

```javascript
import { generateClient } from 'aws-amplify/api'
import { createClinic } from '@/graphql/mutations'

const client = generateClient()

const clinicInput = {
  name: 'Ma Clinique Vétérinaire',
  rpps: '12345678901',
  email: 'contact@maclinique.fr',
  phone: '+33123456789',
  address: '123 Rue de la Clinique, 75001 Paris',
  latitude: 48.8566,
  longitude: 2.3522,
  hasEmergencyService: true,
  transfusionsDone: 0,
  donorOwnersCount: 0,
}

const clinicResponse = await client.graphql({
  query: createClinic,
  variables: { input: clinicInput },
  authMode: 'userPool',
})

console.log('Clinique créée:', clinicResponse.data.createClinic.id)
```

### 3. Créer le profil vétérinaire

```javascript
import { createVeterinarian } from '@/graphql/mutations'

const vetInput = {
  id: '[VOTRE_USER_ID]', // Remplacer par l'ID utilisateur
  firstname: 'Dr. Prénom',
  lastname: 'Nom',
  email: 'votre.email@example.com',
  clinicID: '[ID_CLINIQUE_CRÉÉE]', // Remplacer par l'ID de la clinique
}

const vetResponse = await client.graphql({
  query: createVeterinarian,
  variables: { input: vetInput },
  authMode: 'userPool',
})

console.log('Vétérinaire créé:', vetResponse.data.createVeterinarian)
```

### 4. Recharger la page

Après avoir créé les données, recharger la page des paramètres.

## Vérification

Quand tout fonctionne, vous devriez voir dans la console :

```
🔍 Current user ID: [ID]
✅ Veterinarian found: [DONNÉES]
✅ Clinic found: [DONNÉES]
```

Et les formulaires doivent être remplis avec les vraies données.

## Pourquoi ce Problème ?

Le problème vient du fait que :

1. L'utilisateur s'est inscrit via AWS Cognito
2. Mais aucun profil `Veterinarian` n'a été créé dans la base GraphQL
3. La page des paramètres essaie de récupérer les données du vétérinaire
4. Comme il n'existe pas, la requête échoue

## Solution Permanente

Pour éviter ce problème à l'avenir, il faudrait :

1. Créer automatiquement le profil vétérinaire lors de l'inscription
2. Ou ajouter un processus d'onboarding pour créer le profil
3. Ou gérer le cas où le profil n'existe pas encore

## Test Final

Après avoir créé les données :

1. ✅ La page se charge sans erreur
2. ✅ Les champs sont remplis avec les vraies données
3. ✅ La sauvegarde fonctionne
4. ✅ Les modifications sont persistées
