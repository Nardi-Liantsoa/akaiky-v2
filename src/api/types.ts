export interface User {
  id: string
  // Compte à adresse OU à numéro (NAR-136) : l'un des deux peut être null.
  email: string | null
  phone?: string | null
  name: string
  is_admin: boolean
}

// Réponse de connexion : soit une session ouverte, soit un second facteur à fournir.
export interface LoginResult {
  user?: User
  mfaRequired?: boolean
  enrollmentRequired?: boolean
}

