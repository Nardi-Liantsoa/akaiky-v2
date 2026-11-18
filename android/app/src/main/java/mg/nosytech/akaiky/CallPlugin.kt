package mg.nosytech.akaiky

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
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
    permissions = [Permission(alias = "phone", strings = [Manifest.permission.CALL_PHONE])]
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
        context.startActivity(intent)
        call.resolve()
    }

    private fun startCall(call: PluginCall, number: String) {
        val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(number)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            call.resolve()
        } catch (e: SecurityException) {
            call.reject("Permission d'appel refusée.", "permission_denied")
        }
    }

    private fun hasCallPermission() =
        ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED

    /** Device Owner (app enfant appairée) : la permission est accordée d'office, sans demande. */
    private fun grantAsDeviceOwner(): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return false
        if (!dpm.isDeviceOwnerApp(context.packageName)) return false
        val admin = ComponentName(context.packageName, "mg.nosytech.akaiky.AkaikyDeviceAdminReceiver")
        dpm.setPermissionGrantState(admin, context.packageName, Manifest.permission.CALL_PHONE, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
        return hasCallPermission()
    }
}
