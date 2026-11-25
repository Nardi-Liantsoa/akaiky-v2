import nodemailer from 'nodemailer'
import { appendFileSync } from 'node:fs'

// Envoi SMTP. Sans SMTP configuré, les emails sont seulement affichés dans le
// terminal — acceptable en développement, refusé en production.
export function createMailer(config, log) {
  const { host, port, user, pass, from, replyTo, outbox } = config.mail
  // Recette automatique (MAIL_OUTBOX, refusé en production par la config) : une
  // ligne JSON par email, relue par les tests pour suivre les liens reçus.
  if (outbox) return { async send(msg) { appendFileSync(outbox, JSON.stringify({ ...msg, at: new Date().toISOString() }) + '\n') } }
  if (!host) {
    if (config.production) throw new Error('SMTP_HOST requis en production (emails de confirmation et de réinitialisation)')
    return {
      sent: [],
      async send(msg) {
        this.sent.push(msg)
        log.info({ to: msg.to, subject: msg.subject }, 'email (dev, non envoyé)')
        // Développement : le contenu (liens de confirmation/réinitialisation) dans le terminal.
        console.log(`\n──── email pour ${msg.to} — ${msg.subject}\n${msg.text}\n────\n`)
      }
    }
  }
  const transport = nodemailer.createTransport({
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    host, port, secure: port === 465, requireTLS: port !== 465,
    auth: user ? { user, pass } : undefined,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    disableFileAccess: true, disableUrlAccess: true
  })
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, replyTo, to, subject, text, disableFileAccess: true, disableUrlAccess: true })
    }
  }
}

// Emails d'authentification : aucun texte libre saisi par le demandeur (nom,
// message) n'y figure, et le seul lien est le lien d'action. Un lien de plus
// dans la signature (vers un domaine parqué, par exemple) suffit à faire
// classer le message en spam.
// Trois langues (NAR-211), choisies par la langue du compte destinataire (users.lang),
// malgache par défaut. ⚠️ Malgache à faire relire par une personne de langue maternelle (NAR-154).
// Usage : authEmails(appName)(lang).confirm(lien).
const EMAIL_LANGS = ['mg', 'fr', 'en']

