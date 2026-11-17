// Réservé à l'opérateur SSH + propriétaire PostgreSQL. Aucun secret dans stdout.
import { writeFile } from 'node:fs/promises'
import { createPool } from '../src/db.js'
import { newToken } from '../src/security.js'
const [email,output]=process.argv.slice(2)
if(!email||!output||!process.env.DATABASE_URL) throw new Error('Usage : DATABASE_URL=… node bin/mfa-invite.js email fichier-prive')
const db=createPool(process.env.DATABASE_URL)
try {
 const user=(await db.query('SELECT id FROM users WHERE email=$1 AND is_admin=true',[email.toLowerCase()])).rows[0]
 if(!user) throw new Error('Administrateur introuvable')
 if((await db.query('SELECT user_id FROM mfa_factors WHERE user_id=$1',[user.id])).rows[0]) throw new Error('MFA déjà active : utiliser un code de secours')
 const {token,hash}=newToken()
 await writeFile(output,token+'\n',{mode:0o600,flag:'wx'})
 await db.query(`INSERT INTO mfa_enrollment_invites(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '24 hours')
 ON CONFLICT(user_id) DO UPDATE SET token_hash=$2,expires_at=now()+interval '24 hours',used_at=NULL`,[user.id,hash])
 console.log('Invitation créée pour 24 h dans le fichier privé indiqué.')
} finally {await db.end()}
