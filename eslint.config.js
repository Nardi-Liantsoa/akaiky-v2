import { defineConfig } from 'eslint/config'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

// Front seulement : le serveur (JavaScript ESM repris de Deploy4000) est
// couvert par ses tests contre une vraie PostgreSQL.
// Pas de @vue/eslint-config-typescript : il tire fast-glob → braces, signalé
// par npm audit sans version corrigée (octobre 2026).
export default defineConfig(
  { ignores: ['dist/**', 'server/**', 'android/**', 'ios/**', 'playwright-report/**', 'test-results/**'] },
  tseslint.configs.recommended,
  pluginVue.configs['flat/essential'],
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser } } }
)
