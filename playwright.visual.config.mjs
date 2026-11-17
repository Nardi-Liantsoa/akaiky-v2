// Comparaison visuelle avec main (skill ampy-recette) : toujours lancée par
// scripts/visual.sh, dans l'image Docker de Playwright. Aucune capture stockée.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/visual',
  testMatch: /.*\.spec\.mjs$/,
  outputDir: 'test-results/visual',
  snapshotPathTemplate: `${process.env.VISUAL_REFS || 'test-results/visual-travail/refs'}/{projectName}/{arg}{ext}`,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/rapport-visuel' }], ['json', { outputFile: 'test-results/visual.json' }]],
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: 'disabled', caret: 'hide', scale: 'css' } },
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://visual.test', locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block' },
  projects: [
    { name: 'ordinateur', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'iphone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
})
