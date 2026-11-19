package mg.nosytech.akaiky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.json.JSONObject
import org.junit.Test

class BackgroundStatusPolicyTest {
    private val ok = StatusSnapshot(80, false, "wifi", "ready")
    private val min = 60_000L

    @Test fun premierSignalToujoursDu() {
        assertTrue(BackgroundStatusPolicy.due(null, ok, 0))
    }

    @Test fun unSignalParPeriodeAvecMargeDeDeuxMinutes() {
        val last = SentStatus(1_000_000, ok)
        assertFalse(BackgroundStatusPolicy.due(last, ok.copy(batteryPct = 70), 1_000_000 + 12 * min))
        assertFalse(BackgroundStatusPolicy.due(last, ok.copy(network = "mobile"), 1_000_000 + 13 * min - 1))
        // Tâche périodique avancée par WorkManager (14 min 50 s) : envoyée quand même.
        assertTrue(BackgroundStatusPolicy.due(last, ok, 1_000_000 + 13 * min))
        assertTrue(BackgroundStatusPolicy.due(last, ok, 1_000_000 + 14 * min + 50_000))
        assertTrue("horloge reculée", BackgroundStatusPolicy.due(last, ok, 999_999))
    }

    @Test fun batterieQuiPasseSous15EstUnEvenement() {
        val last = SentStatus(0, ok.copy(batteryPct = 15))
        assertTrue(BackgroundStatusPolicy.due(last, ok.copy(batteryPct = 14), 1 * min))
        assertFalse("déjà basse", BackgroundStatusPolicy.isBatteryEvent(ok.copy(batteryPct = 14), ok.copy(batteryPct = 10)))
        assertFalse("remonte", BackgroundStatusPolicy.isBatteryEvent(ok.copy(batteryPct = 10), ok.copy(batteryPct = 20)))
        assertFalse("relevé inconnu", BackgroundStatusPolicy.isBatteryEvent(ok, ok.copy(batteryPct = null)))
        assertTrue("depuis inconnu", BackgroundStatusPolicy.isBatteryEvent(ok.copy(batteryPct = null), ok.copy(batteryPct = 5)))
        assertFalse("rien de connu avant", BackgroundStatusPolicy.isBatteryEvent(null, ok.copy(batteryPct = 5)))
        assertFalse("la carte SIM n'est pas la batterie", BackgroundStatusPolicy.isBatteryEvent(ok, ok.copy(simState = "absent")))
    }

    private fun sim(memory: SimMemory, next: String, now: Long) = BackgroundStatusPolicy.simEvent(memory, next, now)

    @Test fun changementDeCarteSimEstUnEvenement() {
        val (event, after) = sim(SimMemory("ready"), "absent", 0)
        assertTrue(event)
        assertEquals("absent", after.known)
        assertTrue("retour", sim(after, "ready", 10 * 1000).first)
        assertFalse("rien ne change", sim(SimMemory("ready"), "ready", 0).first)
        assertFalse("rien de connu avant", sim(SimMemory(null), "absent", 0).first)
        assertEquals("premier état connu retenu", "absent", sim(SimMemory(null), "absent", 0).second.known)
    }

    @Test fun carteSimInconnueJamaisComparee() {
        // ready → unknown (modem qui redémarre) → ready : aucun événement, état connu gardé.
        val (toUnknown, kept) = sim(SimMemory("ready"), "unknown", 0)
        assertFalse(toUnknown)
        assertEquals("ready", kept.known)
        assertFalse(sim(kept, "ready", 1).first)
        // ready → unknown → absent : comparé au dernier état connu (ready), donc événement.
        assertTrue(sim(kept, "absent", 2).first)
        assertFalse("état hors vocabulaire", sim(SimMemory("ready"), "bogus", 0).first)
    }

    @Test fun memeChangementDeCarteSimRepeteEnRafaleNEstPasRenvoye() {
        var m = SimMemory("ready")
        val events = mutableListOf<Boolean>()
        // Contact de la carte qui flanche : ready/absent/ready/absent en 40 s.
        for ((i, state) in listOf("absent", "ready", "absent", "ready").withIndex()) {
            val (e, next) = sim(m, state, i * 10_000L)
            events += e
            m = next
        }
        assertEquals(listOf(true, true, false, false), events)
        assertEquals("état connu suivi même sans événement", "ready", m.known)
        // Passé 2 minutes, le même changement est de nouveau un événement.
        assertTrue(sim(m, "absent", 30_000L + 2 * min).first)
    }

