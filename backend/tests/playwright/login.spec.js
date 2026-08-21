const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:5000';

test.describe('Login screen — free email + demo accounts', () => {
  test('clic sur un compte démo pré-remplit les champs sans soumettre automatiquement', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button#login-modal-btn');

    // La modale est ouverte, le formulaire n'est pas encore soumis.
    await expect(page.locator('#login-modal')).toBeVisible();
    await expect(page.locator('#user-profile')).not.toContainText('Vendeur Caissier');

    // Clic sur la chip "Vendeur Caissier".
    await page.click('.demo-chip[data-email="cashier@bakery.com"]');

    // Champs pré-remplis…
    await expect(page.locator('#login-email')).toHaveValue('cashier@bakery.com');
    await expect(page.locator('#login-password')).toHaveValue('password123');

    // …mais le formulaire n'est PAS soumis : modale toujours ouverte,
    // aucun badge utilisateur affiché, aucun toast de bienvenue.
    await expect(page.locator('#login-modal')).toBeVisible();
    await expect(page.locator('#user-profile')).not.toContainText('Vendeur Caissier');
  });

  test("mauvais mot de passe -> message d'erreur clair, pas de crash", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button#login-modal-btn');

    await page.fill('#login-email', 'cashier@bakery.com');
    await page.fill('#login-password', 'mauvais-mot-de-passe');
    await page.click('#login-form button[type="submit"]');

    await expect(page.locator('.toast')).toContainText('Email ou mot de passe incorrect.');
    // Pas de crash : la modale reste ouverte et l'utilisateur peut retenter.
    await expect(page.locator('#login-modal')).toBeVisible();
  });

  test("connexion réussie par saisie libre puis déconnexion vide le token et revient à l'écran de connexion", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button#login-modal-btn');

    // Saisie libre (pas de sélecteur) avec un compte de démonstration.
    await page.fill('#login-email', 'cashier@bakery.com');
    await page.fill('#login-password', 'password123');
    await page.click('#login-form button[type="submit"]');

    await expect(page.locator('#user-profile')).toContainText('Vendeur Caissière');
    await expect(page.locator('#login-modal')).toBeHidden();

    // Token présent côté client.
    const tokenBefore = await page.evaluate(() => localStorage.getItem('bakery_jwt'));
    expect(tokenBefore).toBeTruthy();

    // Déconnexion.
    await page.click('#user-profile button:has-text("Déconnexion")');

    // Token vidé et retour à l'écran de connexion (bouton "Se Connecter").
    const tokenAfter = await page.evaluate(() => localStorage.getItem('bakery_jwt'));
    expect(tokenAfter).toBeNull();
    await expect(page.locator('#login-modal-btn')).toBeVisible();
    await expect(page.locator('#user-profile')).not.toContainText('Vendeur Caissière');
  });
});