// Recette automatique sur le vrai back (critères de recette/criteres.md).
//   npm run recette   → tests de recette + comparaison visuelle + rapport
import { defineConfig } from '@playwright/test'
import { RECETTE_ORIGIN } from './tests/recette/env.mjs'

// macOS 14 : le WebKit de Playwright y est figé (« Unknown setting: PushAPIEnabled »). Le projet
// iphone peut alors utiliser le WebKit Linux d'un serveur Playwright dans Docker, à la version de
// @playwright/test ; le back de recette reste sur ce poste, joint par le tunnel de Playwright :
//   docker run -d --rm --name pw-webkit -p 127.0.0.1:3555:3555 --ipc=host \
//     mcr.microsoft.com/playwright:v1.65.0-noble npx -y playwright@1.65.0 run-server --port 3555 --host 0.0.0.0
//   PW_WEBKIT_WS=ws://127.0.0.1:3555/ npm run recette
const webkitRemote = process.env.PW_WEBKIT_WS ? { connectOptions: { wsEndpoint: process.env.PW_WEBKIT_WS, exposeNetwork: '<loopback>' } } : {}

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
    { name: 'iphone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...webkitRemote } }
  ]
})
