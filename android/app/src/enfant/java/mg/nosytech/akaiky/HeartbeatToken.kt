package mg.nosytech.akaiky

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Jeton « signal de vie » du natif (NAR-180). */
interface TokenStore {
    fun read(): String?
    /** Vrai si écrit (relu à l'identique). */
    fun write(token: String): Boolean
    fun clear()
}

/**
 * Chiffrement du jeton au repos : AES-256-GCM, IV aléatoire de 12 octets, données associées
 * fixes (un texte chiffré ailleurs dans l'app ne s'ouvre pas ici). Format : base64(IV) « . »
 * base64(chiffré + étiquette). Pur javax.crypto : testé sur la JVM avec une clé ordinaire.
 */
object SealedToken {
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private val AAD = "akaiky:heartbeat-token:v1".toByteArray(StandardCharsets.UTF_8)

    fun seal(plain: String, key: SecretKey): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // IV choisi par le fournisseur (le Keystore Android refuse un IV imposé).
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(AAD)
        val data = cipher.doFinal(plain.toByteArray(StandardCharsets.UTF_8))
        val enc = Base64.getEncoder().withoutPadding()
        return enc.encodeToString(cipher.iv) + "." + enc.encodeToString(data)
    }

    /** Texte clair, ou null si la valeur est mal formée, altérée ou chiffrée par une autre clé. */
    fun open(sealed: String?, key: SecretKey): String? = try {
        val parts = sealed?.split('.')
        if (parts == null || parts.size != 2) null else {
            val dec = Base64.getDecoder()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, dec.decode(parts[0])))
            cipher.updateAAD(AAD)
            String(cipher.doFinal(dec.decode(parts[1])), StandardCharsets.UTF_8)
        }
    } catch (e: Exception) {
        null
    }
}

/**
 * Jeton gardé dans les préférences privées du natif, chiffré par une clé Keystore qui lui est
 * propre (alias `akaiky-heartbeat-token`, non exportable) ; aucune dépendance de plus.
 * Clé perdue (restauration, réinitialisation du Keystore) : `read()` rend null, l'envoi est
 * remis à la période suivante et l'écran émet un nouveau jeton à son prochain démarrage.
 */
class KeystoreTokenStore(context: Context) : TokenStore {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun existingKey(): SecretKey? = try {
        (keyStore().getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
    } catch (e: Exception) {
        null
    }

    private fun key(): SecretKey = existingKey() ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
        init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        generateKey()
    }

    override fun read(): String? {
        val sealed = prefs.getString(K_TOKEN, null) ?: return null
        val key = existingKey() ?: return null
        return HeartbeatClient.validToken(SealedToken.open(sealed, key))
    }

    override fun write(token: String): Boolean = try {
        prefs.edit().putString(K_TOKEN, SealedToken.seal(token, key())).commit() && read() == token
    } catch (e: Exception) {
        false
    }

    override fun clear() {
        prefs.edit().remove(K_TOKEN).commit()
    }

    private companion object {
        const val PREFS = "akaiky_heartbeat_token"
        const val K_TOKEN = "sealed"
        const val ALIAS = "akaiky-heartbeat-token"
    }
}
