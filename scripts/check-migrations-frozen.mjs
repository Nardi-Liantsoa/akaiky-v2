// Migrations figées (NAR-198) : une PR ne modifie, ne renomme ni ne supprime aucun
// fichier de server/src/migrations/ déjà présent sur la branche de base ; elle n'en
// ajoute que de nouveaux. Le runner rejoue une migration par son nom : un fichier
// modifié après application ne repasse jamais sur une base existante (023 du 19/11).
//
//   node scripts/check-migrations-frozen.mjs [base]
// Base : argument, sinon origin/$GITHUB_BASE_REF (PR GitHub), sinon origin/main.
// Sans objet sur un push (main est déjà la référence) : sortie 0.
// Comparaison au point de divergence (`base...HEAD`), renommages vus comme
// suppression + ajout (--no-renames), chemins non échappés (core.quotePath=false). Aucune dépendance.
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MIGRATIONS_DIR = 'server/src/migrations/'

// Sortie de `git diff --name-status --no-renames` → fichiers de migration existants
// touchés autrement que par un ajout ({ status, path }).
export function violations(nameStatus) {
  return nameStatus.split('\n').filter(Boolean).map((line) => {
    const [status, ...paths] = line.split('\t')
    return { status, path: paths.at(-1) }
  }).filter((c) => c.path?.startsWith(MIGRATIONS_DIR) && c.status !== 'A')
}

export function report(found, base) {
  const label = { M: 'modifiée', D: 'supprimée', T: 'type changé' }
  return [`Migrations figées : ${found.length} fichier(s) déjà publié(s) sur ${base} touché(s) par cette branche :`,
    ...found.map((c) => `  - ${c.path} (${label[c.status[0]] ?? c.status})`),
    'Une migration publiée ne se modifie jamais : remettre le fichier tel qu\'il est sur la base',
    `(git checkout ${base} -- <fichier>) et écrire la correction dans une nouvelle migration numérotée.`].join('\n')
}

const real = (p) => { try { return realpathSync(p) } catch { return p } }
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    console.log('Migrations figées : push, rien à comparer.')
    process.exit(0)
  }
  const base = process.argv[2] || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main')
  // Une base qui commence par « - » serait lue comme une option de git diff.
  if (base.startsWith('-')) { console.error(`Migrations figées : base invalide (${base}).`); process.exit(2) }
  let out
  try {
    out = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-status', '--no-renames', `${base}...HEAD`, '--', MIGRATIONS_DIR], { encoding: 'utf8' })
  } catch (e) {
    // Base introuvable (historique trop court, branche absente) : on échoue fermé.
    console.error(`Migrations figées : comparaison à ${base} impossible (${e.message.split('\n')[0]}).`)
    process.exit(2)
  }
  const found = violations(out)
  if (found.length) { console.error(report(found, base)); process.exit(1) }
  console.log(`Migrations figées : aucune migration publiée modifiée par rapport à ${base}.`)
}
