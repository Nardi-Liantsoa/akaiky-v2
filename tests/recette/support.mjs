// Outils des tests de recette : vrai serveur, vraie base, emails lus dans la
// boîte d'envoi (MAIL_OUTBOX). Chaque test crée ses propres comptes : les tests
// sont indépendants et tournent en parallèle.
import { test as base, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createPool } from '../../server/src/db.js'
import { state } from './env.mjs'

export { expect }
export const PASSWORD = 'cheval batterie agrafe correcte'

let counter = 0
export const uniqueEmail = (label = 'client') =>
  `${label}.${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}@recette.test`

// Emails écrits par le serveur, du plus ancien au plus récent.
export function mails(to) {
  return readFileSync(state().outbox, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => !to || m.to === to)
}
// Attend un email dont le sujet correspond (le serveur envoie en arrière-plan).
export async function mailFor(to, subject) {
  let found
  await expect.poll(() => (found = mails(to).findLast((m) => subject.test(m.subject))), { message: `email « ${subject} » pour ${to}`, timeout: 10000 }).toBeTruthy()
  return found
}
// Lien d'action reçu par email (ex. /connexion#confirm=…), ramené à son chemin.
export const linkIn = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).href.replace(/^https?:\/\/[^/]+/, '')

// Actions d'exploitation (rôle admin, invitation MFA) : compte propriétaire,
// comme l'opérateur sur le serveur. Jamais pour vérifier le produit.
export async function asOwner(fn) {
  const db = createPool(state().ownerUrl)
  try { return await fn(db) } finally { await db.end() }
}

// Requête d'API depuis le navigateur du test : mêmes cookies, en-tête
// anti-CSRF du starter (x-app). Sert à préparer, jamais à vérifier un parcours.
export const api = (page, method, path, data) => page.request.fetch(`/api${path}`, {
  method, data, headers: { origin: state().origin, 'x-app': '1' }
})

// Compte confirmé et connecté dans le contexte de la page, par l'API : le
// parcours d'inscription lui-même est testé par son critère.
export async function newClient(page, { name = 'Client Recette' } = {}) {
  const email = uniqueEmail()
  expect((await api(page, 'POST', '/auth/register', { name, email, password: PASSWORD })).status()).toBeLessThan(300)
  const token = /#confirm=([A-Za-z0-9_-]+)/.exec((await mailFor(email, /Confirmez/)).text)[1]
  expect((await api(page, 'POST', '/auth/confirm', { token })).ok()).toBe(true)
  expect((await api(page, 'POST', '/auth/login', { email, password: PASSWORD })).ok()).toBe(true)
  return { email, name }
}

// Garde-fous de chaque page (critère C90) : aucune erreur JavaScript, aucun
// appel hors du site.
export const test = base.extend({
  guard: [async ({ page }, use) => {
    const errors = [], outside = []
    const { origin } = state()
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u) })
    await use({ errors, outside })
    expect(errors, 'erreurs JavaScript').toEqual([])
    expect(outside, 'appels vers un service tiers').toEqual([])
  }, { auto: true }]
})
