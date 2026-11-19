package mg.nosytech.akaiky

import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Pont de la mise à jour de l'app enfant (NAR-170) vers l'écran (src/native/akaikyUpdate.ts).
 * L'écran décide quand essayer (src/lib/apkUpdate.ts) ; le natif revérifie tout.
 */
@CapacitorPlugin(name = "AkaikyUpdate")
class ApkUpdatePlugin : Plugin() {

    // Démarrage de l'app : une fenêtre d'installation laissée ouverte est refermée.
    override fun load() {
        ApkUpdate.restoreIfNeeded(context)
    }

    /** { versionCode, lastAttemptAt?, lastResult?, running } */
    @PluginMethod
    fun status(call: PluginCall) {
        try {
            val s = ApkUpdate.status(context)
            val out = JSObject().put("versionCode", s["versionCode"]).put("running", s["running"])
            s["lastAttemptAt"]?.let { out.put("lastAttemptAt", it) }
            s["lastResult"]?.let { out.put("lastResult", it) }
            call.resolve(out)
        } catch (e: Exception) {
            Logger.error("AkaikyUpdate", "état illisible", e)
            call.reject("État illisible.", "failed")
        }
    }

    /** { url, sha256, versionCode } : rendu une fois la session remise au système (l'app redémarre ensuite). */
    @PluginMethod
    fun install(call: PluginCall) {
        val url = ApkUpdatePolicy.validUrl(call.getString("url"), BuildConfig.DEBUG)
            ?: return call.reject("Adresse invalide.", "invalid_url")
        val sha = ApkUpdatePolicy.validSha256(call.getString("sha256"))
            ?: return call.reject("Empreinte invalide.", "invalid_sha256")
        val version = call.getData().optLong("versionCode", -1L)
        if (version < 1) return call.reject("Version invalide.", "invalid_version")
        ApkUpdate.install(context, url, sha, version) { code, message ->
            if (code == null) call.resolve(JSObject().put("committed", true)) else call.reject(message, code)
        }
    }
}
