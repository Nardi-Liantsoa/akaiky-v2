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

// Découpe en caractères visibles, créée une fois (absente des vieilles WebView).
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

// Premier caractère visible (un emoji composé compte pour un), en majuscule.
export function initial(name: string): string {
  const text = name.trim()
  if (!text) return '?'
  const first = graphemes
    ? graphemes.segment(text)[Symbol.iterator]().next().value?.segment ?? ''
    : [...text][0]
  return first.toLocaleUpperCase()
}
