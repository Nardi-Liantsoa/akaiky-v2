// Même règle que le serveur (`phonePasswordProblem`, NAR-136) : le numéro, connu de tous les
// contacts du titulaire, ne fait pas un mot de passe. Vérifié avant l'envoi pour montrer le
// refus traduit ; le serveur reste l'arbitre (son 400 n'a pas de code stable).
// Numéro national = 9 derniers chiffres, quelle que soit la saisie (« 034 12 345 67 », « +261… »).
export function passwordContainsPhone(password: string, phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 9) return false
  return password.replace(/[\s.\-()/+]/g, '').includes(digits.slice(-9))
}
