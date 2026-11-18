// Adresse publique de l'API pour les applications natives, compilée dans le bundle.
// Par défaut le domaine de production du projet ; vite.config.ts refuse de construire
// avec une valeur qui ne serait pas en https. Le téléphone de l'enfant n'utilise que
// celle-ci : jamais une adresse lue dans le QR (NAR-164).
export const API_BASE = `${import.meta.env.VITE_API_ORIGIN || 'https://akaiky.a-definir.invalid'}/api`
