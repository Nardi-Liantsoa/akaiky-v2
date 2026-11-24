import { describe, expect, it, vi } from 'vitest'
import type { BundleInfo } from '@capgo/capacitor-updater'
import capacitorConfig, { apiOrigin, otaUrls, PLACEHOLDER_ORIGIN } from '../../capacitor.config.ts'
import shared from '../../tests/fixtures/ota-target-cases.json'
import { akaikyUpdateUrl, CHECK_EVERY_MS, createOtaUpdater, DOWNLOAD_TIMEOUT_MS, dueForCheck, targetFromLatest } from './otaUpdate'

// Frontière simulée : le greffon @capgo/capacitor-updater (et la coque lue par App.getInfo).
const SERVER = 'https://akaiky.example/api/ota/latest'
const SHA = 'ab'.repeat(32)
const NOW = 1_800_000_000_000
const PARENT = { appId: 'mg.nosytech.akaiky', build: '5' }
const CHILD = { appId: 'mg.nosytech.akaiky.enfant', build: '5' }

const bundle = (id: string, version: string, status: BundleInfo['status'] = 'pending', downloaded = '2026-11-20T10:00:00.000Z'): BundleInfo =>
  ({ id, version, status, downloaded, checksum: SHA })
const data = (app: string, channel = app, minNativeBuild = '3') => ({ app, channel, minNativeBuild })
// Réponse vue par le JavaScript : iOS ne garde que les champs connus (pas de `target`).
const iosLatest = (app = 'parent', extra = {}) => ({
  version: '1.0.1', url: 'https://akaiky.example/api/ota/bundles/0b9c1d4e-0000-4000-8000-000000000001', checksum: SHA, data: data(app), ...extra
})
const androidLatest = (app = 'parent', extra = {}) => ({ ...iosLatest(app), target: { app, channel: app, minNativeBuild: 3 }, ...extra })

function setup({ kind = 'parent' as 'parent' | 'enfant', latest = androidLatest() as unknown, shell = PARENT, busy = false, updateUrl = SERVER as unknown, bundles = [] as BundleInfo[], failed = null as unknown } = {}) {
  const store = new Map<string, string>()
  const state = { bundles: [bundle('builtin', 'builtin', 'success'), ...bundles] }
  const plugin = {
    getLatest: vi.fn(async () => { if (latest instanceof Error) throw latest; return latest as never }),
    download: vi.fn(async (o: { url: string, version: string, checksum?: string }) => {
      const b = bundle('dl-1', o.version)
      state.bundles.push(b)
      return b
    }),
    next: vi.fn(async ({ id }: { id: string }) => state.bundles.find((b) => b.id === id)!),
    set: vi.fn(async () => {}),
    list: vi.fn(async () => ({ bundles: [...state.bundles] })),
    delete: vi.fn(async ({ id }: { id: string }) => { state.bundles = state.bundles.filter((b) => b.id !== id) }),
    current: vi.fn(async () => ({ bundle: state.bundles[0], native: '1.0.0' })),
    getNextBundle: vi.fn(async () => null as BundleInfo | null),
    getFailedUpdate: vi.fn(async () => failed as never)
  }
  let now = NOW
  const busyFn = vi.fn(async () => busy)
  const ota = createOtaUpdater({
    plugin, kind, updateUrl, shell: async () => (kind === 'enfant' && shell === PARENT ? CHILD : shell), busy: busyFn,
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => { store.set(k, v) } }, now: () => now
  })
  return { ota, plugin, busyFn, store, state, advance: (ms: number) => { now += ms } }
}

// Écran hors de vue (App.getState().isActive faux), relu juste avant set().
const away = async () => true
const networkCalls = (p: ReturnType<typeof setup>['plugin']) => p.getLatest.mock.calls.length + p.download.mock.calls.length

