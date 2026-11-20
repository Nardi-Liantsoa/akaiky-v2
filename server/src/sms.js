// Envoi de SMS d'authentification (NAR-136). Interface : `send({ to, text })`, `to` en E.164,
// `available` faux quand aucun fournisseur n'est configuré (les routes qui envoient répondent
// alors 503 avant toute lecture de compte : la réponse ne dépend pas du numéro).
// Fournisseur réel : ticket à part. Ici :
//   - fake : développement et tests. Messages gardés en mémoire (`sent`) et, si SMS_OUTBOX est
//     donné, une ligne JSON par SMS dans ce fichier (comme MAIL_OUTBOX, relu par la recette).
//     Refusé en production par la config, et ici une seconde fois.
//   - none : aucun envoi.
// Aucun texte de SMS n'est jamais écrit dans les journaux : il porte le code.
import { appendFileSync } from 'node:fs'

export function createSms(config) {
  const { provider, outbox } = config.sms
  if (provider === 'none') return { available: false, async send() { throw new Error('Aucun fournisseur SMS configuré') } }
  if (provider !== 'fake') throw new Error(`SMS_PROVIDER inconnu : ${provider}`)
  if (config.production) throw new Error('SMS_PROVIDER=fake interdit en production')
  const sent = []
  return {
    available: true,
    sent,
    async send({ to, text }) {
      sent.push({ to, text })
      if (sent.length > 100) sent.shift()
      if (outbox) appendFileSync(outbox, JSON.stringify({ to, text, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
    }
  }
}

export const SMS_LANGS = ['mg', 'fr', 'en']
export const smsLang = (v) => SMS_LANGS.includes(v) ? v : 'mg'

// Textes en GSM 7 bits (un seul SMS, 160 caractères au plus : apostrophe droite, sans « ’ »
// ni accent hors de l'alphabet GSM), sans aucune donnée du compte (ni nom, ni numéro) :
// seulement le nom de l'app et le code.
export function smsTexts(appName) {
  return {
    confirm: (code, lang) => ({
      mg: `${appName}: ny kaody fanamarinana anao dia ${code}. Manan-kery 5 minitra. Aza omena olona io. Raha tsy ianao no nangataka dia aza raharahiana.`,
      fr: `${appName} : votre code de confirmation est ${code}. Valable 5 minutes. Ne le donnez a personne. Si vous n'avez rien demande, ignorez ce message.`,
      en: `${appName}: your confirmation code is ${code}. Valid for 5 minutes. Do not share it. If you did not ask for it, ignore this message.`
    })[smsLang(lang)],
    // Réinitialisation du mot de passe (NAR-201).
    reset: (code, lang) => ({
      mg: `${appName}: ny kaody hanovana ny tenimiafinao dia ${code}. Manan-kery 5 minitra. Aza omena olona io. Raha tsy ianao no nangataka dia aza raharahiana.`,
      fr: `${appName} : votre code pour changer de mot de passe est ${code}. Valable 5 minutes. Ne le donnez a personne. Si vous n'avez rien demande, ignorez ce message.`,
      en: `${appName}: your password reset code is ${code}. Valid for 5 minutes. Do not share it. If you did not ask for it, ignore this message.`
    })[smsLang(lang)],
    passwordChanged: (lang) => ({
      mg: `${appName}: novaina ny tenimiafin'ny kaontinao. Raha tsy ianao no nanova azy dia mangataha kaody vaovao avy hatrany hanovana azy indray.`,
      fr: `${appName} : le mot de passe de votre compte vient d'etre modifie. Si ce n'est pas vous, demandez tout de suite un nouveau code pour le changer.`,
      en: `${appName}: your account password was just changed. If this was not you, request a new code right away to change it again.`
    })[smsLang(lang)],
    alreadyRegistered: (lang) => ({
      mg: `${appName}: nisy nangataka hisoratra anarana tamin'ity laharana ity, nefa efa manana kaonty izy. Raha tsy ianao dia aza raharahiana.`,
      fr: `${appName} : une inscription a ete demandee avec ce numero, qui a deja un compte. Connectez-vous avec votre mot de passe. Sinon, ignorez ce message.`,
      en: `${appName}: someone tried to sign up with this number, which already has an account. Log in with your password. Otherwise, ignore this message.`
    })[smsLang(lang)]
  }
}
