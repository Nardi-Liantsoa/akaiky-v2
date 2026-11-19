package mg.nosytech.akaiky

import android.Manifest
import android.app.role.RoleManager
import android.os.Build
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.annotation.ActivityCallback
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CallLog
import android.telephony.PhoneNumberUtils
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Appels de l'app enfant (NAR-142) : un appui sur un contact lance l'appel par la
 * carte SIM (ACTION_CALL), seulement vers un numéro de la liste reçue du parent.
 * Urgence : Android interdit ACTION_CALL vers un numéro d'urgence ; ACTION_DIAL
 * ouvre le composeur avec le numéro prérempli, l'enfant n'a qu'à appuyer sur « Appeler ».
 */
@CapacitorPlugin(
    name = "AkaikyCall",
    permissions = [
        Permission(alias = "phone", strings = [Manifest.permission.CALL_PHONE]),
        Permission(alias = "callLog", strings = [Manifest.permission.READ_CALL_LOG])
    ]
)
class CallPlugin : Plugin() {
    private val prefs get() = context.applicationContext.getSharedPreferences("akaiky.calls", Context.MODE_PRIVATE)

    /** Liste des numéros autorisés, reçue avec la configuration (NAR-160). */
    @PluginMethod
    fun setAllowed(call: PluginCall) {
        val allowed = e164Set(call.getArray("numbers"))
        // Liste reçue : le filtre des appels entrants (NAR-145) s'active, avec le pays des
        // numéros pour lire un appel reçu au format national.
        val country = call.getString("country")?.uppercase()?.takeIf { it.matches(Regex("^[A-Z]{2}$")) }
        // Parents et plages « école » (NAR-176) : absents d'un écran plus ancien → aucune
        // plage, comportement inchangé.
        val parents = e164Set(call.getArray("parents"))
        val schedules = call.getArray("schedules")?.toString() ?: "[]"
        val timezone = call.getString("timezone")
        prefs.edit().putStringSet("allowed", allowed).putBoolean("filtering", true)
            .putStringSet("parents", parents).putString("schedules", schedules)
            .apply { if (country != null) putString("country", country) }
            .apply { if (timezone != null) putString("timezone", timezone) else remove("timezone") }.apply()
        // Plages reçues (NAR-143) : liste du lock task relue, apps autorisées retirées si une
        // plage est déjà active, rendues sinon.
        Kiosk.enforceOnMain(context, activity)
        call.resolve()
    }

    /** Numéros E.164 d'une liste reçue de l'écran (le reste est ignoré). */
    private fun e164Set(a: JSArray?): Set<String> =
        if (a == null) emptySet() else (0 until a.length()).mapNotNull { CallPolicy.normalize(a.optString(it)) }.filter { it.startsWith("+") }.toSet()

    /** Téléphone libéré par le parent : plus aucun appel filtré. */
    @PluginMethod
    fun stopFiltering(call: PluginCall) {
        prefs.edit().putBoolean("filtering", false).remove("allowed").remove("parents").remove("schedules").remove("timezone").apply()
        Kiosk.enforceOnMain(context, activity)
        call.resolve()
    }

    /** Appels entrants vus par le filtre, pas encore repris par l'écran (NAR-145). */
    @PluginMethod
    fun peekIncoming(call: PluginCall) {
        call.resolve(JSObject().put("events", JSArray(IncomingCalls.peek(context).toString())))
    }

    @PluginMethod
    fun ackIncoming(call: PluginCall) {
        val ids = call.getArray("ids") ?: JSArray()
        IncomingCalls.ack(context, (0 until ids.length()).map { ids.optString(it) }.toSet())
        call.resolve()
    }

    /**
     * Rôle de filtrage des appels (Android 10+). Le Device Owner ne peut pas se l'accorder :
     * une confirmation système, une fois, à l'installation par le parent.
     */
    @PluginMethod
    fun screeningRole(call: PluginCall) {
        val available = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
        val held = available && (context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true)
        call.resolve(JSObject().put("available", available).put("held", held))
    }

