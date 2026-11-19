package mg.nosytech.akaiky

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import android.telecom.TelecomManager
import android.util.Base64
import android.util.Log
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * Applications autorisées sur le téléphone de l'enfant (NAR-143), règles dans AppsPolicy.
 *
 * - Liste des apps lançables envoyée au parent (nom, icône 48 px), apps que nous avons
 *   cachées comprises (sinon un parent ne pourrait plus jamais les autoriser).
 * - Liste autorisée gardée dans les préférences du verrou : elle entre dans la liste du lock
 *   task (Kiosk.enforce), hors plage « école », et seule elle peut être lancée par l'écran.
 * - Téléphone armé en Device Owner : toute autre app lançable est cachée
 *   (setApplicationHidden), sauf ce qui n'est jamais caché ; rendue à la libération (disarm).
 * - Cacher (applyHidden) et tout rendre (releaseAll) passent par un même verrou : une
 *   libération n'est jamais suivie d'un « cacher » encore en cours (armé relu avant chaque app).
 */
object AllowedApps {
    private const val TAG = "AkaikyApps"
    private const val KEY_ALLOWED = "allowedApps"
    private const val KEY_HIDDEN = "hiddenApps"
    // Navigateurs vus un jour sur ce téléphone : jamais autorisables, même s'ils ne
    // répondent plus aux liens (désactivés, cachés, autre navigateur par défaut).
    private const val KEY_BROWSERS = "browserApps"
    private const val ICON_MAX_BYTES = 4096

    // Hidden compris : MATCH_UNINSTALLED_PACKAGES rend aussi les paquets cachés par le Device Owner.
    private const val LIST_FLAGS = PackageManager.MATCH_UNINSTALLED_PACKAGES or PackageManager.MATCH_DISABLED_COMPONENTS

    // Un seul verrou pour cacher et tout rendre ; libération sur un fil à part (lectures du
    // gestionnaire de paquets hors du fil principal).
    private val lock = Any()
    private val worker = Executors.newSingleThreadExecutor()

    data class App(val pkg: String, val label: String, val icon: String?, val browser: Boolean)

    /** Paquets jamais cachés ; `complete` faux si une recherche a échoué (rien caché alors). */
    data class Protection(val packages: Set<String>, val complete: Boolean)

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(Kiosk.PREFS, Context.MODE_PRIVATE)
    private fun dpm(context: Context) = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private fun admin(context: Context) = ComponentName(context, AkaikyDeviceAdminReceiver::class.java)

    fun allowed(context: Context): List<String> = AppsPolicy.decode(prefs(context).getString(KEY_ALLOWED, null))
    private fun hiddenByUs(context: Context): Set<String> = AppsPolicy.decode(prefs(context).getString(KEY_HIDDEN, null)).toSet()

    /** Jamais cachés sur CE téléphone : composeurs, SMS par défaut, claviers, WebView, lanceurs. */
    fun runtimeProtection(context: Context): Protection {
        val out = mutableSetOf<String>()
        var complete = true
        fun look(what: String, block: () -> Unit) {
            try { block() } catch (e: Exception) { complete = false; Log.w(TAG, "Applications : recherche $what en échec", e) }
        }
        val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
        look("composeur") { (telecom ?: error("Telecom absent")).defaultDialerPackage?.let(out::add) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) look("composeur système") { telecom?.systemDialerPackage?.let(out::add) }
        look("SMS") { Telephony.Sms.getDefaultSmsPackage(context)?.let(out::add) }
        look("claviers") {
            val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.enabledInputMethodList.forEach { out.add(it.packageName) }
        }
        look("WebView") { WebView.getCurrentWebViewPackage()?.packageName?.let(out::add) }
        look("lanceurs") {
            // Lanceurs cachés compris (ils doivent être rendus, jamais restés cachés).
            val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            query(context, home, LIST_FLAGS or PackageManager.MATCH_ALL).forEach { out.add(it.activityInfo.packageName) }
        }
        return Protection(out, complete)
    }

    fun runtimeNeverHide(context: Context): Set<String> = runtimeProtection(context).packages

