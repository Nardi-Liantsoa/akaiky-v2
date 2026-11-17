// État partagé entre la mise en place, les tests et le nettoyage de la recette.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const STATE_FILE = join(tmpdir(), `recette-${process.cwd().replace(/[^a-z0-9]+/gi, '-')}.json`)
export const state = () => JSON.parse(readFileSync(STATE_FILE, 'utf8'))
// Port fixe : la configuration Playwright est relue par chaque processus de test.
export const RECETTE_PORT = Number(process.env.RECETTE_PORT || 8811)
export const RECETTE_ORIGIN = `http://127.0.0.1:${RECETTE_PORT}`
