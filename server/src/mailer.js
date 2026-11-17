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
export function authEmails(appName) {
  const sign = `\n\n— L’équipe ${appName}`
  return {
    confirm: (link) => ({
      subject: `Confirmez votre adresse — ${appName}`,
      text: `Bonjour,\n\nPour activer votre compte, confirmez votre adresse en ouvrant ce lien (valable 24 heures) :\n\n${link}\n\nSi vous n’êtes pas à l’origine de cette inscription, ignorez simplement ce message.${sign}`
    }),
    alreadyRegistered: (loginLink, resetLink) => ({
      subject: `Vous avez déjà un compte — ${appName}`,
      text: `Bonjour,\n\nUne inscription vient d’être demandée avec votre adresse, mais vous avez déjà un compte.\n\nVous connecter : ${loginLink}\nMot de passe oublié : ${resetLink}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre compte n’a pas été modifié.${sign}`
    }),
    reset: (link) => ({
      subject: `Réinitialisation de votre mot de passe — ${appName}`,
      text: `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure, utilisable une seule fois) :\n\n${link}\n\nToutes vos sessions ouvertes seront déconnectées.\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.${sign}`
    }),
    // Ni le nom de la famille ni celui de l'invitant : textes libres saisis par un tiers.
    invitation: (link) => ({
      subject: `Invitation à rejoindre une famille — ${appName}`,
      text: `Bonjour,\n\nVous êtes invité à rejoindre une famille sur ${appName}, l’application qui relie les parents à leurs enfants.\n\nPour accepter, ouvrez ce lien (valable 7 jours, utilisable une seule fois) puis connectez-vous ou créez votre compte avec cette adresse :\n\n${link}\n\nSi vous ne vous attendiez pas à cette invitation, ignorez simplement ce message.${sign}`
    }),
    passwordChanged: () => ({
      subject: `Votre mot de passe a été modifié — ${appName}`,
      text: `Bonjour,\n\nLe mot de passe de votre compte vient d’être modifié et toutes vos sessions ont été fermées.\n\nSi vous n’êtes pas à l’origine de ce changement, prévenez-nous immédiatement.${sign}`
    })
  }
}