    /**
     * Navigateurs de CE téléphone : tout ce qui ouvre un lien http(s) quelconque, apps cachées
     * ou désactivées comprises, plus tout navigateur vu un jour ici (gardé dans les préférences).
     */
    fun runtimeBrowsers(context: Context): Set<String> {
        val found = mutableSetOf<String>()
        for (scheme in listOf("https", "http")) safely("navigateurs") {
            val view = Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://example.com/")).addCategory(Intent.CATEGORY_BROWSABLE)
            query(context, view, LIST_FLAGS or PackageManager.MATCH_ALL).forEach { found.add(it.activityInfo.packageName) }
        }
        val p = prefs(context)
        val known = AppsPolicy.decode(p.getString(KEY_BROWSERS, null)).toSet()
        val all = AppsPolicy.rememberBrowsers(known, found - context.packageName)
        if (all != known) p.edit().putString(KEY_BROWSERS, AppsPolicy.encode(all.sorted())).apply()
        return all
    }

    @Suppress("DEPRECATION")
    private fun query(context: Context, intent: Intent, flags: Int): List<ResolveInfo> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(flags.toLong()))
        } else {
            context.packageManager.queryIntentActivities(intent, flags)
        }

    /** Activités d'accueil (lanceur) installées, cachées par nous comprises. */
    private fun launcherEntries(context: Context): List<ResolveInfo> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val owner = Kiosk.isDeviceOwner(context)
        return query(context, intent, LIST_FLAGS).filter { r ->
            val info = r.activityInfo?.applicationInfo ?: return@filter false
            (info.flags and ApplicationInfo.FLAG_INSTALLED) != 0 ||
                (owner && runCatching { dpm(context).isApplicationHidden(admin(context), info.packageName) }.getOrDefault(false))
        }
    }

    private fun launchablePackages(context: Context): List<String> =
        launcherEntries(context).map { it.activityInfo.packageName }.distinct()

    /**
     * Apps proposées au parent : ni l'app, ni rien de jamais caché ; navigateurs envoyés marqués
     * (`browser`) : le serveur ne les montre pas et refuse de les autoriser. 150 au plus, par nom.
     */
    fun list(context: Context): List<App> {
        val own = context.packageName
        val never = runtimeNeverHide(context)
        val browsers = runtimeBrowsers(context)
        val pm = context.packageManager
        val seen = mutableSetOf<String>()
        val out = mutableListOf<App>()
        for (r in launcherEntries(context)) {
            val pkg = r.activityInfo.packageName
            if (!AppsPolicy.isValidPackage(pkg) || AppsPolicy.isNeverHide(pkg, own, never) || !seen.add(pkg)) continue
            val label = AppsPolicy.cleanLabel(runCatching { r.loadLabel(pm)?.toString() }.getOrNull()).ifEmpty { pkg }
            val icon = runCatching { iconPng(r.loadIcon(pm)) }.getOrNull()
            out.add(App(pkg, label, icon, AppsPolicy.isProtected(pkg, own, never, browsers)))
        }
        return out.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.label }).take(AppsPolicy.MAX_LISTED)
    }

    /** Icône en PNG carré (48 px, sinon 32 px), en base64 ; null au-delà de 4 Ko. */
    private fun iconPng(drawable: Drawable?): String? {
        if (drawable == null) return null
        for (size in intArrayOf(48, 32)) {
            val d = drawable.constantState?.newDrawable()?.mutate() ?: drawable
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            d.setBounds(0, 0, size, size)
            d.draw(Canvas(bitmap))
            val bytes = ByteArrayOutputStream().use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                out.toByteArray()
            }
            bitmap.recycle()
            if (bytes.size <= ICON_MAX_BYTES) return Base64.encodeToString(bytes, Base64.NO_WRAP)
        }
        return null
    }

    /** Liste autorisée reçue de l'écran : nettoyée, gardée ; rendue telle que retenue. */
    fun store(context: Context, requested: List<String?>): List<String> {
        val kept = AppsPolicy.sanitizeAllowed(requested, context.packageName, runtimeNeverHide(context), runtimeBrowsers(context))
        prefs(context).edit().putString(KEY_ALLOWED, AppsPolicy.encode(kept)).apply()
        return kept
    }

    /** Autorisée, toujours pas protégée, et hors plage « école » (plages reçues par AkaikyCall). */
    fun canLaunch(context: Context, pkg: String): Boolean =
        AppsPolicy.canLaunch(
            pkg, allowed(context), context.packageName, runtimeNeverHide(context), runtimeBrowsers(context),
            IncomingCalls.inSchool(context),
        )

    /**
     * Cache toute app lançable non autorisée, montre les autorisées (Device Owner armé
     * seulement). Rend le nombre d'apps cachées par nous. Une recherche de protection en
     * échec : rien n'est caché à ce passage (autorisées montrées seulement), et c'est noté.
     */
    fun applyHidden(context: Context): Int = synchronized(lock) {
        if (!Kiosk.isDeviceOwner(context) || !Kiosk.isArmed(context)) return hiddenByUs(context).size
        val dpm = dpm(context)
        val admin = admin(context)
        val protection = runtimeProtection(context)
        val never = protection.packages
        if (!protection.complete) Log.w(TAG, "Applications : protection incomplète, aucune app cachée à ce passage")
        val plan = AppsPolicy.plan(launchablePackages(context), allowed(context), context.packageName, never, protection.complete)
        val hidden = hiddenByUs(context).toMutableSet()
        for (pkg in plan.hide) {
            // Libéré entre-temps (disarm) : plus rien n'est caché.
            if (!Kiosk.isArmed(context)) break
            safely("cacher $pkg") { if (dpm.setApplicationHidden(admin, pkg, true) || dpm.isApplicationHidden(admin, pkg)) hidden.add(pkg) }
        }
        // Montrées : les autorisées, et celles cachées par nous devenues « jamais cachées ».
        val show = plan.unhide + hidden.filter { AppsPolicy.isNeverHide(it, context.packageName, never) }
        for (pkg in show) safely("montrer $pkg") { dpm.setApplicationHidden(admin, pkg, false); hidden.remove(pkg) }
        prefs(context).edit().putString(KEY_HIDDEN, AppsPolicy.encode(hidden)).commit()
        hidden.size
    }

    /**
     * Libération : tout ce que nous avons caché revient, et les listes sont oubliées (les
     * navigateurs vus restent notés). Sur un fil à part, après tout « cacher » en cours.
     */
    fun releaseAll(context: Context) {
        val app = context.applicationContext
        // Oubliée tout de suite, avant la file : plus rien n'est lançable ni gardé dans le lock
        // task, même si ce passage s'arrête plus bas (réarmé avant son tour).
        prefs(app).edit().remove(KEY_ALLOWED).commit()
        worker.execute {
            synchronized(lock) {
                // Réarmé avant notre tour (nouvel appairage) : rien à rendre, applyHidden décide.
                if (Kiosk.isArmed(app)) return@synchronized
                try {
                    if (Kiosk.isDeviceOwner(app)) {
                        val dpm = dpm(app)
                        val admin = admin(app)
                        val targets = hiddenByUs(app).toMutableSet()
                        safely("apps cachées") {
                            launchablePackages(app).filterTo(targets) { runCatching { dpm.isApplicationHidden(admin, it) }.getOrDefault(false) }
                        }
                        for (pkg in targets) safely("montrer $pkg") { dpm.setApplicationHidden(admin, pkg, false) }
                    }
                } finally {
                    prefs(app).edit().remove(KEY_HIDDEN).commit()
                }
            }
        }
    }

    /**
     * Travail du pont (liste, cacher) sur le fil des applications, à la suite de toute
     * libération : le fil partagé des plugins (SOS, appels) n'attend jamais le gestionnaire de paquets.
     */
    fun onWorker(block: () -> Unit) = worker.execute(block)

    private inline fun safely(what: String, block: () -> Unit) {
        try { block() } catch (e: Exception) { Log.w(TAG, "Applications : $what", e) }
    }
}
