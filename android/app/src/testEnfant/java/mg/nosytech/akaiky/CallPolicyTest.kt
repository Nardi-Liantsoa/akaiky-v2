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

    @Test fun casPartagesDuFiltreDesAppelsEntrants() {
        // Mêmes cas que LegacyIncomingTest (Android 8–9, NAR-172) : même décision.
        assertTrue(IncomingCases.all.size >= 10)
        for (c in IncomingCases.all) {
            assertEquals(c.name, c.expected, CallPolicy.screenIncoming(c.number, c.filtering, c.allowed, IncomingCases.e164Mg, c.reachable))
        }
    }

    @Test fun filtrageInactifToutSonne() {
        assertEquals(CallPolicy.Incoming.RING, CallPolicy.screenIncoming(null, false, emptySet(), suffix9))
        assertEquals(CallPolicy.Incoming.RING, CallPolicy.screenIncoming("+261329876543", false, allowed, suffix9))
    }

    // Appels sortants (NAR-169). Lecture E.164 simplifiée pour le test (PhoneNumberUtils sur le
    // téléphone) : « 0… » malgache → +261…, comparaison exacte ensuite.
    private val e164Mg = { number: String, contact: String -> (if (number.startsWith("0")) "+261" + number.drop(1) else number) == contact }
    private val emergency = { n: String -> CallPolicy.isEmergency(n) }
    private val parent = "+261341234567"
    private val other = "+261331234567"
    private fun out(number: String?, filtering: Boolean = true, list: Set<String> = allowed, reachable: Set<String> = list, isEmergency: (String) -> Boolean = emergency) =
        CallPolicy.screenOutgoing(number, filtering, list, reachable, e164Mg, isEmergency)

    @Test fun sortantContactAutorise() {
        assertEquals(CallPolicy.Outgoing.PLACE, out("+261341234567"))
        assertEquals(CallPolicy.Outgoing.PLACE, out("034 12 345 67"))
        assertEquals(CallPolicy.Outgoing.PLACE, out("+261 33-12.345 67"))
    }

    @Test fun sortantInconnuRefuse() {
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("0329999999"))
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("+33612345678"))
        // Même 7 derniers chiffres qu'un contact : refusé (comparaison exacte).
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("+261321234567"))
        // Indicatif sans « + » : lu comme numéro national par le réseau, jamais comme le contact.
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("261341234567"))
    }

    @Test fun sortantMalformeRefuse() {
        assertEquals(CallPolicy.Outgoing.BLOCK_INVALID, out(null))
        assertEquals(CallPolicy.Outgoing.BLOCK_INVALID, out(""))
        assertEquals(CallPolicy.Outgoing.BLOCK_INVALID, out("abc"))
        assertEquals(CallPolicy.Outgoing.BLOCK_INVALID, out("1234567890123456"))
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("*#06#"))
    }

    @Test fun sortantUrgenceToujours() {
        assertEquals(CallPolicy.Outgoing.EMERGENCY, out("112"))
        assertEquals(CallPolicy.Outgoing.EMERGENCY, out(" 117 "))
        // Liste vide, pendant une plage (aucun joignable), ou numéro connu du seul téléphone.
        assertEquals(CallPolicy.Outgoing.EMERGENCY, out("112", list = emptySet()))
        assertEquals(CallPolicy.Outgoing.EMERGENCY, out("117", reachable = emptySet()))
        assertEquals(CallPolicy.Outgoing.EMERGENCY, out("999", list = emptySet(), isEmergency = { it == "999" || emergency(it) }))
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("1170"))
    }

    @Test fun sortantListeVideRefuse() {
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("+261341234567", list = emptySet()))
    }

    @Test fun sortantFiltrageInactifPasse() {
        assertEquals(CallPolicy.Outgoing.PLACE, out("0329999999", filtering = false, list = emptySet()))
        assertEquals(CallPolicy.Outgoing.PLACE, out(null, filtering = false))
    }

    @Test fun sortantPlageEcoleParentsSeuls() {
        val school = CallPolicy.reachable(allowed, setOf(parent), inSchool = true)
        assertEquals(CallPolicy.Outgoing.PLACE, out(parent, reachable = school))
        assertEquals(CallPolicy.Outgoing.BLOCK_SCHEDULE, out(other, reachable = school))
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("0329999999", reachable = school))
        assertEquals(CallPolicy.Outgoing.EMERGENCY, out("112", reachable = school))
    }

    @Test fun urgenceStricte() {
        assertTrue(CallPolicy.isEmergency("117"))
        assertTrue(CallPolicy.isEmergency("1 1 7"))
        assertTrue(CallPolicy.isEmergency("(112)"))
        assertTrue(CallPolicy.isEmergency("1-1-2"))
        // Codes de service : jamais une urgence, même si leurs chiffres en forment une.
        assertFalse(CallPolicy.isEmergency("*117#"))
        assertFalse(CallPolicy.isEmergency("#112#"))
        assertFalse(CallPolicy.isEmergency("*112"))
        assertFalse(CallPolicy.isEmergency("1.1.7"))
        assertFalse(CallPolicy.isEmergency("11+7"))
        assertFalse(CallPolicy.isEmergency(""))
        assertFalse(CallPolicy.isEmergency(null))
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("*117#", list = emptySet()))
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("#112#", list = emptySet()))
        assertEquals(CallPolicy.Outgoing.EMERGENCY, out("1 1 7", list = emptySet()))
    }

    @Test fun plusInitialPasUneUrgence() {
        // « +112 », « +117 » : lus comme un indicatif international, jamais une urgence de l'app.
        assertFalse(CallPolicy.isEmergency("+112"))
        assertFalse(CallPolicy.isEmergency("+117"))
        assertFalse(CallPolicy.isEmergency("+ 1 1 7"))
        assertFalse(CallPolicy.placeImmediately("tel", "+112"))
        // Décision normale : hors liste, refusé ; présent dans la liste, composé.
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("+112", list = emptySet()))
        assertEquals(CallPolicy.Outgoing.BLOCK_UNKNOWN, out("+117"))
        assertEquals(CallPolicy.Outgoing.PLACE, out("+117", list = setOf("+117")))
        var read = 0
        assertFalse(CallPolicy.placeOutgoing("tel", "+112") { read++; CallPolicy.Outgoing.BLOCK_UNKNOWN })
        assertFalse(CallPolicy.placeOutgoing("tel", "+117") { read++; CallPolicy.Outgoing.BLOCK_UNKNOWN })
        assertEquals(2, read)
    }

    @Test fun redirectionUrgenceSansLecture() {
        var read = 0
        val decide = { read++; CallPolicy.Outgoing.BLOCK_UNKNOWN }
        assertTrue(CallPolicy.placeOutgoing("tel", "112", decide))
        assertTrue(CallPolicy.placeOutgoing("tel", "1 1 7", decide))
        // Messagerie vocale de l'enfant : composée aussitôt.
        assertTrue(CallPolicy.placeOutgoing("voicemail", null, decide))
        assertEquals(0, read)
        // Code de service : décision complète, refusé.
        assertFalse(CallPolicy.placeOutgoing("tel", "*117#", decide))
        assertEquals(1, read)
        // sip : décision complète (numéro illisible pendant le filtrage).
        assertFalse(CallPolicy.placeOutgoing("sip", null) { read++; CallPolicy.Outgoing.BLOCK_INVALID })
        assertEquals(2, read)
        assertTrue(CallPolicy.placeOutgoing("tel", "0341234567") { CallPolicy.Outgoing.PLACE })
    }

    @Test fun redirectionErreurAnnule() {
        // Décision synchrone : toute erreur annule, sauf l'urgence, composée avant toute lecture.
        val boom: () -> CallPolicy.Outgoing = { throw IllegalStateException("préférences illisibles") }
        assertFalse(CallPolicy.placeOutgoing("tel", "0341234567", boom))
        assertFalse(CallPolicy.placeOutgoing("tel", "*117#", boom))
        assertFalse(CallPolicy.placeOutgoing("sip", null, boom))
        assertTrue(CallPolicy.placeOutgoing("tel", "117", boom))
        assertTrue(CallPolicy.placeOutgoing("voicemail", null, boom))
        assertFalse(CallPolicy.placeImmediately("sip", "112"))
        assertFalse(CallPolicy.placeImmediately("tel", "0341234567"))
    }
}
