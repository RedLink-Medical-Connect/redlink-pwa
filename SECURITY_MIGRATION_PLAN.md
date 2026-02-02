# 🔒 PLAN DE MIGRATION SÉCURITÉ GRAPHQL

## 🎯 OBJECTIF

Migrer le schéma GraphQL actuel vers une version sécurisée avec des règles d'autorisation strictes.

---

## ⚠️ ATTENTION - CHANGEMENTS BREAKING

### 🚨 Impact sur l'Application

- **Règles d'autorisation** complètement refactorisées
- **Accès aux données** restreint par rôle utilisateur
- **Champs sensibles** protégés ou exclus
- **Requêtes existantes** peuvent échouer

### 📋 Pré-requis

1. **Backup de la base de données** DynamoDB
2. **Tests en environnement de staging** avant production
3. **Mise à jour des requêtes frontend** si nécessaire

---

## 🔄 ÉTAPES DE MIGRATION

### Étape 1: Sauvegarde (CRITIQUE)

```bash
# Sauvegarder le schéma actuel
cp amplify/backend/api/redlinkpwa/schema.graphql schema-backup-$(date +%Y%m%d).graphql

# Sauvegarder les données (si nécessaire)
amplify env checkout dev
amplify status
```

### Étape 2: Application du Nouveau Schéma

```bash
# Remplacer le schéma actuel
cp amplify/backend/api/redlinkpwa/schema-secure.graphql amplify/backend/api/redlinkpwa/schema.graphql

# Déployer les changements
amplify push
```

### Étape 3: Validation

```bash
# Tester les nouvelles règles
npm run test:e2e
```

---

## 🔍 CHANGEMENTS DÉTAILLÉS

### 1. **Règles d'Autorisation Refactorisées**

#### Avant (VULNÉRABLE)

```graphql
type Request
  @auth(
    rules: [
      { allow: private, operations: [read, update] } # DANGEREUX
    ]
  )
```

#### Après (SÉCURISÉ)

```graphql
type Request
  @auth(
    rules: [
      { allow: owner, ownerField: "clinicID", operations: [create, read, update, delete] }
      { allow: private, provider: userPools, operations: [read], condition: "profile = 'owner'" }
    ]
  )
```

### 2. **Protection des Données Sensibles**

#### Avant (EXPOSÉ)

```graphql
type Clinic {
  rpps: String! # Numéro professionnel exposé
  email: String! # Email exposé
}
```

#### Après (PROTÉGÉ)

```graphql
type Clinic
  @auth(rules: [{ allow: public, operations: [read], excludeFields: ["rpps", "email", "phone"] }])
```

### 3. **Ownership Explicite**

#### Avant (FLOU)

```graphql
type Animal
  @auth(
    rules: [
      { allow: owner } # Quel propriétaire ?
    ]
  )
```

#### Après (CLAIR)

```graphql
type Animal
  @auth(
    rules: [
      { allow: owner, ownerField: "ownerID" }
      { allow: private, provider: userPools, operations: [read], condition: "profile = 'vet'" }
    ]
  )
```

---

## 🎯 MATRICE D'AUTORISATION FINALE

| Type             | Propriétaire        | Vétérinaire              | Public               |
| ---------------- | ------------------- | ------------------------ | -------------------- |
| **Clinic**       | CRUD (sa clinique)  | Read (toutes)            | Read (info publique) |
| **Veterinarian** | ❌                  | Read (tous vets)         | ❌                   |
| **Owner**        | CRUD (son profil)   | Read (sans contact)      | ❌                   |
| **Animal**       | CRUD (ses animaux)  | Read (tous)              | ❌                   |
| **Request**      | Read (matching)     | CRUD (sa clinique)       | ❌                   |
| **Mission**      | CRUD (ses missions) | Read/Update (validation) | ❌                   |

---

## 🧪 TESTS DE VALIDATION

### Test 1: Propriétaire d'Animal

```javascript
// ✅ DOIT RÉUSSIR: Lire ses propres animaux
query MyAnimals {
  listAnimals(filter: { ownerID: { eq: "user-123" } }) {
    items { id name species }
  }
}

// ❌ DOIT ÉCHOUER: Lire les animaux d'un autre
query OtherAnimals {
  listAnimals(filter: { ownerID: { eq: "other-456" } }) {
    items { id name species }
  }
}
```

### Test 2: Vétérinaire

```javascript
// ✅ DOIT RÉUSSIR: Lire tous les animaux (pour matching)
query AllAnimals {
  listAnimals {
    items { id name species bloodGroup }
  }
}

// ❌ DOIT ÉCHOUER: Modifier un animal
mutation UpdateAnimal {
  updateAnimal(input: { id: "animal-123", name: "NewName" }) {
    id name
  }
}
```

### Test 3: Données Sensibles

```javascript
// ✅ DOIT RÉUSSIR: Info publique clinique
query PublicClinic {
  getClinic(id: "clinic-123") {
    id name address hasEmergencyService
  }
}

// ❌ DOIT ÉCHOUER: Données sensibles
query SensitiveClinic {
  getClinic(id: "clinic-123") {
    id name rpps email phone # rpps, email, phone doivent être null
  }
}
```

---

## 🚨 ROLLBACK PLAN

### En cas de problème critique

```bash
# 1. Restaurer l'ancien schéma
cp schema-backup-YYYYMMDD.graphql amplify/backend/api/redlinkpwa/schema.graphql

# 2. Redéployer
amplify push --yes

# 3. Vérifier le fonctionnement
npm run test:e2e
```

---

## 📊 MÉTRIQUES DE SUCCÈS

### Sécurité

- [ ] Aucun accès non autorisé aux données
- [ ] Champs sensibles protégés
- [ ] Tests d'autorisation passent

### Fonctionnalité

- [ ] Application fonctionne normalement
- [ ] Matching des donneurs opérationnel
- [ ] Création de demandes fonctionnelle

### Performance

- [ ] Temps de réponse < 500ms
- [ ] Pas d'erreurs GraphQL
- [ ] Logs propres

---

## ⏭️ PROCHAINES ÉTAPES

1. **Appliquer la migration** en staging
2. **Tester exhaustivement** toutes les fonctionnalités
3. **Corriger les requêtes frontend** si nécessaire
4. **Déployer en production** avec monitoring renforcé
5. **Audit de sécurité** post-déploiement
