import { describe, expect, it, vi } from 'vitest'
import { createApkUpdater, RETRY_MS, shouldInstall, validApk } from './apkUpdate'

const apk = { versionCode: 8, url: 'https://akaiky.test/downloads/akaiky-enfant.apk', sha256: 'a'.repeat(64) }
const NOW = 1_800_000_000_000

describe('shouldInstall', () => {
  it('version plus récente, au repos, jamais essayée : oui', () => {
    expect(shouldInstall({ apk, installed: 7, now: NOW, busy: false })).toBe(true)
  })
  it('même version ou plus ancienne : non', () => {
    expect(shouldInstall({ apk, installed: 8, now: NOW, busy: false })).toBe(false)
    expect(shouldInstall({ apk, installed: 9, now: NOW, busy: false })).toBe(false)
  })
  it('SOS en cours : non', () => {
    expect(shouldInstall({ apk, installed: 7, now: NOW, busy: true })).toBe(false)
  })
  it('au plus une tentative toutes les 6 heures ; horloge reculée : pas bloquée', () => {
    expect(shouldInstall({ apk, installed: 7, lastAttemptAt: NOW - RETRY_MS + 1, now: NOW, busy: false })).toBe(false)
    expect(shouldInstall({ apk, installed: 7, lastAttemptAt: NOW - RETRY_MS, now: NOW, busy: false })).toBe(true)
    expect(shouldInstall({ apk, installed: 7, lastAttemptAt: NOW + 60_000, now: NOW, busy: false })).toBe(true)
  })
  it('serveur local de test (adb reverse) : transmis, le natif release le refuse', () => {
    expect(validApk({ ...apk, url: 'http://127.0.0.1:8080/downloads/akaiky-enfant.apk' })).toBe(true)
    expect(validApk({ ...apk, url: 'http://127.0.0.1.evil.test/a.apk' })).toBe(false)
  })
  it('bloc mal formé ou absent : non', () => {
    for (const bad of [null, undefined, {}, { ...apk, url: 'http://akaiky.test/a.apk' }, { ...apk, sha256: 'x' }, { ...apk, versionCode: 1.5 }, { ...apk, versionCode: 0 }]) {
      expect(validApk(bad)).toBe(false)
      expect(shouldInstall({ apk: bad, installed: 0, now: NOW, busy: false })).toBe(false)
    }
  })
})

describe('createApkUpdater', () => {
  function setup(status: { versionCode: number, lastAttemptAt?: number, running?: boolean }, busy = false) {
    const plugin = {
      status: vi.fn(async () => ({ running: false, ...status })),
      install: vi.fn(async () => ({ committed: true }))
    }
    return { plugin, updater: createApkUpdater({ plugin, busy: () => busy, now: () => NOW }) }
  }

  it('confie au natif adresse, empreinte et version', async () => {
    const { plugin, updater } = setup({ versionCode: 7 })
    expect(await updater.check({ ...apk, sha256: 'A'.repeat(64) })).toBe(true)
    expect(plugin.install).toHaveBeenCalledWith({ url: apk.url, sha256: 'a'.repeat(64), versionCode: 8 })
  })

  it('à jour, essai récent, installation en cours ou SOS : rien', async () => {
    for (const s of [{ versionCode: 8 }, { versionCode: 7, lastAttemptAt: NOW - 1000 }, { versionCode: 7, running: true }]) {
      const { plugin, updater } = setup(s)
      expect(await updater.check(apk)).toBe(false)
      expect(plugin.install).not.toHaveBeenCalled()
    }
    const sos = setup({ versionCode: 7 }, true)
    expect(await sos.updater.check(apk)).toBe(false)
    expect(sos.plugin.status).not.toHaveBeenCalled()
  })

  it('refus du natif ou greffon absent : jamais d’erreur levée ; un seul essai à la fois', async () => {
    const { plugin, updater } = setup({ versionCode: 7 })
    plugin.install.mockRejectedValueOnce(Object.assign(new Error('refusé'), { code: 'wrong_signer' }))
    expect(await updater.check(apk)).toBe(false)
    plugin.status.mockRejectedValueOnce(new Error('not implemented'))
    expect(await updater.check(apk)).toBe(false)
    let release!: () => void
    plugin.install.mockImplementationOnce(() => new Promise((r) => { release = () => r({ committed: true }) }))
    const first = updater.check(apk)
    await vi.waitFor(() => expect(plugin.install).toHaveBeenCalledTimes(2))
    expect(await updater.check(apk)).toBe(false)
    release()
    expect(await first).toBe(true)
  })
})
