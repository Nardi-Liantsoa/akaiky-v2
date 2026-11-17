import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, newUser, call, cookieOf, tokenIn } from './helpers.js'
import { newToken, tokenHash } from '../src/security.js'
import { base32, totp, checkTotp, seal, unseal } from '../src/totp.js'
import { readFile } from 'node:fs/promises'
import { createPool } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
let dbh,ctx
before(async()=>{dbh=await startDb();ctx=await startApp(dbh.url)})
after(async()=>{await ctx?.close();dbh?.stop()})
const login=(u,cookie,rememberDevice=false)=>call(ctx.app,'POST','/api/auth/login',{cookie,body:{email:u.email,password:u.password,rememberDevice}})
async function prepareAdmin() {
 const u=await newUser(ctx)
 await ctx.db.query('UPDATE users SET is_admin=true WHERE id=$1',[u.id])
 const invitation=newToken()
 await ctx.db.query("INSERT INTO mfa_enrollment_invites(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[u.id,invitation.hash])
 return {...u,invitation:invitation.token}
}
async function enroll(u,remember=true,app=ctx.app) {
 const response=await login(u,undefined,remember),cookie=cookieOf(response)
 assert.equal(response.json().mfaRequired,true)
 const setup=await call(app,'POST','/api/auth/mfa/setup',{cookie,body:{invitation:u.invitation}})
 assert.equal(setup.statusCode,200,setup.body)
 const secret=setup.json().secret
 const verify=await call(app,'POST','/api/auth/mfa/verify',{cookie,body:{code:totp(secret)}})
 assert.equal(verify.statusCode,200,verify.body)
 return {secret,cookie:cookieOf(verify),codes:verify.json().recoveryCodes,challenge:cookie}
}
test('TOTP : vecteurs RFC6238, fenêtre bornée et anti-rejeu ; chiffrement lié au compte',()=>{
 const secret=base32(Buffer.from('12345678901234567890'))
 for(const [time,expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']]) assert.equal(totp(secret,Math.floor(time/30),8),expected)
 const now=1234567890000,counter=Math.floor(now/30000),code=totp(secret,counter)
 assert.equal(checkTotp(secret,code,-1,now),counter)
 assert.equal(checkTotp(secret,code,counter,now),null)
 assert.equal(checkTotp(secret,totp(secret,counter-2),-1,now),null)
 assert.equal(checkTotp(secret,'__proto__',-1,now),null)
 const encrypted=seal(secret,'ab'.repeat(32),'user1')
 assert.equal(unseal(encrypted,'ab'.repeat(32),'user1'),secret)
 assert.throws(()=>unseal(encrypted,'ab'.repeat(32),'user2'))
 assert.throws(()=>unseal(encrypted,'cd'.repeat(32),'user1'))
})
test('admin : ancienne session refusée, mot de passe insuffisant, invitation obligatoire et liée au compte',async()=>{
 const u=await prepareAdmin(),other=await prepareAdmin()
 assert.equal((await call(ctx.app,'GET','/api/auth/me',{cookie:u.cookie})).json().user,null)
 const r=await login(u),c=cookieOf(r)
 assert.equal(r.json().user,undefined);assert.equal(r.json().enrollmentRequired,true)
 assert.equal((await call(ctx.app,'GET','/api/notes',{cookie:c})).statusCode,401)
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/setup',{cookie:c,body:{}})).statusCode,403)
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/setup',{cookie:c,body:{invitation:other.invitation}})).statusCode,403)
 const setup=await call(ctx.app,'POST','/api/auth/mfa/setup',{cookie:c,body:{invitation:u.invitation}})
 assert.equal(setup.statusCode,200)
 const verify=await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:c,body:{code:totp(setup.json().secret)}})
 assert.equal(verify.statusCode,200,verify.body)
 assert.equal(verify.json().recoveryCodes.length,10)
 assert.equal((await call(ctx.app,'GET','/api/auth/me',{cookie:cookieOf(verify)})).json().user.is_admin,true)
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:c,body:{code:totp(setup.json().secret)}})).statusCode,401)
 const factor=(await ctx.db.query('SELECT secret FROM mfa_factors WHERE user_id=$1',[u.id])).rows[0]
 assert.ok(!factor.secret.includes(setup.json().secret))
})
test('MFA : appareil reconnu ne contourne jamais le second facteur ; code de secours à usage unique même en parallèle',async()=>{
 const u=await prepareAdmin(),enrolled=await enroll(u)
 const r=await login(u,enrolled.cookie)
 assert.equal(r.json().mfaRequired,true);assert.equal(r.json().enrollmentRequired,false)
 const c=cookieOf(r)
 // Le code d'activation déjà utilisé ne reconfigure pas le facteur.
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/setup',{cookie:c,body:{invitation:u.invitation}})).statusCode,409)
 const one=await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:c,body:{code:enrolled.codes[0]}})
 assert.equal(one.statusCode,200)
 const [a,b]=await Promise.all([login(u),login(u,enrolled.cookie)])
 const results=await Promise.all([a,b].map(r=>call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(r),body:{code:enrolled.codes[1]}})))
 assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,401])
 const replay=await login(u)
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(replay),body:{code:enrolled.codes[0]}})).statusCode,401)
})
test('appareil : voie indépendante sous attaque, cookie forgé / autre compte refusé, révocation et expiration',async()=>{
 const u=await newUser(ctx),other=await newUser(ctx)
 const r=await login(u,undefined,true),cookie=cookieOf(r)
 assert.match(cookie,/app-device=/)
 await ctx.db.query("UPDATE users SET failed_logins=20,locked_until=now()+interval '30 seconds' WHERE id=$1",[u.id])
 const start=Date.now(),known=await login(u,cookie)
 assert.equal(known.statusCode,200,known.body);assert.ok(Date.now()-start<5000)
 assert.equal((await ctx.db.query('SELECT failed_logins FROM users WHERE id=$1',[u.id])).rows[0].failed_logins,20)
 const devices=await call(ctx.app,'GET','/api/auth/security',{cookie:cookieOf(known)})
 assert.equal(devices.json().devices.length,1);assert.equal(devices.json().devices[0].current,true)
 const id=devices.json().devices[0].id
 assert.equal((await call(ctx.app,'DELETE',`/api/auth/devices/${id}`,{cookie:other.cookie})).statusCode,200)
 assert.equal((await ctx.db.query('SELECT count(*) FROM trusted_devices WHERE id=$1',[id])).rows[0].count,'1')
 const { recognizedDevice }=await import('../src/devices.js')
 assert.equal(await recognizedDevice(ctx.db,{headers:{cookie}},ctx.app.config,other.email),null)
 assert.equal(await recognizedDevice(ctx.db,{headers:{cookie:'app-device='+newToken().token}},ctx.app.config,u.email),null)
 const currentCookie=cookieOf(known)
 await call(ctx.app,'DELETE',`/api/auth/devices/${id}`,{cookie:currentCookie})
 assert.equal(await recognizedDevice(ctx.db,{headers:{cookie:currentCookie}},ctx.app.config,u.email),null)
 await ctx.db.query('UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=$1',[u.id])
 const again=await login(u,undefined,true)
 await ctx.db.query("UPDATE trusted_devices SET expires_at=now()-interval '1 second' WHERE user_id=$1",[u.id])
 assert.equal(await recognizedDevice(ctx.db,{headers:{cookie:cookieOf(again)}},ctx.app.config,u.email),null)
})
test('MFA : quota persistant malgré nouveaux défis/IP, appareil reconnu indépendant, expiration',async()=>{
 const u=await prepareAdmin(),enrolled=await enroll(u)
 const r=await login(u)
 await ctx.db.query('INSERT INTO security_quotas(name,hits,expires_at) VALUES($1,10,now()+interval \'15 minutes\') ON CONFLICT(name) DO UPDATE SET hits=10,expires_at=now()+interval \'15 minutes\'',[`mfa:${u.id}:unknown`])
 const blocked=await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(r),body:{code:'000000'}})
 assert.equal(blocked.statusCode,429)
 const again=await login(u)
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(again),body:{code:'000000'},headers:{'x-forwarded-for':'2.3.4.5'}})).statusCode,429)
 const known=await login(u,enrolled.cookie)
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(known),body:{code:enrolled.codes[0]}})).statusCode,200)
 await ctx.db.query("UPDATE mfa_challenges SET expires_at=now()-interval '1 second' WHERE user_id=$1",[u.id])
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(again),body:{code:enrolled.codes[1]}})).statusCode,401)
})
test('réinitialiser le mot de passe révoque sessions/appareils/défis mais conserve la MFA',async()=>{
 const u=await prepareAdmin(),enrolled=await enroll(u)
 await login(u)
 await call(ctx.app,'POST','/api/auth/forgot-password',{body:{email:u.email}})

 const mail=ctx.sent.findLast(m=>m.to===u.email)
 const result=await call(ctx.app,'POST','/api/auth/reset-password',{body:{token:tokenIn(mail,'reset'),password:'Un nouveau mot de passe sécurisé'}})
 assert.equal(result.statusCode,200)
 for(const table of ['sessions','trusted_devices','mfa_challenges']) assert.equal((await ctx.db.query(`SELECT count(*) FROM ${table} WHERE user_id=$1`,[u.id])).rows[0].count,'0')
 assert.equal((await ctx.db.query('SELECT count(*) FROM mfa_factors WHERE user_id=$1',[u.id])).rows[0].count,'1')
 const r=await login({...u,password:'Un nouveau mot de passe sécurisé'})
 assert.equal(r.json().mfaRequired,true)
 assert.equal((await call(ctx.app,'GET','/api/auth/me',{cookie:enrolled.cookie})).json().user,null)
})
test('MFA avec rôle SQL restreint : activation/vérification fonctionnent, création invitation interdite',async()=>{
 const sql=(await readFile(new URL('../../ops/runtime-role.sql',import.meta.url),'utf8')).replace(":'runtime_password'","'runtime-test-only'")
 await ctx.db.query(sql)
 const u=await prepareAdmin(),url=new URL(dbh.url);url.username='app_runtime';url.password='runtime-test-only'
 const pool=createPool(url.toString()),app=await buildApp({config:loadConfig({DATABASE_URL:url.toString(),APP_ORIGIN:'https://app.test'}),db:pool,mailer:{async send(){}},logger:false})
 try {
  await assert.rejects(pool.query("INSERT INTO mfa_enrollment_invites(user_id,token_hash,expires_at) VALUES($1,$2,now())",[u.id,newToken().hash]),/permission denied/)
  await assert.rejects(pool.query('UPDATE mfa_enrollment_invites SET token_hash=$1',[newToken().hash]),/permission denied/)
  const r=await call(app,'POST','/api/auth/login',{body:{email:u.email,password:u.password,rememberDevice:true}})
  const setup=await call(app,'POST','/api/auth/mfa/setup',{cookie:cookieOf(r),body:{invitation:u.invitation}})
  assert.equal(setup.statusCode,200,setup.body)
  const rejected=await call(app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(r),body:{code:'incorrect'}})
  assert.equal(rejected.statusCode,401,rejected.body)
  const verified=await call(app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(r),body:{code:totp(setup.json().secret)}})
  assert.equal(verified.statusCode,200,verified.body)
  assert.equal((await call(app,'GET','/api/auth/security',{cookie:cookieOf(verified)})).json().mfaEnabled,true)
 } finally {await app.close();await pool.end()}
})
test('codes de secours : renouvellement protégé, anciens codes invalidés, défi reprenable sans exposer le secret',async()=>{
 const u=await prepareAdmin(),enrolled=await enroll(u)
 const status=await call(ctx.app,'GET','/api/auth/mfa/status',{cookie:enrolled.challenge})
 assert.equal(status.json().challenge,null)
 const r=await login(u)
 assert.deepEqual((await call(ctx.app,'GET','/api/auth/mfa/status',{cookie:cookieOf(r)})).json().challenge,{mfaRequired:true,enrollmentRequired:false,enrollmentPrepared:false})
 assert.equal((await call(ctx.app,'POST','/api/auth/mfa/recovery-codes',{body:{code:enrolled.codes[0]}})).statusCode,401)
 const bad=await call(ctx.app,'POST','/api/auth/mfa/recovery-codes',{cookie:enrolled.cookie,body:{code:'invalid'}})
 assert.equal(bad.statusCode,401)
 const renewed=await call(ctx.app,'POST','/api/auth/mfa/recovery-codes',{cookie:enrolled.cookie,body:{code:enrolled.codes[0]}})
 assert.equal(renewed.statusCode,200,renewed.body);assert.equal(renewed.json().recoveryCodes.length,10)
 const old=await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(r),body:{code:enrolled.codes[1]}})
 assert.equal(old.statusCode,401)
 const current=await call(ctx.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(r),body:{code:renewed.json().recoveryCodes[0]}})
 assert.equal(current.statusCode,200)
})

