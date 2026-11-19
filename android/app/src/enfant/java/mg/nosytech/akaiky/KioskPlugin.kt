package mg.nosytech.akaiky

import android.content.Intent
import android.provider.Settings
import com.getcapacitor.JSArray
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
    fun arm(call: PluginCall) {
        Kiosk.arm(context)
        // Apps non autorisées cachées dès l'armement (NAR-143), sur le fil des applications
        // (jamais le fil partagé des plugins), puis verrou et réponse depuis le fil principal.
        AllowedApps.onWorker {
            try { AllowedApps.applyHidden(context) } catch (e: Exception) { Logger.error("AkaikyKiosk", "Apps non cachées", e) }
            onMain(call) { Kiosk.enforce(context, activity) }
        }
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

    /**
     * Début ou fin d'une plage « école » vus par le minuteur de l'écran : l'état voulu est
     * réappliqué (liste du lock task sans, puis avec, les apps autorisées), fenêtre de sortie intacte.
     */
    @PluginMethod
    fun refresh(call: PluginCall) = onMain(call) { Kiosk.enforce(context, activity) }

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

    // Applications autorisées (NAR-143). Lecture des paquets et des icônes sur le fil des
    // applications (AllowedApps.onWorker), réponse donnée depuis ce fil : le fil partagé des
    // plugins (SOS, appels) n'est jamais bloqué.

    /** Apps lançables proposées au parent : ni l'app, ni composeur, réglages, navigateurs… */
    @PluginMethod
    fun listLaunchableApps(call: PluginCall) = AllowedApps.onWorker {
        try {
            val apps = JSArray()
            for (a in AllowedApps.list(context)) {
                apps.put(JSObject().apply {
                    put("package", a.pkg)
                    put("label", a.label)
                    put("icon", a.icon ?: JSObject.NULL)
                    if (a.browser) put("browser", true)
                })
            }
            call.resolve(JSObject().apply { put("apps", apps) })
        } catch (e: Exception) {
            Logger.error("AkaikyKiosk", "Liste des apps en échec", e)
            call.reject("Liste des applications indisponible.", "failed")
        }
    }

    /** Liste autorisée par le parent : gardée, appliquée (apps cachées, lock task) si armé. */
    @PluginMethod
    fun applyAllowedApps(call: PluginCall) {
        val requested = try {
            call.getArray("packages")?.toList<Any?>()?.map { it as? String } ?: emptyList()
        } catch (e: Exception) {
            call.reject("Liste invalide.", "invalid")
            return
        }
        AllowedApps.onWorker { applyAllowed(call, requested) }
    }

    private fun applyAllowed(call: PluginCall, requested: List<String?>) {
        val kept: List<String>
        val hidden: Int
        try {
            kept = AllowedApps.store(context, requested)
            hidden = AllowedApps.applyHidden(context)
        } catch (e: Exception) {
            Logger.error("AkaikyKiosk", "Apps autorisées non appliquées", e)
            call.reject("Action impossible sur ce téléphone.", "failed")
            return
        }
        activity.runOnUiThread {
            // Liste du lock task relue (base + autorisées) ; jamais d'échec visible pour ça.
            try { Kiosk.enforce(context, activity) } catch (e: Exception) { Logger.error("AkaikyKiosk", "Verrou non appliqué", e) }
            call.resolve(JSObject().apply {
                put("deviceOwner", Kiosk.isDeviceOwner(context))
                put("armed", Kiosk.isArmed(context))
                put("allowed", JSArray(kept))
                put("hidden", hidden)
            })
        }
    }

    /**
     * Ouvre une app autorisée ; toute autre est refusée, quoi que demande l'écran. Pendant une
     * plage « école » (plages et fuseau reçus par AkaikyCall.setAllowed), refusée aussi.
     */
    @PluginMethod
    fun launchApp(call: PluginCall) {
        val pkg = call.getString("package")
        if (pkg != null && IncomingCalls.inSchool(context)) {
            // Plage vue ici avant l'écran : liste du lock task relue (apps autorisées retirées).
            Kiosk.enforceOnMain(context, activity)
            call.reject("Pas d'application pendant l'école.", "school")
            return
        }
        if (pkg == null || !AllowedApps.canLaunch(context, pkg)) {
            call.reject("Application non autorisée.", "not_allowed")
            return
        }
        val intent = context.packageManager.getLaunchIntentForPackage(pkg)
        if (intent == null) {
            call.reject("Application introuvable.", "not_found")
            return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            Logger.error("AkaikyKiosk", "Lancement refusé", e)
            call.reject("Application introuvable.", "not_found")
        }
    }

    /**
     * Plage « école » active vue par l'écran (minuteur de 60 s, à chaque tour tant que l'app
     * n'est pas devant) : liste du lock task relue (apps autorisées retirées), puis l'app revient
     * au premier plan, devant une app autorisée encore ouverte. Seulement armé, verrouillé (pas
     * pendant une sortie), plage active selon le natif, et jamais pendant un appel en cours.
     */
    @PluginMethod
    fun bringToFront(call: PluginCall) {
        val telecom = context.getSystemService(android.content.Context.TELECOM_SERVICE) as? android.telecom.TelecomManager
        val inCall = try { telecom?.isInCall == true } catch (e: SecurityException) { false }
        val school = IncomingCalls.inSchool(context)
        val bring = Kiosk.isArmed(context) && !Kiosk.isUnlocked(context) && school && !inCall
        activity.runOnUiThread {
            try { Kiosk.enforce(context, activity) } catch (e: Exception) { Logger.error("AkaikyKiosk", "Verrou non appliqué", e) }
            if (bring) Kiosk.bringToFront(context)
            call.resolve(JSObject().apply { put("brought", bring) })
        }
    }
}
