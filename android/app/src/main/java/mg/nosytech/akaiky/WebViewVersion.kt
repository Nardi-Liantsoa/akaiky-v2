package mg.nosytech.akaiky

import android.webkit.WebView

/**
 * Version du WebView du téléphone (NAR-161, NAR-164). Le bundle exige Chrome 64
 * (capacitor.config.ts : android.minWebViewVersion) : en dessous, l'app n'affiche
 * que son écran de repli, et le mode verrouillé (NAR-139) ne doit pas s'activer,
 * sinon le téléphone reste bloqué sur cet écran sans accès au Play Store.
 */
object WebViewVersion {
    const val MINIMUM = 64

    /** Version majeure (« 113.0.5672.136 » → 113), 0 si illisible. */
    @JvmStatic
    fun major(versionName: String?): Int = versionName?.substringBefore('.')?.toIntOrNull() ?: 0

    /** Vrai si le WebView actuel peut faire tourner l'app (à vérifier avant tout verrouillage). */
    @JvmStatic
    fun sufficient(): Boolean = major(WebView.getCurrentWebViewPackage()?.versionName) >= MINIMUM
}
