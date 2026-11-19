package mg.nosytech.akaiky

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AppsPolicyTest {
    private val own = "mg.nosytech.akaiky.enfant"

    // Liste unique, lue aussi par le serveur (routes/apps.js) : les deux disent la même chose.
    private val shared = JSONObject(File("../../server/src/protected-apps.json").readText())
    private fun strings(a: JSONArray) = (0 until a.length()).map { a.getString(it) }

    @Test fun listesEgalesAuServeur() {
        assertEquals(strings(shared.getJSONArray("prefixes")), AppsPolicy.PREFIXES)
        assertEquals(strings(shared.getJSONArray("neverHide")).toSet(), AppsPolicy.NEVER_HIDE)
        assertEquals(strings(shared.getJSONArray("browsers")).toSet(), AppsPolicy.BROWSERS)
        assertEquals(strings(shared.getJSONArray("neverHide")).size, AppsPolicy.NEVER_HIDE.size)
        assertEquals(strings(shared.getJSONArray("browsers")).size, AppsPolicy.BROWSERS.size)
    }

    @Test fun nomsDePaquet() {
        assertTrue(AppsPolicy.isValidPackage("com.android.calculator2"))
        assertTrue(AppsPolicy.isValidPackage("org.mozilla.firefox_beta"))
        assertFalse(AppsPolicy.isValidPackage("calculator"))
        assertFalse(AppsPolicy.isValidPackage("1com.exemple"))
        assertFalse(AppsPolicy.isValidPackage("com..exemple"))
        assertFalse(AppsPolicy.isValidPackage("com.exemple."))
        assertFalse(AppsPolicy.isValidPackage("com.ex-emple"))
        assertFalse(AppsPolicy.isValidPackage(null))
        assertFalse(AppsPolicy.isValidPackage("a." + "b".repeat(199)))
    }

    @Test fun protegees() {
        assertTrue("l'app", AppsPolicy.isProtected(own, own))
        assertTrue("l'app parent", AppsPolicy.isProtected("mg.nosytech.akaiky", own))
        assertTrue("préfixe", AppsPolicy.isProtected("mg.nosytech.akaiky.autre", own))
        assertFalse("préfixe sans point", AppsPolicy.isProtected("mg.nosytech.akaikyx", own))
        assertTrue("composeur", AppsPolicy.isProtected("com.google.android.dialer", own))
        assertTrue("réglages", AppsPolicy.isProtected("com.android.settings", own))
        assertTrue("navigateur", AppsPolicy.isProtected("com.android.chrome", own))
        assertTrue("composeur du constructeur", AppsPolicy.isProtected("com.oem.dialer", own, runtimeNeverHide = setOf("com.oem.dialer")))
        assertTrue("navigateur détecté", AppsPolicy.isProtected("com.oem.browser", own, runtimeBrowsers = setOf("com.oem.browser")))
        assertFalse(AppsPolicy.isProtected("com.android.calculator2", own))
        assertFalse("navigateur : caché, pas « jamais caché »", AppsPolicy.isNeverHide("com.android.chrome", own))
        assertTrue(AppsPolicy.isNeverHide("com.android.systemui", own))
    }

    @Test fun listeAutoriseeNettoyee() {
        val kept = AppsPolicy.sanitizeAllowed(
            listOf(
                " com.android.calculator2 ", "com.android.calculator2", null, "pas un paquet", own,
                "com.android.chrome", "com.android.settings", "com.oem.dialer",
                "com.android.camera2", "com.android.deskclock", "com.google.android.calendar", "com.exemple.cinquieme",
            ),
            own,
            runtimeNeverHide = setOf("com.oem.dialer"),
        )
        assertEquals(listOf("com.android.calculator2", "com.android.camera2", "com.android.deskclock", "com.google.android.calendar"), kept)
        assertEquals(AppsPolicy.MAX_ALLOWED, kept.size)
    }

    @Test fun planCacheLesAutresMontreLesAutorisees() {
        val launchable = listOf(
            own, "com.android.calculator2", "com.android.camera2", "com.android.deskclock",
            "com.android.chrome", "com.android.settings", "com.google.android.dialer", "com.oem.ime", "com.android.calculator2",
        )
        val plan = AppsPolicy.plan(launchable, listOf("com.android.calculator2"), own, runtimeNeverHide = setOf("com.oem.ime"))
        assertEquals(listOf("com.android.camera2", "com.android.chrome", "com.android.deskclock"), plan.hide)
        assertEquals(listOf("com.android.calculator2"), plan.unhide)
    }

    @Test fun fournisseurWebViewJamaisCacheMemeNavigateur() {
        // Android 8/9 : Chrome peut fournir la WebView de l'app ; le cacher éteindrait l'écran.
        val plan = AppsPolicy.plan(listOf("com.android.chrome", "com.android.camera2"), emptyList(), own, runtimeNeverHide = setOf("com.android.chrome"))
        assertEquals(listOf("com.android.camera2"), plan.hide)
        assertEquals(emptyList<String>(), plan.unhide)
    }

    @Test fun rienDAutoriseToutEstCacheSaufLeNecessaire() {
        val plan = AppsPolicy.plan(listOf(own, "com.android.systemui", "com.android.camera2"), emptyList(), own)
        assertEquals(listOf("com.android.camera2"), plan.hide)
    }

    @Test fun paquetsDuLockTaskAvecLesAutorisees() {
        val base = arrayOf(own, "com.google.android.dialer", "com.android.server.telecom")
        assertArrayEquals(
            arrayOf(own, "com.google.android.dialer", "com.android.server.telecom", "com.android.calculator2"),
            AppsPolicy.lockTaskPackages(base, listOf("com.android.calculator2", own, "pas valide")),
        )
        assertArrayEquals(base, AppsPolicy.lockTaskPackages(base, emptyList()))
        // Plage « école » : apps autorisées retirées, base (app, composeur, Telecom) gardée.
        assertArrayEquals(base, AppsPolicy.lockTaskPackages(base, listOf("com.android.calculator2"), inSchool = true))
    }

    @Test fun nomAffiche() {
        assertEquals("Appareil photo", AppsPolicy.cleanLabel("  Appareil\u0000 \n photo\u0007 "))
        assertEquals("", AppsPolicy.cleanLabel(null))
        val long = "é".repeat(100)
        assertEquals(80, AppsPolicy.cleanLabel(long).codePointCount(0, AppsPolicy.cleanLabel(long).length))
        val emoji = "😀".repeat(90)
        assertEquals(80, AppsPolicy.cleanLabel(emoji).codePointCount(0, AppsPolicy.cleanLabel(emoji).length))
    }

    @Test fun stockageRelu() {
        assertEquals(listOf("com.a.b", "com.c.d"), AppsPolicy.decode(AppsPolicy.encode(listOf("com.a.b", "com.c.d", "com.a.b"))))
        assertEquals(listOf("com.a.b"), AppsPolicy.decode("com.a.b,,pas valide, com.a.b"))
        assertEquals(emptyList<String>(), AppsPolicy.decode(null))
    }

    @Test fun protectionIncompleteRienNEstCache() {
        // Composeur, SMS, clavier, lanceur ou WebView introuvable : on ne cache rien à l'aveugle,
        // les autorisées sont seulement montrées.
        val launchable = listOf("com.android.calculator2", "com.android.camera2", "com.oem.dialer")
        val plan = AppsPolicy.plan(launchable, listOf("com.android.calculator2"), own, protectionComplete = false)
        assertEquals(emptyList<String>(), plan.hide)
        assertEquals(listOf("com.android.calculator2"), plan.unhide)
        val complet = AppsPolicy.plan(launchable, listOf("com.android.calculator2"), own, protectionComplete = true)
        assertEquals(listOf("com.android.camera2", "com.oem.dialer"), complet.hide)
    }

    @Test fun navigateursVusGardes() {
        val known = AppsPolicy.rememberBrowsers(emptySet(), setOf("com.exemple.browser"))
        // Plus vu ensuite (désactivé, caché) : toujours noté.
        assertEquals(setOf("com.exemple.browser", "org.autre.web"), AppsPolicy.rememberBrowsers(known, setOf("org.autre.web", "pas valide")))
        assertEquals(known, AppsPolicy.rememberBrowsers(known, emptySet()))
    }

    @Test fun ouvertureRefuseeHorsListeNavigateurOuEcole() {
        val allowed = listOf("com.android.calculator2", "com.exemple.browser")
        val never = setOf("com.oem.ime")
        val browsers = setOf("com.exemple.browser")
        assertTrue(AppsPolicy.canLaunch("com.android.calculator2", allowed, own, never, browsers, inSchool = false))
        assertFalse("école", AppsPolicy.canLaunch("com.android.calculator2", allowed, own, never, browsers, inSchool = true))
        assertFalse("navigateur vu", AppsPolicy.canLaunch("com.exemple.browser", allowed, own, never, browsers, inSchool = false))
        assertFalse("non autorisée", AppsPolicy.canLaunch("com.android.camera2", allowed, own, never, browsers, inSchool = false))
        assertFalse(AppsPolicy.canLaunch(null, allowed, own, never, browsers, inSchool = false))
    }
}
