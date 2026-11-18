package mg.nosytech.akaiky

import android.content.Intent
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Pont du mode appareil dédié (NAR-167) vers l'écran de l'enfant (src/native/kiosk.ts).
 * Le code parent est vérifié par l'écran (WebCrypto, hors ligne) ; le natif ne fait
 * qu'ouvrir une fenêtre bornée à 15 minutes et la refermer.
 */
@CapacitorPlugin(name = "AkaikyKiosk")
class KioskPlugin : Plugin() {

    // Chaque reprise de l'app (retour d'un appel, bouton d'accueil, fin de sortie,
    // démarrage) remet l'état voulu : verrou, ou sortie encore ouverte.
    override fun handleOnResume() {
        super.handleOnResume()
        // Jamais de plantage ici : l'app est le lanceur, un plantage en boucle laisserait
        // le téléphone sans écran. Une politique refusée par le constructeur est ignorée.
        try {
            Kiosk.enforce(context, activity)
        } catch (e: Exception) {
            Logger.error("AkaikyKiosk", "Verrou non appliqué", e)
        }
    }

    private fun status(): JSObject = JSObject().apply {
        put("deviceOwner", Kiosk.isDeviceOwner(context))
        put("armed", Kiosk.isArmed(context))
        put("locked", Kiosk.isInLockTask(context))
        Kiosk.unlockedUntil(context)?.let { put("unlockedUntil", it) }
    }

    /** Applique sur le fil principal (lock task), puis répond avec l'état. */
    private fun onMain(call: PluginCall, action: () -> Unit) {
        activity.runOnUiThread {
            try {
                action()
                call.resolve(status())
            } catch (e: SecurityException) {
                call.reject("Action refusée par le système.", "not_allowed")
            } catch (e: Exception) {
                Logger.error("AkaikyKiosk", "Action du verrou en échec", e)
                call.reject("Action impossible sur ce téléphone.", "failed")
            }
        }
    }

    @PluginMethod
    fun status(call: PluginCall) = call.resolve(status())

    /** Téléphone appairé : le verrou s'applique, et à chaque reprise ensuite. */
    @PluginMethod
    fun arm(call: PluginCall) = onMain(call) {
        Kiosk.arm(context)
        Kiosk.enforce(context, activity)
    }

    /** Téléphone retiré par le parent : plus de verrou ni de restriction. */
    @PluginMethod
    fun disarm(call: PluginCall) = onMain(call) { Kiosk.disarm(context, activity) }

    /** Code parent vérifié par l'écran : sortie de `minutes` (15 au plus). */
    @PluginMethod
    fun unlockFor(call: PluginCall) {
        if (!Kiosk.isArmed(context)) {
            call.reject("Téléphone non verrouillé.", "not_armed")
            return
        }
        val minutes = call.getInt("minutes", KioskPolicy.MAX_UNLOCK_MINUTES) ?: KioskPolicy.MAX_UNLOCK_MINUTES
        onMain(call) {
            Kiosk.openWindow(context, minutes)
            Kiosk.enforce(context, activity)
        }
    }

    @PluginMethod
    fun lockNow(call: PluginCall) = onMain(call) {
        Kiosk.closeWindow(context)
        Kiosk.enforce(context, activity)
    }

    /** Réglages du téléphone, pendant une sortie seulement (sinon le lock task les bloque). */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        if (Kiosk.isArmed(context) && !Kiosk.isUnlocked(context)) {
            call.reject("Téléphone verrouillé.", "locked")
            return
        }
        try {
            activity.startActivity(Intent(Settings.ACTION_SETTINGS))
            call.resolve()
        } catch (e: Exception) {
            call.reject("Réglages indisponibles.", "no_settings")
        }
    }
}