describe('barrière Capgo : aucune requête tant que updateUrl n’est pas le serveur Akaiky', () => {
  it('adresse acceptée : https://<hôte>/api/ota/latest, ou 127.0.0.1 en clair (test adb reverse)', () => {
    expect(akaikyUpdateUrl(SERVER)?.origin).toBe('https://akaiky.example')
    expect(akaikyUpdateUrl('http://127.0.0.1:8099/api/ota/latest')).not.toBeNull()
  })
  it.each([
    ['vide (défaut du greffon : Capgo Cloud)', ''],
    ['absente', undefined],
    ['Capgo Cloud', 'https://plugin.capgo.app/updates'],
    ['Capgo, même chemin', 'https://plugin.capgo.app/api/ota/latest'],
    ['capgo.app nu', 'https://capgo.app/api/ota/latest'],
    ['http distant', 'http://akaiky.example/api/ota/latest'],
    ['adresse provisoire', 'https://akaiky.a-definir.invalid/api/ota/latest'],
    ['autre chemin', 'https://akaiky.example/updates'],
    ['requête', 'https://akaiky.example/api/ota/latest?x=1'],
    ['identifiants', 'https://u:p@akaiky.example/api/ota/latest'],
    ['127.0.0.1 sans port', 'http://127.0.0.1/api/ota/latest'],
    ['illisible', 'pas une adresse']
  ])('%s : refusée', (_n, url) => {
    expect(akaikyUpdateUrl(url)).toBeNull()
  })
  it('barrière fermée : le greffon n’est jamais appelé (ni getLatest, ni rien d’autre)', async () => {
    for (const updateUrl of ['', 'https://plugin.capgo.app/updates', null]) {
      for (const kind of ['parent', 'enfant'] as const) {
        const { ota, plugin } = setup({ kind, updateUrl })
        expect(await ota.check()).toBe('gate-closed')
        expect(await ota.applyStaged(away)).toBe(false)
        for (const fn of Object.values(plugin)) expect(fn).not.toHaveBeenCalled()
      }
    }
  })
  it('la constante du build est l’updateUrl de capacitor.config.ts, la source des coques', () => {
    expect(__AKAIKY_OTA_UPDATE_URL__).toBe(capacitorConfig.plugins?.CapacitorUpdater?.updateUrl ?? '')
  })
})

describe('cible : `data` sur les deux plateformes (iOS perd `target`)', () => {
  it('iOS : `data` seul suffit', () => {
    expect(targetFromLatest(iosLatest())).toEqual({ app: 'parent', channel: 'parent', minNativeBuild: 3 })
  })
  it('Android : `target` doit dire exactement la même chose que `data`', () => {
    expect(targetFromLatest(androidLatest())).toEqual({ app: 'parent', channel: 'parent', minNativeBuild: 3 })
    expect(targetFromLatest(androidLatest('parent', { target: { app: 'enfant', channel: 'parent', minNativeBuild: 3 } }))).toBeNull()
    expect(targetFromLatest(androidLatest('parent', { target: { app: 'parent', channel: 'parent', minNativeBuild: 1 } }))).toBeNull()
    expect(targetFromLatest(androidLatest('parent', { target: null }))).toBeNull()
  })
  it('sans `data` (target seul, ou rien) : aucune cible, échoue fermé', () => {
    expect(targetFromLatest({ ...androidLatest(), data: undefined })).toBeNull()
    expect(targetFromLatest({ version: '1', url: 'x' })).toBeNull()
  })
  it('iOS, parent : bundle parent téléchargé avec son empreinte, puis next()', async () => {
    const { ota, plugin } = setup({ latest: iosLatest() })
    expect(await ota.check()).toBe('staged')
    expect(plugin.download).toHaveBeenCalledWith({ url: iosLatest().url, version: '1.0.1', checksum: SHA })
    expect(plugin.next).toHaveBeenCalledWith({ id: 'dl-1' })
    expect(plugin.set).not.toHaveBeenCalled()
  })
  it('iOS : réponse sans `data` jamais téléchargée', async () => {
    const { ota, plugin } = setup({ latest: { ...iosLatest(), data: undefined } })
    expect(await ota.check()).toBe('refused:invalid')
    expect(plugin.download).not.toHaveBeenCalled()
  })
})

