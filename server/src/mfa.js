import { HttpError, audit } from './lib.js'
import { newToken, tokenHash, createLimiter, rateLimitKey } from './security.js'
import { readAuthCookie, authCookie } from './auth-cookies.js'
import { newSecret, seal, unseal, checkTotp, recoveryCodes } from './totp.js'
import { isRecoveryCode, dailyMfaBlocked, dailyMfaError, recordMfaFailure, unlockDailyMfa } from './mfa-budget.js'

export function createMfa(app, finishLogin) {
 const {db,config}=app
 const ipLimit=createLimiter({max:30,windowMs:15*60*1000})
 async function begin(conn,req,reply,user,deviceId,remember) {
  const {token,hash}=newToken()
  await conn.query('DELETE FROM mfa_challenges WHERE expires_at<=now()')
  // Borné par compte ; ne pas supprimer un défi valide d'un autre navigateur.
  const n=Number((await conn.query('SELECT count(*) FROM mfa_challenges WHERE user_id=$1 AND device_id IS NOT DISTINCT FROM $2::uuid',[user.id,deviceId])).rows[0].count)
  if(n>=20) throw new HttpError(429,'Trop de connexions en cours. Réessayez dans cinq minutes.')
  await conn.query('INSERT INTO mfa_challenges(token_hash,user_id,device_id,remember) VALUES($1,$2,$3,$4)',[hash,user.id,deviceId,remember])
  authCookie(reply,config,'challenge',token,300)
  const enrolled=!!(await conn.query('SELECT user_id FROM mfa_factors WHERE user_id=$1',[user.id])).rows[0]
  return {mfaRequired:true,enrollmentRequired:!enrolled}
 }
 async function transaction(req,fn,{allowRecovery=false}={}) {
  if(!ipLimit(rateLimitKey(req.ip))) throw new HttpError(429,'Trop de tentatives. Réessayez plus tard.')
  const token=readAuthCookie(req,config,'challenge')
  if(!token) throw new HttpError(401,'Connexion expirée. Saisissez à nouveau votre mot de passe.')
  const conn=await db.connect()
  try {
   await conn.query('BEGIN')
   const owner=(await conn.query('SELECT user_id FROM mfa_challenges WHERE token_hash=$1',[tokenHash(token)])).rows[0]
   if(owner) await conn.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[owner.user_id])
   const c=(await conn.query('SELECT * FROM mfa_challenges WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[tokenHash(token)])).rows[0]
   const recovering=allowRecovery && isRecoveryCode(req.body?.code)
   if(!c||(c.attempts>=10 && !recovering)) throw new HttpError(401,'Connexion expirée. Saisissez à nouveau votre mot de passe.')
   // Compte + appareil, persistant et indépendant des IP / nouveaux défis.
   const key=`mfa:${c.user_id}:${c.device_id || 'unknown'}`
   const q=(await conn.query(`INSERT INTO security_quotas(name,hits,expires_at) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(name) DO UPDATE SET hits=CASE WHEN security_quotas.expires_at<=now() THEN 1 ELSE LEAST(security_quotas.hits+1,1000) END,
    expires_at=CASE WHEN security_quotas.expires_at<=now() THEN now()+interval '15 minutes' ELSE security_quotas.expires_at END RETURNING hits`,[key])).rows[0]
   let result
   if(q.hits>10 && !recovering) { result={error:new HttpError(429,'Trop de codes essayés. Réessayez dans quinze minutes.')} }
   else { await conn.query('UPDATE mfa_challenges SET attempts=LEAST(attempts+1,1000) WHERE token_hash=$1',[c.token_hash]); result=await fn(conn,c) }
   await conn.query('COMMIT')
   if(result?.error) throw result.error
   return result
  } catch(e) { await conn.query('ROLLBACK');throw e } finally {conn.release()}
 }
 const invalid=()=>({error:new HttpError(401,'Code invalide ou déjà utilisé.')})
 async function factorCode(conn,userId,code) {
  const factor=(await conn.query('SELECT * FROM mfa_factors WHERE user_id=$1 FOR UPDATE',[userId])).rows[0]
  if(!factor) return invalid()
  // Les secours aléatoires de 128 bits gardent une voie de récupération même
  // lorsque les quotas TOTP sont épuisés. Aucun code à six chiffres ne passe ici.
  if(isRecoveryCode(code)) {
   const used=(await conn.query('UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING user_id',[userId,tokenHash(code.toLowerCase())])).rows[0]
   if(used) {await unlockDailyMfa(conn,userId);return {ok:true}}
   if(!await dailyMfaBlocked(conn,userId)) await recordMfaFailure(conn,userId)
   return invalid()
  }
  if(await dailyMfaBlocked(conn,userId)) return dailyMfaError()
  const counter=checkTotp(unseal(factor.secret,config.mfaKey,userId),code,factor.last_counter)
  if(counter!==null) {await conn.query('UPDATE mfa_factors SET last_counter=$2 WHERE user_id=$1',[userId,counter]);return {ok:true}}
  await recordMfaFailure(conn,userId)
  return invalid()
 }
 async function issueRecovery(conn,userId) {
  const codes=recoveryCodes()
  await conn.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1',[userId])
  for(const code of codes) await conn.query('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)',[userId,tokenHash(code)])
  return codes
 }
 app.get('/mfa/status',{config:{public:true}},async(req)=>{
  const token=readAuthCookie(req,config,'challenge')
  if(!token) return {challenge:null}
  const c=(await db.query(`SELECT c.pending_secret IS NOT NULL AS prepared,
   EXISTS(SELECT 1 FROM mfa_factors f WHERE f.user_id=c.user_id) AS enrolled
   FROM mfa_challenges c WHERE c.token_hash=$1 AND c.expires_at>now() AND c.attempts<10`,[tokenHash(token)])).rows[0]
  return {challenge:c?{mfaRequired:true,enrollmentRequired:!c.enrolled,enrollmentPrepared:c.prepared}:null}
 })
 app.post('/mfa/setup',{config:{public:true}},async(req)=>transaction(req,async(conn,c)=>{
  if((await conn.query('SELECT user_id FROM mfa_factors WHERE user_id=$1',[c.user_id])).rows[0]) return {error:new HttpError(409,'Double authentification déjà activée.')}
  if(!c.pending_secret) {
   const invitation=req.body?.invitation
   if(typeof invitation!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(invitation)) return {error:new HttpError(403,'Code d’activation administrateur requis.')}
   const invite=(await conn.query(`UPDATE mfa_enrollment_invites SET used_at=now() WHERE user_id=$1 AND token_hash=$2 AND expires_at>now() AND used_at IS NULL RETURNING user_id`,[c.user_id,tokenHash(invitation)])).rows[0]
   if(!invite) return {error:new HttpError(403,'Code d’activation invalide ou expiré.')}
   c.pending_secret=seal(newSecret(),config.mfaKey,c.user_id)
   await conn.query('UPDATE mfa_challenges SET pending_secret=$2 WHERE token_hash=$1',[c.token_hash,c.pending_secret])
  }
  const {email,phone}=(await conn.query('SELECT email,phone FROM users WHERE id=$1',[c.user_id])).rows[0]
  return {secret:unseal(c.pending_secret,config.mfaKey,c.user_id),account:email??phone,issuer:config.appName}
 }))
 app.post('/mfa/verify',{config:{public:true}},async(req,reply)=>transaction(req,async(conn,c)=>{
  // Verrou utilisateur : activation, consommation du code et session atomiques.
  const user=(await conn.query('SELECT id,email,phone,name,is_admin FROM users WHERE id=$1 FOR UPDATE',[c.user_id])).rows[0]
  const enrolled=!!(await conn.query('SELECT user_id FROM mfa_factors WHERE user_id=$1',[c.user_id])).rows[0]
  let codes
  if(!enrolled) {
   if(!c.pending_secret) return invalid()
   if(await dailyMfaBlocked(conn,c.user_id)) return dailyMfaError()
   const counter=checkTotp(unseal(c.pending_secret,config.mfaKey,c.user_id),req.body?.code)
   if(counter===null) {await recordMfaFailure(conn,c.user_id);return invalid()}
   await conn.query('INSERT INTO mfa_factors(user_id,secret,last_counter) VALUES($1,$2,$3)',[c.user_id,c.pending_secret,counter])
   codes=await issueRecovery(conn,c.user_id)
   await conn.query('DELETE FROM sessions WHERE user_id=$1',[c.user_id])
   await audit(conn,req,'mfa_enabled',c.user_id)
  } else {
   const checked=await factorCode(conn,c.user_id,req.body?.code)
   if(checked.error) return checked
  }
  await conn.query('DELETE FROM mfa_challenges WHERE token_hash=$1',[c.token_hash])
  await conn.query('UPDATE security_quotas SET hits=0,expires_at=now() WHERE name=$1',[`mfa:${c.user_id}:${c.device_id || 'unknown'}`])
  const result=await finishLogin(conn,req,reply,user,c.device_id,c.remember,true)
  authCookie(reply,config,'challenge','',0)
  return {...result,...(codes?{recoveryCodes:codes}:{})}
 },{allowRecovery:true}))
 app.post('/mfa/cancel',{config:{public:true}},async(req,reply)=>{
  const token=readAuthCookie(req,config,'challenge')
  if(token) await db.query('DELETE FROM mfa_challenges WHERE token_hash=$1',[tokenHash(token)])
  authCookie(reply,config,'challenge','',0)
  return {ok:true}
 })
 app.post('/mfa/recovery-codes',{config:{admin:true}},async(req)=>{
  const user=app.requireAdmin(req)
  if(!ipLimit(rateLimitKey(req.ip))) throw new HttpError(429,'Trop de tentatives. Réessayez plus tard.')
  const conn=await db.connect()
  let result
  try {
   await conn.query('BEGIN')
   await conn.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id])
   const key=`mfa-regenerate:${user.id}`
   const q=(await conn.query(`INSERT INTO security_quotas(name,hits,expires_at) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(name) DO UPDATE SET hits=CASE WHEN security_quotas.expires_at<=now() THEN 1 ELSE LEAST(security_quotas.hits+1,1000) END,
    expires_at=CASE WHEN security_quotas.expires_at<=now() THEN now()+interval '15 minutes' ELSE security_quotas.expires_at END RETURNING hits`,[key])).rows[0]
   if(q.hits>10 && !isRecoveryCode(req.body?.code)) result={error:new HttpError(429,'Trop de codes essayés. Réessayez dans quinze minutes.')}
   else {
    result=await factorCode(conn,user.id,req.body?.code)
    if(result.ok) {
    result={recoveryCodes:await issueRecovery(conn,user.id)}
    await conn.query('UPDATE security_quotas SET hits=0,expires_at=now() WHERE name=$1',[key])
    await audit(conn,req,'mfa_recovery_regenerated',user.id)
    }
   }
   await conn.query('COMMIT')
  } catch(e) {await conn.query('ROLLBACK');throw e} finally {conn.release()}
  if(result.error) throw result.error
  return result
 })
 app.get('/security',async(req)=>{
  const user=app.requireUser(req),token=readAuthCookie(req,config,'device')
  const devices=(await db.query('SELECT id,label,created_at,last_used_at,expires_at,token_hash=$2 AS current FROM trusted_devices WHERE user_id=$1 AND expires_at>now() ORDER BY last_used_at DESC',[user.id,token?tokenHash(token):null])).rows
  const enabled=!!(await db.query('SELECT user_id FROM mfa_factors WHERE user_id=$1',[user.id])).rows[0]
  const remaining=Number((await db.query('SELECT count(*) FROM mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL',[user.id])).rows[0].count)
  return {devices,mfaEnabled:enabled,recoveryCodesRemaining:remaining}
 })
 app.delete('/devices/:id',async(req,reply)=>{
  const user=app.requireUser(req),id=req.params.id
  if(id!=='all'&&!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400,'Appareil invalide.')
  await db.query(`DELETE FROM trusted_devices WHERE user_id=$1 ${id==='all'?'':'AND id=$2'}`,id==='all'?[user.id]:[user.id,id])
  if(id==='all') authCookie(reply,config,'device','',0)
  await audit(db,req,'devices_revoked',user.id)
  return {ok:true}
 })
 return {begin}
}
