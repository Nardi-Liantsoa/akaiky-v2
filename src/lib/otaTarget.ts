import { App } from '@capacitor/app'
import { kindFromAppId, type AppKind } from './appKind'

// À quelle app un bundle OTA est destiné (NAR-162). Les deux variantes Android partagent le
// même bundle web ; ce qui les sépare, c'est leur coque (greffons natifs différents) et donc
// leur versionCode, qui suit une échelle par app. Chaque publication annonce sa cible
// (`target` de la réponse du serveur OTA, à côté de `version` et `url`) ; l'écran la refuse
// si elle ne vise pas la coque qui le fait tourner. Défense en profondeur : le serveur fait le
// même tri sur app_id et version_code envoyés par le greffon, et chaque coque porte nativement
// son app_id et son canal (android/app/build.gradle). Cas partagés : tests/fixtures/ota-target-cases.json.

export interface OtaTarget {
  app: AppKind
  // Canal de publication : le nom de l'app, ou ce nom suivi de « - » (parent-test).
  channel: string
  // versionCode minimal de la coque de CETTE app (échelles parent et enfant indépendantes).
  minNativeBuild: number
}

// Coque qui fait tourner l'écran, lue nativement (jamais dans le bundle) : identifiant de
// l'application et versionCode (CFBundleVersion sur iOS).
export interface Shell {
  appId: string
  build: string
}

export type OtaVerdict = 'accept' | 'unknown-shell' | 'invalid' | 'wrong-app' | 'wrong-channel' | 'native-too-old'

const APPS: readonly AppKind[] = ['parent', 'enfant']

// Suffixe non vide après « - » : « parent- » n'est pas un canal.
export const channelBelongsTo = (channel: string, app: AppKind): boolean =>
  channel === app || (channel.startsWith(`${app}-`) && channel.length > app.length + 1)

// Famille d'identifiants des deux apps : tout autre identifiant est une coque inconnue.
const ownAppId = (id: string): boolean => id === 'mg.nosytech.akaiky' || id.startsWith('mg.nosytech.akaiky.')

function parseTarget(raw: unknown): OtaTarget | null {
  if (!raw || typeof raw !== 'object') return null
  const { app, channel, minNativeBuild } = raw as Record<string, unknown>
  if (typeof app !== 'string' || !(APPS as readonly string[]).includes(app)) return null
  if (typeof channel !== 'string' || channel === '') return null
  if (typeof minNativeBuild !== 'number' || !Number.isSafeInteger(minNativeBuild) || minNativeBuild < 1) return null
  return { app: app as AppKind, channel, minNativeBuild }
}

// Toujours fermé : une coque qu'on ne sait pas lire, ou une cible douteuse, ne reçoit rien.
export function otaVerdict(target: unknown, shell: Shell): OtaVerdict {
  if (!ownAppId(shell.appId) || !/^\d+$/.test(shell.build)) return 'unknown-shell'
  const t = parseTarget(target)
  if (!t) return 'invalid'
  const kind = kindFromAppId(shell.appId)
  if (t.app !== kind) return 'wrong-app'
  if (!channelBelongsTo(t.channel, kind)) return 'wrong-channel'
  if (Number(shell.build) < t.minNativeBuild) return 'native-too-old'
  return 'accept'
}

// Lecture native en échec (web, greffon absent) : coque vide, donc « unknown-shell ».
export async function readShell(): Promise<Shell> {
  try {
    const info = await App.getInfo()
    return { appId: info.id ?? '', build: info.build ?? '' }
  } catch {
    return { appId: '', build: '' }
  }
}
