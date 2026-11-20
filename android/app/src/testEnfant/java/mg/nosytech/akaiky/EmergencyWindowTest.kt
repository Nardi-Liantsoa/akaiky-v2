package mg.nosytech.akaiky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Fenêtre des secours (NAR-196) ; cas de décision partagés : incoming-call-cases.json. */
class EmergencyWindowTest {
    private val min = 60_000L

    @Test fun trenteMinutes() {
        assertEquals(30 * min, EmergencyWindow.DURATION_MS)
        val m = EmergencyWindow.Mark(10 * min, 3)
        assertTrue(EmergencyWindow.isOpen(m, 10 * min, 3))
        assertTrue(EmergencyWindow.isOpen(m, 40 * min - 1, 3))
        assertFalse(EmergencyWindow.isOpen(m, 40 * min, 3))
    }

    @Test fun aucunAppelAuxSecours() {
        assertFalse(EmergencyWindow.isOpen(null, 10 * min, 3))
    }

    @Test fun redemarrageFerme() {
        val m = EmergencyWindow.Mark(10 * min, 3)
        assertFalse(EmergencyWindow.isOpen(m, 11 * min, 4))
        // Numéro de démarrage illisible (-1 des deux côtés) : l'horloge repartie de zéro suffit.
        assertFalse(EmergencyWindow.isOpen(EmergencyWindow.Mark(10 * min, -1), 1 * min, -1))
    }

    @Test fun instantAbime() {
        // Instant négatif (préférences abîmées) : fermée, sans débordement de la soustraction.
        assertFalse(EmergencyWindow.isOpen(EmergencyWindow.Mark(Long.MIN_VALUE, 3), 10 * min, 3))
        assertFalse(EmergencyWindow.isOpen(EmergencyWindow.Mark(-1, 3), 10 * min, 3))
    }
}
