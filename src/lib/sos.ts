// Appui maintenu sur SOS, en attendant l'alerte complète (NAR-149) : numéros à
// essayer dans l'ordre. Premier contact (premier de l'ordre SOS), puis le numéro
// d'urgence si l'appel ne part pas ou s'il n'y a aucun contact.
export interface SosStep { kind: 'contact' | 'emergency', number: string }

export function sosPlan(contacts: { phone: string, position: number }[], emergency: string): SosStep[] {
  const first = [...contacts].sort((a, b) => a.position - b.position)[0]
  return [...(first ? [{ kind: 'contact' as const, number: first.phone }] : []), { kind: 'emergency', number: emergency }]
}
