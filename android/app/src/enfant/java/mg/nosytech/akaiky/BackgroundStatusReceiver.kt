package mg.nosytech.akaiky

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Diffusions exemptées des restrictions d'Android 8, déclarées dans le manifeste (NAR-180) :
 * redémarrage et mise à jour de l'app (écoute des autres diffusions reposée, tâche
 * périodique revérifiée) et CARRIER_CONFIG_CHANGED (carte SIM retirée ou insérée, même
 * processus arrêté). L'intention n'est jamais lue : l'état réel est relu. Au redémarrage, un
 * SOS gardé (NAR-151) est déclaré interrompu.
 */
class BackgroundStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Redémarrage : un SOS gardé n'a plus ni service ni appel ; jamais montré « en cours » (NAR-151).
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            try { SosService.onBoot(context) } catch (e: Exception) { Log.w("AkaikySos", "SOS gardé non effacé", e) }
        }
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
