package mg.nosytech.akaiky

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KioskPolicyTest {
    @Test fun dureeBornee() {
        assertEquals(15, KioskPolicy.clampMinutes(60))
        assertEquals(1, KioskPolicy.clampMinutes(0))
        assertEquals(1, KioskPolicy.clampMinutes(-5))
        assertEquals(10, KioskPolicy.clampMinutes(10))
    }

    @Test fun fenetreOuverteQuinzeMinutesPuisFermee() {
        val w = KioskPolicy.open(nowElapsed = 1_000, boot = 7, minutes = 15)
        assertTrue(KioskPolicy.isOpen(w, 1_000, 7))
        assertTrue(KioskPolicy.isOpen(w, 1_000 + 15 * 60_000 - 1, 7))
        assertFalse(KioskPolicy.isOpen(w, 1_000 + 15 * 60_000, 7))
    }

    @Test fun redemarrageFermeLaFenetre() {
        val w = KioskPolicy.open(nowElapsed = 500_000, boot = 7, minutes = 15)
        assertFalse("autre démarrage", KioskPolicy.isOpen(w, 500_001, 8))
        assertFalse("horloge repartie de zéro", KioskPolicy.isOpen(w, 10_000, 7))
        assertFalse(KioskPolicy.isOpen(null, 0, 7))
    }

    @Test fun fenetreTropLongueRefusee() {
        val forged = KioskPolicy.Window(startElapsed = 0, untilElapsed = 16 * 60_000L, boot = 1)
        assertFalse(KioskPolicy.isOpen(forged, 1, 1))
    }

    @Test fun paquetsDuVerrou() {
        assertArrayEquals(
            arrayOf("mg.nosytech.akaiky.enfant", "com.google.android.dialer", "com.android.server.telecom"),
            KioskPolicy.lockTaskPackages(
                "mg.nosytech.akaiky.enfant",
                listOf("com.google.android.dialer", null, "com.google.android.dialer", " ", "com.android.server.telecom", "mg.nosytech.akaiky.enfant")
            )
        )
    }
}
