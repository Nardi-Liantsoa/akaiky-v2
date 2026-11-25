import { describe, expect, it } from 'vitest'
import { MESSAGES } from './messages'

// Les trois catalogues (NAR-210) : mêmes clés, mêmes fonctions avec le même nombre
// d'arguments, listes de même longueur, aucun texte vide. Le type Messages attrape déjà
// une clé oubliée à la compilation ; ce test attrape aussi ce que le type laisse passer
// (chaîne vide, fonction qui ignore un argument, liste plus courte). L'ordre des
// arguments d'une fonction n'est pas vérifié : il reste à la relecture.

type Shape = string | { fn: number } | Shape[] | { [k: string]: Shape }

// Argument d'essai qui sert de texte, de liste ou de nombre selon la fonction : une liste
// d'un nom (rendue « Fy », .map et .join permis) qui vaut n dans un calcul. Chaque
// fonction est rendue avec n = 1 puis 2 : singulier et pluriel ne doivent pas être vides.
const sample = (n: number) => (): unknown => Object.assign(['Fy'], { valueOf: () => n })

function shape(v: unknown, path: string, empties: string[]): Shape {
  if (typeof v === 'string') {
    if (!v.trim()) empties.push(path)
    return 'string'
  }
  if (typeof v === 'function') {
    for (const n of [1, 2]) {
      const out = String((v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, sample(n))))
      if (!out.trim()) empties.push(`${path}(${n})`)
    }
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

    const children = { ...MESSAGES.en.children, colors: { ...MESSAGES.en.children.colors, blue: ' ' } }
    expect(check({ ...MESSAGES, en: { ...MESSAGES.en, children } }).empties).toEqual(['en.children.colors.blue'])
  })
})
