import { describe, expect, it } from 'vitest'
import { MESSAGES } from './messages'

// Les trois catalogues (NAR-210) : mêmes clés, mêmes fonctions avec le même nombre
// d'arguments, aucun texte vide. Le type Messages attrape déjà une clé oubliée à la
// compilation ; ce test attrape aussi ce que le type laisse passer (chaîne vide,
// fonction qui ignore un argument, tableau plus court).

type Shape = string | { fn: number, sample: string } | Shape[] | { [k: string]: Shape }

// Fonctions appelées avec des arguments d'essai : le texte rendu ne doit pas être vide.
// Chaque argument d'essai sert de texte, de liste ou de nombre selon la fonction : une
// liste d'un nom (rendue « Fy », .map et .join permis) qui vaut 2 dans un calcul.
const sample = (): unknown => Object.assign(['Fy'], { valueOf: () => 2 })

function shape(v: unknown, path: string, empties: string[]): Shape {
  if (typeof v === 'string') {
    if (!v.trim()) empties.push(path)
    return 'string'
  }
  if (typeof v === 'function') {
    const out = String((v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, sample)))
    if (!out.trim()) empties.push(path)
    return { fn: v.length, sample: 'fn' }
  }
  if (Array.isArray(v)) return v.map((x, i) => shape(x, `${path}[${i}]`, empties))
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k], `${path}.${k}`, empties)]))
  }
  throw new Error(`${path} : valeur inattendue (${typeof v})`)
}

describe('catalogues mg, fr, en', () => {
  const empties: string[] = []
  const shapes = Object.fromEntries(Object.entries(MESSAGES).map(([l, m]) => [l, shape(m, l, empties)]))

  it('ont exactement les mêmes clés, fonctions et longueurs de listes', () => {
    expect(shapes.mg).toEqual(shapes.fr)
    expect(shapes.en).toEqual(shapes.fr)
  })

  it('n’ont aucun texte vide', () => {
    expect(empties).toEqual([])
  })

  it('détecte une clé retirée d’une langue', () => {
    const { lang: _lang, ...withoutLang } = MESSAGES.mg
    expect(shape(withoutLang, 'mg', [])).not.toEqual(shapes.fr)
  })
})
