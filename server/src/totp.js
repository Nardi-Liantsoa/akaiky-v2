import { randomBytes, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function base32(bytes) {
 let bits=0,value=0,out=''
 for (const b of bytes) { value=(value<<8)|b; bits+=8; while(bits>=5) { out+=alphabet[(value>>>(bits-5))&31]; bits-=5 } }
 if(bits) out+=alphabet[(value<<(5-bits))&31]
 return out
}
function unbase32(secret) {
 let bits=0,value=0,out=[]
 for(const c of secret) { const n=alphabet.indexOf(c); if(n<0) throw new Error('Secret TOTP invalide'); value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8} }
 return Buffer.from(out)
}
export const newSecret = () => base32(randomBytes(20))
export function totp(secret,counter=Math.floor(Date.now()/30000),digits=6) {
 const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(counter))
 const h=createHmac('sha1',unbase32(secret)).update(b).digest(), offset=h[19]&15
 return String((h.readUInt32BE(offset)&0x7fffffff)%(10**digits)).padStart(digits,'0')
}
export function checkTotp(secret,code,last=-1,now=Date.now()) {
 if(typeof code!=='string'||!/^\d{6}$/.test(code)) return null
 const counter=Math.floor(now/30000)
 for(const n of [counter,counter-1,counter+1]) if(n>Number(last)&&timingSafeEqual(Buffer.from(totp(secret,n)),Buffer.from(code))) return n
 return null
}
// Balise GCM de 16 octets imposée au chiffrement ET au déchiffrement : une
// balise tronquée affaiblirait l'authentification du secret (Semgrep gcm-no-tag-length).
export function seal(secret,key,userId) {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv,{authTagLength:16})
 cipher.setAAD(Buffer.from(userId))
 const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()])
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64')
}
export function unseal(value,key,userId) {
 const b=Buffer.from(value,'base64')
 if(b.length<29) throw new Error('Secret chiffré invalide')
 const cipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),b.subarray(0,12),{authTagLength:16})
 cipher.setAAD(Buffer.from(userId));cipher.setAuthTag(b.subarray(12,28))
 return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8')
}
export const recoveryCodes = () => Array.from({length:10},()=>randomBytes(16).toString('hex').match(/.{4}/g).join('-'))
