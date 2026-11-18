package mg.nosytech.akaiky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CallPolicyTest {
    private val allowed = setOf("+261341234567", "+261331234567")

    @Test fun contactDeLaListe() {
        assertTrue(CallPolicy.isAllowed("+261341234567", allowed))
        assertTrue(CallPolicy.isAllowed(" +261 34 12 345 67 ", allowed))
    }

    @Test fun numeroHorsListeRefuse() {
        assertFalse(CallPolicy.isAllowed("+261321234567", allowed))
        assertFalse(CallPolicy.isAllowed("0341234567", allowed))
        assertFalse(CallPolicy.isAllowed("*#06#", allowed))
        assertFalse(CallPolicy.isAllowed(null, allowed))
        assertFalse(CallPolicy.isAllowed("+261341234567", emptySet()))
    }

    @Test fun urgence() {
        assertTrue(CallPolicy.isEmergency("117"))
        assertTrue(CallPolicy.isEmergency("112"))
        assertFalse(CallPolicy.isEmergency("+261341234567"))
        assertFalse(CallPolicy.isEmergency("1170"))
    }

    @Test fun normalisation() {
        assertEquals("+261341234567", CallPolicy.normalize("+261 34-12.345 67"))
        assertNull(CallPolicy.normalize("abc"))
        assertNull(CallPolicy.normalize("1234567890123456"))
    }

    // Comparaison simplifiée pour le test (PhoneNumberUtils sur le téléphone) : suffixe de 9 chiffres.
    private val suffix9 = { a: String, b: String -> a.filter { it.isDigit() }.takeLast(9) == b.filter { it.isDigit() }.takeLast(9) }

    @Test fun appelEntrantDUnContactSonne() {
        assertEquals(CallPolicy.Incoming.RING, CallPolicy.screenIncoming("+261341234567", true, allowed, suffix9))
        assertEquals(CallPolicy.Incoming.RING, CallPolicy.screenIncoming("034 12 345 67", true, allowed, suffix9))
    }

    @Test fun inconnuEtMasqueRejetes() {
        assertEquals(CallPolicy.Incoming.BLOCK_UNKNOWN, CallPolicy.screenIncoming("+261329876543", true, allowed, suffix9))
        assertEquals(CallPolicy.Incoming.BLOCK_HIDDEN, CallPolicy.screenIncoming(null, true, allowed, suffix9))
        assertEquals(CallPolicy.Incoming.BLOCK_HIDDEN, CallPolicy.screenIncoming("", true, allowed, suffix9))
        assertEquals(CallPolicy.Incoming.BLOCK_UNKNOWN, CallPolicy.screenIncoming("+261341234567", true, emptySet(), suffix9))
    }

    @Test fun filtrageInactifToutSonne() {
        assertEquals(CallPolicy.Incoming.RING, CallPolicy.screenIncoming(null, false, emptySet(), suffix9))
        assertEquals(CallPolicy.Incoming.RING, CallPolicy.screenIncoming("+261329876543", false, allowed, suffix9))
    }
}
