// Numéro d'urgence affiché et composé par le téléphone de l'enfant (NAR-142, C09).
// Madagascar : 117 (police), comme la maquette ; à confirmer avec le client (CdC §12.1).
// France : 112. Par défaut : 112, accepté par tous les réseaux GSM.
const NUMBERS: Record<string, string> = { MG: '117', FR: '112' }

export function emergencyNumber(country: string | null | undefined): string {
  return NUMBERS[(country ?? '').toUpperCase()] ?? '112'
}
