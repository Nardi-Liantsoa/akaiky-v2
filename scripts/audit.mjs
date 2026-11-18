// Audit des dépendances du front avec exceptions datées (NAR-159).
//
// `npm audit --audit-level=moderate` échoue sur tout avis, y compris ceux sans
// correction publiée et sans exposition en production. Ce script lit le rapport
// JSON de npm et échoue sur :
//   - tout avis de gravité moderate ou plus absent de audit-exceptions.json ;
//   - toute exception expirée (on réexamine, on ne prolonge pas en silence) ;
//   - toute exception qui ne correspond plus à aucun avis (version corrigée
//     installée : on la retire au lieu de l'oublier) ;
//   - toute exception plus longue que 30 jours (de `added` à `expires`), ou dont
//     l'avis a pris une gravité supérieure à celle acceptée (`severity`) ;
//   - tout rapport illisible ou en erreur (réseau, registre) : on échoue fermé.
// Dates en UTC (AAAA-MM-JJ) ; une exception vaut jusqu'à `expires` inclus.
// Aucune dépendance : node:child_process, node:fs et node:url.
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical']
const BLOCKING = new Set(['moderate', 'high', 'critical'])
const MAX_DAYS = 30
const DATE = /^\d{4}-\d{2}-\d{2}$/
const days = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
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

const wellFormed = (e) => e && typeof e === 'object'
  && typeof e.id === 'string' && typeof e.package === 'string' && typeof e.reason === 'string' && e.reason.trim()
  && DATE.test(e.added ?? '') && DATE.test(e.expires ?? '') && LEVELS.includes(e.severity)

// today : 'AAAA-MM-JJ' (UTC).
export function evaluate(report, exceptions, today) {
  const problems = []
  if (!report || typeof report !== 'object' || report.error || !report.vulnerabilities) {
    return { ok: false, problems: ['Rapport npm audit illisible ou en erreur : audit non vérifié.'] }
  }
  if (!Array.isArray(exceptions)) return { ok: false, problems: ['audit-exceptions.json doit être une liste.'] }
  // Toutes les gravités pour rapprocher les exceptions (un avis rétrogradé en low
  // n'a pas disparu) ; seules moderate et plus bloquent quand rien ne les couvre.
  const advisories = advisoriesOf(report)
  const valid = new Map()
  for (const e of exceptions) {
    if (!wellFormed(e)) {
      problems.push(`Exception mal formée (id, package, reason, added, expires, severity) : ${JSON.stringify(e)}.`)
    } else if (!(days(e.added, e.expires) >= 0 && days(e.added, e.expires) <= MAX_DAYS)) {
      problems.push(`Exception ${e.id} : ${MAX_DAYS} jours au plus entre added (${e.added}) et expires (${e.expires}).`)
    } else if (e.expires < today) {
      problems.push(`Exception expirée le ${e.expires} : ${e.id} (${e.package}). Réexaminer l'avis, puis retirer ou renouveler l'exception.`)
    } else {
      valid.set(`${e.id.toUpperCase()}|${e.package}`, e)
    }
  }
  const seen = new Set()
  for (const a of advisories) {
    const key = `${a.id}|${a.pkg}`
    const e = valid.get(key)
    if (e) {
      seen.add(key)
      if (LEVELS.indexOf(a.severity) > LEVELS.indexOf(e.severity)) {
        problems.push(`Avis ${a.id} sur ${a.pkg} passé en ${a.severity} (exception acceptée pour ${e.severity}) : réexaminer.`)
      }
      continue
    }
    if (BLOCKING.has(a.severity)) problems.push(`Avis ${a.severity} non couvert : ${a.id ?? a.url} sur ${a.pkg}.`)
  }
  for (const [key, e] of valid) {
    if (!seen.has(key)) problems.push(`Exception devenue inutile : ${e.id} ne touche plus ${e.package}. La retirer de audit-exceptions.json.`)
  }
  return { ok: problems.length === 0, problems }
}

function runNpmAudit() {
  try {
    // Toujours le projet racine, quel que soit le dossier d'appel : c'est lui que
    // décrit audit-exceptions.json.
    return execFileSync('npm', ['audit', '--json'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    // npm audit sort en code non nul dès qu'il trouve un avis : le JSON est dans stdout.
    if (typeof err.stdout === 'string' && err.stdout.trim()) return err.stdout
    throw err
  }
}

// Lancé directement (et non importé par le test). Chemins réels des deux côtés :
// sous un chemin à lien symbolique, une comparaison brute sauterait l'audit.
const real = (path) => { try { return realpathSync(path) } catch { return path } }
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  let report
  try { report = JSON.parse(runNpmAudit()) } catch { report = null }
  let exceptions
  try { exceptions = JSON.parse(readFileSync(new URL('../audit-exceptions.json', import.meta.url), 'utf8')) } catch { exceptions = null }
  const today = new Date().toISOString().slice(0, 10)
  const { ok, problems } = evaluate(report, exceptions, today)
  if (ok) {
    console.log(`Audit des dépendances : aucun avis bloquant (${exceptions.length} exception(s) datée(s) en cours).`)
  } else {
    for (const p of problems) console.error(`✗ ${p}`)
    process.exit(1)
  }
}