describe('un bundle refusé par otaVerdict n’est jamais téléchargé', () => {
  it.each([
    ['bundle enfant à l’app parent', 'parent', androidLatest('enfant'), PARENT, 'refused:wrong-app'],
    ['bundle parent à l’app enfant', 'enfant', androidLatest('parent'), CHILD, 'refused:wrong-app'],
    ['canal d’une autre app', 'parent', { ...iosLatest(), data: data('parent', 'enfant') }, PARENT, 'refused:wrong-channel'],
    ['coque trop ancienne', 'parent', { ...iosLatest(), data: data('parent', 'parent', '9') }, PARENT, 'refused:native-too-old'],
    ['coque illisible', 'parent', androidLatest(), { appId: '', build: '' }, 'refused:unknown-shell'],
    ['cible incohérente (Android)', 'parent', androidLatest('parent', { target: { app: 'enfant', channel: 'enfant', minNativeBuild: 1 } }), PARENT, 'refused:invalid']
  ] as const)('%s', async (_n, kind, latest, shell, outcome) => {
    const { ota, plugin } = setup({ kind, latest, shell })
    expect(await ota.check()).toBe(outcome)
    expect(plugin.download).not.toHaveBeenCalled()
    expect(plugin.next).not.toHaveBeenCalled()
    expect(plugin.set).not.toHaveBeenCalled()
  })
  it.each([
    ['empreinte absente', { checksum: undefined }],
    ['empreinte en majuscules (le greffon Android compare à l’identique)', { checksum: SHA.toUpperCase() }],
    ['empreinte trop courte', { checksum: 'ab' }],
    ['zip d’un autre serveur', { url: 'https://evil.example/api/ota/bundles/x' }],
    ['zip hors /api/ota/bundles', { url: 'https://akaiky.example/downloads/x.zip' }],
    ['version mal formée', { version: '../x' }]
  ])('réponse douteuse (%s) : rien n’est téléchargé', async (_n, extra) => {
    const { ota, plugin } = setup({ latest: androidLatest('parent', extra) })
    expect(await ota.check()).toBe('bad-response')
    expect(plugin.download).not.toHaveBeenCalled()
  })
})