    @PluginMethod
    fun requestScreeningRole(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(JSObject().put("held", false))
            return
        }
        val roles = context.getSystemService(RoleManager::class.java)
        if (roles == null || !roles.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
            call.resolve(JSObject().put("held", false))
            return
        }
        if (roles.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            call.resolve(JSObject().put("held", true))
            return
        }
        startActivityForResult(call, roles.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), "onScreeningRole")
    }

    @ActivityCallback
    private fun onScreeningRole(call: PluginCall, result: ActivityResult) {
        val held = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true
        call.resolve(JSObject().put("held", held))
    }

    @PluginMethod
    fun call(call: PluginCall) {
        val number = CallPolicy.normalize(call.getString("number"))
        // Pendant une plage « école » (NAR-176) : les seuls parents, comme à l'écran.
        val allowed = IncomingCalls.reachable(context)
        if (number == null || !CallPolicy.isAllowed(number, allowed)) {
            call.reject("Numéro non autorisé.", "not_allowed")
            return
        }
        if (hasCallPermission() || grantAsDeviceOwner()) startCall(call, number)
        else requestPermissionForAlias("phone", call, "onPhonePermission")
    }

    @PermissionCallback
    private fun onPhonePermission(call: PluginCall) {
        val number = CallPolicy.normalize(call.getString("number"))
        if (number != null && hasCallPermission()) startCall(call, number)
        else call.reject("Permission d'appel refusée.", "permission_denied")
    }

    @PluginMethod
    fun emergency(call: PluginCall) {
        val number = CallPolicy.normalize(call.getString("number"))
        if (number == null || !CallPolicy.isEmergency(number)) {
            call.reject("Numéro d'urgence inconnu.", "not_emergency")
            return
        }
        val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            // Pas de composeur (désactivé, absent) : refus propre, jamais un plantage.
            call.reject("Composeur indisponible.", "no_dialer")
        }
    }

    /**
     * Durée d'un appel sortant (NAR-166), lue dans le journal d'appels du système : le
     * PREMIER appel sortant vers `number` commencé dans [since, until) (ms) ; `until` est le
     * début de l'appel suivant au même numéro, pour que chaque appel garde sa propre durée.
     * Numéros comparés par PhoneNumberUtils (format national ou international). Sans
     * permission, ou appel pas encore écrit par Android : `found = false`.
     */
    @PluginMethod
    fun lastOutgoing(call: PluginCall) {
        val number = CallPolicy.normalize(call.getString("number"))
        // Appel reçu (NAR-145) : même recherche dans les appels entrants.
        // Un appel reçu non décroché est noté « manqué » ou « refusé » par Android : durée 0.
        val incoming = call.getBoolean("incoming", false) == true
        val countries = if (incoming) IncomingCalls.countries(context) else emptyList()
        val types = if (incoming) listOf(CallLog.Calls.INCOMING_TYPE, CallLog.Calls.MISSED_TYPE, CallLog.Calls.REJECTED_TYPE) else listOf(CallLog.Calls.OUTGOING_TYPE)
        val since = call.getLong("since") ?: 0L
        val until = call.getLong("until") ?: Long.MAX_VALUE
        val result = com.getcapacitor.JSObject().put("found", false)
        if (number == null) {
            call.resolve(result)
            return
        }
        // Permission impossible à obtenir : le web envoie l'appel sans durée, sans attendre.
        if (!(isGranted(Manifest.permission.READ_CALL_LOG) || grant(Manifest.permission.READ_CALL_LOG))) {
            call.resolve(result.put("permission", false))
            return
        }
        try {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION),
                "${CallLog.Calls.TYPE} IN (${types.joinToString(",")}) AND ${CallLog.Calls.DATE} >= ? AND ${CallLog.Calls.DATE} < ?",
                arrayOf(since.toString(), until.toString()),
                "${CallLog.Calls.DATE} ASC"
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    val logged = cursor.getString(0) ?: continue
                    // Appel reçu : comparaison exacte (E.164), comme le filtre ; sortant : numéro composé par l'app.
                    val same = if (incoming) number in IncomingCalls.candidates(logged, countries) else PhoneNumberUtils.compare(context, logged, number)
                    if (!same) continue
                    result.put("found", true).put("startedAt", cursor.getLong(1)).put("durationS", cursor.getLong(2))
                    break
                }
            }
        } catch (e: SecurityException) {
            // Permission retirée entre-temps : pas de durée.
        }
        call.resolve(result)
    }

    private fun startCall(call: PluginCall, number: String) {
        val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(number)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            call.resolve()
        } catch (e: SecurityException) {
            call.reject("Permission d'appel refusée.", "permission_denied")
        } catch (e: Exception) {
            call.reject("Appel impossible.", "call_failed")
        }
    }

    private fun isGranted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun hasCallPermission() = isGranted(Manifest.permission.CALL_PHONE)

    /** Device Owner (app enfant appairée) : la permission est accordée d'office, sans demande. */
    private fun grant(permission: String): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return false
        if (!dpm.isDeviceOwnerApp(context.packageName)) return false
        val admin = ComponentName(context.packageName, "mg.nosytech.akaiky.AkaikyDeviceAdminReceiver")
        dpm.setPermissionGrantState(admin, context.packageName, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
        return isGranted(permission)
    }

    private fun grantAsDeviceOwner(): Boolean = grant(Manifest.permission.CALL_PHONE)
}
