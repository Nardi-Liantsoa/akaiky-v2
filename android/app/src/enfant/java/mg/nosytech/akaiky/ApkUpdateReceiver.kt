package mg.nosytech.akaiky

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Mise à jour de l'app (NAR-170) : résultat de PackageInstaller et alarme de sécurité de la
 * fenêtre d'installation. Dans les deux cas, DISALLOW_INSTALL_APPS est reposée. Non exporté :
 * seuls les PendingIntent explicites de l'app (et le système qui les remplit) l'atteignent.
 */
class ApkUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            when (intent.action) {
                ApkUpdate.ACTION_RESULT -> ApkUpdate.onResult(context, intent)
                ApkUpdate.ACTION_SAFETY -> ApkUpdate.closeWindow(context, "délai de sécurité")
            }
        } catch (e: Exception) {
            Log.w("AkaikyUpdate", "résultat non traité", e)
            try { ApkUpdate.closeWindow(context, "erreur") } catch (_: Exception) { }
        }
    }
}
