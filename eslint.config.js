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
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser } } },
  // Argument ou variable volontairement ignoré : préfixe « _ » (une traduction sans pluriel
  // garde l'argument de la fonction, NAR-210).
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
  // Aucun texte d'interface en dur dans un template (NAR-210) : tout passe par useT()
  // dans les trois langues (texte, aria-label, title, placeholder, alt, props de texte). Restent permis
  // la ponctuation, les symboles et les chiffres du pavé, et deux noms invariants :
  // la marque « Akaiky » et « SOS », compris tel quel en malgache, français et anglais.
  {
    files: ['src/**/*.vue'],
    rules: {
      'vue/no-bare-strings-in-template': ['error', {
        // Attributs vérifiés : ceux d'HTML (défaut de la règle) et les props de texte de nos
        // composants (SectionCard, StatusBlock, ToggleSwitch, FormField, ConfirmSheet…). Un texte
        // dans une liaison (:title="'…'", {{ '…' }}) échappe à la règle : la revue s'en charge.
        attributes: {
          '/.+/': ['title', 'aria-label', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext', 'label', 'help', 'lead', 'legend', 'description', 'error', 'emergency', 'placeholder'],
          img: ['alt'],
          // Props dont le nom a un autre sens en HTML (action d'un formulaire…) : sur nos composants seulement.
          StatusBlock: ['text'],
          ConfirmSheet: ['confirm'],
          DeleteConfirm: ['action', 'confirm']
        },
        allowlist: [
          '(', ')', ',', '.', '&', '+', '-', '=', '*', '/', '#', '%', '!', '?', ':', ';', '[', ']', '{', '}', '<', '>',
          '·', '•', '‐', '–', '—', '−', '|', '…', '«', '»', '’',
          '⌫', '▾', '✓', '✕', '↑', '↓', '×', '‹', '›',
          '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
          'Akaiky', 'SOS'
        ]
      }]
    }
  }
)
