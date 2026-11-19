package mg.nosytech.akaiky

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Surveillance de l'état du téléphone en arrière-plan (NAR-180), écran éteint et WebView
 * endormie : POST /api/device/heartbeat avec `background: true`.
 *   - WorkManager : tâche périodique de 15 minutes (le minimum), réseau exigé ; survit au
 *     redémarrage. Événements (batterie qui passe sous 15 %, carte SIM) : tâche unique
 *     immédiate, réseau exigé : hors ligne, elle part au retour du réseau.
 *   - Événements : ACTION_BATTERY_LOW et ACTION_BATTERY_CHANGED ne se déclarent plus dans
 *     le manifeste depuis Android 8 (diffusions implicites non exemptées), ni
 *     SIM_STATE_CHANGED (cachée, non exemptée) : écoutés à l'exécution, sur le contexte de
 *     l'application, tant que le processus vit (l'app est le lanceur, en lock task : il vit).
 *     Dans le manifeste, seules les exemptées : BOOT_COMPLETED, MY_PACKAGE_REPLACED et
 *     CARRIER_CONFIG_CHANGED (émise au retrait et à l'insertion d'une carte SIM). Filet : chaque
 *     tâche périodique relit tout et compare au dernier envoi.
 *   - Hors ligne : une seule place en attente, le relevé le plus récent (StatusQueue).
 *   - Authentification : jeton « signal de vie » (HeartbeatClient), émis par le serveur à
 *     l'écran et confié ici par startBackgroundStatus ; chiffré au repos par une clé Keystore
 *     propre (KeystoreTokenStore). Refusé (401) : surveillance arrêtée, `needsToken` posé,
 *     l'écran en émet un autre à son prochain démarrage. Illisible ou absent : rien n'est
 *     envoyé, `needsToken` posé, nouvel essai à la période suivante (pas d'arrêt).
 *   - Marche, arrêt et envoi sous un même verrou (StatusRunner) ; marche et arrêt passent par
 *     un fil unique, dans l'ordre des appels de l'écran : aucun signal ne part après un arrêt.
 */
object BackgroundStatus {
    private const val TAG = "AkaikyStatus"
    private const val PREFS = "akaiky_background_status"
    private const val K_ENABLED = "enabled"
    private const val K_BASE = "api_base"
    private const val K_NEEDS_TOKEN = "needs_token"
    const val PERIODIC = "akaiky-status-periodic"
    const val EVENT = "akaiky-status-event"

    /** Marche et arrêt, dans l'ordre des appels de l'écran, hors du fil des greffons. */
    val control: ExecutorService = Executors.newSingleThreadExecutor()
    @Volatile private var receiver: BroadcastReceiver? = null
    @Volatile private var sharedRunner: StatusRunner? = null

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun store(context: Context) = object : KeyValueStore {
        private val p = prefs(context)
        override fun get(key: String) = p.getString(key, null)
        override fun put(key: String, value: String) { p.edit().putString(key, value).commit() }
        override fun remove(key: String) { p.edit().remove(key).commit() }
    }

    @Volatile private var sharedQueue: StatusQueue? = null

    /** Une seule file par processus : ses méthodes et les blocs `synchronized(q)` sont sérialisés. */
    fun queue(context: Context): StatusQueue = sharedQueue ?: synchronized(this) {
        sharedQueue ?: StatusQueue(store(context)).also { sharedQueue = it }
    }

    /** Un seul cœur par processus (verrou d'envoi, file, jeton), StatusRunner. */
    private fun runner(context: Context): StatusRunner = sharedRunner ?: synchronized(this) {
        sharedRunner ?: StatusRunner(
            queue = queue(context),
            tokens = KeystoreTokenStore(context),
            isEnabled = { isEnabled(context) },
            read = { read(context) },
            send = { token, payload ->
                val base = HeartbeatClient.validBase(prefs(context).getString(K_BASE, null))
                if (base == null) SendOutcome.RETRY
                else HeartbeatClient(base, HeartbeatClient.urlConnection, log = { Log.i(TAG, it) }).send(token, payload)
            },
            markNeedsToken = { prefs(context).edit().putBoolean(K_NEEDS_TOKEN, true).commit() },
            log = { Log.i(TAG, it) }
        ).also { sharedRunner = it }
    }

    fun isEnabled(context: Context) = prefs(context).getBoolean(K_ENABLED, false)

    /** Jeton refusé ou illisible : l'écran doit en émettre un autre. */
    fun needsToken(context: Context) = prefs(context).getBoolean(K_NEEDS_TOKEN, false)

    /**
     * Téléphone appairé : jeton gardé, surveillance en route (idempotent), premier signal tout
     * de suite. Faux si le jeton n'a pas pu être écrit (rien n'est lancé).
     */
    fun start(context: Context, apiBase: String, token: String): Boolean = runner(context).locked {
        if (!KeystoreTokenStore(context).write(token)) return@locked false
        prefs(context).edit().putBoolean(K_ENABLED, true).putString(K_BASE, apiBase).putBoolean(K_NEEDS_TOKEN, false).commit()
        ensureReceivers(context)
        schedulePeriodic(context)
        enqueueNow(context)
        true
    }

    /**
     * Téléphone libéré, retiré ou réappairé ailleurs : plus rien ne part. Attend la fin d'un
     * envoi en cours (verrou) : au retour, aucun signal n'est en vol ni ne partira.
     */
    fun stop(context: Context) = stop(context, needsToken = false)

    private fun stop(context: Context, needsToken: Boolean) = runner(context).stop(disable = {
        prefs(context).edit().putBoolean(K_ENABLED, false).putBoolean(K_NEEDS_TOKEN, needsToken).commit()
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(PERIODIC)
        wm.cancelUniqueWork(EVENT)
    })

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<BackgroundStatusWorker>(BackgroundStatusPolicy.EVERY_MS, TimeUnit.MILLISECONDS)
            .setConstraints(connected())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    private fun enqueueNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<BackgroundStatusWorker>().setConstraints(connected()).build()
        // REPLACE : le relevé envoyé est relu au moment de l'envoi, le plus récent l'emporte.
        WorkManager.getInstance(context).enqueueUniqueWork(EVENT, ExistingWorkPolicy.REPLACE, request)
    }

    private fun connected() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun read(context: Context): StatusSnapshot {
        val battery = DeviceSignals.battery(context)
        return BackgroundStatusPolicy.snapshot(battery.pct, battery.charging, DeviceSignals.network(context), DeviceSignals.simState(context))
    }

    /**
     * Diffusion reçue (batterie, carte SIM) : relevé comparé au dernier état connu ; un
     * événement est noté et envoyé dès que le réseau le permet. Rien d'autre ne part.
     */
    fun onSignal(context: Context) {
        if (!isEnabled(context)) return
        val current = read(context)
        val pending = runner(context).observe(current, System.currentTimeMillis(), always = false)
        if (pending?.event == true) {
            Log.i(TAG, "événement : batterie ${current.batteryPct} %, carte SIM ${current.simState}")
            enqueueNow(context)
        }
    }

    /** Écoute des diffusions non déclarables dans le manifeste ; une fois par processus. */
    fun ensureReceivers(context: Context) {
        if (receiver != null) return
        synchronized(this) {
            if (receiver != null) return
            val r = object : BroadcastReceiver() {
                override fun onReceive(c: Context, intent: Intent) {
                    try { onSignal(c) } catch (e: Exception) { Log.w(TAG, "relevé en échec", e) }
                }
            }
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_BATTERY_LOW)
                addAction(Intent.ACTION_BATTERY_CHANGED)
                addAction(SIM_STATE_CHANGED)
            }
            // Exportée : diffusions du système. Le contenu de l'intention n'est jamais lu,
            // seulement l'état réel relu aussitôt : une diffusion forgée ne fait rien de plus.
            ContextCompat.registerReceiver(context.applicationContext, r, filter, ContextCompat.RECEIVER_EXPORTED)
            receiver = r
        }
    }

    /** Corps de la tâche : envoi du relevé en attente (ou de l'actuel) s'il est dû. */
    fun run(context: Context): SendOutcome? {
        ensureReceivers(context)
        if (!isEnabled(context)) return null
        if (HeartbeatClient.validBase(prefs(context).getString(K_BASE, null)) == null) return null
        // Jeton refusé (401) : arrêt, `needsToken` posé (sous le verrou, réentrant).
        return runner(context).run(onRefused = { stop(context, needsToken = true) })
    }

    /** Diffusion cachée de TelephonyManager (TelephonyIntents.ACTION_SIM_STATE_CHANGED). */
    private const val SIM_STATE_CHANGED = "android.intent.action.SIM_STATE_CHANGED"
}
