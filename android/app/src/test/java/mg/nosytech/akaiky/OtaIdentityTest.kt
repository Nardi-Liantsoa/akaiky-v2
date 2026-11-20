package mg.nosytech.akaiky

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.io.File

// Identité OTA que la coque de la variante testée embarque (NAR-162) : assets fusionnés
// (android/app/build.gradle, OtaIdentityTask), comparés aux coques de
// tests/fixtures/ota-target-cases.json, qu'utilise aussi src/lib/otaTarget.test.ts.
class OtaIdentityTest {
    private val shared = JSONObject(File("../../tests/fixtures/ota-target-cases.json").readText())
    private val updater = JSONObject(File(System.getProperty("akaiky.assets"), "capacitor.config.json").readText())
        .getJSONObject("plugins").getJSONObject("CapacitorUpdater")

    @Test fun laCoqueSePresenteCommeSonApp() {
        val shell = shared.getJSONObject("shells").getJSONObject(BuildConfig.FLAVOR)
        assertEquals(shell.getString("applicationId"), BuildConfig.APPLICATION_ID)
        assertEquals(shell.getString("applicationId"), updater.getString("appId"))
        assertEquals(shell.getString("channel"), updater.getString("defaultChannel"))
    }

    @Test fun jamaisLIdentiteDeLAutreApp() {
        val other = if (BuildConfig.FLAVOR == "enfant") "parent" else "enfant"
        val shell = shared.getJSONObject("shells").getJSONObject(other)
        assertNotEquals(shell.getString("applicationId"), updater.getString("appId"))
        assertNotEquals(shell.getString("channel"), updater.getString("defaultChannel"))
    }

    @Test fun leJavaScriptNePeutPasChangerDeCanalNiDIdentifiant() {
        assertFalse(updater.getBoolean("allowSetDefaultChannel"))
        assertFalse(updater.getBoolean("allowModifyAppId"))
        // Réglages de capacitor.config.ts conservés par la réécriture.
        assertFalse(updater.getBoolean("autoUpdate"))
        assertEquals(10000, updater.getInt("appReadyTimeout"))
        // Aucune statistique vers le service Capgo (identifiant d'appareil d'un enfant).
        assertEquals("", updater.getString("statsUrl"))
    }
}
