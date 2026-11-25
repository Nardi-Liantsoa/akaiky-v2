import { describe, expect, it } from 'vitest'
import { MESSAGES } from './messages'

// Les trois catalogues (NAR-210) : mêmes clés, mêmes fonctions avec le même nombre
// d'arguments, listes de même longueur, aucun texte vide. Le type Messages attrape déjà
// une clé oubliée à la compilation ; ce test attrape aussi ce que le type laisse passer
// (chaîne vide, fonction qui ignore un argument, liste plus courte). L'ordre des
// arguments d'une fonction n'est pas vérifié : il reste à la relecture.

type Shape = string | { fn: number } | Shape[] | { [k: string]: Shape }

// Arguments d'essai : chaque argument est essayé comme nombre n et comme liste de n noms
// (rendue « Fy » ou « Fy,Fy »), avec n = 1 puis 2, pour passer par le singulier et le
// pluriel (n === 1, names.length > 1). Toute combinaison qui s'exécute doit rendre un
// texte non vide ; une combinaison qui lève (.map sur un nombre) ne correspond pas au type.
const candidates = (n: number): unknown[] => [n, Array(n).fill('Fy')]
function* combos(arity: number, n: number): Generator<unknown[]> {
  if (arity === 0) { yield []; return }
  for (const head of candidates(n)) for (const rest of combos(arity - 1, n)) yield [head, ...rest]
}

function shape(v: unknown, path: string, empties: string[]): Shape {
  if (typeof v === 'string') {
    if (!v.trim()) empties.push(path)
    return 'string'
  }
  if (typeof v === 'function') {
    let ran = 0
    for (const n of [1, 2]) {
      for (const args of combos(v.length, n)) {
        let out: string
        try { out = String((v as (...a: unknown[]) => unknown)(...args)) } catch { continue }
        ran++
        if (!out.trim()) empties.push(`${path}(${JSON.stringify(args)})`)
      }
    }
    if (!ran) throw new Error(`${path} : aucun argument d'essai ne convient`)
    return { fn: v.length }
  }
  if (Array.isArray(v)) return v.map((x, i) => shape(x, `${path}[${i}]`, empties))
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k], `${path}.${k}`, empties)]))
  }
  throw new Error(`${path} : valeur inattendue (${typeof v})`)
}

// Langues dont la forme diffère du français, et chemins des textes vides.
function check(catalogs: Record<string, unknown>) {
  const empties: string[] = []
  const shapes = Object.fromEntries(Object.entries(catalogs).map(([l, m]) => [l, shape(m, l, empties)]))
  const ref = JSON.stringify(shapes.fr)
  const differ = Object.keys(shapes).filter((l) => JSON.stringify(shapes[l]) !== ref)
  return { differ, empties }
}

describe('catalogues mg, fr, en', () => {
  it('ont les mêmes clés, fonctions et longueurs de listes, sans texte vide', () => {
    expect(check(MESSAGES)).toEqual({ differ: [], empties: [] })
  })

  it('détectent une clé retirée, une fonction qui perd son argument et un texte vide', () => {
    const { lang: _lang, ...mg } = MESSAGES.mg
    expect(check({ ...MESSAGES, mg }).differ).toEqual(['mg'])

    const phoneState = { ...MESSAGES.mg.phoneState, moreAlerts: () => 'fampitandremana hafa' }
    expect(check({ ...MESSAGES, mg: { ...MESSAGES.mg, phoneState } }).differ).toEqual(['mg'])

    // Singulier vide (n === 1) et pluriel vide (plusieurs noms) : vus tous les deux.
    const one = { ...MESSAGES.fr.phoneState, moreAlerts: (n: number) => (n === 1 ? '' : 'autres alertes') }
    expect(check({ ...MESSAGES, fr: { ...MESSAGES.fr, phoneState: one } }).empties).toEqual(['fr.phoneState.moreAlerts([1])'])
    const many = (names: string[]) => (names.length > 1 ? ' ' : `${names[0]} regarde`)
    expect(check({ fr: { w: many } }).empties).toEqual(['fr.w([["Fy","Fy"]])'])

    const children = { ...MESSAGES.en.children, colors: { ...MESSAGES.en.children.colors, blue: ' ' } }
    expect(check({ ...MESSAGES, en: { ...MESSAGES.en, children } }).empties).toEqual(['en.children.colors.blue'])
  })
})
