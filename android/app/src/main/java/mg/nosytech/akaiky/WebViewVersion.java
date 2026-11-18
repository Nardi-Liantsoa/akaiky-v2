package mg.nosytech.akaiky;

import android.content.pm.PackageInfo;
import android.webkit.WebView;

/**
 * Version du WebView du téléphone (NAR-161, NAR-164). Le bundle exige Chrome 64
 * (capacitor.config.ts : android.minWebViewVersion) : en dessous, l'app n'affiche
 * que son écran de repli, et le mode verrouillé (NAR-139) ne doit pas s'activer,
 * sinon le téléphone reste bloqué sur cet écran sans accès au Play Store.
 */
public final class WebViewVersion {
    public static final int MINIMUM = 64;

    private WebViewVersion() {}

    /** Version majeure (« 113.0.5672.136 » → 113), 0 si illisible. */
    public static int major(String versionName) {
        if (versionName == null) return 0;
        int end = versionName.indexOf('.');
        try {
            return Integer.parseInt(end < 0 ? versionName : versionName.substring(0, end));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Vrai si le WebView actuel peut faire tourner l'app (à vérifier avant tout verrouillage). */
    public static boolean sufficient() {
        PackageInfo webView = WebView.getCurrentWebViewPackage();
        return webView != null && major(webView.versionName) >= MINIMUM;
    }
}
