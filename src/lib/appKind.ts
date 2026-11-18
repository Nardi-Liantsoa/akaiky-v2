import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

// Dans quelle application tourne ce code : l'app parent (Play Store, App Store,
// web) ou l'app enfant (variante Android « enfant », installée par QR). Lu une
// fois, depuis l'identifiant natif de l'application ; le web est toujours parent.
export type AppKind = 'parent' | 'enfant'
export const CHILD_APP_ID = 'mg.nosytech.akaiky.enfant'

export const kindFromAppId = (id: string | null | undefined): AppKind => (id === CHILD_APP_ID ? 'enfant' : 'parent')

let pending: Promise<AppKind> | null = null
export function appKind(): Promise<AppKind> {
  // Lecture native en échec (ne devrait pas arriver) : parent par défaut, sans le
  // retenir, pour réessayer à la navigation suivante. L'app parent exige une
  // connexion ; elle n'ouvre rien de plus sur un téléphone d'enfant.
  pending ??= Capacitor.isNativePlatform()
    ? App.getInfo().then((info) => kindFromAppId(info.id), () => { pending = null; return 'parent' as const })
    : Promise.resolve('parent')
  return pending
}
