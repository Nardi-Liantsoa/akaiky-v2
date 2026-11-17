// Recette automatique (skill ampy-recette) : lance les tests de recette sur le
// vrai back, puis la comparaison visuelle avec main, et vérifie que chaque
// critère de recette/criteres.md est couvert par au moins un test et que tous
// passent. Écrit test-results/recette-rapport.md, le document que le testeur
// humain survole. Code de sortie 1 si la recette échoue.
// Un critère marqué « (prévu) » n'est pas encore construit : affiché, il ne
// bloque pas une PR mais rend la recette incomplète pour la préproduction.
//   npm run recette                   → tout
//   npm run recette -- --sans-visuel  → sans Docker ; la recette reste incomplète
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'

const withVisual = !process.argv.includes('--sans-visuel')
const started = Date.now()
mkdirSync('test-results', { recursive: true })

const criteria = [...readFileSync('recette/criteres.md', 'utf8').matchAll(/^- \[(C\d+)\] (\(prévu\) )?(.+)$/gm)].map(([, id, planned, text]) => ({ id, text, planned: !!planned }))
if (!criteria.length) throw new Error('recette/criteres.md : aucun critère [Cnn]')

// Le rapport du passage précédent est effacé avant : un passage interrompu
// (base, Docker, construction) ne peut pas être lu comme un succès.
function run(label, command, args, report) {
  console.log(`\n=== ${label}`)
  rmSync(report, { force: true })
  const t = Date.now()
  const { status } = spawnSync(command, args, { stdio: 'inherit' })
  const seconds = Math.round((Date.now() - t) / 1000)
  const tests = existsSync(report) ? flatten(JSON.parse(readFileSync(report, 'utf8')).suites) : []
  return { label, seconds, tests, broken: status !== 0 && !tests.length }
}
// Rapport JSON de Playwright → une ligne par test et par navigateur.
function flatten(suites, file = '') {
  return suites.flatMap((s) => [
    ...(s.specs || []).flatMap((spec) => spec.tests.map((t) => ({
      file: s.file || file, title: spec.title.replace(/\s*@C\d+/g, '').trim(),
      tags: [...new Set([...(spec.tags || []), ...(spec.title.match(/@C\d+/g) || [])].map((x) => x.replace(/^@/, '')))],
      browser: t.projectName, status: t.status // expected | unexpected | skipped
    }))),
    ...flatten(s.suites || [], s.file || file)
  ])
}

const suites = [
  run('Tests de recette sur le vrai back', 'npx', ['playwright', 'test', '-c', 'playwright.recette.config.mjs'], 'test-results/recette.json'),
  ...(withVisual ? [run('Comparaison visuelle avec main (Docker)', 'sh', ['scripts/visual.sh'], 'test-results/visual.json')] : [])
]
const tests = suites.flatMap((s) => s.tests)
const known = new Set(criteria.map((c) => c.id))
const unknownTags = [...new Set(tests.flatMap((t) => t.tags).filter((id) => !known.has(id)))]
const broken = suites.filter((s) => s.broken)
// Un test ignoré (skip, fixme) ne couvre rien.
const rows = criteria.map((c) => {
  const covering = tests.filter((t) => t.tags.includes(c.id) && t.status !== 'skipped')
  const failing = covering.filter((t) => t.status === 'unexpected')
  const state = failing.length ? 'ÉCHEC' : covering.length ? 'OK' : c.planned ? 'PRÉVU' : 'NON COUVERT'
  return { ...c, covering, failing, state }
})
const planned = rows.filter((r) => r.state === 'PRÉVU')
const ok = rows.every((r) => ['OK', 'PRÉVU'].includes(r.state)) && !unknownTags.length && !broken.length && withVisual
const verdict = !ok ? 'RECETTE AUTOMATIQUE NON VALIDÉE' : planned.length ? `RECETTE AUTOMATIQUE VALIDÉE POUR CE QUI EST CONSTRUIT — ${planned.length} critère(s) prévu(s), pas encore livrable en préproduction` : 'RECETTE AUTOMATIQUE VALIDÉE'
const minutes = ((Date.now() - started) / 60000).toFixed(1)

const lines = [
  `# Rapport de recette — ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`,
  '',
  `**Verdict : ${verdict}** — ${rows.filter((r) => r.state === 'OK').length}/${rows.length} critères verts, ${tests.length} vérifications, ${minutes} min.`,
  ...broken.map((s) => `\n⚠️ ${s.label} : interrompu avant de produire un résultat (voir la sortie ci-dessus).`),
  ...(withVisual ? [] : ['', '⚠️ Comparaison visuelle non lancée (`--sans-visuel`) : le critère visuel n’est pas vérifié.']),
  ...(unknownTags.length ? ['', `⚠️ Tests rattachés à des critères inexistants : ${unknownTags.join(', ')}`] : []),
  '',
  '| Critère | État | Tests | Navigateurs |',
  '|---|---|---|---|',
  ...rows.map((r) => `| **${r.id}** ${r.text} | ${{ OK: '✅', PRÉVU: '⏳' }[r.state] || '❌'} ${r.state} | ${new Set(r.covering.map((t) => t.title)).size} | ${[...new Set(r.covering.map((t) => t.browser))].join(', ')} |`),
  '',
  ...rows.filter((r) => r.failing.length).flatMap((r) => [`### ${r.id} — échecs`, ...r.failing.map((t) => `- ${t.title} (${t.browser}, ${t.file})`), '']),
  '## À faire par le testeur humain (survol)',
  '',
  '1. Si des rendus diffèrent de `main` : ouvrir `test-results/rapport-visuel/index.html` (avant / après / différence) ; changement voulu → valider la PR, sinon faire corriger.',
  '2. Juger le rendu final des pages clés en préproduction : beau, conforme aux maquettes et au goût du client.',
  '3. 10 minutes sur un vrai iPhone et un vrai Android : parcours principal, clavier, lien reçu par email.',
  '4. Un vrai paiement et la réception réelle d’un email, quand le projet en comporte.',
  '',
  `Détail : \`test-results/rapport-recette/index.html\` (vrai back) et \`test-results/rapport-visuel/index.html\` (rendus). Durées : ${suites.map((s) => `${s.label} ${s.seconds} s`).join(' · ')}.`
]
writeFileSync('test-results/recette-rapport.md', lines.join('\n') + '\n')
console.log(`\n${lines.slice(0, 3).join('\n')}\nRapport : test-results/recette-rapport.md`)
process.exit(ok ? 0 : 1)
