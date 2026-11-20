// Règle des cibles OTA (NAR-162, NAR-189), côté serveur. Même décision que l'écran
// (src/lib/otaTarget.ts, otaVerdict) et mêmes cas partagés (tests/fixtures/ota-target-cases.json) :
// un bundle n'est proposé qu'à la coque de SON app, sur un canal de cette app, et seulement si
// la coque est au moins à min_native_build (échelle versionCode propre à chaque app).
// Le serveur ne peut pas importer le TypeScript du front : la règle est recopiée ici, et le test
// serveur la vérifie contre le même fichier de cas.

export const APPS = ['parent', 'enfant']
export const PARENT_APP_ID = 'mg.nosytech.akaiky'
export const CHILD_APP_ID = 'mg.nosytech.akaiky.enfant'
// Plus grand versionCode accepté par Google Play.
export const MAX_NATIVE_BUILD = 2100000000
// Nom de canal publiable : minuscules, chiffres, segments séparés par « - » (contrainte aussi en base).
export const CHANNEL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/

// Préfixe, pas égalité : une variante dérivée de l'app enfant (.debug) reste l'app enfant.
export const kindFromAppId = (id) => (id === CHILD_APP_ID || id.startsWith(`${CHILD_APP_ID}.`) ? 'enfant' : 'parent')
// Famille d'identifiants des deux apps : tout autre identifiant est une coque inconnue.
export const ownAppId = (id) => typeof id === 'string' && (id === PARENT_APP_ID || id.startsWith(`${PARENT_APP_ID}.`))
// Suffixe non vide après « - » : « parent- » n'est pas un canal.
export const channelBelongsTo = (channel, app) =>
  typeof channel === 'string' && (channel === app || (channel.startsWith(`${app}-`) && channel.length > app.length + 1))

export function parseTarget(raw) {
  if (!raw || typeof raw !== 'object') return null
  const { app, channel, minNativeBuild } = raw
  if (typeof app !== 'string' || !APPS.includes(app)) return null
  if (typeof channel !== 'string' || channel === '') return null
  if (typeof minNativeBuild !== 'number' || !Number.isSafeInteger(minNativeBuild) || minNativeBuild < 1) return null
  return { app, channel, minNativeBuild }
}

// La même cible, en chaînes, pour le champ `data` de la réponse (NAR-191) : le greffon iOS 8.54.2
// ne transmet au JavaScript que ses champs connus (`target` est perdu) mais garde `data`, un
// dictionnaire de chaînes (une valeur non textuelle ferait échouer tout le décodage côté iOS).
// L'écran lit la cible là, sur les deux plateformes (src/lib/otaTarget.ts, targetFromData) ;
// cas partagés : `data` de tests/fixtures/ota-target-cases.json.
export const targetData = ({ app, channel, minNativeBuild }) => ({ app, channel, minNativeBuild: String(minNativeBuild) })

// Toujours fermé : une coque qu'on ne sait pas lire, ou une cible douteuse, ne reçoit rien.
export function otaVerdict(target, shell) {
  if (!ownAppId(shell.appId) || !/^\d+$/.test(shell.build)) return 'unknown-shell'
  const t = parseTarget(target)
  if (!t) return 'invalid'
  const kind = kindFromAppId(shell.appId)
  if (t.app !== kind) return 'wrong-app'
  if (!channelBelongsTo(t.channel, kind)) return 'wrong-channel'
  if (Number(shell.build) < t.minNativeBuild) return 'native-too-old'
  return 'accept'
}

// Ce que le greffon envoie (app_id, version_code, canal demandé) ramené à une demande sûre,
// ou au motif du refus. Le canal doit appartenir à l'app de la coque : jamais celui d'une autre.
export function readRequest({ app_id: appId, version_code: build, defaultChannel: channel }) {
  if (!ownAppId(appId) || typeof build !== 'string' || !/^\d{1,10}$/.test(build) || Number(build) > MAX_NATIVE_BUILD) {
    return { refused: 'unknown_shell' }
  }
  const kind = kindFromAppId(appId)
  if (typeof channel !== 'string' || !CHANNEL_RE.test(channel) || channel.length > 40 || !channelBelongsTo(channel, kind)) return { refused: 'wrong_channel', kind }
  return { kind, channel, build: Number(build), shell: { appId, build } }
}

// Cible publiée, contrôlée par la publication (server/bin/ota-publish.js) : app connue, canal de
// cette app, coque minimale entière, version au format attendu par le greffon.
export function publishProblem({ app, channel, minNativeBuild, version }) {
  if (!APPS.includes(app)) return '--app : parent ou enfant'
  if (typeof channel !== 'string' || !CHANNEL_RE.test(channel) || channel.length > 40) return '--channel : minuscules, chiffres et « - » (40 caractères au plus)'
  if (!channelBelongsTo(channel, app)) return `--channel « ${channel} » n'appartient pas à l'app ${app} (${app} ou ${app}-<suffixe>)`
  if (!parseTarget({ app, channel, minNativeBuild }) || minNativeBuild > MAX_NATIVE_BUILD) return '--min-native : versionCode entier strictement positif'
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return '--version : 1 à 64 caractères parmi lettres, chiffres, « . », « + », « _ », « - »'
  return null
}
