/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import legacy from '@vitejs/plugin-legacy'
import capacitorConfig, { normalizeOrigin, PLACEHOLDER_ORIGIN } from './capacitor.config.ts'

// En développement, /api est relayé vers l'API locale (`npm run dev:api`, port 8787).
const API = process.env.VITE_API_PROXY || 'http://127.0.0.1:8787'

// Police Nunito (src/style.css, NAR-157) : sans indice, le navigateur ne la découvre qu'après
// avoir lu la feuille de style, et le texte saute de la police système à Nunito. Le preload,
// écrit au build depuis le bundle (nom haché, base du build), la demande en même temps que la
// CSS. `crossorigin` est exigé : Chromium et Firefox chargent @font-face en mode CORS, et sans
// lui ils la téléchargeraient deux fois. WebKit (Safari) charge une police de même origine en
// no-cors et ignore donc ce preload (deux requêtes) : aucune balise ne sert les deux moteurs, on
// suit la norme. Même origine : la CSP (font-src 'self') l'admet.
const PRELOADED_FONT = 'src/assets/fonts/nunito-latin-wght.woff2'
function preloadFont(): Plugin {
  let base = '/'
  return {
    name: 'akaiky-preload-font',
    apply: 'build',
    configResolved(config) { base = config.base },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const font = Object.values(ctx.bundle ?? {}).find((f) => f.type === 'asset' && f.originalFileNames.includes(PRELOADED_FONT))
        // Police renommée ou plus importée : on échoue plutôt que de perdre le preload sans bruit.
        if (!font) throw new Error(`Police à précharger absente du bundle : ${PRELOADED_FONT}`)
        return [{ tag: 'link', injectTo: 'head', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: base + font.fileName } }]
      }
    }
  }
}

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
  // Serveur OTA des coques (NAR-190) : capacitor.config.ts relit la même origine que le bundle.
  // Un mode qui lirait un autre fichier (.env.staging…) donnerait deux adresses : refusé.
  const otaUpdateUrl = capacitorConfig.plugins?.CapacitorUpdater?.updateUrl ?? ''
  if (command === 'build' && !otaUpdateUrl.startsWith(`${normalizeOrigin(origin || PLACEHOLDER_ORIGIN)}/api/`)) {
    throw new Error(`Serveur OTA des coques (${otaUpdateUrl}) et API du bundle (${origin || PLACEHOLDER_ORIGIN}) diffèrent : passer VITE_API_ORIGIN en variable d'environnement`)
  }

  return {
    // Barrière Capgo du runtime OTA (NAR-191, src/lib/otaUpdate.ts) : l'`updateUrl` que `cap sync`
    // écrit dans les coques, depuis la même source (serveur Akaiky, NAR-190). Adresse provisoire
    // (.invalid) : aucune requête.
    define: {
      __AKAIKY_OTA_UPDATE_URL__: JSON.stringify(otaUpdateUrl)
    },
    plugins: [
      vue(),
      preloadFont(),
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
      sourcemap: false,
      rollupOptions: {
        output: {
          // Worker de MapLibre (NAR-205), livré en .mjs : renommé .js, type que le serveur et le
          // serveur local des coques servent en JavaScript (un worker de module l'exige).
          assetFileNames: (asset) => (asset.names?.some((n) => n.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]')
        }
      }
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
