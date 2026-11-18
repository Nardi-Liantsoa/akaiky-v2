package mg.nosytech.akaiky

import android.content.Context
import android.content.SharedPreferences
import android.os.BaseBundle

/**
 * Jeton d'appairage reçu dans les extras de provisionnement du QR (NAR-138, NAR-164).
 *
 * Valable 15 minutes et à usage unique : gardé dans les préférences privées de l'app
 * (sans sauvegarde : allowBackup="false" et data_extraction_rules), le temps que le
 * web l'échange contre une session d'appareil, puis effacé. La session elle-même
 * va dans le Keystore (stockage sécurisé), jamais ici.
 */
object ProvisioningStore {
    const val EXTRA_PAIRING = "akaiky.pairing"
    private const val PREFS = "akaiky.provisioning"
    private const val KEY_TOKEN = "pairing"
    private val TOKEN = Regex("^[A-Za-z0-9_-]{43}$")

    /** Retient le jeton des extras (PersistableBundle ou Bundle), s'il a la bonne forme. */
    @JvmStatic
    fun saveFrom(context: Context, extras: BaseBundle?) {
        @Suppress("DEPRECATION")
        val token = extras?.get(EXTRA_PAIRING) as? String ?: return
        if (!TOKEN.matches(token)) return
        prefs(context).edit().putString(KEY_TOKEN, token).commit()
    }

    @JvmStatic
    fun token(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)

    @JvmStatic
    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_TOKEN).commit()
    }

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