function catalog(appName) {
  return {
    fr: {
      sign: `\n\n— L’équipe ${appName}`,
      confirm: (link) => [`Confirmez votre adresse — ${appName}`, `Bonjour,\n\nPour activer votre compte, confirmez votre adresse en ouvrant ce lien (valable 24 heures) :\n\n${link}\n\nSi vous n’êtes pas à l’origine de cette inscription, ignorez simplement ce message.`],
      alreadyRegistered: (loginLink, resetLink) => [`Vous avez déjà un compte — ${appName}`, `Bonjour,\n\nUne inscription vient d’être demandée avec votre adresse, mais vous avez déjà un compte.\n\nVous connecter : ${loginLink}\nMot de passe oublié : ${resetLink}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre compte n’a pas été modifié.`],
      reset: (link) => [`Réinitialisation de votre mot de passe — ${appName}`, `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure, utilisable une seule fois) :\n\n${link}\n\nToutes vos sessions ouvertes seront déconnectées.\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.`],
      // Ni le nom de la famille ni celui de l'invitant : textes libres saisis par un tiers.
      invitation: (link) => [`Invitation à rejoindre une famille — ${appName}`, `Bonjour,\n\nVous êtes invité à rejoindre une famille sur ${appName}, l’application qui relie les parents à leurs enfants.\n\nPour accepter, ouvrez ce lien (valable 7 jours, utilisable une seule fois) puis connectez-vous ou créez votre compte avec cette adresse :\n\n${link}\n\nSi vous ne vous attendiez pas à cette invitation, ignorez simplement ce message.`],
      // Ni le nom de la famille ni celui du parent principal : textes libres saisis par un tiers.
      familyDeleted: () => [`Une famille dont vous faisiez partie a été supprimée — ${appName}`, `Bonjour,\n\nLe parent principal d’une famille dont vous faisiez partie sur ${appName} vient de la supprimer. Les enfants, leurs contacts, leurs journaux et leurs messages ont été effacés, et leurs téléphones ont été déconnectés.\n\nVotre compte, lui, est conservé : vous pouvez créer une nouvelle famille ou en rejoindre une autre sur invitation.\n\nSi vous pensez qu’il s’agit d’une erreur, rapprochez-vous du parent principal de cette famille.`],
      passwordChanged: () => [`Votre mot de passe a été modifié — ${appName}`, `Bonjour,\n\nLe mot de passe de votre compte vient d’être modifié et toutes vos sessions ont été fermées.\n\nSi vous n’êtes pas à l’origine de ce changement, prévenez-nous immédiatement.`]
    },
    mg: {
      sign: `\n\n— Ny ekipan’i ${appName}`,
      confirm: (link) => [`Hamarino ny adiresinao — ${appName}`, `Manao ahoana,\n\nMba hampandehanana ny kaontinao, hamarino ny adiresinao amin’ny fanokafana ity rohy ity (manan-kery 24 ora) :\n\n${link}\n\nRaha tsy ianao no nisoratra anarana, aza raharahiana ity hafatra ity.`],
      alreadyRegistered: (loginLink, resetLink) => [`Efa manana kaonty ianao — ${appName}`, `Manao ahoana,\n\nNisy nangataka hisoratra anarana tamin’ny adiresinao, nefa efa manana kaonty ianao.\n\nHiditra : ${loginLink}\nTeny miafina hadino : ${resetLink}\n\nRaha tsy ianao no nangataka, aza raharahiana ity hafatra ity : tsy nisy niova ny kaontinao.`],
      reset: (link) => [`Fanovana ny teny miafinao — ${appName}`, `Manao ahoana,\n\nMba hisafidianana teny miafina vaovao, sokafy ity rohy ity (manan-kery 1 ora, indray mandeha ihany no azo ampiasaina) :\n\n${link}\n\nHivoaka avokoa ny fidiranao rehetra mbola misokatra.\nRaha tsy ianao no nangataka, aza raharahiana ity hafatra ity.`],
      invitation: (link) => [`Fanasana hiditra ao amin’ny fianakaviana iray — ${appName}`, `Manao ahoana,\n\nAsaina hiditra ao amin’ny fianakaviana iray ao amin’ny ${appName} ianao, ilay fampiharana mampifandray ny ray aman-dreny sy ny zanany.\n\nRaha hanaiky, sokafy ity rohy ity (manan-kery 7 andro, indray mandeha ihany no azo ampiasaina), dia midira na mamoròna kaonty amin’ity adiresy ity :\n\n${link}\n\nRaha tsy nanantena io fanasana io ianao, aza raharahiana ity hafatra ity.`],
      familyDeleted: () => [`Voafafa ny fianakaviana iray nisy anao — ${appName}`, `Manao ahoana,\n\nNofafain’ny ray aman-dreny lehibe ny fianakaviana iray nisy anao tao amin’ny ${appName}. Voafafa ny ankizy, ny mpifandray aminy, ny tantarany ary ny hafany, ary tapaka ny findainy.\n\nTsy voafafa kosa ny kaontinao : afaka mamorona fianakaviana vaovao ianao, na miditra amin’ny hafa raha asaina.\n\nRaha heverinao fa diso izany, mifandraisa amin’ny ray aman-dreny lehiben’io fianakaviana io.`],
      passwordChanged: () => [`Niova ny teny miafinao — ${appName}`, `Manao ahoana,\n\nVao niova ny teny miafin’ny kaontinao ary nakatona avokoa ny fidiranao rehetra.\n\nRaha tsy ianao no nanova azy, ampahafantaro anay avy hatrany.`]
    },
    en: {
      sign: `\n\n— The ${appName} team`,
      confirm: (link) => [`Confirm your address — ${appName}`, `Hello,\n\nTo activate your account, confirm your address by opening this link (valid for 24 hours):\n\n${link}\n\nIf you did not sign up, simply ignore this message.`],
      alreadyRegistered: (loginLink, resetLink) => [`You already have an account — ${appName}`, `Hello,\n\nSomeone just tried to sign up with your address, but you already have an account.\n\nSign in: ${loginLink}\nForgot your password: ${resetLink}\n\nIf this wasn’t you, ignore this message: your account has not been changed.`],
      reset: (link) => [`Reset your password — ${appName}`, `Hello,\n\nTo choose a new password, open this link (valid for 1 hour, single use):\n\n${link}\n\nAll your open sessions will be signed out.\nIf this wasn’t you, ignore this message.`],
      invitation: (link) => [`Invitation to join a family — ${appName}`, `Hello,\n\nYou have been invited to join a family on ${appName}, the app that connects parents with their children.\n\nTo accept, open this link (valid for 7 days, single use), then sign in or create your account with this address:\n\n${link}\n\nIf you were not expecting this invitation, simply ignore this message.`],
      familyDeleted: () => [`A family you belonged to has been deleted — ${appName}`, `Hello,\n\nThe main parent of a family you belonged to on ${appName} has just deleted it. The children, their contacts, their logs and their messages have been erased, and their phones have been disconnected.\n\nYour account is kept: you can create a new family or join another one by invitation.\n\nIf you think this is a mistake, get in touch with the main parent of that family.`],
      passwordChanged: () => [`Your password has been changed — ${appName}`, `Hello,\n\nThe password of your account has just been changed and all your sessions have been closed.\n\nIf you did not make this change, let us know right away.`]
    }
  }
}

export function authEmails(appName) {
  const texts = catalog(appName)
  return (lang) => {
    const c = texts[EMAIL_LANGS.includes(lang) ? lang : 'mg']
    const mail = (make) => (...args) => {
      const [subject, text] = make(...args)
      return { subject, text: text + c.sign }
    }
    return {
      confirm: mail(c.confirm),
      alreadyRegistered: mail(c.alreadyRegistered),
      reset: mail(c.reset),
      invitation: mail(c.invitation),
      familyDeleted: mail(c.familyDeleted),
      passwordChanged: mail(c.passwordChanged)
    }
  }
}
