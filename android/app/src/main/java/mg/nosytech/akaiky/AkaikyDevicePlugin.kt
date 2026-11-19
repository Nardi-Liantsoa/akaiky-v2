package mg.nosytech.akaiky

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebView
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Greffon de l'app enfant (NAR-164) : jeton d'appairage reçu au provisionnement,
 * description du téléphone, version du WebView et statut Device Owner.
 * Présent dans les deux variantes ; seule l'app enfant reçoit un jeton.
 */
@CapacitorPlugin(name = "AkaikyDevice")
class AkaikyDevicePlugin : Plugin() {

    @PluginMethod
    fun getProvisioning(call: PluginCall) {
        val result = JSObject()
        ProvisioningStore.token(context)?.let { result.put("pairingToken", it) }
        call.resolve(result)
    }

    @PluginMethod
    fun clearProvisioning(call: PluginCall) {
        ProvisioningStore.clear(context)
        call.resolve()
    }

    /** Batterie, réseau et carte SIM : barre d'état de l'écran (NAR-142) et signal de vie (NAR-147, NAR-180). */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        val result = JSObject()
        val battery = DeviceSignals.battery(context)
        battery.pct?.let { result.put("battery", it) }
        battery.charging?.let { result.put("charging", it) }
        result.put("network", DeviceSignals.network(context))
        result.put("simState", DeviceSignals.simState(context))
        call.resolve(result)
    }

    @PluginMethod
    fun getInfo(call: PluginCall) {
        val result = JSObject()
        result.put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
        result.put("osVersion", Build.VERSION.RELEASE)
        try {
            result.put("appVersion", context.packageManager.getPackageInfo(context.packageName, 0).versionName)
        } catch (ignored: PackageManager.NameNotFoundException) {
            // Impossible pour notre propre paquet ; la version reste absente.
        }
        WebView.getCurrentWebViewPackage()?.let {
            result.put("webViewPackage", it.packageName)
            result.put("webViewVersion", it.versionName)
            result.put("webViewMajor", WebViewVersion.major(it.versionName))
        }
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
        result.put("deviceOwner", dpm?.isDeviceOwnerApp(context.packageName) == true)
        call.resolve(result)
    }
}