describe('empreinte et installation', () => {
  it('SHA-256 qui ne correspond pas : le greffon rejette le téléchargement, rien n’est installé', async () => {
    const { ota, plugin } = setup()
    plugin.download.mockRejectedValueOnce(new Error('Checksum failed'))
    expect(await ota.check()).toBe('download-failed')
    expect(plugin.next).not.toHaveBeenCalled()
    expect(plugin.set).not.toHaveBeenCalled()
  })
  it('téléchargement sans fin (greffon Android sans délai) : abandonné, verrou rendu, zip tardif repris', async () => {
    vi.useFakeTimers()
    try {
      const { ota, plugin, state } = setup({ kind: 'enfant', latest: androidLatest('enfant') })
      plugin.download.mockImplementationOnce(() => new Promise(() => {}))
      const checking = ota.check()
      await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS)
      expect(await checking).toBe('download-failed')
      state.bundles.push(bundle('late', '1.0.1'))
      expect(await ota.applyStaged(away)).toBe(true)
      expect(plugin.set).toHaveBeenCalledWith({ id: 'late' })
    } finally { vi.useRealTimers() }
  })
  it('app enfant : un bundle « success » qui n’est pas l’actuel n’est pas repris (applyStaged ne l’installerait pas)', async () => {
    const { ota, plugin } = setup({ kind: 'enfant', latest: androidLatest('enfant'), bundles: [bundle('old', '1.0.1', 'success')] })
    expect(await ota.check()).toBe('staged')
    expect(plugin.download).toHaveBeenCalledTimes(1)
    expect(plugin.delete).toHaveBeenCalledWith({ id: 'old' })
    expect(await ota.applyStaged(away)).toBe(true)
    expect(plugin.set).toHaveBeenCalledWith({ id: 'dl-1' })
  })
  it('bundle rendu en erreur : rien n’est installé', async () => {
    const { ota, plugin } = setup()
    plugin.download.mockResolvedValueOnce(bundle('dl-x', '1.0.1', 'error'))
    expect(await ota.check()).toBe('download-failed')
    expect(plugin.next).not.toHaveBeenCalled()
  })
  it('pas de nouvelle version (le greffon rejette ou rend sans url) : rien', async () => {
    for (const latest of [new Error('no_new_version_available'), { version: 'builtin', error: 'no_new_version_available' }]) {
      const { ota, plugin } = setup({ latest })
      expect(await ota.check()).toBe('up-to-date')
      expect(plugin.download).not.toHaveBeenCalled()
    }
  })
  it('version déjà active : rien', async () => {
    const { ota, plugin } = setup({ latest: { ...androidLatest(), version: 'builtin' } })
    expect(await ota.check()).toBe('up-to-date')
    expect(plugin.download).not.toHaveBeenCalled()
  })
  it('déjà téléchargée : reprise sans nouveau téléchargement', async () => {
    const { ota, plugin } = setup({ bundles: [bundle('old', '1.0.1')] })
    expect(await ota.check()).toBe('staged')
    expect(plugin.download).not.toHaveBeenCalled()
    expect(plugin.next).toHaveBeenCalledWith({ id: 'old' })
  })
  it('version annulée par le greffon (notifyAppReady absent) : plus jamais retéléchargée', async () => {
    const first = setup({ failed: { bundle: bundle('bad', '1.0.1', 'error') } })
    expect(await first.ota.check()).toBe('failed-before')
    expect(first.plugin.download).not.toHaveBeenCalled()
    // Mémorisée : même après que le greffon a effacé le bundle et oublié l'échec.
    first.plugin.getFailedUpdate.mockResolvedValue(null as never)
    first.advance(CHECK_EVERY_MS)
    expect(await first.ota.check()).toBe('failed-before')
  })
  it('téléchargement raté (bundle « error » laissé par le greffon) : retenté, jamais pris pour une annulation', async () => {
    const { ota, plugin, store } = setup({ bundles: [bundle('partial', '1.0.1', 'error')] })
    expect(await ota.check()).toBe('staged')
    expect(plugin.download).toHaveBeenCalledWith({ url: androidLatest().url, version: '1.0.1', checksum: SHA })
    expect(plugin.delete).toHaveBeenCalledWith({ id: 'partial' })
    expect(store.get('akaiky.ota.failedVersions') ?? '[]').toBe('[]')
  })
  it('nettoyage : seuls l’actuel et celui qui attend restent', async () => {
    const { ota, plugin, state } = setup({ bundles: [bundle('stale', '1.0.0'), bundle('broken', '0.9.0', 'error')] })
    expect(await ota.check()).toBe('staged')
    expect(plugin.delete.mock.calls.map(([o]) => o.id).sort()).toEqual(['broken', 'stale'])
    expect(state.bundles.map((b) => b.id)).toEqual(['builtin', 'dl-1'])
  })
  it('sans nouvelle version : les restes sont effacés, le bundle qui attend (next) est gardé', async () => {
    const { ota, plugin } = setup({ latest: new Error('no_new_version_available'), bundles: [bundle('next', '1.0.1'), bundle('stale', '1.0.0')] })
    plugin.getNextBundle.mockResolvedValue(bundle('next', '1.0.1'))
    expect(await ota.check()).toBe('up-to-date')
    expect(plugin.delete.mock.calls.map(([o]) => o.id)).toEqual(['stale'])
  })
})

