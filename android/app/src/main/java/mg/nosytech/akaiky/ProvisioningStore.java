package mg.nosytech.akaiky;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.BaseBundle;

import java.util.regex.Pattern;

/**
 * Jeton d'appairage reçu dans les extras de provisionnement du QR (NAR-138, NAR-164).
 *
 * Valable 15 minutes et à usage unique : gardé dans les préférences privées de l'app
 * (sans sauvegarde : allowBackup="false" et data_extraction_rules), le temps que le
 * web l'échange contre une session d'appareil, puis effacé. La session elle-même
 * va dans le Keystore (stockage sécurisé), jamais ici.
 */
public final class ProvisioningStore {
    public static final String EXTRA_PAIRING = "akaiky.pairing";
    private static final String PREFS = "akaiky.provisioning";
    private static final String KEY_TOKEN = "pairing";
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private ProvisioningStore() {}

    /** Retient le jeton des extras (PersistableBundle ou Bundle), s'il a la bonne forme. */
    public static void saveFrom(Context context, BaseBundle extras) {
        if (extras == null) return;
        Object token = extras.get(EXTRA_PAIRING);
        if (!(token instanceof String) || !TOKEN.matcher((String) token).matches()) return;
        prefs(context).edit().putString(KEY_TOKEN, (String) token).commit();
    }

    public static String token(Context context) {
        return prefs(context).getString(KEY_TOKEN, null);
    }

    public static void clear(Context context) {
        prefs(context).edit().remove(KEY_TOKEN).commit();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
