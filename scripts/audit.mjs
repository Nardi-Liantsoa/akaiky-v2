// Audit des dépendances du front avec exceptions datées (NAR-159).
//
// `npm audit --audit-level=moderate` échoue sur tout avis, y compris ceux sans
// correction publiée et sans exposition en production. Ce script lit le rapport
// JSON de npm et échoue sur :
//   - tout avis de gravité moderate ou plus absent de audit-exceptions.json ;
//   - toute exception expirée (on réexamine, on ne prolonge pas en silence) ;
//   - toute exception qui ne correspond plus à aucun avis (version corrigée
//     installée : on la retire au lieu de l'oublier) ;
//   - tout rapport illisible ou en erreur (réseau, registre) : on échoue fermé.
// Aucune dépendance : node:child_process et node:fs.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BLOCKING = new Set(['moderate', 'high', 'critical'])
const ghsaOf = (url) => /GHSA(-[0-9a-z]{4}){3}/i.exec(url ?? '')?.[0]?.toUpperCase() ?? null

// Avis directs du rapport : les entrées `via` qui sont des objets ; les chaînes
// ne font que remonter un avis déjà présent sur une dépendance.
export function advisoriesOf(report) {
  const found = []
  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via === 'object' && via) found.push({ id: ghsaOf(via.url), pkg: via.name, severity: via.severity, url: via.url })
    }
  }
  return found
}

// today : 'AAAA-MM-JJ'. Une exception vaut jusqu'à sa date d'expiration incluse.
export function evaluate(report, exceptions, today) {
  const problems = []
  if (!report || typeof report !== 'object' || report.error || !report.vulnerabilities) {
    return { ok: false, problems: ['Rapport npm audit illisible ou en erreur : audit non vérifié.'] }
  }
  const advisories = advisoriesOf(report).filter((a) => BLOCKING.has(a.severity))
  const valid = new Map()
  for (const e of exceptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expires ?? '') || !e.id || !e.package || !e.reason) {
      problems.push(`Exception mal formée : ${JSON.stringify(e)}.`)
    } else if (e.expires < today) {
      problems.push(`Exception expirée le ${e.expires} : ${e.id} (${e.package}). Réexaminer l'avis, puis retirer ou renouveler l'exception.`)
    } else {
      valid.set(`${e.id.toUpperCase()}|${e.package}`, e)
    }
  }
  const seen = new Set()
  for (const a of advisories) {
    const key = `${a.id}|${a.pkg}`
    if (valid.has(key)) { seen.add(key); continue }
    problems.push(`Avis ${a.severity} non couvert : ${a.id ?? a.url} sur ${a.pkg}.`)
  }
  for (const [key, e] of valid) {
    if (!seen.has(key)) problems.push(`Exception devenue inutile : ${e.id} ne touche plus ${e.package}. La retirer de audit-exceptions.json.`)
  }
  return { ok: problems.length === 0, problems }
}

function runNpmAudit() {
  try {
    return execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    // npm audit sort en code non nul dès qu'il trouve un avis : le JSON est dans stdout.
    if (typeof err.stdout === 'string' && err.stdout.trim()) return err.stdout
    throw err
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let report
  try { report = JSON.parse(runNpmAudit()) } catch { report = null }
  const exceptions = JSON.parse(readFileSync(new URL('../audit-exceptions.json', import.meta.url), 'utf8'))
  const today = new Date().toISOString().slice(0, 10)
  const { ok, problems } = evaluate(report, exceptions, today)
  if (ok) {
    console.log(`Audit des dépendances : aucun avis bloquant (${exceptions.length} exception(s) datée(s) en cours).`)
  } else {
    for (const p of problems) console.error(`✗ ${p}`)
    process.exit(1)
  }
}
