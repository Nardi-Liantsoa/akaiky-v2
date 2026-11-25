// Avatar d'un enfant ou d'un contact : initiale sur une pastille colorée
// (maquettes, docs/DESIGN.md). Les couleurs sont des jetons, jamais des valeurs.
export const AVATAR_COLORS = ['orange', 'blue', 'violet', 'green', 'yellow'] as const
export type AvatarColor = (typeof AVATAR_COLORS)[number]

const TOKENS: Record<AvatarColor, string> = {
  orange: 'var(--accent-orange)',
  blue: 'var(--accent-blue)',
  violet: 'var(--accent-violet)',
  green: 'var(--call)',
  yellow: 'var(--accent-yellow)'
}

export const colorToken = (c: AvatarColor) => TOKENS[c]

// Teinte claire d'une vignette de contact (écran de l'enfant, maquette écran 1).
const TINTS: Record<AvatarColor, string> = {
  orange: 'var(--tint-peach)',
  blue: 'var(--tint-sky)',
  violet: 'var(--tint-lilac)',
  green: 'var(--tint-mint)',
  yellow: 'var(--tint-butter)'
}
export const tintToken = (c: string) => TINTS[c as AvatarColor] ?? TINTS.orange
export const accentToken = (c: string) => TOKENS[c as AvatarColor] ?? TOKENS.orange

// Découpe en caractères visibles, créée une fois (absente des vieilles WebView).
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

// Premier caractère visible (un emoji composé compte pour un), en majuscule. Nom vide :
// rien (pastille unie, jamais « ? » ; NAR-186).
export function initial(name: string): string {
  const text = name.trim()
  if (!text) return ''
  const first = graphemes
    ? graphemes.segment(text)[Symbol.iterator]().next().value?.segment ?? ''
    : [...text][0]
  return first.toLocaleUpperCase()
}

// Couleur proposée d'office à l'ajout (NAR-222) : la moins portée parmi `used`, ordre de
// AVATAR_COLORS à égalité ; même règle que le serveur (server/src/routes/children.js).
export function leastUsedColor(used: readonly (string | null | undefined)[]): AvatarColor {
  const count = (c: AvatarColor) => used.filter((u) => u === c).length
  return AVATAR_COLORS.reduce((best, c) => (count(c) < count(best) ? c : best))
}
