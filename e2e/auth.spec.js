import { test, expect } from '@playwright/test';

// Récupération des comptes de test depuis le .env (Créés manuellement)
const vetUser = {
  email: process.env.TEST_VET_EMAIL,
  password: process.env.TEST_VET_PASSWORD,
  name: process.env.TEST_VET_LASTNAME
};

const ownerUser = {
  email: process.env.TEST_OWNER_EMAIL,
  password: process.env.TEST_OWNER_PASSWORD
};

// Génération de données pour les tests d'inscription (pour ne pas avoir d'erreur "Email existe déjà")
const randomId = Math.floor(Math.random() * 100000);
const newOwnerEmail = `auto.owner.${randomId}@test.com`;
const newVetEmail = `auto.vet.${randomId}@test.com`;

test.describe('🔴 RedLink - Suite de Tests Complète (Auth & Rôles)', () => {

  // --- 1. SÉCURITÉ VISITEUR (GUEST) ---
  test('Visiteur : Redirections de sécurité et i18n', async ({ page }) => {
    // Test d'accès interdit (Dashboard)
    await page.goto('/dashboard/requests');
    await expect(page).toHaveURL(/.*login/); // Doit être redirigé

    // Test d'accès interdit (Profil)
    await page.goto('/dashboard/profile');
    await expect(page).toHaveURL(/.*login/);

    // Test de la page Login
    await expect(page.locator('h1')).toContainText(/SE CONNECTER|LOGIN/i);

    // Test Switch Langue (FR <-> EN)
    // On clique sur le selecteur de langue (assurez-vous que le sélecteur a un aria-label ou role)
    // Ici on clique sur le bouton qui affiche "FR" ou "EN"
    await page.getByRole('combobox').click();
    await page.getByLabel('EN').click();
    await expect(page.locator('h1')).toContainText('LOGIN');
  });

  // --- 2. INSCRIPTION PROPRIÉTAIRE ---
  test('Inscription : Parcours Propriétaire (Multi-étapes)', async ({ page }) => {
    await page.goto('/register/owner');

    // Étape 1 : Infos
    await page.getByPlaceholder(/NOM|LAST NAME/i).fill('Dupont');
    await page.getByPlaceholder(/PRÉNOM|FIRST NAME/i).fill('Jean');
    await page.getByPlaceholder(/ADRESSE MAIL|EMAIL/i).fill(newOwnerEmail);
    await page.getByPlaceholder(/TÉLÉPHONE|PHONE/i).fill('0600000000');
    await page.getByPlaceholder(/ADRESSE|ADDRESS/i, { exact: true }).fill('10 Rue de la Paix');

    // Mots de passe
    await page.locator('input[type="password"]').first().fill('Password123!');
    await page.locator('input[type="password"]').last().fill('Password123!');

    await page.getByRole('button', { name: /SUIVANT|NEXT/i }).click();

    // Étape 2 : Animal (Vérification que le step a changé)
    await expect(page.getByPlaceholder(/NOM|NAME/i, { exact: true })).toBeVisible();
    await page.getByPlaceholder(/NOM|NAME/i, { exact: true }).fill('Rex');
    await page.getByPlaceholder(/ESPÈCE|SPECIES/i).fill('Chien');
    await page.getByPlaceholder(/GROUPE SANGUIN|BLOOD/i).fill('DEA 1.1-');

    // Soumission
    await page.getByRole('button', { name: /TERMINER|COMPLETE/i }).click();

    // Vérification redirection vers Verify Email
    await expect(page).toHaveURL(/.*verify-email/);
    await expect(page.getByText(newOwnerEmail)).toBeVisible();
  });

  // --- 3. INSCRIPTION CLINIQUE ---
  test('Inscription : Parcours Clinique (Multi-étapes)', async ({ page }) => {
    await page.goto('/register/clinic');

    // Étape 1 : Véto
    await page.getByPlaceholder(/NOM|LAST NAME/i).fill('House');
    await page.getByPlaceholder(/PRÉNOM|FIRST NAME/i).fill('Gregory');
    await page.getByPlaceholder(/ADRESSE MAIL|EMAIL/i).fill(newVetEmail);
    await page.getByPlaceholder(/RPPS/i).fill('10000000');

    await page.locator('input[type="password"]').first().fill('Password123!');
    await page.locator('input[type="password"]').last().fill('Password123!');

    await page.getByRole('button', { name: /SUIVANT|NEXT/i }).click();

    // Étape 2 : Structure
    await expect(page.getByPlaceholder(/NOM DE LA CLINIQUE|CLINIC NAME/i)).toBeVisible();
    await page.getByPlaceholder(/NOM DE LA CLINIQUE|CLINIC NAME/i).fill('Princeton Plainsboro');

    await page.getByRole('button', { name: /TERMINER|COMPLETE/i }).click();

    await expect(page).toHaveURL(/.*verify-email/);
  });

  // --- 4. CONNEXION VÉTÉRINAIRE (Happy Path) ---
  test('Login Vétérinaire : Accès Dashboard et Sidebar', async ({ page }) => {
    // On saute si pas de compte configuré dans .env
    if (!vetUser.email) test.skip('⚠️ Pas de compte Vétérinaire dans .env');

    await page.goto('/login');
    await page.getByPlaceholder(/votre@email.com/i).fill(vetUser.email);
    await page.locator('input[type="password"]').fill(vetUser.password);
    await page.getByRole('button', { name: /SE CONNECTER|LOGIN/i }).click();

    // 1. Redirection vers Dashboard
    await expect(page).toHaveURL(/.*dashboard\/requests/, { timeout: 15000 });

    // 2. Vérification des éléments spécifiques Véto
    await expect(page.getByRole('button', { name: /FAIRE UNE DEMANDE|NEW REQUEST/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Donneurs|Donors/i })).toBeVisible();

    // 3. Test Sécurité Croisée : Essayer d'aller sur le profil owner
    await page.goto('/dashboard/profile');
    // Doit être renvoyé sur le dashboard
    await expect(page).toHaveURL(/.*dashboard\/requests/);
  });

  // --- 5. CONNEXION PROPRIÉTAIRE (Happy Path) ---
  test('Login Propriétaire : Accès Profil et Restriction', async ({ page }) => {
    if (!ownerUser.email) test.skip('⚠️ Pas de compte Owner dans .env');

    await page.goto('/login');
    await page.getByPlaceholder(/votre@email.com/i).fill(ownerUser.email);
    await page.locator('input[type="password"]').fill(ownerUser.password);
    await page.getByRole('button', { name: /SE CONNECTER|LOGIN/i }).click();

    // 1. Redirection vers Profil
    await expect(page).toHaveURL(/.*profile/);

    // 2. Vérification des éléments spécifiques Owner
    await expect(page.getByRole('button', { name: /AJOUTER UN ANIMAL|ADD AN ANIMAL/i })).toBeVisible();

    // 3. Vérification que les menus Véto sont ABSENTS
    await expect(page.getByRole('link', { name: /Donneurs|Donors/i })).not.toBeVisible();

    // 4. Test Sécurité Croisée : Essayer d'aller sur le dashboard
    await page.goto('/dashboard/requests');
    // Doit être renvoyé sur le profil
    await expect(page).toHaveURL(/.*profile/);
  });

  // --- 6. DÉCONNEXION ---
  test('Déconnexion : Retour au Login', async ({ page }) => {
    if (!ownerUser.email) test.skip();

    // Connexion rapide
    await page.goto('/login');
    await page.getByPlaceholder(/votre@email.com/i).fill(ownerUser.email);
    await page.locator('input[type="password"]').fill(ownerUser.password);
    await page.getByRole('button', { name: /SE CONNECTER|LOGIN/i }).click();
    await expect(page).toHaveURL(/.*profile/);

    // Déconnexion via l'Avatar
    await page.locator('.p-avatar').click(); // Clic sur l'avatar
    await page.getByText(/Se déconnecter|Logout/i).click(); // Clic dans le menu

    // Vérification
    await expect(page).toHaveURL(/.*login/);
  });

});
