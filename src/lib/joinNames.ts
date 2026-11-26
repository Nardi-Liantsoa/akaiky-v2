// « Papa, Tonton et Mamie » : virgules, puis le mot de liaison de la langue avant le dernier nom
// (NAR-238). Sans Intl.ListFormat : WebView 64 ne l'a pas.
export function joinNames(names: readonly string[], and: string): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`
}
