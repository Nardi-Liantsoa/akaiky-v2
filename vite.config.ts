/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import legacy from '@vitejs/plugin-legacy'
import capacitorConfig from './capacitor.config.ts'

// En développement, /api est relayé vers l'API locale (`npm run dev:api`, port 8787).
const API = process.env.VITE_API_PROXY || 'http://127.0.0.1:8787'

// Sortie dans dist/web : servi par l'API en production (STATIC_DIR) et
// embarqué par Capacitor (webDir).
export default defineConfig(({ command, mode }) => {
  // L'app native compile l'adresse de l'API dans son bundle : une adresse en
  // http enverrait mots de passe et jetons en clair. Refusée à tout build
  // (production, préprod…) ; seul un build `--mode development` peut viser
  // une API locale.
  const origin = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_ORIGIN
  if (command === 'build' && mode !== 'development' && origin && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) {
    throw new Error(`VITE_API_ORIGIN doit être une origine https sans chemin (reçu : ${origin})`)
  }

  return {
    // Barrière Capgo du runtime OTA (NAR-191, src/lib/otaUpdate.ts) : l'`updateUrl` que `cap sync`
    // écrit dans les coques, depuis la même source. Absent (Capgo Cloud par défaut) : aucune requête.
    define: {
      __AKAIKY_OTA_UPDATE_URL__: JSON.stringify(capacitorConfig.plugins?.CapacitorUpdater?.updateUrl ?? '')
    },
    plugins: [
      vue(),
      // Vieux WebView Android (téléphones sans Play Store) : la cible Vite par
      // défaut y émet une syntaxe illisible et l'app reste figée sur l'écran de
      // démarrage. Un seul bundle moderne transpilé, sans chunks SystemJS (leurs
      // scripts en ligne seraient bloqués par la CSP).
      // Chrome 64 et plus : le bundle garde import() (Chrome 63) et import.meta (Chrome 64),
      // que la compilation (oxc, Vite 8) n'abaisse pas. android.minWebViewVersion (capacitor.config.ts) suit.
      legacy({
        modernTargets: 'chrome >= 64, safari >= 13',
        modernPolyfills: true,
        renderLegacyChunks: false
      })
    ],
    build: {
      outDir: 'dist/web',
      emptyOutDir: true,
      sourcemap: false
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: API, changeOrigin: false } }
    },
    // Les tests Playwright tournent sur `vite preview` avec une API simulée :
    // aucun relais vers une API réelle.
    preview: {
      proxy: {}
    },
    test: {
      include: ['src/**/*.test.ts']
    }
  }
})
