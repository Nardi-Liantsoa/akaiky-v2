package mg.nosytech.akaiky;

import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Greffon de l'app enfant (NAR-164) : jeton d'appairage reçu au provisionnement,
 * description du téléphone, version du WebView et statut Device Owner.
 * Présent dans les deux variantes ; seule l'app enfant reçoit un jeton.
 */
@CapacitorPlugin(name = "AkaikyDevice")
public class AkaikyDevicePlugin extends Plugin {

    @PluginMethod
    public void getProvisioning(PluginCall call) {
        JSObject result = new JSObject();
        String token = ProvisioningStore.token(getContext());
        if (token != null) result.put("pairingToken", token);
        call.resolve(result);
    }

    @PluginMethod
    public void clearProvisioning(PluginCall call) {
        ProvisioningStore.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        result.put("osVersion", Build.VERSION.RELEASE);
        try {
            PackageInfo app = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            result.put("appVersion", app.versionName);
        } catch (PackageManager.NameNotFoundException ignored) {
            // Impossible pour notre propre paquet ; la version reste absente.
        }
        PackageInfo webView = WebView.getCurrentWebViewPackage();
        if (webView != null) {
            result.put("webViewPackage", webView.packageName);
            result.put("webViewVersion", webView.versionName);
            result.put("webViewMajor", WebViewVersion.major(webView.versionName));
        }
        DevicePolicyManager dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        result.put("deviceOwner", dpm != null && dpm.isDeviceOwnerApp(context.getPackageName()));
        call.resolve(result);
    }
}
