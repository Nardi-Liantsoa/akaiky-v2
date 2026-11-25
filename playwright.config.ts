import { defineConfig, devices } from '@playwright/test'

// Tests du front construit, API simulée (tests/e2e/mock.ts) et réseau
// verrouillé : aucune requête ne sort vers un tiers. Le serveur, lui, a ses
// propres tests contre une vraie PostgreSQL (server/test/).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'fr-FR',
    trace: 'retain-on-failure'
  },
  projects: [
    // 960 px : les parcours se vérifient sur la colonne unique (téléphone, tablette) ; la mise
    // en page de l'ordinateur (≥ 1024 px : barre latérale, maître/détail, NAR-223) a ses propres
    // tests, qui fixent leur largeur (wide-navigation.spec.ts, desktop-layout.spec.ts).
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 800 } } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } }
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
})
