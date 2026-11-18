package mg.nosytech.akaiky

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
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

    /** Batterie et réseau, pour la barre d'état de l'écran de l'enfant (NAR-142). */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        val result = JSObject()
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (battery != null) {
            val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level >= 0 && scale > 0) result.put("battery", level * 100 / scale)
            val status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            result.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
        }
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
        result.put("network", when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        })
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
