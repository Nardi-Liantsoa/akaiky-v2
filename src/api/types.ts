export interface User {
  id: string
  // Compte à adresse OU à numéro (NAR-136) : l'un des deux peut être null.
  email: string | null
  phone?: string | null
  name: string
  is_admin: boolean
}

// Identifiant de connexion : une adresse OU un numéro (NAR-136), jamais les deux
// (le serveur refuse un corps qui porte les deux, ou aucun).
export type LoginId = { email: string, phone?: never } | { phone: string, email?: never }

// Réponse de connexion : soit une session ouverte, soit un second facteur à fournir.
export interface LoginResult {
  user?: User
  mfaRequired?: boolean
  enrollmentRequired?: boolean
}

