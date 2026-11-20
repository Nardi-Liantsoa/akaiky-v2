package mg.nosytech.akaiky

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import android.util.Log

/**
 * Appels de l'enfant aux secours (NAR-196), gardés dans les préférences privées de l'app
 * (écriture synchrone : le processus survit rarement longtemps à un appel d'urgence) pour
 * ouvrir la fenêtre des secours (EmergencyWindow). Notés par :
 * - Android 10+ : le service de filtrage (AkaikyCallScreeningService), à qui Telecom présente
 *   aussi les appels SORTANTS, appels d'urgence compris (vérifié sur Android 14), quel que soit
 *   le composeur (bouton « Appeler les secours », SOS, composeur d'urgence du système) ;
 * - Android 8–9 : le récepteur NEW_OUTGOING_CALL (OutgoingCallReceiver), qui voit aussi les
 *   urgences ;
 * - toute version : la décision des appels sortants (OutgoingCalls.decide, service de redirection
 *   d'Android 10+) quand elle reconnaît une urgence.
 * Le journal d'appels d'Android n'est pas une source : les appels d'urgence n'y sont pas écrits
 * par défaut (réglage opérateur, vérifié sur émulateur Android 14). Aucun numéro noté.
 */
object EmergencyCalls {
    private const val PREFS = "akaiky.calls"
    private const val TAG = "AkaikyEmergency"

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun bootCount(context: Context): Int =
        try { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1) } catch (e: Exception) { -1 }

    private fun mark(context: Context): EmergencyWindow.Mark? {
        val p = prefs(context)
        if (!p.contains("emergency_at")) return null
        return EmergencyWindow.Mark(p.getLong("emergency_at", 0L), p.getInt("emergency_boot", -1))
    }

    /** Appel aux secours en train de partir : la fenêtre (re)part de maintenant. */
    @Synchronized
    fun record(context: Context) {
        try {
            // Un nouvel appel relance la fenêtre de 30 min à partir de maintenant.
            val m = EmergencyWindow.Mark(SystemClock.elapsedRealtime(), bootCount(context))
            prefs(context).edit().putLong("emergency_at", m.atElapsed).putInt("emergency_boot", m.boot).commit()
            Log.i(TAG, "Appel aux secours : appels entrants ouverts ${EmergencyWindow.MINUTES} min")
        } catch (e: Exception) {
            Log.w(TAG, "Appel aux secours non noté", e)
        }
    }

    /** Fenêtre des secours ouverte maintenant. */
    fun windowOpen(context: Context): Boolean =
        try { EmergencyWindow.isOpen(mark(context), SystemClock.elapsedRealtime(), bootCount(context)) } catch (e: Exception) { false }
}
