import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authEmails } from '../src/mailer.js'

// Un lien vers un domaine parqué fait classer les emails en spam : chaque email
// ne contient que le lien d'action qu'il transmet, et aucun texte libre saisi
// par le demandeur.
test('emails : seul le lien d’action, signature sans lien, dans les trois langues', () => {
  const link = 'https://app.exemple.fr/connexion#confirm=x'
  const signs = { fr: /— L’équipe Mon app$/, mg: /— Ny ekipan’i Mon app$/, en: /— The Mon app team$/ }
  const subjects = new Set()
  for (const [lang, sign] of Object.entries(signs)) {
    const emails = authEmails('Mon app')(lang)
    const all = [emails.confirm(link), emails.reset(link), emails.alreadyRegistered(link, link), emails.passwordChanged(), emails.invitation(link), emails.familyDeleted()]
    for (const m of all) {
      const urls = m.text.match(/https?:\/\/\S+/g) || []
      assert.ok(urls.every((u) => u === link), `lien inattendu dans « ${m.subject} » : ${urls}`)
      assert.match(m.text, sign)
      assert.ok(m.subject.trim() && m.text.trim())
      subjects.add(m.subject)
    }
    // Chaque lien d'action est bien dans son courriel.
    for (const m of [emails.confirm(link), emails.reset(link), emails.invitation(link)]) assert.ok(m.text.includes(link))
  }
  // 6 courriels × 3 langues, tous différents : aucune langue n'a gardé le texte d'une autre.
  assert.equal(subjects.size, 18)
  // Langue inconnue : malgache.
  assert.equal(authEmails('Mon app')('de').confirm(link).subject, authEmails('Mon app')('mg').confirm(link).subject)
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
