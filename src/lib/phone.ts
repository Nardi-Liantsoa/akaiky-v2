// Affichage d'un numéro E.164 par groupes lisibles. Malgache : +261 34 12 345 67 ;
// français : +33 6 12 34 56 78 ; autres : tel quel.
export function formatPhone(e164: string): string {
  const mg = /^\+261(\d{2})(\d{2})(\d{3})(\d{2})$/.exec(e164)
  if (mg) return `+261 ${mg.slice(1).join(' ')}`
  const fr = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164)
  if (fr) return `+33 ${fr.slice(1).join(' ')}`
  return e164
}

// Numéro E.164 qu'un contact peut porter : même règle que le serveur (server/src/phone.js),
// « + », indicatif sans 0, 8 à 15 chiffres.
export const isE164 = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9]\d{7,14}$/.test(v)

// Saisie égale au numéro enregistré, une fois retirés les séparateurs qu'ajoute
// formatPhone ou que tape la personne (espaces, tirets, points, parenthèses) ; vide = aucun
// numéro. Une écriture locale (« 034… ») compte comme un changement : le serveur la normalise.
export function samePhone(input: string, e164: string | null): boolean {
  const typed = input.replace(/[\s().-]/g, '')
  return typed === (e164 ?? '')
}
