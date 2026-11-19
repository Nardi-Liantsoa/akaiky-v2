package mg.nosytech.akaiky

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.content.SharedPreferences
import android.provider.CallLog
import android.telecom.TelecomManager
import android.telephony.PhoneNumberUtils
import android.telephony.PhoneStateListener
import android.telephony.SmsManager
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * SOS hors ligne (NAR-151), service au premier plan (notification « SOS en cours ») : il
 * survit à l'écran éteint et à la WebView endormie. Dans l'ordre : sirène (si le parent
 * l'a activée), position (dernière connue, sinon un relevé GPS de 10 s au plus), SMS aux
 * parents (SmsManager, sans Internet), puis cascade d'appels (SosCascade.kt).
 *
 * La position ne part QUE dans le SMS, de téléphone à téléphone : jamais vers notre serveur,
 * jamais dans les journaux (ni numéro). L'écran reçoit l'état par SosRun (SosPlugin.kt).
 *
 * Processus tué (START_REDELIVER_INTENT) : l'avancement est gardé dans les préférences
 * privées (SosCascade.Progress : étapes, état des SMS, jamais de numéro ni de position) et le
 * SOS reprend sans renvoyer un SMS déjà confirmé. Chaque lancement porte un `runId` : un
 * nouveau SOS (le précédent fini) repart de zéro, une redistribution reprend le sien.
 */
class SosService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var config: JSONObject
    private lateinit var plan: SosCascade.Plan
    var runId = ""
        private set
    @Volatile private var state: SosCascade.State? = null
    private var startedAt = 0L
    @Volatile private var finished = false
    private var resumed = false
    private var siren: Siren? = null
    private var positionKnown: Boolean? = null
    /** Position en cours de recherche : le service ne s'arrête pas avant le SMS. */
    private var locating = false
    /** SMS confiés à SmsManager : la fin attend leur résultat (30 s au plus). */
    private var smsHandedOver = false
    private val smsStatus = LinkedHashMap<String, String>()
    private val smsRemaining = HashMap<String, Int>()
    /** État des appels lisible (READ_PHONE_STATE) : sinon, créneau fixe par appel (sans dialTimeout). */
    private var callStateKnown = false
    /** Fin : état final atteint, sirène muette, SMS tous revenus (30 s au plus après la fin). */
    private var quietSince = 0L

    /** Appel sortant en cours : numéro, heure de lancement, coupure prévue, état vu. */
    private class Call(val index: Int, val number: String, val placedAt: Long, val timeout: Boolean) {
        var offhookAt = 0L
        /** Coupé par nous (endCall a réussi) : la fin ne dépend plus du réseau. */
        var endedByUs = false
        /** Entrée de cet appel vue au journal d'appels : il est fini (écrite après le raccroché). */
        var logSeen = false
    }
    private var current: Call? = null
    /** Dernier appel lancé par ce SOS : le suivant attend qu'il soit fini (whenIdle). */
    private var lastCall: Call? = null
    /** Appel trouvé en cours à la reprise (processus tué) : gardé tant qu'on attend sa fin. */
    private var checking: Call? = null
    /** Attente d'une ligne libre (whenIdle) : relancée tout de suite à CALL_STATE_IDLE. */
    private var idleCheck: Runnable? = null
    private var telephonyCallback: Any? = null
    private var smsReceiver: BroadcastReceiver? = null
    private var locationListener: LocationListener? = null

    override fun onBind(intent: Intent?): IBinder? = null

    private val prefs: SharedPreferences get() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** SOS en cours (position, SMS, appels ou secours) : un nouveau départ est refusé. */
    fun inProgress(): Boolean = SosCascade.inProgress(running === this, finished, state?.status)

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val raw = intent?.getStringExtra(EXTRA_CONFIG)
        // Redémarré par le système sans intention : rien à reprendre.
        if (raw == null) {
            if (running !== this) stopSelf()
            return START_NOT_STICKY
        }
        val cfg = try { JSONObject(raw) } catch (e: Exception) { null }
        if (cfg == null) { if (running !== this) stopSelf(); return START_NOT_STICKY }
        val id = cfg.optString("runId")
        // Même SOS reçu deux fois pendant qu'il tourne : rien de neuf.
        if (running === this && id == runId && !finished) return START_REDELIVER_INTENT
        // Un autre SOS est en cours : celui-ci est refusé (jamais deux SOS à la fois) et jamais
        // redistribué (START_NOT_STICKY) ; le SOS en cours garde son appel et son intention.
        if (running === this && id != runId && inProgress()) {
            Log.w(TAG, "Nouveau SOS refusé : un SOS est déjà en cours")
            SosRun.dropPending(id)
            return START_NOT_STICKY
        }
        val redelivered = flags and START_FLAG_REDELIVERY != 0
        val saved = SosCascade.Progress.fromJson(prefs.getString(KEY_PROGRESS, null))?.takeIf { it.runId == id }
        // Redistribution sans avancement gardé (SOS fini, interrompu ou refusé) : jamais rejoué.
        if (redelivered && saved == null) {
            if (running !== this) stopSelf(startId)
            return START_NOT_STICKY
        }
        // L'écran est déjà passé à l'appel direct (repli signalé, ou lancement reçu trop tard) :
        // ce SOS n'est jamais lancé, sinon deux SOS tourneraient à la fois.
        if (SosCascade.dropStart(cfg.optLong("requestedAt"), System.currentTimeMillis(), prefs.getString(KEY_FALLBACK, null) == id, redelivered)) {
            Log.w(TAG, "SOS abandonné : l'écran est passé à l'appel direct")
            if (saved != null) prefs.edit().remove(KEY_PROGRESS).putString(KEY_DONE, id).commit()
            SosRun.dropPending(id)
            if (running !== this) stopSelf(startId)
            return START_NOT_STICKY
        }
        // Le plugin a refusé un nouveau départ pendant un SOS en cours ; ici, l'ancien est fini :
        // ses écouteurs, minuteries et sirène sont libérés avant le nouveau (jamais l'appel en cours).
        if (running === this) release()
        config = cfg
        runId = id
        resetRun()
        if (!goForeground()) {
            // Sans premier plan, Android arrêterait le service : SMS sans position tout de suite,
            // l'écran (état « failed ») passe à l'ancien SOS (appel direct).
            val n = sendSmsBestEffort(this, config)
            Log.w(TAG, "SOS sans premier plan : $n SMS confié(s), repli de l'écran")
            SosRun.publish(JSONObject().put("active", false).put("status", "failed").put("runId", runId).put("smsBestEffort", n))
            clearProgress()
            // Fini d'office : onDestroy ne publie pas un « interrompu » par-dessus « failed ».
            finished = true
            if (running === this) running = null
            stopSelf()
            return START_NOT_STICKY
        }
        running = this
        if (saved != null) resume(saved) else begin()
        handler.postDelayed(touch, TOUCH_MS)
        return START_REDELIVER_INTENT
    }

    /** Tous les champs propres à un SOS remis à zéro avant chaque départ (ou reprise). */
    private fun resetRun() {
        finished = false
        resumed = false
        state = null
        quietSince = 0L
        siren = null
        positionKnown = null
        locating = false
        smsHandedOver = false
        smsStatus.clear()
        smsRemaining.clear()
        current = null
        lastCall = null
        checking = null
        idleCheck = null
        callStateKnown = false
        startedAt = System.currentTimeMillis()
        handler.removeCallbacksAndMessages(null)
    }

    /** Signe de vie gardé toutes les TOUCH_MS : sans lui, l'écran dira le SOS interrompu. */
    private val touch = object : Runnable {
        override fun run() {
            if (finished) return
            persist()
            handler.postDelayed(this, TOUCH_MS)
        }
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun goForeground(): Boolean {
        return try {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, config.optString("notifyTitle", "SOS"), NotificationManager.IMPORTANCE_HIGH))
            val open = PendingIntent.getActivity(this, 0, packageManager.getLaunchIntentForPackage(packageName) ?: Intent(), PendingIntent.FLAG_IMMUTABLE)
            val notification = NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(config.optString("notifyTitle", "SOS"))
                .setContentText(config.optString("notifyText", ""))
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(open)
                .build()
            // Android 14 : type déclaré au manifeste ET permission correspondante accordée.
            // Position refusée : le service part quand même, en « appel » seul.
            val phone = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL else 0
            val location = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && granted(Manifest.permission.ACCESS_FINE_LOCATION)) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
            for (types in listOf(phone or location, phone).distinct()) {
                try {
                    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types)
                    return true
                } catch (e: Exception) {
                    Log.w(TAG, "Premier plan refusé (types $types)", e)
                }
            }
            false
        } catch (e: Exception) {
            Log.w(TAG, "Notification du SOS impossible", e)
            false
        }
    }

    private fun startSiren(durationMs: Long) {
        if (!config.optBoolean("siren", false) || durationMs <= 0) return
        siren = Siren(this).also { it.start() }
        handler.postDelayed({ siren?.stop(); publish(); finishIfQuiet() }, durationMs)
    }

    private fun begin() {
        plan = planOf(config)
        plan.sms.forEach { smsStatus[it.id] = "pending" }
        persist()
        Log.i(TAG, "SOS lancé : ${plan.sms.size} SMS, ${plan.calls.size} appel(s), plage école ${config.optBoolean("inSchool", false)}")
        listenCalls()
        startSiren(SosCascade.SIREN_MAX_S * 1000L)
        publish()
        // Annulé pendant la recherche de position : ni SMS ni appel. Un parent qui appelle,
        // ou les secours choisis par l'enfant, n'empêchent pas le SMS aux autres parents.
        locateAndSend(plan.sms) { if (state == null) apply(SosCascade.start(plan)) else finishIfQuiet() }
    }

    /** Reprise après la mort du processus : jamais un SMS confirmé renvoyé. */
    private fun resume(p: SosCascade.Progress) {
        resumed = true
        startedAt = p.startedAt
        plan = planOf(config)
        plan.sms.forEach { smsStatus[it.id] = p.sms[it.id] ?: "pending" }
        state = p.state
        val r = SosCascade.resume(plan, p)
        r.smsTo.forEach { smsStatus[it.id] = "pending" }
        Log.i(TAG, "SOS repris : ${r.kind.name.lowercase()}, ${r.smsTo.size} SMS à renvoyer")
        listenCalls()
        val s = p.state
        if (s == null || s.status == SosCascade.Status.CALLING || s.status == SosCascade.Status.EMERGENCY) {
            startSiren(SosCascade.SIREN_MAX_S * 1000L - (System.currentTimeMillis() - startedAt))
        }
        persist()
        publish()
        when (r.kind) {
            SosCascade.ResumeKind.RESTART -> locateAndSend(r.smsTo) { if (state == null) apply(SosCascade.start(plan)) else finishIfQuiet() }
            SosCascade.ResumeKind.CHECK_CALL -> {
                if (r.smsTo.isNotEmpty()) locateAndSend(r.smsTo) { finishIfQuiet() }
                checkInterruptedCall(s!!, p.callPlacedAt)
            }
            SosCascade.ResumeKind.EMERGENCY -> if (r.smsTo.isNotEmpty()) locateAndSend(r.smsTo) { finishIfQuiet() } else finishIfQuiet()
            SosCascade.ResumeKind.DONE -> finishIfQuiet()
        }
    }

    /**
     * Appel en cours quand le processus est mort : attendre qu'il finisse, puis le journal
     * décide (décroché ou non). Journal muet : le même contact est rappelé (jamais un
     * « décroché » supposé sur un temps qui compte la mort du processus).
     */
    private fun checkInterruptedCall(s: SosCascade.State, placedAt: Long) {
        val target = plan.calls.getOrNull(s.index)
        // Plus de contact à cet index : suite de la cascade ; heure d'appel inconnue : rappel.
        if (target == null) { apply(SosCascade.step(plan, s, SosCascade.Event.Failed)); return }
        if (placedAt == 0L) { apply(SosCascade.Step(s.copy(redial = false), listOf(SosCascade.Action.Call(s.index, true)))); return }
        val call = Call(s.index, target.number, placedAt, !s.redial)
        checking = call
        lastCall = call
        // Peut-être encore en ligne : sirène en pause, comme pendant tout appel.
        if (!callStateKnown) siren?.pause()
        // Jamais coupé par nous : sans état des appels lisible, fini seulement quand le journal le montre.
        awaitCallEnd(call, true) { found ->
            if (checking === call) checking = null
            if (finished || state != s) return@awaitCallEnd
            if (found != null) onEvent(SosCascade.Event.Ended(found, false))
            else apply(SosCascade.Step(s.copy(redial = false), listOf(SosCascade.Action.Call(s.index, true))))
        }
    }

    private fun locateAndSend(targets: List<SosCascade.Target>, then: () -> Unit) {
        locating = true
        locate { loc ->
            locating = false
            if (finished || state?.status == SosCascade.Status.CANCELLED) { finishIfQuiet(); return@locate }
            sendSms(loc, targets)
            then()
        }
    }

    // --- Position -----------------------------------------------------------------------

    private fun locate(done: (Location?) -> Unit) {
        val lm = getSystemService(LocationManager::class.java)
        if (lm == null || !(granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION))) return done(null)
        val providers = buildList {
            add(LocationManager.GPS_PROVIDER); add(LocationManager.NETWORK_PROVIDER)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(LocationManager.FUSED_PROVIDER)
        }.filter { try { lm.isProviderEnabled(it) } catch (e: Exception) { false } }
        val last = providers.mapNotNull { try { lm.getLastKnownLocation(it) } catch (e: SecurityException) { null } }.maxByOrNull { it.time }
        // Récente (2 min) et précise (100 m) : pas d'attente.
        if (last != null && System.currentTimeMillis() - last.time < 120_000 && last.hasAccuracy() && last.accuracy <= 100) return done(last)
        if (providers.isEmpty()) return done(last)
        var over = false
        lateinit var timeout: Runnable
        val finish = { l: Location? ->
            if (!over) {
                over = true
                handler.removeCallbacks(timeout)
                locationListener?.let { try { lm.removeUpdates(it) } catch (e: Exception) { } }
                locationListener = null
                done(l ?: last)
            }
        }
        timeout = Runnable { finish(null) }
        // Toutes les méthodes écrites : abstraites jusqu'à Android 10 (AbstractMethodError sinon).
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) { finish(location) }
            @Deprecated("API 29") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }
        locationListener = listener
        // GPS, réseau et, sur Android 12+, le fournisseur « fused » : le premier relevé gagne.
        var requested = 0
        for (p in providers) {
            try { lm.requestLocationUpdates(p, 1000L, 0f, listener, Looper.getMainLooper()); requested++ } catch (e: Exception) { }
        }
        // Aucun fournisseur demandé : inutile d'attendre 10 s, SMS tout de suite.
        if (requested == 0) { finish(null); return }
        handler.postDelayed(timeout, SosCascade.LOCATION_TIMEOUT_S * 1000L)
    }

    // --- SMS ----------------------------------------------------------------------------

    private fun sendSms(loc: Location?, targets: List<SosCascade.Target>) {
        positionKnown = loc != null
        if (targets.isEmpty()) { persist(); publish(); return }
        smsHandedOver = true
        val time = { t: Long -> DateTimeFormatter.ofPattern("HH:mm").withZone(SchoolSchedule.zone(config.optString("timezone", ""))).format(Instant.ofEpochMilli(t)) }
        val text = if (loc != null) SosCascade.fillSms(config.getString("smsWith"), loc.latitude, loc.longitude, if (loc.hasAccuracy()) loc.accuracy else 0f, time(loc.time))
        else config.getString("smsWithout")
        val run = runId
        if (smsReceiver == null) {
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    // Résultat d'un SOS précédent : ignoré (adresse propre à chaque SOS).
                    if (intent.data?.host != runId.lowercase()) return
                    val id = intent.getStringExtra("id") ?: return
                    val ok = resultCode == Activity.RESULT_OK
                    Log.i(TAG, "SMS ${intent.getIntExtra("n", 0) + 1} : résultat ${if (ok) "OK" else "erreur $resultCode"}")
                    if (smsStatus[id] != "pending") return
                    if (!ok) smsStatus[id] = "failed"
                    else {
                        val left = (smsRemaining[id] ?: 1) - 1
                        smsRemaining[id] = left
                        if (left <= 0) smsStatus[id] = "sent"
                    }
                    persist()
                    publish()
                    finishIfQuiet()
                }
            }
            val filter = IntentFilter(SMS_SENT).apply { addDataScheme(SMS_SCHEME) }
            ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            smsReceiver = receiver
        }
        val sms = smsManager(this)
        targets.forEach { t ->
            val i = plan.sms.indexOfFirst { it.id == t.id }.coerceAtLeast(0)
            try {
                if (sms == null) throw IllegalStateException("pas de SmsManager")
                val parts = sms.divideMessage(text)
                smsRemaining[t.id] = parts.size
                smsStatus[t.id] = "pending"
                val sent = ArrayList(parts.indices.map { k ->
                    val uri = Uri.Builder().scheme(SMS_SCHEME).authority(run.lowercase()).appendPath(t.id).appendPath(k.toString()).build()
                    PendingIntent.getBroadcast(this, 1000 + i * 10 + k, Intent(SMS_SENT, uri).setPackage(packageName).putExtra("id", t.id).putExtra("n", i),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                })
                sms.sendMultipartTextMessage(t.number, null, parts, sent, null)
                Log.i(TAG, "SMS ${i + 1}/${plan.sms.size} confié à SmsManager (${parts.size} partie(s), ${text.length} caractères, position ${loc != null})")
            } catch (e: Exception) {
                smsStatus[t.id] = "failed"
                Log.w(TAG, "SMS ${i + 1} impossible : ${e.javaClass.simpleName}")
            }
        }
        persist()
        publish()
    }

    // --- Appels -------------------------------------------------------------------------

    private fun listenCalls() {
        val tm = getSystemService(TelephonyManager::class.java) ?: return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                    override fun onCallStateChanged(state: Int) { onCallState(state, null) }
                }
                tm.registerTelephonyCallback(ContextCompat.getMainExecutor(this), cb)
                telephonyCallback = cb
            } else {
                // Numéro de l'appelant fourni avec READ_CALL_LOG (Android 9+) ; sinon vide.
                @Suppress("DEPRECATION")
                val l = object : PhoneStateListener() {
                    @Deprecated("API 31") override fun onCallStateChanged(state: Int, phoneNumber: String?) { onCallState(state, phoneNumber) }
                }
                @Suppress("DEPRECATION") tm.listen(l, PhoneStateListener.LISTEN_CALL_STATE)
                telephonyCallback = l
            }
            callStateKnown = true
        } catch (e: SecurityException) {
            // Sans READ_PHONE_STATE : créneau fixe par appel puis journal d'appels (placeCall).
            callStateKnown = false
            Log.w(TAG, "État des appels illisible : créneau fixe par appel", e)
        }
    }

    private fun onCallState(s: Int, number: String?) {
        if (finished) return
        val call = current
        when (s) {
            // Tout appel en ligne (cascade, secours composés par l'enfant) : sirène en pause.
            TelephonyManager.CALL_STATE_OFFHOOK -> {
                siren?.pause()
                if (call == null || call.offhookAt != 0L) return
                call.offhookAt = System.currentTimeMillis()
                handler.removeCallbacks(dialTimeout)
                Log.i(TAG, "Appel ${call.index + 1} en ligne")
                if (call.timeout) handler.postDelayed(noAnswer, SosCascade.NO_ANSWER_S * 1000L)
                publish()
            }
            TelephonyManager.CALL_STATE_IDLE -> {
                siren?.resume()
                // Une attente de ligne libre est revérifiée tout de suite.
                idleCheck?.let { handler.removeCallbacks(it); handler.post(it) }
                if (call == null || call.offhookAt == 0L) return
                handler.removeCallbacks(noAnswer)
                current = null
                Log.i(TAG, "Appel ${call.index + 1} terminé (coupé par nous : ${call.endedByUs})")
                connectedSeconds(call) { d ->
                    Log.i(TAG, "Appel ${call.index + 1} : $d s connectées")
                    onEvent(SosCascade.Event.Ended(d, call.endedByUs))
                }
            }
            // Le téléphone sonne : seul un contact joignable prend le relais ; un inconnu est
            // ignoré (le filtre le rejette, la cascade continue).
            TelephonyManager.CALL_STATE_RINGING -> if (call == null) {
                val readings = number?.takeIf { it.isNotBlank() }?.let { IncomingCalls.candidates(it, IncomingCalls.countries(this)) }
                val from = SosCascade.ringFromContact(readings, IncomingCalls.reachable(this), IncomingCalls.screenedAllowedAt(this), System.currentTimeMillis())
                Log.i(TAG, "Appel entrant pendant le SOS : ${if (from) "contact" else "inconnu, ignoré"}")
                onEvent(SosCascade.Event.Ring(from))
            }
        }
    }

    private val dialTimeout = Runnable {
        val call = current ?: return@Runnable
        if (call.offhookAt != 0L) return@Runnable
        Log.i(TAG, "Appel ${call.index + 1} jamais parti")
        current = null
        onEvent(SosCascade.Event.Failed)
    }

    private val noAnswer = Runnable {
        val call = current ?: return@Runnable
        call.endedByUs = true
        Log.i(TAG, "Appel ${call.index + 1} : ${SosCascade.NO_ANSWER_S} s en ligne, coupé")
        if (!endCall()) {
            // Android 8.x : impossible de raccrocher ; l'appel finit par le réseau.
            call.endedByUs = false
        }
    }

    /**
     * Sans état des appels : créneau fixe. NO_ANSWER_S après le lancement, l'appel est coupé,
     * puis (plus d'appel en cours) le journal décide : décroché ou non. Jamais dialTimeout.
     */
    private val slotEnd = Runnable {
        val call = current ?: return@Runnable
        call.endedByUs = endCall()
        Log.i(TAG, "Appel ${call.index + 1} : fin du créneau de ${SosCascade.NO_ANSWER_S} s (coupé : ${call.endedByUs})")
        // Pas coupé (Android 8, permission refusée) : l'appel peut durer ; la cascade attend son
        // entrée au journal d'appels (30 min au plus), jamais un « libre » supposé.
        awaitCallEnd(call, !call.endedByUs) { found ->
            if (current !== call) return@awaitCallEnd
            current = null
            onEvent(SosCascade.Event.Ended(SosCascade.connected(found, null, call.timeout), call.endedByUs))
        }
    }

    /** Sans état des appels, rappel sans coupure : fin repérée dans le journal (30 min au plus). */
    private fun pollRedial(call: Call) {
        awaitCallEnd(call, true) { found ->
            if (current !== call) return@awaitCallEnd
            current = null
            onEvent(SosCascade.Event.Ended(found ?: 0, false))
        }
    }

    /**
     * Fin d'un appel : isInCall lisible, dès qu'il est faux ; illisible, dès que l'entrée de
     * l'appel apparaît au journal quand on n'a pas pu le couper (logRequired), 30 min au plus
     * depuis son lancement (SosCascade.lineFree). Rend la durée connectée du journal, ou null.
     */
    private fun awaitCallEnd(call: Call, logRequired: Boolean, done: (Long?) -> Unit) {
        if (finished) return
        val inCall = isInCall()
        val log = if (inCall == true) null else readCallLog(call)
        if (log != null) call.logSeen = true
        if (!SosCascade.lineFree(inCall, log != null, logRequired, System.currentTimeMillis() - call.placedAt)) {
            handler.postDelayed({ awaitCallEnd(call, logRequired, done) }, LINE_POLL_MS)
            return
        }
        // Sans état des appels, la sirène était en pause depuis le lancement de l'appel.
        if (!callStateKnown) siren?.resume()
        if (log != null) done(log)
        else readCallLogRetry(call, 0) { found -> if (found != null) call.logSeen = true; done(found) }
    }

    /** TelecomManager.isInCall (READ_PHONE_STATE) ; null si illisible. */
    private fun isInCall(): Boolean? {
        if (!granted(Manifest.permission.READ_PHONE_STATE)) return null
        return try { getSystemService(TelecomManager::class.java)?.isInCall } catch (e: Exception) { null }
    }

    /**
     * Jamais d'appel lancé pendant un appel en cours. isInCall lisible et vrai : on attend, sans
     * limite, qu'il passe à faux (ou CALL_STATE_IDLE). Illisible (jamais pris pour « libre ») : le
     * dernier appel de ce SOS qu'on n'a pas coupé doit avoir son entrée au journal (30 min au plus).
     */
    private fun whenIdle(then: () -> Unit) {
        if (finished) return
        val inCall = isInCall()
        val prev = lastCall
        val required = prev != null && !prev.logSeen && !prev.endedByUs
        val seen = required && inCall == null && readCallLog(prev!!)?.also { prev.logSeen = true } != null
        val waited = if (prev != null) System.currentTimeMillis() - prev.placedAt else 0L
        if (SosCascade.lineFree(inCall, seen, required, waited)) { idleCheck = null; then(); return }
        val retry = Runnable { whenIdle(then) }
        idleCheck = retry
        handler.postDelayed(retry, 1000)
    }

    /**
     * Durée connectée : journal d'appels (écrit par Android juste après la fin), 10 essais d'une
     * seconde ; introuvable ou illisible : appel minuté = 0 (pas décroché, contact suivant),
     * rappel sans coupure = temps « en ligne » mesuré (SosCascade.connected).
     */
    private fun connectedSeconds(call: Call, done: (Long) -> Unit) {
        readCallLogRetry(call, 0) { found ->
            val offhook = if (call.offhookAt != 0L) (System.currentTimeMillis() - call.offhookAt) / 1000 else null
            done(SosCascade.connected(found, offhook, call.timeout))
        }
    }

    private fun readCallLogRetry(call: Call, attempt: Int, done: (Long?) -> Unit) {
        handler.postDelayed({
            val found = readCallLog(call)
            when {
                found != null -> done(found)
                granted(Manifest.permission.READ_CALL_LOG) && attempt < CALL_LOG_TRIES - 1 -> readCallLogRetry(call, attempt + 1, done)
                else -> done(null)
            }
        }, 1000)
    }

    private fun readCallLog(call: Call): Long? {
        if (!granted(Manifest.permission.READ_CALL_LOG)) return null
        return try {
            contentResolver.query(
                CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DURATION),
                "${CallLog.Calls.TYPE} = ? AND ${CallLog.Calls.DATE} >= ?",
                arrayOf(CallLog.Calls.OUTGOING_TYPE.toString(), (call.placedAt - 5000).toString()),
                "${CallLog.Calls.DATE} DESC"
            )?.use { c ->
                while (c.moveToNext()) {
                    if (PhoneNumberUtils.compare(this, c.getString(0) ?: continue, call.number)) return@use c.getLong(1)
                }
                null
            }
        } catch (e: Exception) { null }
    }

    private fun placeCall(index: Int, timeout: Boolean) {
        whenIdle {
            // Annulé, répondu ou passé ailleurs pendant l'attente : rien.
            val s = state
            if (finished || s == null || s.status != SosCascade.Status.CALLING || s.index != index) return@whenIdle
            dial(index, timeout)
        }
    }

    private fun dial(index: Int, timeout: Boolean) {
        val target = plan.calls[index]
        // Liste blanche du natif (et parents seuls pendant une plage), quoi que dise l'écran.
        if (!CallPolicy.isAllowed(target.number, IncomingCalls.reachable(this))) {
            Log.w(TAG, "Appel ${index + 1} refusé : numéro hors liste")
            handler.post { onEvent(SosCascade.Event.Failed) }
            return
        }
        val call = Call(index, target.number, System.currentTimeMillis(), timeout)
        current = call
        lastCall = call
        // Sans état des appels, aucun « en ligne » ne viendra : sirène en pause jusqu'à la fin connue.
        if (!callStateKnown) siren?.pause()
        try {
            getSystemService(TelecomManager::class.java).placeCall(Uri.fromParts("tel", target.number, null), Bundle())
            Log.i(TAG, "Appel ${index + 1}/${plan.calls.size} lancé${if (timeout) "" else " (rappel sans coupure)"}${if (callStateKnown) "" else ", créneau fixe"}")
            persist()
            when {
                callStateKnown -> handler.postDelayed(dialTimeout, SosCascade.DIAL_TIMEOUT_S * 1000L)
                timeout -> handler.postDelayed(slotEnd, SosCascade.NO_ANSWER_S * 1000L)
                else -> pollRedial(call)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Appel ${index + 1} impossible : ${e.javaClass.simpleName}")
            current = null
            lastCall = null
            if (!callStateKnown) siren?.resume()
            handler.post { onEvent(SosCascade.Event.Failed) }
        }
    }

    /** Raccroche l'appel en cours (Android 9+, ANSWER_PHONE_CALLS accordée par la politique). */
    private fun endCall(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || !granted(Manifest.permission.ANSWER_PHONE_CALLS)) return false
        return try {
            @Suppress("DEPRECATION") getSystemService(TelecomManager::class.java).endCall()
        } catch (e: Exception) { false }
    }

    private fun dialEmergency() {
        val number = plan.emergency
        Log.i(TAG, "Composeur des secours")
        if (!CallPolicy.isEmergency(number)) return
        // Android interdit l'appel direct d'un numéro d'urgence à une app : composeur prérempli.
        try {
            startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            Log.w(TAG, "Composeur indisponible", e)
        }
    }

    // --- Machine à états ----------------------------------------------------------------

    fun onEvent(event: SosCascade.Event) {
        val s = state
        if (finished || !::plan.isInitialized) return
        if (s == null) {
            // Avant la première étape (position, SMS) : rien ne sera appelé ; annulé, pas de SMS.
            val answered = SosCascade.Step(SosCascade.State(SosCascade.Status.ANSWERED, -1, false), listOf(SosCascade.Action.StopSiren))
            when (event) {
                SosCascade.Event.Cancel ->
                    apply(SosCascade.Step(SosCascade.State(SosCascade.Status.CANCELLED, -1, false), listOf(SosCascade.Action.StopSiren)))
                SosCascade.Event.Incoming -> apply(answered)
                is SosCascade.Event.Ring -> if (event.fromContact) apply(answered)
                SosCascade.Event.Emergency ->
                    apply(SosCascade.Step(SosCascade.State(SosCascade.Status.EMERGENCY, plan.calls.size, false), listOf(SosCascade.Action.DialEmergency)))
                else -> {}
            }
            return
        }
        apply(SosCascade.step(plan, s, event))
    }

    private fun apply(step: SosCascade.Step) {
        state = step.state
        for (a in step.actions) when (a) {
            is SosCascade.Action.Call -> placeCall(a.index, a.timeout)
            SosCascade.Action.EndCall -> {
                handler.removeCallbacks(noAnswer); handler.removeCallbacks(dialTimeout); handler.removeCallbacks(slotEnd)
                val ended = endCall()
                current?.endedByUs = ended
                // Sans état des appels : sirène reprise seulement si l'appel est bien coupé.
                if (!callStateKnown && ended) siren?.resume()
                current = null
            }
            SosCascade.Action.DialEmergency -> dialEmergency()
            SosCascade.Action.StopSiren -> siren?.stop()
        }
        persist()
        publish()
        finishIfQuiet()
    }

    private fun finishIfQuiet() {
        val s = state ?: return
        if (finished || s.status == SosCascade.Status.CALLING || locating) return
        // Liste épuisée : le service tient tant que la sirène sonne (2 min au plus).
        if (s.status == SosCascade.Status.EMERGENCY && siren?.isStopped == false) return
        if (quietSince == 0L) quietSince = System.currentTimeMillis()
        if (smsHandedOver && smsStatus.values.any { it == "pending" } && System.currentTimeMillis() - quietSince < 30_000) {
            handler.postDelayed({ finishIfQuiet() }, 1000)
            return
        }
        finished = true
        publish()
        clearProgress()
        cleanup()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        Log.i(TAG, "SOS terminé : ${s.status.name.lowercase()}")
    }

    // --- Avancement gardé ---------------------------------------------------------------

    private fun persist() {
        if (finished || runId.isEmpty()) return
        val now = System.currentTimeMillis()
        val p = SosCascade.Progress(runId, startedAt, LinkedHashMap(smsStatus), state, (current ?: checking)?.placedAt ?: 0L, now)
        prefs.edit().putString(KEY_PROGRESS, p.toJson()).commit()
    }

    /** SOS fini : avancement effacé, son identifiant gardé pour ne jamais le rejouer. */
    private fun clearProgress() {
        prefs.edit().remove(KEY_PROGRESS).putString(KEY_DONE, runId).commit()
    }

    /** Écouteurs, minuteries, sirène et récepteur libérés (le SOS en cours garde son appel). */
    private fun release() {
        handler.removeCallbacksAndMessages(null)
        siren?.stop()
        smsReceiver?.let { try { unregisterReceiver(it) } catch (e: Exception) { } }
        smsReceiver = null
        locationListener?.let { l -> try { getSystemService(LocationManager::class.java)?.removeUpdates(l) } catch (e: Exception) { } }
        locationListener = null
        val tm = getSystemService(TelephonyManager::class.java)
        val cb = telephonyCallback
        if (tm != null && cb != null) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && cb is TelephonyCallback) tm.unregisterTelephonyCallback(cb)
                else if (cb is PhoneStateListener) @Suppress("DEPRECATION") tm.listen(cb, PhoneStateListener.LISTEN_NONE)
            } catch (e: Exception) { }
        }
        telephonyCallback = null
    }

    private fun cleanup() {
        release()
        if (running === this) running = null
    }

    override fun onDestroy() {
        if (!finished) {
            finished = true
            cleanup()
            // Arrêté avant la fin (par le système) : l'écran le voit, jamais un SOS muet.
            if (::plan.isInitialized) { clearProgress(); publish(interrupted = true) }
        }
        super.onDestroy()
    }

    /** État pour l'écran : jamais la position ni un numéro, seulement prénoms et étapes. */
    private fun publish(interrupted: Boolean = false) {
        if (!::plan.isInitialized) return
        val s = state
        val o = JSONObject()
            .put("active", !finished)
            .put("status", if (interrupted) "interrupted" else s?.status?.name?.lowercase() ?: "starting")
            .put("runId", runId)
            .put("startedAt", startedAt)
            .put("index", s?.index ?: 0)
            .put("redial", s?.redial ?: false)
            .put("inCall", current?.offhookAt?.let { it != 0L } ?: false)
            .put("calls", JSONArray(plan.calls.map { it.name }))
            .put("sms", JSONArray(plan.sms.map { JSONObject().put("id", it.id).put("name", it.name).put("status", smsStatus[it.id] ?: "pending") }))
            .put("siren", siren?.playing ?: false)
            .put("emergency", plan.emergency)
        if (resumed) o.put("resumed", true)
        if (interrupted) o.put("interrupted", true)
        positionKnown?.let { o.put("positionKnown", it) }
        if (s?.status == SosCascade.Status.ANSWERED) o.put("answeredBy", if (s.index < 0) "incoming" else plan.calls.getOrNull(s.index)?.name ?: "")
        SosRun.publish(o)
    }

    companion object {
        private const val TAG = "AkaikySos"
        const val EXTRA_CONFIG = "config"
        private const val CHANNEL = "sos"
        private const val NOTIFICATION_ID = 1510
        private const val SMS_SENT = "mg.nosytech.akaiky.SOS_SMS_SENT"
        private const val SMS_SCHEME = "akaikysos"
        private const val CALL_LOG_TRIES = 10
        private const val LINE_POLL_MS = 2000L
        private const val TOUCH_MS = 30_000L
        const val PREFS = "akaiky.sos"
        private const val KEY_PROGRESS = "progress"
        private const val KEY_DONE = "doneRunId"
        /** SOS que l'écran a remplacé par l'appel direct : jamais lancé ensuite. */
        private const val KEY_FALLBACK = "fallbackRunId"
        /** SOS perdu au redémarrage du téléphone : dit une fois à l'écran. */
        private const val KEY_INTERRUPTED = "interruptedRunId"
        @Volatile var running: SosService? = null

        fun planOf(config: JSONObject): SosCascade.Plan {
            val contacts = config.getJSONArray("contacts")
            val list = (0 until contacts.length()).map {
                val c = contacts.getJSONObject(it)
                SosCascade.Contact(c.getString("id"), c.getString("name"), c.getString("phone"), c.optInt("position", it), c.optBoolean("parent", false))
            }
            return SosCascade.plan(list, config.getString("emergency"), config.optBoolean("inSchool", false))
        }

        private fun smsManager(context: Context): SmsManager? = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) context.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
        } catch (e: Exception) { null }

        /** Dernier recours (service impossible) : SMS sans position, sans suivi. Rend le nombre confié. */
        fun sendSmsBestEffort(context: Context, config: JSONObject): Int {
            val sms = smsManager(context) ?: return 0
            val plan = try { planOf(config) } catch (e: Exception) { return 0 }
            val text = config.optString("smsWithout", "")
            if (text.isEmpty()) return 0
            var n = 0
            for (t in plan.sms) {
                try { sms.sendMultipartTextMessage(t.number, null, sms.divideMessage(text), null, null); n++ } catch (e: Exception) { }
            }
            return n
        }

        private fun prefsOf(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** SOS gardé sur le téléphone (processus tué, service pas encore relancé). */
        fun persistedRun(context: Context): SosCascade.Progress? =
            SosCascade.Progress.fromJson(prefsOf(context).getString(KEY_PROGRESS, null))

        fun interruptedState(runId: String): JSONObject =
            JSONObject().put("active", false).put("status", "interrupted").put("interrupted", true).put("runId", runId)

        /** SOS gardé jamais repris : effacé, jamais rejoué (identifiant gardé), « interrompu » publié. */
        fun interruptPersisted(context: Context, runId: String): JSONObject {
            prefsOf(context).edit().remove(KEY_PROGRESS).putString(KEY_DONE, runId).remove(KEY_INTERRUPTED).commit()
            Log.w(TAG, "SOS gardé sans service : interrompu")
            return interruptedState(runId).also { SosRun.publish(it) }
        }

        /** Redémarrage du téléphone : aucun SOS n'y survit (ni service ni appel) ; l'écran le dira. */
        fun onBoot(context: Context) {
            val p = persistedRun(context) ?: return
            prefsOf(context).edit().remove(KEY_PROGRESS).putString(KEY_DONE, p.runId).putString(KEY_INTERRUPTED, p.runId).commit()
            Log.w(TAG, "SOS perdu au redémarrage : interrompu")
        }

        /** SOS perdu au redémarrage, rendu une seule fois. */
        fun takeInterrupted(context: Context): String? {
            val id = prefsOf(context).getString(KEY_INTERRUPTED, null) ?: return null
            prefsOf(context).edit().remove(KEY_INTERRUPTED).commit()
            return id
        }

        /** L'écran est passé à l'appel direct : ce SOS ne sera jamais lancé par le service. */
        fun markFallback(context: Context, runId: String) {
            prefsOf(context).edit().putString(KEY_FALLBACK, runId).commit()
        }
    }
}