test('MFA : une faute reste silencieuse, cinq échecs déclenchent une seule alerte',async()=>{
 const isolated=await startApp(dbh.url)
 try {
  const u=await prepareAdmin(),e=await enroll(u,true,isolated.app)
  const r=await login(u),cookie=cookieOf(r)
  const verify=code=>call(isolated.app,'POST','/api/auth/mfa/verify',{cookie,body:{code}})
  const alerts=async()=>Number((await ctx.db.query("SELECT occurrences FROM security_alerts WHERE kind='login_attack'")).rows[0]?.occurrences||0)
  const before=await alerts()
  // Chaîne non numérique : échec garanti indépendamment de l'heure du test.
  for(let n=1;n<=6;n++) {
   assert.equal((await verify('incorrect')).statusCode,401)
   assert.equal(await alerts(),before+(n>=5?1:0))
  }
  assert.equal((await verify(e.codes[0])).statusCode,200)
  assert.equal((await ctx.db.query('SELECT hits FROM security_quotas WHERE name=$1',[`mfa-daily-failures:${u.id}`])).rows[0].hits,0)
 } finally {await isolated.close()}
})

test('MFA : plafond commun de 30 échecs, persistant entre appareils/processus/routes ; secours possible après saturation',async()=>{
 const first=await startApp(dbh.url),second=await startApp(dbh.url)
 try {
  const u=await prepareAdmin(),e=await enroll(u,true,first.app),a=await login(u),b=await login(u,e.cookie)
  const user=await newUser(ctx)
  const cookies=[cookieOf(a),cookieOf(b)]
  let ip=1
  const verify=(app,cookie,code)=>app.inject({method:'POST',url:'/api/auth/mfa/verify',remoteAddress:`198.51.100.${ip++}`,headers:{origin:'https://app.test','x-app':'1',cookie},payload:{code}})
  // Le renouvellement des codes partage aussi le même budget.
  const renew=await call(first.app,'POST','/api/auth/mfa/recovery-codes',{cookie:e.cookie,body:{code:'incorrect'}})
  assert.equal(renew.statusCode,401)
  for(let n=1;n<=28;n++) {
   const i=n%2
   // Simule l'écoulement de plusieurs périodes de 15 min, pas de la journée.
   await ctx.db.query("UPDATE security_quotas SET hits=0,expires_at=now() WHERE name LIKE 'mfa:%'")
   await ctx.db.query('UPDATE mfa_challenges SET attempts=0 WHERE user_id=$1',[u.id])
   const r=await verify(i?first.app:second.app,cookies[i],'incorrect')
   assert.equal(r.statusCode,401,r.body)
  }
  const concurrent=await Promise.all([verify(first.app,cookies[0],'incorrect'),verify(second.app,cookies[1],'incorrect')])
  assert.deepEqual(concurrent.map(r=>r.statusCode).sort(),[401,429])
  assert.equal((await ctx.db.query('SELECT hits FROM security_quotas WHERE name=$1',[`mfa-daily-failures:${u.id}`])).rows[0].hits,30)
  // Même un code TOTP correct est refusé sans être consommé après 30 échecs.
  await ctx.db.query('UPDATE mfa_factors SET last_counter=-1 WHERE user_id=$1',[u.id])
  const blocked=await verify(second.app,cookies[1],totp(e.secret))
  assert.equal(blocked.statusCode,429);assert.match(blocked.json().error,/quotidienne/)
  const regenBlocked=await call(first.app,'POST','/api/auth/mfa/recovery-codes',{cookie:e.cookie,body:{code:totp(e.secret)}})
  assert.equal(regenBlocked.statusCode,429)
  assert.equal((await call(first.app,'GET','/api/auth/me',{cookie:user.cookie})).json().user.id,user.id)
  // Une attaque ne peut pas bloquer un secours valide en épuisant le défi et
  // le quota court ; le code de secours conserve son usage unique.
  await ctx.db.query('UPDATE mfa_challenges SET attempts=10 WHERE user_id=$1',[u.id])
  await ctx.db.query("UPDATE security_quotas SET hits=100,expires_at=now()+interval '15 minutes' WHERE name LIKE 'mfa:%'")
  const recovered=await verify(first.app,cookies[0],e.codes[0])
  assert.equal(recovered.statusCode,200,recovered.body)
  assert.equal((await ctx.db.query('SELECT hits FROM security_quotas WHERE name=$1',[`mfa-daily-failures:${u.id}`])).rows[0].hits,0)
  assert.equal((await verify(second.app,cookies[1],e.codes[0])).statusCode,401)
 } finally {await first.close();await second.close()}
})

