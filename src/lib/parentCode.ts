// Code parent à 6 chiffres (NAR-139). Même règle que le serveur
// (server/src/parent-code.js), qui seul décide ; ici, pour le message immédiat.
export type ParentCodeProblem = 'invalid_parent_code' | 'weak_parent_code'

export function parentCodeProblem(code: string): ParentCodeProblem | null {
  if (!/^[0-9]{6}$/.test(code)) return 'invalid_parent_code'
  // Suites modulo 10 (901234 compris), motifs répétés (121212, 123123), paires ou triplets
  // doublés (112233, 111222), palindromes (123321).
  const d = [...code].map(Number)
  const steps = d.slice(1).map((x, i) => (x - d[i] + 10) % 10)
  const run = steps.every((s) => s === steps[0]) && [0, 1, 9].includes(steps[0])
  const repeated = code === code.slice(0, 2).repeat(3) || code === code.slice(0, 3).repeat(2)
  const pairs = code[0] === code[1] && code[2] === code[3] && code[4] === code[5]
  const triples = code[0] === code[1] && code[1] === code[2] && code[3] === code[4] && code[4] === code[5]
  const mirror = code === [...code].reverse().join('')
  if (run || repeated || pairs || triples || mirror) return 'weak_parent_code'
  return null
}
