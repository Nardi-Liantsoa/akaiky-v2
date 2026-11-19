package mg.nosytech.akaiky

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Diffusions exemptées des restrictions d'Android 8, déclarées dans le manifeste (NAR-180) :
 * redémarrage et mise à jour de l'app (écoute des autres diffusions reposée, tâche
 * périodique revérifiée) et CARRIER_CONFIG_CHANGED (carte SIM retirée ou insérée, même
 * processus arrêté). L'intention n'est jamais lue : l'état réel est relu.
 */
class BackgroundStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            if (!BackgroundStatus.isEnabled(context)) return
            BackgroundStatus.ensureReceivers(context)
            when (intent.action) {
                Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> BackgroundStatus.schedulePeriodic(context)
                else -> BackgroundStatus.onSignal(context)
            }
        } catch (e: Exception) {
            Log.w("AkaikyStatus", "diffusion ignorée", e)
        }
    }
}