test('MFA : succès TOTP ne remet pas le budget à zéro ; expiration des 24 heures le libère',async()=>{
 const isolated=await startApp(dbh.url)
 try {
  const u=await prepareAdmin(),e=await enroll(u,true,isolated.app),r=await login(u)
  const key=`mfa-daily-failures:${u.id}`
  await ctx.db.query("INSERT INTO security_quotas(name,hits,expires_at) VALUES($1,29,now()+interval '24 hours')",[key])
  await ctx.db.query('UPDATE mfa_factors SET last_counter=-1 WHERE user_id=$1',[u.id])
  const good=await call(isolated.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(r),body:{code:totp(e.secret)}})
  assert.equal(good.statusCode,200,good.body)
  assert.equal((await ctx.db.query('SELECT hits FROM security_quotas WHERE name=$1',[key])).rows[0].hits,29)
  await ctx.db.query("UPDATE security_quotas SET hits=30,expires_at=now()-interval '1 second' WHERE name=$1",[key])
  const next=await login(u)
  const bad=await call(isolated.app,'POST','/api/auth/mfa/verify',{cookie:cookieOf(next),body:{code:'incorrect'}})
  assert.equal(bad.statusCode,401)
  assert.equal((await ctx.db.query('SELECT hits FROM security_quotas WHERE name=$1',[key])).rows[0].hits,1)
 } finally {await isolated.close()}
})
