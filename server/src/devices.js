import { newToken, tokenHash } from './security.js'
import { readAuthCookie, authCookie } from './auth-cookies.js'
export async function recognizedDevice(db, req, config, email) {
 const token = readAuthCookie(req, config, 'device')
 if (!token) return null
 return (await db.query(`SELECT d.id FROM trusted_devices d JOIN users u ON u.id=d.user_id
 WHERE d.token_hash=$1 AND d.expires_at>now() AND u.email=$2`, [tokenHash(token),email])).rows[0]?.id || null
}
export async function rememberDevice(conn, req, reply, config, userId, deviceId, remember) {
 if (!remember && !deviceId) return
 const {token,hash} = newToken()
 // Sérialise également le plafond des dix appareils par compte.
 await conn.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
 let id
 if (deviceId) id = (await conn.query(`UPDATE trusted_devices SET token_hash=$2,last_used_at=now(),failures=0,next_attempt_at=now()
 WHERE id=$1 AND user_id=$3 AND expires_at>now() RETURNING id`, [deviceId,hash,userId])).rows[0]?.id
 if (!id && remember) {
  await conn.query(`DELETE FROM trusted_devices WHERE user_id=$1 AND (expires_at<=now() OR id IN
   (SELECT id FROM trusted_devices WHERE user_id=$1 ORDER BY last_used_at DESC OFFSET 9))`, [userId])
  const ua = req.headers['user-agent'] || ''
  const browser = /Firefox/i.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Navigateur'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'ordinateur'
  id = (await conn.query('INSERT INTO trusted_devices(user_id,token_hash,label) VALUES($1,$2,$3) RETURNING id', [userId,hash,`${browser} · ${os}`])).rows[0].id
 }
 if (id) authCookie(reply,config,'device',token,30*86400)
}
