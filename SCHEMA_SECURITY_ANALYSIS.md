# 🔍 ANALYSE SÉCURITÉ SCHÉMA GRAPHQL

## 🚨 PROBLÈMES CRITIQUES IDENTIFIÉS

### 1. **Règle `{ allow: private }` Trop Permissive**

```graphql
# ❌ PROBLÈME: Accès en lecture pour TOUS les utilisateurs authentifiés
type Request
  @auth(
    rules: [
      { allow: private, operations: [read, update] } # DANGEREUX !
    ]
  )
```

**Impact** : N'importe quel utilisateur authentifié peut lire/modifier toutes les demandes

### 2. **Pas de Restriction par Propriétaire**

```graphql
# ❌ PROBLÈME: Pas de ownerField spécifié
type Request
  @auth(
    rules: [
      { allow: owner } # Mais quel champ définit le propriétaire ?
    ]
  )
```

**Impact** : Règle d'ownership non fonctionnelle

### 3. **Groupes Inexistants**

```graphql
# ❌ PROBLÈME: Groupe "Veterinarians" non configuré dans Cognito
{ allow: groups, groups: ["Veterinarians"] }
```

**Impact** : Règles non appliquées, accès par défaut

### 4. **Données Sensibles Exposées**

```graphql
# ❌ PROBLÈME: RPPS et données médicales accessibles
type Clinic {
  rpps: String! # Numéro professionnel sensible
  email: String! # Email exposé
}
```

---

## ✅ CORRECTIONS PROPOSÉES

### 1. **Restriction par Rôle Cognito**

```graphql
# ✅ SOLUTION: Utiliser les attributs Cognito profile
type Request
  @auth(
    rules: [
      { allow: owner, ownerField: "clinicID", operations: [create, read, update, delete] }
      { allow: private, provider: userPools, operations: [read], condition: "profile = 'owner'" }
    ]
  )
```

### 2. **Ownership Explicite**

```graphql
# ✅ SOLUTION: Définir clairement les propriétaires
type Animal
  @auth(
    rules: [
      { allow: owner, ownerField: "ownerID" }
      { allow: private, operations: [read], condition: "profile = 'vet'" }
    ]
  )
```

### 3. **Séparation des Données Sensibles**

```graphql
# ✅ SOLUTION: Champs sensibles protégés
type Clinic
  @auth(
    rules: [
      { allow: owner, ownerField: "owner" }
      { allow: private, operations: [read], excludeFields: ["rpps", "email"] }
    ]
  )
```

---

## 🎯 MATRICE D'AUTORISATION CIBLE

| Entité      | Owner (Propriétaire) | Vet (Vétérinaire)         | Public               |
| ----------- | -------------------- | ------------------------- | -------------------- |
| **Animal**  | CRUD (ses animaux)   | Read (tous)               | ❌                   |
| **Request** | Read (matching)      | CRUD (sa clinique)        | ❌                   |
| **Mission** | CRUD (ses missions)  | Read/Update (sa clinique) | ❌                   |
| **Clinic**  | Read (publique)      | CRUD (sa clinique)        | Read (info publique) |
| **Owner**   | CRUD (son profil)    | Read (pour matching)      | ❌                   |

---

## 🔧 PLAN DE CORRECTION

### Phase 1: Sécurisation Immédiate

1. Supprimer toutes les règles `{ allow: private }`
2. Ajouter `ownerField` explicites
3. Utiliser les attributs Cognito `profile`

### Phase 2: Granularité Fine

1. Implémenter `excludeFields` pour données sensibles
2. Ajouter conditions basées sur le statut
3. Créer des resolvers personnalisés si nécessaire

### Phase 3: Audit & Tests

1. Tester chaque règle avec différents rôles
2. Vérifier les requêtes cross-entity
3. Audit de sécurité complet
