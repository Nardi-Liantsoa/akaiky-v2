package mg.nosytech.akaiky

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * SOS hors ligne (NAR-151), pont vers l'écran (src/native/akaikySos.ts) : lancement du
 * service (SosService.kt), annulation, état, et événements « sosUpdate » quand la WebView
 * est éveillée (sinon l'état se relit par state() à la reprise).
 */
@CapacitorPlugin(name = "AkaikySos")
class SosPlugin : Plugin() {
    override fun load() {
        SosRun.listener = { state -> notifyListeners("sosUpdate", JSObject.fromJSONObject(state)) }
    }

    override fun handleOnDestroy() {
        SosRun.listener = null
    }

    /**
     * { contacts: [{ id, name, phone, position }], emergency, siren, smsWith, smsWithout,
     *   notifyTitle, notifyText, timezone }. Seuls les numéros de la liste reçue par setAllowed
     * sont gardés ; « parent » (SMS, plage « école ») et la plage elle-même sont relus ici
     * (IncomingCalls.parents, SchoolSchedule), jamais reçus de l'écran.
     *
     * Un SOS encore en cours (position, SMS, appels, secours), un lancement pas encore confirmé
     * par le service, ou un SOS gardé qui va être repris refusent un nouveau départ (`already`,
     * avec son état) : jamais deux SOS à la fois. Fini (répondu, annulé, terminé), ou gardé sans
     * signe de vie depuis 2 min (interrompu, effacé), un nouveau SOS repart de zéro.
     * `started: true` ne promet que le lancement demandé : l'écran attend l'état du service
     * (le provisoire porte `pending`) et passe à l'ancien SOS s'il ne vient pas.
     */
    @PluginMethod
    fun start(call: PluginCall) = synchronized(SosRun) { startLocked(call) }

    private fun startLocked(call: PluginCall) {
        val now = System.currentTimeMillis()
        val running = SosService.running
        var saved = SosService.persistedRun(context)
        if (saved != null && SosCascade.staleRun(saved, running != null, now)) {
            SosService.interruptPersisted(context, saved.runId)
            saved = null
        }
        val persistedLive = saved != null && running == null
        val snap = SosRun.snapshot()
        val snapInProgress = snap != null && SosCascade.snapshotInProgress(snap.optBoolean("active"), snap.optBoolean("pending"), snap.optString("status", null))
        if (SosCascade.startBlocked(running?.inProgress() == true, snapInProgress, SosRun.pendingSince, persistedLive, now)) {
            val res = JSObject().put("started", false).put("already", true)
            val state = snap ?: if (persistedLive) resumedState(saved!!.runId) else null
            state?.let { res.put("state", JSObject.fromJSONObject(it)) }
            call.resolve(res)
            return
        }
        val smsWith = call.getString("smsWith")?.take(300)
        val smsWithout = call.getString("smsWithout")?.take(300)
        if (smsWith == null || smsWithout == null) { call.reject("Textes du SMS manquants.", "invalid"); return }
        val allowed = IncomingCalls.allowed(context)
        val parents = IncomingCalls.parents(context)
        val input = call.getArray("contacts") ?: com.getcapacitor.JSArray()
        val contacts = JSONArray()
        for (i in 0 until input.length()) {
            val c = input.optJSONObject(i) ?: continue
            val phone = CallPolicy.normalize(c.optString("phone")) ?: continue
            if (!CallPolicy.isAllowed(phone, allowed)) continue
            contacts.put(JSONObject().put("id", c.optString("id")).put("name", c.optString("name").take(40))
                .put("phone", phone).put("position", c.optInt("position", i)).put("parent", CallPolicy.isAllowed(phone, parents)))
        }
        val emergency = CallPolicy.normalize(call.getString("emergency"))?.takeIf { CallPolicy.isEmergency(it) } ?: "112"
        grantAll()
        val runId = UUID.randomUUID().toString()
        val config = JSONObject()
            .put("runId", runId)
            // Heure de la demande : le service refuse un lancement reçu après le repli de l'écran.
            .put("requestedAt", now)
            .put("contacts", contacts)
            .put("emergency", emergency)
            .put("inSchool", IncomingCalls.inSchool(context))
            .put("siren", call.getBoolean("siren", false) == true)
            .put("smsWith", smsWith).put("smsWithout", smsWithout)
            .put("notifyTitle", call.getString("notifyTitle") ?: "SOS")
            .put("notifyText", call.getString("notifyText") ?: "")
            .put("timezone", call.getString("timezone") ?: "")
        // État du SOS précédent effacé ; lancement marqué en attente AVANT de démarrer le service
        // (un second départ est refusé d'ici sa confirmation) ; état provisoire tout de suite.
        SosRun.clear()
        SosRun.markPending(runId, now)
        SosRun.publish(JSONObject().put("active", true).put("status", "starting").put("pending", true)
            .put("runId", runId).put("startedAt", now))
        try {
            ContextCompat.startForegroundService(context, Intent(context, SosService::class.java).putExtra(SosService.EXTRA_CONFIG, config.toString()))
            call.resolve(JSObject().put("started", true).put("runId", runId))
        } catch (e: Exception) {
            // Service refusé : SMS sans position quand même, l'écran passe à l'appel direct.
            Logger.error("AkaikySos", "SOS non lancé", e)
            val n = SosService.sendSmsBestEffort(context, config)
            SosRun.publish(JSONObject().put("active", false).put("status", "failed").put("runId", runId).put("smsBestEffort", n))
            call.resolve(JSObject().put("started", false).put("failed", true))
        }
    }

    /**
     * « Annuler » de l'enfant ({}), ou repli de l'écran passé à l'appel direct
     * ({ runId, fallback: true }) : ce SOS-là est annulé s'il tourne, et ne sera jamais lancé
     * s'il n'est pas encore arrivé au service (jamais deux SOS à la fois).
     */
    @PluginMethod
    fun cancel(call: PluginCall) {
        val runId = call.getString("runId")
        if (call.getBoolean("fallback", false) == true && runId != null) {
            synchronized(SosRun) {
                SosService.markFallback(context, runId)
                SosRun.dropPending(runId)
            }
        }
        Handler(Looper.getMainLooper()).post {
            val service = SosService.running
            if (service != null && (runId == null || service.runId == runId)) service.onEvent(SosCascade.Event.Cancel)
        }
        call.resolve()
    }

    /** « Appeler les secours » pendant le SOS : cascade arrêtée, composeur ouvert par le service. */
    @PluginMethod
    fun emergency(call: PluginCall) {
        val service = SosService.running
        if (service != null) Handler(Looper.getMainLooper()).post { service.onEvent(SosCascade.Event.Emergency) }
        call.resolve(JSObject().put("handled", service != null))
    }

    /**
     * Jamais un SOS montré « en cours » qui ne tourne pas : lancement jamais confirmé → « failed » ;
     * SOS gardé sans service ni signe de vie depuis 2 min, ou perdu au redémarrage → « interrupted ».
     */
    @PluginMethod
    fun state(call: PluginCall) {
        val state = synchronized(SosRun) { stateLocked(System.currentTimeMillis()) }
        call.resolve(JSObject.fromJSONObject(state))
    }

    private fun stateLocked(now: Long): JSONObject {
        val s = SosRun.snapshot()
        if (s != null) {
            if (s.optBoolean("pending") && !SosCascade.pendingLive(SosRun.pendingSince, now)) SosRun.dropPending(s.optString("runId"))
            return SosRun.snapshot() ?: s
        }
        val saved = SosService.persistedRun(context)
        if (saved != null) {
            if (SosCascade.staleRun(saved, SosService.running != null, now)) return SosService.interruptPersisted(context, saved.runId)
            // Processus tué en plein SOS, service pas encore relancé : l'écran le montre en cours.
            return resumedState(saved.runId)
        }
        SosService.takeInterrupted(context)?.let { id -> return SosService.interruptedState(id).also { SosRun.publish(it) } }
        return JSONObject().put("active", false)
    }

    private fun resumedState(runId: String): JSONObject =
        JSONObject().put("active", true).put("status", "starting").put("resumed", true).put("runId", runId)

    /**
     * Device Owner : SMS, position, état et fin d'appel, journal d'appels et notification
     * accordés d'office (même voie que CALL_PHONE dans CallPlugin), sans demande à l'enfant.
     */
    private fun grantAll() {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = ComponentName(context.packageName, "mg.nosytech.akaiky.AkaikyDeviceAdminReceiver")
        val permissions = buildList {
            add(Manifest.permission.SEND_SMS)
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            add(Manifest.permission.CALL_PHONE)
            add(Manifest.permission.READ_PHONE_STATE)
            add(Manifest.permission.READ_CALL_LOG)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) add(Manifest.permission.ANSWER_PHONE_CALLS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        for (p in permissions) {
            try {
                dpm.setPermissionGrantState(admin, context.packageName, p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
            } catch (e: Exception) {
                Logger.error("AkaikySos", "Permission non accordée : $p", e)
            }
        }
    }
}
