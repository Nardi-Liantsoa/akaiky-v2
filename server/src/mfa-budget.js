import { HttpError } from './lib.js'
import { securityAlert } from './login-guard.js'

// Appelé sous verrou utilisateur : commun aux processus, appareils et routes.
const name = userId => `mfa-daily-failures:${userId}`
export const isRecoveryCode = code => typeof code === 'string' && /^[a-f0-9]{4}(?:-[a-f0-9]{4}){7}$/i.test(code)
export async function dailyMfaBlocked(conn, userId) {
 const row = (await conn.query('SELECT hits FROM security_quotas WHERE name=$1 AND expires_at>now()', [name(userId)])).rows[0]
 return row?.hits >= 30
}
export function dailyMfaError() {
 return {error:new HttpError(429, 'Limite quotidienne de codes atteinte. Utilisez un code de secours ou attendez la fin des 24 heures.')}
}
export async function recordMfaFailure(conn, userId) {
 const {rows:[row]} = await conn.query(`INSERT INTO security_quotas(name,hits,expires_at)
  VALUES($1,1,now()+interval '24 hours') ON CONFLICT(name) DO UPDATE SET
  hits=CASE WHEN security_quotas.expires_at<=now() THEN 1 ELSE LEAST(security_quotas.hits+1,31) END,
  expires_at=CASE WHEN security_quotas.expires_at<=now() THEN now()+interval '24 hours' ELSE security_quotas.expires_at END
  RETURNING hits`, [name(userId)])
 // Une faute de frappe ne déclenche pas Telegram. Deux seuils, pas une alerte
 // pour chaque requête rejetée après épuisement du budget.
 if (row.hits === 5 || row.hits === 30) await securityAlert(conn, 'login_attack')
}
export async function unlockDailyMfa(conn, userId) {
 // Seule une preuve forte (code de secours consommé) autorise cette remise à zéro.
 await conn.query('UPDATE security_quotas SET hits=0,expires_at=now() WHERE name=$1', [name(userId)])
}
