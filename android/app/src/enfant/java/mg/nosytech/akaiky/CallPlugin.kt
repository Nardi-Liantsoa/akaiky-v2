package mg.nosytech.akaiky

import android.Manifest
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
        val numbers = call.getArray("numbers") ?: JSArray()
        val allowed = (0 until numbers.length()).mapNotNull { CallPolicy.normalize(numbers.optString(it)) }.filter { it.startsWith("+") }.toSet()
        prefs.edit().putStringSet("allowed", allowed).apply()
        call.resolve()
    }

    @PluginMethod
    fun call(call: PluginCall) {
        val number = CallPolicy.normalize(call.getString("number"))
        val allowed = prefs.getStringSet("allowed", emptySet()) ?: emptySet()
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
        val since = call.getLong("since") ?: 0L
        val until = call.getLong("until") ?: Long.MAX_VALUE
        val result = com.getcapacitor.JSObject().put("found", false)
        if (number == null || !(isGranted(Manifest.permission.READ_CALL_LOG) || grant(Manifest.permission.READ_CALL_LOG))) {
            call.resolve(result)
            return
        }
        try {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION),
                "${CallLog.Calls.TYPE} = ? AND ${CallLog.Calls.DATE} >= ? AND ${CallLog.Calls.DATE} < ?",
                arrayOf(CallLog.Calls.OUTGOING_TYPE.toString(), since.toString(), until.toString()),
                "${CallLog.Calls.DATE} ASC"
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    if (!PhoneNumberUtils.compare(context, cursor.getString(0) ?: continue, number)) continue
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
