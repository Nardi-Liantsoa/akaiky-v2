package mg.nosytech.akaiky

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Filtre des appels entrants d'Android 8–9 (NAR-172) : diffusion PHONE_STATE (protégée,
 * envoyée par le système seul, livrée aux récepteurs du manifeste malgré les restrictions
 * d'Android 8). Désactivé à partir d'Android 10 (`incoming_receiver_enabled`) où le service de
 * filtrage décide seul : jamais deux décisions pour un appel.
 * Sonnerie : RINGING arrive quand le téléphone sonne déjà ; un appel refusé est raccroché
 * aussitôt décidé, avant toute écriture (mesuré sur émulateur Android 8.1 : ~0,2 s de sonnerie).
 * Pas de coupure du volume : silenceRinger est réservé au composeur par défaut avant Android 10,
 * le volume de la sonnerie à 0 est refusé (« Do Not Disturb ») sans accès aux règles de
 * notification, et il ne gagnerait que quelques ms sur le raccrochage, lancé au même instant.
 * Aucun numéro dans les journaux.
 */
class LegacyIncomingCallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        if (!LegacyIncoming.applies(Build.VERSION.SDK_INT)) return
        val app = context.applicationContext
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        @Suppress("DEPRECATION")
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
        val started = SystemClock.elapsedRealtime()
        // Jamais d'exception hors du récepteur : en cas d'erreur, l'appel sonne.
        try {
            when (val step = LegacyIncomingCalls.ring.onState(state, !number.isNullOrEmpty(), number)) {
                is LegacyIncoming.Step.Decide -> LegacyIncomingCalls.handle(app, step.number, started)
                LegacyIncoming.Step.ReadNumber -> LegacyIncomingCalls.readNumber(app, goAsync(), started)
                else -> Unit
            }
        } catch (e: Throwable) {
            Log.w("AkaikyIncoming", "Diffusion PHONE_STATE non traitée : l'appel sonne", e)
        }
    }
}

object LegacyIncomingCalls {
    private const val TAG = "AkaikyIncoming"

