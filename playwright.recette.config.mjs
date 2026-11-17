// Recette automatique sur le vrai back (critères de recette/criteres.md).
//   npm run recette   → tests de recette + comparaison visuelle + rapport
import { defineConfig } from '@playwright/test'
import { RECETTE_ORIGIN } from './tests/recette/env.mjs'

export default defineConfig({
  testDir: './tests/recette',
  testMatch: /.*\.spec\.mjs$/,
  globalSetup: './tests/recette/global-setup.mjs',
  globalTeardown: './tests/recette/global-teardown.mjs',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Le serveur borne les hachages de mots de passe simultanés par adresse IP
  // (2 dans app-propre) et tous les tests partent de la même adresse.
  workers: 2,
  outputDir: 'test-results/recette',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/rapport-recette' }], ['json', { outputFile: 'test-results/recette.json' }]],
  use: {
    baseURL: RECETTE_ORIGIN, locale: 'fr-FR', timezoneId: 'Europe/Paris',
    reducedMotion: 'reduce', serviceWorkers: 'block',
    trace: 'retain-on-failure', screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'ordinateur', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'iphone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
})