    @Test fun evenementNoteForceLEnvoi() {
        val last = SentStatus(0, ok)
        assertTrue(BackgroundStatusPolicy.shouldSend(last, PendingStatus(1, ok, event = true), 1 * min))
        assertFalse(BackgroundStatusPolicy.shouldSend(last, PendingStatus(1, ok, event = false), 1 * min))
    }

    @Test fun corpsDuSignal() {
        val p = BackgroundStatusPolicy.payload(StatusSnapshot(14, null, "mobile", "absent"))
        assertEquals(setOf("batteryPct", "charging", "network", "simState", "background"), p.keys().asSequence().toSet())
        assertEquals(14, p.getInt("batteryPct"))
        assertTrue(p.isNull("charging"))
        assertEquals("mobile", p.getString("network"))
        assertEquals("absent", p.getString("simState"))
        assertTrue(p.getBoolean("background"))
        val unknown = JSONObject(BackgroundStatusPolicy.payload(StatusSnapshot(null, null, "x", "y")).toString())
        assertTrue(unknown.isNull("batteryPct"))
        assertEquals("unknown", unknown.getString("network"))
        assertEquals("unknown", unknown.getString("simState"))
    }

    @Test fun releveNatifVersVocabulaireDuServeur() {
        assertEquals("mobile", BackgroundStatusPolicy.snapshot(50, true, "cellular", "ready").network)
        assertEquals("wifi", BackgroundStatusPolicy.snapshot(50, true, "other", "ready").network)
        assertEquals("none", BackgroundStatusPolicy.snapshot(50, true, "none", "ready").network)
        assertNull(BackgroundStatusPolicy.snapshot(101, true, "wifi", "ready").batteryPct)
        assertEquals("unknown", BackgroundStatusPolicy.snapshot(50, true, "wifi", "bogus").simState)
    }

    @Test fun memoireDeLaCarteSimAllerRetour() {
        val m = SimMemory("absent", listOf(SimTransition("ready", "absent", 42)))
        assertEquals(m, BackgroundStatusPolicy.decodeSim(BackgroundStatusPolicy.encodeSim(m)))
        assertEquals(SimMemory(null), BackgroundStatusPolicy.decodeSim(BackgroundStatusPolicy.encodeSim(SimMemory(null))))
        assertEquals(SimMemory(null), BackgroundStatusPolicy.decodeSim("{"))
        assertEquals(SimMemory(null), BackgroundStatusPolicy.decodeSim(null))
    }

    @Test fun encodageAllerRetour() {
        val s = StatusSnapshot(null, true, "none", "locked")
        assertEquals(s, BackgroundStatusPolicy.decode(BackgroundStatusPolicy.encode(s)))
        assertNull(BackgroundStatusPolicy.decode("pas du json"))
        assertNull(BackgroundStatusPolicy.decode(null))
    }

    @Test fun etatDeLaCarteSim() {
        assertEquals("absent", DeviceSignals.simStateName(1))
        assertEquals("ready", DeviceSignals.simStateName(5))
        assertEquals("locked", DeviceSignals.simStateName(2))
        assertEquals("locked", DeviceSignals.simStateName(3))
        assertEquals("locked", DeviceSignals.simStateName(4))
        assertEquals("unknown", DeviceSignals.simStateName(0))
        assertEquals("unknown", DeviceSignals.simStateName(6))
        assertEquals("absent", DeviceSignals.simStateName(8))
        assertEquals("unknown", DeviceSignals.simStateName(42))
        assertEquals(50, DeviceSignals.batteryPct(50, 100))
        assertEquals(100, DeviceSignals.batteryPct(255, 255))
        assertNull(DeviceSignals.batteryPct(-1, 100))
        assertNull(DeviceSignals.batteryPct(10, 0))
    }
}