    /** Appel en cours de décision (un seul par sonnerie), pour tout le processus. */
    val ring = LegacyIncoming.Ring()

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun receiverEnabled(context: Context): Boolean {
        val receiver = ComponentName(context, LegacyIncomingCallReceiver::class.java)
        return when (context.packageManager.getComponentEnabledSetting(receiver)) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> context.resources.getBoolean(R.bool.incoming_receiver_enabled)
            else -> false
        }
    }

    private fun hangupMethod(context: Context): LegacyIncoming.Hangup = LegacyIncoming.hangup(
        Build.VERSION.SDK_INT,
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && granted(context, Manifest.permission.ANSWER_PHONE_CALLS),
        granted(context, Manifest.permission.CALL_PHONE),
    )

    /** Filtre réellement actif sur ce téléphone (bandeau de l'écran : screeningRole().incomingActive). */
    fun active(context: Context): Boolean = LegacyIncoming.active(
        Build.VERSION.SDK_INT, receiverEnabled(context),
        granted(context, Manifest.permission.READ_PHONE_STATE), granted(context, Manifest.permission.READ_CALL_LOG),
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && granted(context, Manifest.permission.ANSWER_PHONE_CALLS),
        granted(context, Manifest.permission.CALL_PHONE),
    )

    /**
     * Décision (IncomingCalls.screen, la même que sur Android 10+) ; refus : appel raccroché,
     * puis noté `call_blocked`. Filtre inactif (permission manquante) : rien,
     * tout sonne, comme Android 10+ sans le rôle.
     */
    fun handle(context: Context, number: String?, started: Long) {
        try {
            if (!active(context)) {
                Log.w(TAG, "Filtre des appels entrants inactif (permission ou récepteur)")
                return
            }
            // Appel en ligne (processus redémarré pendant l'appel : OFFHOOK jamais vu) : appel en
            // attente, jamais raccroché ni noté.
            val audio = context.getSystemService(AudioManager::class.java)
            if (audio != null && LegacyIncoming.otherCallActive(audio.mode)) {
                Log.i(TAG, "Appel en attente pendant un appel en ligne : il sonne")
                return
            }
            IncomingCalls.screen(context, number) { decision ->
                if (LegacyIncoming.blocks(decision)) {
                    val ended = endCall(context)
                    Log.i(TAG, "Appel entrant refusé ($decision), raccroché : $ended, en ${SystemClock.elapsedRealtime() - started} ms")
                    // Non raccroché : l'appel sonne, il n'est pas noté comme bloqué.
                    ended
                } else {
                    Log.i(TAG, "Appel entrant accepté, décidé en ${SystemClock.elapsedRealtime() - started} ms")
                    true
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Décision impossible : l'appel sonne", e)
        }
    }

    /**
     * Numéro absent de la diffusion (Android 9 : copie sans numéro, ou numéro masqué) : relu
     * par l'état courant du téléphone, qu'Android rend aussitôt à l'inscription d'un écouteur
     * (numéro fourni selon les mêmes permissions). 2 s au plus ; sans réponse, rien n'est fait.
     * Android 9, relecture vide : la diffusion suivante (celle avec le numéro, retenue tant que
     * ce récepteur n'a pas fini) décide ; « masqué » n'est conclu qu'après TWIN_GRACE_MS.
     * Cette attente vit dans le processus (Handler, état en mémoire) : processus tué pendant ces
     * 3 s, rien n'est décidé et l'appel sonne (jamais un raccrochage à tort).
     */
    @Suppress("DEPRECATION")
    fun readNumber(context: Context, pending: BroadcastReceiver.PendingResult, started: Long) {
        val tm = context.getSystemService(TelephonyManager::class.java)
        if (tm == null) {
            Log.w(TAG, "Numéro absent et état des appels illisible : l'appel sonne")
            pending.finish(); return
        }
        val main = Handler(Looper.getMainLooper())
        main.post {
            var done = false
            lateinit var listener: PhoneStateListener
            val finish = {
                if (!done) {
                    done = true
                    try { tm.listen(listener, PhoneStateListener.LISTEN_NONE) } catch (e: Throwable) { }
                    pending.finish()
                }
            }
            listener = object : PhoneStateListener() {
                @Deprecated("API 31")
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    if (done) return
                    val step = ring.onNumberRead(state == TelephonyManager.CALL_STATE_RINGING, phoneNumber,
                        LegacyIncoming.twinExpected(Build.VERSION.SDK_INT))
                    finish()
                    when (step) {
                        is LegacyIncoming.Step.Decide -> handle(context, step.number, started)
                        is LegacyIncoming.Step.AwaitTwin -> main.postDelayed({
                            try {
                                val confirmed = ring.onTwinTimeout(step.ring, tm.callState == TelephonyManager.CALL_STATE_RINGING)
                                if (confirmed is LegacyIncoming.Step.Decide) handle(context, confirmed.number, started)
                            } catch (e: Throwable) {
                                Log.w(TAG, "Numéro masqué non confirmé : l'appel sonne", e)
                            }
                        }, LegacyIncoming.TWIN_GRACE_MS)
                        else -> Unit
                    }
                }
            }
            try {
                tm.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
                main.postDelayed({
                    if (!done) Log.w(TAG, "Numéro non relu en 2 s : l'appel sonne")
                    finish()
                }, 2000)
            } catch (e: Throwable) {
                Log.w(TAG, "État des appels illisible", e)
                finish()
            }
        }
    }

    /** Raccroche l'appel qui sonne : Android 9 TelecomManager.endCall, Android 8 ITelephony. */
    @Suppress("DEPRECATION")
    private fun endCall(context: Context): Boolean = try {
        when (hangupMethod(context)) {
            LegacyIncoming.Hangup.TELECOM -> context.getSystemService(TelecomManager::class.java)?.endCall() == true
            LegacyIncoming.Hangup.ITELEPHONY -> {
                // Interface cachée, sans restriction d'accès avant Android 9 ; CALL_PHONE suffit.
                val tm = context.getSystemService(TelephonyManager::class.java)
                val getter = TelephonyManager::class.java.getDeclaredMethod("getITelephony").apply { isAccessible = true }
                val telephony = getter.invoke(tm) ?: return false
                telephony.javaClass.getMethod("endCall").invoke(telephony) as? Boolean == true
            }
            LegacyIncoming.Hangup.NONE -> false
        }
    } catch (e: Throwable) {
        // Réflexion refusée ou interface absente (ITelephony) : jamais de plantage, l'appel sonne.
        Log.w(TAG, "Raccrocher impossible", e)
        false
    }

    /**
     * Permissions du filtre d'Android 8–9 accordées d'office en Device Owner (comme
     * PROCESS_OUTGOING_CALLS) : état et numéro de l'appel, journal d'appels (numéro sur
     * Android 9), raccrocher (ANSWER_PHONE_CALLS sur 9, CALL_PHONE pour ITelephony sur 8).
     */
    fun grant(context: Context) {
        if (!LegacyIncoming.applies(Build.VERSION.SDK_INT)) return
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = ComponentName(context.packageName, "mg.nosytech.akaiky.AkaikyDeviceAdminReceiver")
        val permissions = buildList {
            add(Manifest.permission.READ_PHONE_STATE)
            add(Manifest.permission.READ_CALL_LOG)
            add(Manifest.permission.CALL_PHONE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) add(Manifest.permission.ANSWER_PHONE_CALLS)
        }
        for (permission in permissions) {
            if (granted(context, permission)) continue
            try {
                dpm.setPermissionGrantState(admin, context.packageName, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
            } catch (e: Exception) {
                Log.w(TAG, "Permission du filtre des appels entrants non accordée : $permission", e)
            }
        }
    }
}