describe('au plus une vérification toutes les 6 heures', () => {
  it('dueForCheck : jamais, 6 h passées, horloge reculée', () => {
    expect(dueForCheck(null, NOW)).toBe(true)
    expect(dueForCheck(NOW - CHECK_EVERY_MS + 1, NOW)).toBe(false)
    expect(dueForCheck(NOW - CHECK_EVERY_MS, NOW)).toBe(true)
    expect(dueForCheck(NOW + 60_000, NOW)).toBe(true)
  })
  it('deuxième lancement dans les 6 h : aucune requête ; échec compris', async () => {
    const { ota, plugin, advance } = setup({ latest: new Error('réseau') })
    await ota.check()
    advance(CHECK_EVERY_MS - 1)
    expect(await ota.check()).toBe('throttled')
    expect(plugin.getLatest).toHaveBeenCalledTimes(1)
    advance(1)
    await ota.check()
    expect(plugin.getLatest).toHaveBeenCalledTimes(2)
  })
})

describe('app enfant : seulement au repos (aucun appel, aucun SOS)', () => {
  it('appel ou SOS en cours : ni vérification, ni téléchargement, et la tentative n’est pas consommée', async () => {
    const { ota, plugin, busyFn } = setup({ kind: 'enfant', latest: androidLatest('enfant'), busy: true })
    expect(await ota.check()).toBe('busy')
    expect(networkCalls(plugin)).toBe(0)
    busyFn.mockResolvedValue(false)
    expect(await ota.check()).toBe('staged')
  })
  it('état illisible (rejet) : occupé', async () => {
    const { ota, plugin, busyFn } = setup({ kind: 'enfant', latest: androidLatest('enfant') })
    busyFn.mockRejectedValue(new Error('not implemented'))
    expect(await ota.check()).toBe('busy')
    expect(networkCalls(plugin)).toBe(0)
  })
  it('appel commencé pendant la vérification : pas de téléchargement', async () => {
    const { ota, plugin, busyFn } = setup({ kind: 'enfant', latest: androidLatest('enfant') })
    busyFn.mockResolvedValueOnce(false).mockResolvedValue(true)
    expect(await ota.check()).toBe('busy')
    expect(plugin.download).not.toHaveBeenCalled()
  })
  it('téléchargé, jamais next() (le greffon l’installerait à l’écran d’appel)', async () => {
    const { ota, plugin } = setup({ kind: 'enfant', latest: androidLatest('enfant') })
    expect(await ota.check()).toBe('staged')
    expect(plugin.next).not.toHaveBeenCalled()
    expect(plugin.set).not.toHaveBeenCalled()
  })
  it('installé par set() au repos seulement', async () => {
    const idle = setup({ kind: 'enfant', bundles: [bundle('older', '1.0.0', 'pending', '2026-11-19T00:00:00Z'), bundle('newer', '1.0.1', 'pending', '2026-11-20T00:00:00Z')] })
    expect(await idle.ota.applyStaged(away)).toBe(true)
    expect(idle.plugin.set).toHaveBeenCalledWith({ id: 'newer' })

    const busy = setup({ kind: 'enfant', busy: true, bundles: [bundle('newer', '1.0.1')] })
    expect(await busy.ota.applyStaged(away)).toBe(false)
    expect(busy.plugin.set).not.toHaveBeenCalled()

    // Appel commencé entre la lecture de la liste et l'installation.
    const late = setup({ kind: 'enfant', bundles: [bundle('newer', '1.0.1')] })
    late.busyFn.mockResolvedValueOnce(false).mockResolvedValue(true)
    expect(await late.ota.applyStaged(away)).toBe(false)
    expect(late.plugin.set).not.toHaveBeenCalled()
  })
  it('revenu au premier plan juste avant set() : rien n’est installé', async () => {
    const { ota, plugin } = setup({ kind: 'enfant', bundles: [bundle('newer', '1.0.1')] })
    expect(await ota.applyStaged(async () => false)).toBe(false)
    expect(await ota.applyStaged(async () => { throw new Error('illisible') })).toBe(false)
    expect(plugin.set).not.toHaveBeenCalled()
  })
  it('jamais pendant une vérification, et inversement', async () => {
    const { ota, plugin } = setup({ kind: 'enfant', latest: androidLatest('enfant'), bundles: [bundle('newer', '1.0.0')] })
    let release!: () => void
    plugin.getLatest.mockImplementationOnce(() => new Promise((r) => { release = () => r(androidLatest('enfant') as never) }))
    const checking = ota.check()
    await vi.waitFor(() => expect(plugin.getLatest).toHaveBeenCalled())
    expect(await ota.applyStaged(away)).toBe(false)
    release()
    expect(await checking).toBe('staged')
    expect(plugin.set).not.toHaveBeenCalled()
  })
  it('rien en attente, ou version annulée : rien', async () => {
    expect(await setup({ kind: 'enfant' }).ota.applyStaged(away)).toBe(false)
    const failed = setup({ kind: 'enfant', bundles: [bundle('b', '1.0.1')], failed: { bundle: bundle('b', '1.0.1', 'error') } })
    expect(await failed.ota.applyStaged(away)).toBe(false)
    expect(failed.plugin.set).not.toHaveBeenCalled()
  })
  it('app parent : jamais set() (next() suffit, installé par le greffon en arrière-plan)', async () => {
    const { ota, plugin } = setup({ bundles: [bundle('b', '1.0.1')] })
    expect(await ota.applyStaged(away)).toBe(false)
    expect(plugin.set).not.toHaveBeenCalled()
  })
  it('app parent : jamais bloquée par l’état « occupé »', async () => {
    const { ota } = setup({ busy: true })
    expect(await ota.check()).toBe('staged')
  })
})

