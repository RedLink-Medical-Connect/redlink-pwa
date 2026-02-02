# Guide de Débogage - Paramètres Clinique

## Problème

Les données de la clinique ne se chargent pas dans la page des paramètres.

## Étapes de Débogage

### 1. Ouvrir la Page des Paramètres

- URL: http://localhost:5174/dashboard/settings
- Ouvrir les outils de développement (F12)
- Aller dans l'onglet Console

### 2. Analyser les Messages de Débogage

Vous devriez voir des messages comme :

```
🔍 Current user ID: [ID_UTILISATEUR]
🔍 Attempting to fetch veterinarian data with query: [REQUÊTE_GRAPHQL]
🔍 GraphQL response: [RÉPONSE]
```

### 3. Cas Possibles

#### Cas A: Aucun Profil Vétérinaire

Si vous voyez :

```
⚠️ No veterinarian profile found for user: [ID]
❌ Error fetching settings: Error: Aucun profil vétérinaire trouvé pour cet utilisateur
```

**SOLUTION**: L'utilisateur connecté n'a pas de profil vétérinaire dans la base de données.

#### Cas B: Profil Vétérinaire Sans Clinique

Si vous voyez :

```
✅ Veterinarian found: [DONNÉES_VET]
⚠️ No clinic associated with veterinarian
❌ Error fetching settings: Error: Aucune clinique associée à ce vétérinaire
```

**SOLUTION**: Le vétérinaire existe mais n'a pas de clinique associée.

#### Cas C: Erreur GraphQL

Si vous voyez une erreur GraphQL, cela peut indiquer :

- Problème de permissions
- Schéma non déployé
- Problème de connexion AWS

### 4. Solutions

#### Solution 1: Créer des Données de Test

1. Dans la console du navigateur, tapez :

```javascript
// Vérifier les données existantes
debugData()

// Si aucune donnée, créer des données de test
createTestData()
```

#### Solution 2: Vérifier le Schéma GraphQL

```bash
amplify status
amplify push --yes
```

#### Solution 3: Vérifier les Permissions

- L'utilisateur doit être authentifié
- Les règles d'autorisation dans le schéma doivent permettre l'accès

### 5. Création Manuelle de Données

Si les scripts automatiques ne fonctionnent pas, vous pouvez créer manuellement :

#### A. Créer une Clinique

```javascript
const clinicInput = {
  name: 'Ma Clinique',
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
```

#### B. Créer un Profil Vétérinaire

```javascript
const { userId } = await getCurrentUser()

const vetInput = {
  id: userId, // IMPORTANT: Utiliser l'ID de l'utilisateur connecté
  firstname: 'Dr. Prénom',
  lastname: 'Nom',
  email: 'email@example.com',
  clinicID: '[ID_CLINIQUE_CRÉÉE]',
}

const vetResponse = await client.graphql({
  query: createVeterinarian,
  variables: { input: vetInput },
  authMode: 'userPool',
})
```

### 6. Vérification Finale

Après avoir créé les données :

1. Recharger la page des paramètres
2. Vérifier que les données se chargent
3. Tester la sauvegarde des modifications

### 7. Messages de Succès Attendus

Quand tout fonctionne, vous devriez voir :

```
🔍 Current user ID: [ID]
✅ Veterinarian found: [DONNÉES_VET]
✅ Clinic found: [DONNÉES_CLINIQUE]
```

Et les formulaires doivent être remplis avec les vraies données de la base.

## Scripts de Débogage Disponibles

Les scripts suivants sont automatiquement chargés dans la console :

- `debugData()` - Analyse les données existantes
- `createTestData()` - Crée des données de test

## Problèmes Courants

1. **Utilisateur non authentifié** - Vérifier la connexion
2. **Schéma non déployé** - Faire `amplify push --yes`
3. **Permissions insuffisantes** - Vérifier les règles @auth
4. **Données manquantes** - Utiliser les scripts de création
5. **ID utilisateur incorrect** - Vérifier que l'ID du vétérinaire = ID utilisateur
