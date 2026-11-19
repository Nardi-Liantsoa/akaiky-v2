package mg.nosytech.akaiky

import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Pont de la surveillance en arrière-plan (NAR-180) vers l'écran (src/native/akaikyBackground.ts) :
 * marche (avec le jeton « signal de vie »), arrêt, état.
 */
@CapacitorPlugin(name = "AkaikyBackground")
class BackgroundStatusPlugin : Plugin() {

    // Processus démarré par l'app (lanceur, redémarrage) : écoute des diffusions reposée.
    override fun load() {
        try {
            BackgroundStatus.ensureReceivers(context)
        } catch (e: Exception) {
            Logger.error("AkaikyBackground", "Écoute non posée", e)
        }
    }

    /** { apiBase, token } : adresse https de l'API et jeton « signal de vie » (POST /api/device/heartbeat-token). */
    @PluginMethod
    fun startBackgroundStatus(call: PluginCall) {
        val base = HeartbeatClient.validBase(call.getString("apiBase"))
            ?: return call.reject("Adresse de l'API invalide.", "invalid_api_base")
        val token = HeartbeatClient.validToken(call.getString("token"))
            ?: return call.reject("Jeton invalide.", "invalid_token")
        BackgroundStatus.control.execute {
            try {
                if (BackgroundStatus.start(context, base, token)) call.resolve()
                else call.reject("Jeton non enregistré sur ce téléphone.", "storage_failed")
            } catch (e: Exception) {
                Logger.error("AkaikyBackground", "Surveillance non lancée", e)
                call.reject("Surveillance impossible sur ce téléphone.", "failed")
            }
        }
    }

    /** Rendu une fois l'arrêt fait : aucun signal ne part plus (envoi en cours attendu). */
    @PluginMethod
    fun stopBackgroundStatus(call: PluginCall) {
        BackgroundStatus.control.execute {
            try {
                BackgroundStatus.stop(context)
                call.resolve()
            } catch (e: Exception) {
                Logger.error("AkaikyBackground", "Surveillance non arrêtée", e)
                call.reject("Arrêt impossible.", "failed")
            }
        }
    }

    /** { enabled, needsToken } : `needsToken` vrai si le jeton a été refusé (401) ou est illisible. */
    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(JSObject().put("enabled", BackgroundStatus.isEnabled(context)).put("needsToken", BackgroundStatus.needsToken(context)))
    }
}
