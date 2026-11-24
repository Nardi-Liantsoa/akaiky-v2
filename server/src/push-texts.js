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
  // État du téléphone (NAR-147) : `id` = l'enfant ; l'app ouvre son accueil.
  battery_low: {
    mg: (n) => ({ title: `Efa ho lany ny bateria-n’ny findain’i ${n}`, body: 'Sokafy ny Akaiky hijerena ny toetry ny findainy.' }),
    fr: (n) => ({ title: `Batterie faible : téléphone de ${n}`, body: 'Ouvrez Akaiky pour voir son état.' }),
    en: (n) => ({ title: `${n}’s phone battery is low`, body: 'Open Akaiky to check it.' })
  },
  sim_absent: {
    mg: (n) => ({ title: `Tsy misy karatra SIM ny findain’i ${n}`, body: 'Sokafy ny Akaiky hijerena ny toetry ny findainy.' }),
    fr: (n) => ({ title: `Carte SIM absente : téléphone de ${n}`, body: 'Ouvrez Akaiky pour voir son état.' }),
    en: (n) => ({ title: `No SIM card in ${n}’s phone`, body: 'Open Akaiky to check it.' })
  },
  silent: {
    mg: (n) => ({ title: `Tsy mamaly intsony ny findain’i ${n}`, body: 'Tsy nisy famantarana nandritra ny adiny iray mahery.' }),
    fr: (n) => ({ title: `Le téléphone de ${n} ne répond plus`, body: 'Aucun signal depuis plus d’une heure.' }),
    en: (n) => ({ title: `${n}’s phone is not responding`, body: 'No signal for more than an hour.' })
  },
  test: {
    mg: () => ({ title: 'Fampandrenesana andrana', body: 'Mandeha amin’ity finday ity ny fampandrenesana.' }),
    fr: () => ({ title: 'Notification de test', body: 'Les notifications fonctionnent sur ce téléphone.' }),
    en: () => ({ title: 'Test notification', body: 'Notifications work on this phone.' })
  }
}
// Événements silencieux (réveil du téléphone de l'enfant) : aucune partie `notification`.
// `locate` (NAR-203) : un membre demande la position ; `id` = l'enfant, jamais de position.
const DATA_EVENTS = new Set(['config', 'locate'])
// Événements dont `ref` est l'enfant (prénom lu sur l'enfant, NAR-147).
export const CHILD_EVENTS = new Set(['battery_low', 'sim_absent', 'silent'])
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