describe('coques : serveur OTA Akaiky (NAR-190)', () => {
  const updater = capacitorConfig.plugins?.CapacitorUpdater as Record<string, unknown>
  it('updateUrl et channelUrl : la même origine que l’API du bundle, aux chemins du serveur', () => {
    const origin = apiOrigin()
    expect(updater.updateUrl).toBe(`${origin}${shared.server.updatePath}`)
    expect(updater.channelUrl).toBe(`${origin}${shared.server.channelPath}`)
    expect(updater.statsUrl).toBe('')
  })
  it('le JavaScript ne peut ni changer ni garder une autre adresse, ni viser une autre app', () => {
    expect(updater).toMatchObject({ allowModifyUrl: false, persistModifyUrl: false, allowPreview: false, allowHttpsToHttpRedirect: false })
    expect(updater).not.toHaveProperty('localApi')
  })
  it('origine : celle que lit Vite (VITE_API_ORIGIN), sinon l’adresse provisoire', () => {
    expect(apiOrigin({ VITE_API_ORIGIN: 'https://env.example' })).toBe('https://env.example')
    expect(apiOrigin({})).toBe(PLACEHOLDER_ORIGIN)
  })
  it('origine canonique ; http accepté au chargement (le build Android tranche) ; chemin, identifiants ou Capgo refusés', () => {
    expect(otaUrls('https://akaiky.example:8443')).toEqual({
      updateUrl: 'https://akaiky.example:8443/api/ota/latest', channelUrl: 'https://akaiky.example:8443/api/ota/channel', httpsOnly: true
    })
    expect(otaUrls('HTTPS://Akaiky.Example').updateUrl).toBe('https://akaiky.example/api/ota/latest')
    expect(otaUrls('HTTPS://Akaiky.Example').httpsOnly).toBe(true)
    expect(otaUrls('http://192.168.1.20:8787').httpsOnly).toBe(false)
    for (const bad of ['https://akaiky.example/', 'https://akaiky.example/api', 'https://u:p@akaiky.example', 'https://akaiky.example?x=1',
      'https://plugin.capgo.app', 'https://capgo.app', 'ftp://x', '', 'akaiky.example']) {
      expect(() => otaUrls(bad), bad).toThrow()
    }
  })
})
