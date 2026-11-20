// Numéro d'urgence affiché et composé par le téléphone de l'enfant (NAR-142, C09).
// Madagascar : 117 (police, numéro des secours depuis un mobile ; sources : CallPolicy.kt et
// docs/MOBILE.md « Numéros d'urgence », NAR-197). France : 112. Par défaut : 112, reconnu
// comme urgence par tout téléphone GSM. Chaque numéro rendu ici doit figurer dans
// CallPolicy.EMERGENCY (tests/fixtures/emergency-numbers.json), sinon le natif le refuse.
const NUMBERS: Record<string, string> = { MG: '117', FR: '112' }

export function emergencyNumber(country: string | null | undefined): string {
  return NUMBERS[(country ?? '').toUpperCase()] ?? '112'
}
