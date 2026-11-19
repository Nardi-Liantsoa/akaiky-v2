import { api } from './http'

// Applications autorisées d'un enfant (NAR-143). Inventaire : applications envoyées par ses
// téléphones actifs (icône PNG en base64, absente si trop lourde) ; liste : 4 au plus, ordonnée.
export interface InventoryApp { package: string, label: string, icon: string | null, allowed: boolean }
// blocked : autorisée puis devenue protégée (navigateur reconnu, liste fixe mise à jour) ; à retirer.
export interface AllowedApp { package: string, label: string, position: number, blocked?: boolean }
export interface ChildApps { max: number, inventory: InventoryApp[], allowed: AllowedApp[] }
const base = (childId: string) => `/children/${encodeURIComponent(childId)}`
export const getApps = (childId: string) => api.get<ChildApps>(`${base(childId)}/apps`)
export const setAllowedApps = (childId: string, packages: string[]) =>
  api.put<{ max: number, allowed: AllowedApp[] }>(`${base(childId)}/allowed-apps`, { packages })
