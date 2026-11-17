export interface User {
  id: string
  email: string
  name: string
  is_admin: boolean
}

// Réponse de connexion : soit une session ouverte, soit un second facteur à fournir.
export interface LoginResult {
  user?: User
  mfaRequired?: boolean
  enrollmentRequired?: boolean
}

