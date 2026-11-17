// Nom de famille : 1 à 80 caractères (points de code), comme le serveur et
// PostgreSQL. maxlength du HTML compte les unités UTF-16 et bloquerait les emoji.
export const FAMILY_NAME_MAX = 80

export function familyNameValid(value: string): boolean {
  const length = [...value.trim()].length
  return length >= 1 && length <= FAMILY_NAME_MAX
}
