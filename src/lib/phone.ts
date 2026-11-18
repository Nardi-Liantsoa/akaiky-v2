// Affichage d'un numéro E.164 par groupes lisibles. Malgache : +261 34 12 345 67 ;
// français : +33 6 12 34 56 78 ; autres : tel quel.
export function formatPhone(e164: string): string {
  const mg = /^\+261(\d{2})(\d{2})(\d{3})(\d{2})$/.exec(e164)
  if (mg) return `+261 ${mg.slice(1).join(' ')}`
  const fr = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164)
  if (fr) return `+33 ${fr.slice(1).join(' ')}`
  return e164
}
