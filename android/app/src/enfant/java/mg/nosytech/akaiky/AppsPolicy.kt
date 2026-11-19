package mg.nosytech.akaiky

/**
 * Applications autorisées (NAR-143), sans dépendance Android : testées par AppsPolicyTest.
 *
 * Listes recopiées de server/src/protected-apps.json (le test vérifie qu'elles sont égales) :
 * - PREFIXES : l'app elle-même (parent et enfant) ;
 * - NEVER_HIDE : jamais cachées ni autorisables (appels, SMS du SOS, interface système, réglages
 *   ouverts pendant une sortie, lanceurs, claviers, installation, services Google, WebView) ;
 * - BROWSERS : jamais autorisables (navigateur bloqué en v1), cachées comme toute app non autorisée.
 * Le natif y ajoute à l'exécution (AllowedApps.kt) le composeur et l'app SMS par défaut, les
 * claviers activés, le fournisseur WebView et les lanceurs (jamais cachés), et tout ce qui ouvre
 * un lien http(s) (navigateurs). « Jamais caché » l'emporte sur « navigateur » : sur Android 8/9,
 * Chrome peut être le fournisseur WebView, et le cacher éteindrait l'écran de l'app.
 */
object AppsPolicy {
    const val MAX_ALLOWED = 4
    const val MAX_LISTED = 150
    const val MAX_LABEL = 80
    private const val MAX_PACKAGE = 200
    private val PACKAGE = Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)+$")

    val PREFIXES = listOf("mg.nosytech.akaiky")

    val NEVER_HIDE = setOf(
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.android.phone",
        "com.android.server.telecom",
        "com.android.dialer",
        "com.google.android.dialer",
        "com.samsung.android.dialer",
        "com.samsung.android.incallui",
        "com.android.contacts",
        "com.google.android.contacts",
        "com.samsung.android.app.contacts",
        "com.android.mms",
        "com.android.messaging",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.emergency",
        "com.android.launcher",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.sec.android.app.launcher",
        "com.miui.home",
        "com.huawei.android.launcher",
        "com.android.inputmethod.latin",
        "com.google.android.inputmethod.latin",
        "com.samsung.android.honeyboard",
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.android.vending",
        "com.google.android.gms",
        "com.google.android.gsf",
        "com.android.webview",
        "com.google.android.webview",
        "com.android.providers.telephony",
        "com.android.cellbroadcastreceiver",
        "com.google.android.cellbroadcastreceiver",
    )

    val BROWSERS = setOf(
        "com.android.browser",
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
        "org.chromium.chrome",
        "org.mozilla.firefox",
        "org.mozilla.firefox_beta",
        "org.mozilla.fenix",
        "org.mozilla.focus",
        "org.mozilla.klar",
        "com.opera.browser",
        "com.opera.mini.native",
        "com.opera.gx",
        "com.microsoft.emmx",
        "com.brave.browser",
        "com.sec.android.app.sbrowser",
        "com.UCMobile.intl",
        "com.uc.browser.en",
        "com.duckduckgo.mobile.android",
        "com.kiwibrowser.browser",
        "com.vivaldi.browser",
        "com.mi.globalbrowser",
        "com.huawei.browser",
        "com.yandex.browser",
        "com.google.android.googlequicksearchbox",
    )

    fun isValidPackage(pkg: String?): Boolean =
        pkg != null && pkg.length <= MAX_PACKAGE && PACKAGE.matches(pkg)

    private fun isOwn(pkg: String, own: String): Boolean =
        pkg == own || PREFIXES.any { pkg == it || pkg.startsWith("$it.") }

    /** Jamais caché : l'app, la liste fixe et ce que le téléphone désigne à l'exécution. */
    fun isNeverHide(pkg: String, own: String, runtimeNeverHide: Set<String> = emptySet()): Boolean =
        isOwn(pkg, own) || pkg in NEVER_HIDE || pkg in runtimeNeverHide

    /** Ni listé au parent, ni autorisable, ni lancé par l'écran. */
    fun isProtected(
        pkg: String,
        own: String,
        runtimeNeverHide: Set<String> = emptySet(),
        runtimeBrowsers: Set<String> = emptySet(),
    ): Boolean = isNeverHide(pkg, own, runtimeNeverHide) || pkg in BROWSERS || pkg in runtimeBrowsers

    /** Liste reçue de l'écran : noms valides, sans doublon, ni protégés, 4 au plus, dans l'ordre. */
    fun sanitizeAllowed(
        requested: List<String?>,
        own: String,
        runtimeNeverHide: Set<String> = emptySet(),
        runtimeBrowsers: Set<String> = emptySet(),
    ): List<String> =
        requested.asSequence()
            .filterNotNull()
            .map { it.trim() }
            .filter { isValidPackage(it) && !isProtected(it, own, runtimeNeverHide, runtimeBrowsers) }
            .distinct()
            .take(MAX_ALLOWED)
            .toList()

    /** Nom affiché : caractères de contrôle retirés, espaces resserrés, 80 points de code au plus. */
    fun cleanLabel(raw: String?): String {
        val cleaned = (raw ?: "").filter { !Character.isISOControl(it) }.trim().replace(Regex("\\s+"), " ")
        val cps = cleaned.codePoints().toArray()
        return if (cps.size <= MAX_LABEL) cleaned else String(cps, 0, MAX_LABEL).trim()
    }

    data class HidePlan(val hide: List<String>, val unhide: List<String>)

    /**
     * Ce qu'il faut cacher ou montrer parmi les apps lançables : tout ce qui n'est pas autorisé
     * est caché (navigateurs compris), sauf l'app et ce qui n'est jamais caché.
     * `protectionComplete` faux (une recherche du composeur, de l'app SMS, des claviers, du
     * lanceur ou du fournisseur WebView a échoué) : rien n'est caché à ce passage, les
     * autorisées sont seulement montrées ; on ne cache jamais à l'aveugle le composeur ou le clavier.
     */
    fun plan(
        launchable: Collection<String>,
        allowed: Collection<String>,
        own: String,
        runtimeNeverHide: Set<String> = emptySet(),
        protectionComplete: Boolean = true,
    ): HidePlan {
        val ok = allowed.toSet()
        val candidates = launchable.distinct().filter { !isNeverHide(it, own, runtimeNeverHide) }
        return HidePlan(
            hide = if (protectionComplete) candidates.filter { it !in ok }.sorted() else emptyList(),
            unhide = candidates.filter { it in ok }.sorted(),
        )
    }

    /** Navigateurs déjà vus sur ce téléphone, gardés pour toujours : jamais autorisables ensuite. */
    fun rememberBrowsers(known: Collection<String>, found: Collection<String>): Set<String> =
        (known + found).filter { isValidPackage(it) }.toSet()

    /**
     * Ouverture demandée par l'écran : autorisée, toujours pas protégée (une app peut devenir
     * navigateur, etc.), et hors plage « école » (seuls les parents et le SOS restent, NAR-148).
     */
    fun canLaunch(
        pkg: String?,
        allowed: Collection<String>,
        own: String,
        runtimeNeverHide: Set<String>,
        runtimeBrowsers: Set<String>,
        inSchool: Boolean,
    ): Boolean =
        !inSchool && isValidPackage(pkg) && pkg!! in allowed && !isProtected(pkg, own, runtimeNeverHide, runtimeBrowsers)

    /**
     * Paquets du lock task : la liste de base (app, composeur, Telecom), puis les apps autorisées,
     * sauf pendant une plage « école » : la base seule (une app autorisée encore ouverte sort
     * alors du verrou, l'app et le composeur restent toujours).
     */
    fun lockTaskPackages(base: Array<String>, allowed: Collection<String>, inSchool: Boolean = false): Array<String> =
        if (inSchool) base.distinct().toTypedArray()
        else (base.toList() + allowed.filter { isValidPackage(it) }).distinct().toTypedArray()

    /** Stockage dans les préférences : une liste séparée par des virgules (noms validés à la relecture). */
    fun encode(list: Collection<String>): String = list.filter { isValidPackage(it) }.distinct().joinToString(",")

    fun decode(raw: String?): List<String> =
        (raw ?: "").split(',').map { it.trim() }.filter { isValidPackage(it) }.distinct()
}
