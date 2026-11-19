import type { AkaikyUpdatePlugin } from '../native/akaikyUpdate'

// Mise à jour de l'app enfant (NAR-170) : version annoncée par /api/device/config (`apk`),
// installée par le natif, qui revérifie tout (fichier, paquet, version, certificat, appel en cours).
// Ici, seulement QUAND essayer : version plus récente, téléphone au repos (aucun SOS), et au plus
// une tentative toutes les 6 heures (tout réseau : la tentative est bornée, pas le réseau).
export interface ApkInfo { versionCode: number, url: string, sha256: string }

export const RETRY_MS = 6 * 60 * 60 * 1000

// https, ou http://127.0.0.1:<port>/ (test par `adb reverse`) que seul le natif debug accepte.
export function validApk(v: unknown): v is ApkInfo {
  const a = v as ApkInfo | null
  return !!a && typeof a === 'object' && Number.isSafeInteger(a.versionCode) && a.versionCode > 0
    && typeof a.url === 'string' && /^(https:\/\/|http:\/\/127\.0\.0\.1:\d+\/)/.test(a.url)
    && typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(a.sha256)
}

export function shouldInstall({ apk, installed, lastAttemptAt, now, busy }: {
  apk: unknown, installed: number, lastAttemptAt?: number, now: number, busy: boolean
}): boolean {
  if (busy || !validApk(apk) || apk.versionCode <= installed) return false
  // Dernière tentative dans le futur (horloge reculée) : ne bloque pas indéfiniment.
  if (lastAttemptAt !== undefined && lastAttemptAt <= now && now - lastAttemptAt < RETRY_MS) return false
  return true
}

export function createApkUpdater({ plugin, busy, now = () => Date.now() }: {
  plugin: Pick<AkaikyUpdatePlugin, 'status' | 'install'>, busy: () => boolean, now?: () => number
}) {
  let checking = false
  return {
    // À chaque configuration reçue et à chaque retour au premier plan. Jamais d'erreur levée :
    // un refus du natif (SOS, appel, fichier refusé) attend la tentative suivante.
    async check(apk: unknown): Promise<boolean> {
      if (checking || busy() || !validApk(apk)) return false
      checking = true
      try {
        const s = await plugin.status()
        if (s.running || !shouldInstall({ apk, installed: s.versionCode, lastAttemptAt: s.lastAttemptAt, now: now(), busy: busy() })) return false
        await plugin.install({ url: apk.url, sha256: apk.sha256.toLowerCase(), versionCode: apk.versionCode })
        return true
      } catch {
        return false
      } finally {
        checking = false
      }
    }
  }
}
