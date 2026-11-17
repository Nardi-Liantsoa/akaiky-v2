import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authEmails } from '../src/mailer.js'

// Un lien vers un domaine parqué fait classer les emails en spam : chaque email
// ne contient que le lien d'action qu'il transmet, et aucun texte libre saisi
// par le demandeur.
test('emails : seul le lien d’action, signature sans lien', () => {
  const link = 'https://app.exemple.fr/connexion#confirm=x'
  const emails = authEmails('Mon app')
  for (const m of [emails.confirm(link), emails.reset(link), emails.alreadyRegistered(link, link), emails.passwordChanged()]) {
    const urls = m.text.match(/https?:\/\/\S+/g) || []
    assert.ok(urls.every((u) => u === link), `lien inattendu dans « ${m.subject} » : ${urls}`)
    assert.match(m.text, /— L’équipe Mon app$/)
  }
})

test('boîte d’envoi de recette : emails écrits dans le fichier, refusée en production', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { createMailer } = await import('../src/mailer.js')
  const { loadConfig } = await import('../src/config.js')
  const outbox = join(mkdtempSync(join(tmpdir(), 'outbox-')), 'mails.jsonl')
  const mailer = createMailer({ production: false, mail: { outbox } }, { info() {} })
  await mailer.send({ to: 'a@exemple.fr', subject: 'Confirmez', text: 'lien' })
  const [mail] = readFileSync(outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual([mail.to, mail.subject], ['a@exemple.fr', 'Confirmez'])
  assert.throws(() => loadConfig({ NODE_ENV: 'production', MAIL_OUTBOX: outbox, APP_ORIGIN: 'https://app.exemple.fr', DATABASE_URL: 'postgres://x@h/x', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), DATA_ENCRYPTION_KEY: 'cd'.repeat(32), TRUST_PROXY: '172.21.0.0/16' }), /MAIL_OUTBOX/)
})
