// Contenu des notifications push (NAR-141, ampy-push « Le contenu »). Liste FERMÉE
// d'événements ; chaque texte est générique : le prénom de l'enfant au plus, jamais le
// texte d'un message ni un emplacement. `data` ne porte que le type et l'identifiant :
// l'app recharge le contenu par l'API, avec sa session.
export const LANGS = ['mg', 'fr', 'en']
export const MAX_PAYLOAD_BYTES = 4096
// Canal Android créé par l'app (NAR-179) ; importance haute.
export const ANDROID_CHANNEL = 'alertes'

const TEXTS = {
  message: {
    mg: (n) => ({ title: `Nandefa hafatra i ${n}`, body: 'Sokafy ny Akaiky hamakiana azy.' }),
    fr: (n) => ({ title: `${n} a envoyé un message`, body: 'Ouvrez Akaiky pour le lire.' }),
    en: (n) => ({ title: `${n} sent a message`, body: 'Open Akaiky to read it.' })
  },
  test: {
    mg: () => ({ title: 'Fampandrenesana andrana', body: 'Mandeha amin’ity finday ity ny fampandrenesana.' }),
    fr: () => ({ title: 'Notification de test', body: 'Les notifications fonctionnent sur ce téléphone.' }),
    en: () => ({ title: 'Test notification', body: 'Notifications work on this phone.' })
  }
}
// Événements silencieux (réveil du téléphone de l'enfant) : aucune partie `notification`.
const DATA_EVENTS = new Set(['config'])
export const EVENTS = new Set([...Object.keys(TEXTS), ...DATA_EVENTS])
export const kindOf = (event) => DATA_EVENTS.has(event) ? 'data' : 'notification'

// Prénom affiché : une ligne, 40 caractères au plus (le titre reste court sur l'écran verrouillé).
const shortName = (name) => [...String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, 40).join('') || '…'

// Message FCM HTTP v1 (`message` de projects.messages.send), sans le jeton : ajouté par l'expéditeur.
export function buildPayload({ event, ref, lang, name }) {
  if (!EVENTS.has(event)) throw new Error(`Événement push inconnu : ${event}`)
  const data = { type: event, ...(ref ? { id: String(ref) } : {}) }
  let message
  if (DATA_EVENTS.has(event)) {
    message = {
      data,
      android: { priority: 'high' },
      apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' }, payload: { aps: { 'content-available': 1 } } }
    }
  } else {
    const text = TEXTS[event][LANGS.includes(lang) ? lang : 'mg'](shortName(name))
    message = {
      notification: { title: text.title, body: text.body },
      data,
      android: { priority: 'high', notification: { channel_id: ANDROID_CHANNEL } },
      apns: { headers: { 'apns-push-type': 'alert', 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } }
    }
  }
  // Marge pour le jeton (4 Ko au plus pour FCM et APNs).
  if (Buffer.byteLength(JSON.stringify(message)) > MAX_PAYLOAD_BYTES - 512) throw new Error('Notification trop volumineuse')
  return message
}