/** Dernier état du SOS et écouteur de l'écran (SosPlugin), partagés avec le service. */
object SosRun {
    @Volatile var listener: ((JSONObject) -> Unit)? = null
    @Volatile private var last: JSONObject? = null
    /** Lancement demandé au service, pas encore confirmé : posé avant startForegroundService. */
    @Volatile private var pendingRunId: String? = null
    @Volatile var pendingSince = 0L
        private set

    @Synchronized fun markPending(runId: String, now: Long) { pendingRunId = runId; pendingSince = now }
    @Synchronized fun clearPending(runId: String?) {
        if (runId != null && runId == pendingRunId) { pendingRunId = null; pendingSince = 0L }
    }

    fun publish(state: JSONObject) {
        // Premier état du service pour ce lancement : il n'est plus en attente.
        if (!state.optBoolean("pending")) clearPending(state.optString("runId"))
        last = state
        try { listener?.invoke(state) } catch (e: Exception) { }
    }

    /** Lancement abandonné (refusé, trop tard, repli de l'écran) : son état provisoire devient « failed ». */
    @Synchronized fun dropPending(runId: String) {
        clearPending(runId)
        val l = last
        if (l != null && l.optBoolean("pending") && l.optString("runId") == runId) {
            publish(JSONObject().put("active", false).put("status", "failed").put("runId", runId))
        }
    }
    /** Nouveau SOS : l'état du précédent ne doit jamais passer pour le sien. */
    fun clear() { last = null }
    fun snapshot(): JSONObject? = last
}
