package mg.nosytech.akaiky

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.telephony.TelephonyManager

/**
 * Relevés du téléphone (batterie, réseau, carte SIM), partagés par l'écran
 * (AkaikyDevicePlugin.getStatus) et la surveillance native en arrière-plan (NAR-180).
 * Aucune permission : batterie par l'intention collante, réseau par ConnectivityManager
 * (ACCESS_NETWORK_STATE), carte SIM par TelephonyManager.getSimState.
 */
object DeviceSignals {
    data class Battery(val pct: Int?, val charging: Boolean?)

    fun battery(context: Context): Battery {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return Battery(null, null)
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return Battery(
            batteryPct(intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)),
            if (status < 0) null else status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        )
    }

    /** Pourcentage entier 0–100, ou null si le relevé est inexploitable. */
    fun batteryPct(level: Int, scale: Int): Int? =
        if (level < 0 || scale <= 0) null else (level * 100 / scale).coerceIn(0, 100)

    /** « wifi », « cellular », « other » (Ethernet, VPN…) ou « none » : vocabulaire de l'écran. */
    fun network(context: Context): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
        return when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }
    }

    fun simState(context: Context): String = try {
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        if (tm == null) "unknown" else simStateName(tm.simState)
    } catch (e: Exception) {
        "unknown"
    }

    /**
     * TelephonyManager.SIM_STATE_* → vocabulaire du serveur (ready, absent, locked, unknown).
     * Valeurs écrites en clair : la règle se teste sur la JVM, sans Android.
     * Carte illisible (CARD_IO_ERROR) comptée absente : le téléphone ne peut plus appeler,
     * les parents doivent le savoir. Pas encore prête (NOT_READY, au démarrage) : inconnue.
     */
    fun simStateName(state: Int): String = when (state) {
        1 -> "absent"          // SIM_STATE_ABSENT
        2, 3, 4, 7, 9 -> "locked" // PIN, PUK, réseau verrouillé, désactivée, restreinte
        5 -> "ready"           // SIM_STATE_READY
        8 -> "absent"          // SIM_STATE_CARD_IO_ERROR
        else -> "unknown"      // UNKNOWN (0), NOT_READY (6), et toute valeur future
    }
}
