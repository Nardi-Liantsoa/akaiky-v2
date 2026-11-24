package mg.nosytech.akaiky

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Position à la demande (NAR-204) : un relevé unique quand l'écran le demande (un parent
 * regarde, GET /api/device/locate), jamais en continu ni en arrière-plan. Règles : LocationFix.
 * Permission accordée d'office en Device Owner, comme pour le SOS. Aucune position écrite dans
 * les journaux ni gardée sur le téléphone : elle part à l'écran, qui l'envoie au serveur.
 */
@CapacitorPlugin(name = "AkaikyLocation")
class LocationPlugin : Plugin() {
    private val handler = Handler(Looper.getMainLooper())
    private var running = false
    /** Relevé en cours : arrêté (GPS rendu, appel refusé) par `cancel` et à la destruction du greffon. */
    private var stopCurrent: (() -> Unit)? = null
    /** Greffon détruit : un appel arrivé après est refusé, jamais laissé sans réponse. */
    private var destroyed = false

    /** Relevé en cours abandonné (écran passé en arrière-plan, session perdue) : GPS rendu tout de suite. */
    @PluginMethod
    fun cancel(call: PluginCall) {
        handler.post { stopCurrent?.invoke(); call.resolve() }
    }

    /** { lat, lng, accuracyM, ageS } ; refus : `busy`, `denied`, `unavailable`, `timeout`, `cancelled`. */
    @PluginMethod
    fun currentPosition(call: PluginCall) {
        handler.post { start(call) }
    }

    private fun granted(p: String) = context.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun grant() {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = ComponentName(context.packageName, "mg.nosytech.akaiky.AkaikyDeviceAdminReceiver")
        for (p in listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) {
            try {
                dpm.setPermissionGrantState(admin, context.packageName, p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
            } catch (e: Exception) {
                Logger.error("AkaikyLocation", "Permission non accordée : $p", e)
            }
        }
    }

    private fun sample(l: Location) = LocationFix.Sample(l.elapsedRealtimeNanos, l.latitude, l.longitude, if (l.hasAccuracy()) l.accuracy else null)

    private fun start(call: PluginCall) {
        if (destroyed) return call.reject("Relevé abandonné.", "cancelled")
        if (running) return call.reject("Relevé déjà en cours.", "busy")
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) || !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) grant()
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) Logger.warn("AkaikyLocation", "Position précise non accordée : réseau seulement")
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            return call.reject("Position non autorisée.", "denied")
        }
        val lm = context.getSystemService(LocationManager::class.java) ?: return call.reject("Position indisponible.", "unavailable")
        val providers = buildList {
            add(LocationManager.GPS_PROVIDER); add(LocationManager.NETWORK_PROVIDER)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(LocationManager.FUSED_PROVIDER)
        }.filter { try { lm.isProviderEnabled(it) } catch (e: Exception) { false } }
        if (providers.isEmpty()) return call.reject("Position désactivée sur le téléphone.", "unavailable")

        running = true
        val startedNs = SystemClock.elapsedRealtimeNanos()
        var best: LocationFix.Sample? = null
        var over = false
        lateinit var listener: LocationListener
        lateinit var timeout: Runnable
        val stop = { cancelled: Boolean ->
            if (!over) {
                over = true
                running = false
                stopCurrent = null
                handler.removeCallbacks(timeout)
                try { lm.removeUpdates(listener) } catch (e: Exception) { }
                val r = if (cancelled) null else best?.let { LocationFix.result(it, SystemClock.elapsedRealtimeNanos()) }
                when {
                    cancelled -> call.reject("Relevé abandonné.", "cancelled")
                    r == null -> call.reject("Aucune position dans le délai.", "timeout")
                    else -> call.resolve(JSObject().put("lat", r.lat).put("lng", r.lng).put("accuracyM", r.accuracyM).put("ageS", r.ageS))
                }
            }
        }
        val finish = { stop(false) }
        timeout = Runnable { finish() }
        // Toutes les méthodes écrites : abstraites jusqu'à Android 10 (AbstractMethodError sinon).
        listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val s = sample(location)
                if (!LocationFix.valid(s) || !LocationFix.fresh(s, startedNs)) return
                best = LocationFix.better(best, s)
                if (LocationFix.good(s)) finish()
            }
            @Deprecated("API 29") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }
        stopCurrent = { stop(true) }
        var requested = 0
        for (p in providers) {
            try { lm.requestLocationUpdates(p, 1000L, 0f, listener, Looper.getMainLooper()); requested++ } catch (e: Exception) { }
        }
        if (requested == 0) { running = false; over = true; stopCurrent = null; return call.reject("Position indisponible.", "unavailable") }
        val wanted = call.getLong("timeoutMs") ?: LocationFix.TIMEOUT_MS
        handler.postDelayed(timeout, wanted.coerceIn(1_000L, LocationFix.TIMEOUT_MS))
    }

    // Activité détruite pendant un relevé : GPS rendu (jamais d'écoute laissée en place). Les
    // appels déjà en file passent encore par start(), qui les refuse : aucun laissé sans réponse.
    override fun handleOnDestroy() {
        destroyed = true
        handler.post { stopCurrent?.invoke() }
    }
}
