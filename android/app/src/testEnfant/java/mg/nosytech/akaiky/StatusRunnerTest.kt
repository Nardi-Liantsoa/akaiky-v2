package mg.nosytech.akaiky

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusRunnerTest {
    private class MemoryStore : KeyValueStore {
        val data = HashMap<String, String>()
        override fun get(key: String) = data[key]
        override fun put(key: String, value: String) { data[key] = value }
        override fun remove(key: String) { data.remove(key) }
    }

    private class Tokens(@Volatile var value: String?) : TokenStore {
        override fun read() = value
        override fun write(token: String): Boolean { value = token; return true }
        override fun clear() { value = null }
    }

    private val ok = StatusSnapshot(80, false, "wifi", "ready")
    private val min = 60_000L
    private val token = "T".repeat(43)

    private class Fixture(
        var status: StatusSnapshot,
        var outcome: SendOutcome = SendOutcome.SENT,
        var now: Long = 1_000_000L
    ) {
        val enabled = AtomicBoolean(true)
        val queue = StatusQueue(MemoryStore())
        val tokens = Tokens("T".repeat(43))
        val sent = mutableListOf<Pair<String, JSONObject>>()
        var needsToken = 0
        var beforeReply: () -> Unit = {}
        val runner = StatusRunner(queue, tokens, { enabled.get() }, { status },
            send = { t, p -> sent += t to p; beforeReply(); outcome },
            clock = { now },
            markNeedsToken = { needsToken++ })
    }

    @Test fun premierSignalPuisUnParPeriode() {
        val f = Fixture(ok)
        assertEquals(SendOutcome.SENT, f.runner.run {})
        assertEquals(token, f.sent.single().first)
        assertTrue(f.sent.single().second.getBoolean("background"))
        f.now += 10 * min
        assertNull("trop tôt", f.runner.run {})
        f.now += 3 * min
        assertEquals("13 minutes : dû (marge de 2 minutes)", SendOutcome.SENT, f.runner.run {})
        assertEquals(2, f.sent.size)
    }

    @Test fun aucunEnvoiDesactive() {
        val f = Fixture(ok)
        f.enabled.set(false)
        assertNull(f.runner.run {})
        assertTrue(f.sent.isEmpty())
    }

    @Test fun arretPendantUnEnvoiAttendSaFinEtNeNoteRien() {
        val f = Fixture(ok)
        val inFlight = CountDownLatch(1)
        val release = CountDownLatch(1)
        f.beforeReply = { inFlight.countDown(); release.await(5, TimeUnit.SECONDS) }
        val worker = Thread { f.runner.run {} }.apply { start() }
        assertTrue(inFlight.await(5, TimeUnit.SECONDS))
        val stopped = AtomicBoolean(false)
        val stopper = Thread { f.runner.stop { f.enabled.set(false) }; stopped.set(true) }.apply { start() }
        Thread.sleep(200)
        assertFalse("l'arrêt attend l'envoi en cours", stopped.get())
        assertFalse("désactivé tout de suite", f.enabled.get())
        release.countDown()
        worker.join(5000); stopper.join(5000)
        assertTrue(stopped.get())
        assertNull("succès arrivé après l'arrêt : rien noté", f.queue.lastSent())
        assertNull(f.queue.peek())
        assertNull("jeton effacé", f.tokens.value)
        // Après l'arrêt : plus rien ne part.
        f.beforeReply = {}
        assertNull(f.runner.run {})
        assertEquals(1, f.sent.size)
    }

    @Test fun jetonRefuseArreteEtDemandeUnNouveauJeton() {
        val f = Fixture(ok, outcome = SendOutcome.NEEDS_TOKEN)
        var refused = 0
        assertEquals(SendOutcome.NEEDS_TOKEN, f.runner.run { refused++; f.runner.stop { f.enabled.set(false) } })
        assertEquals(1, refused)
        assertFalse(f.enabled.get())
        assertNull(f.tokens.value)
        assertNull(f.runner.run {})
    }

    @Test fun jetonIllisibleReessaieSansArreter() {
        val f = Fixture(ok.copy(simState = "absent"))
        f.queue.markSent(SentStatus(f.now - 1 * min, ok))
        f.tokens.value = null
        var refused = 0
        assertEquals(SendOutcome.NO_TOKEN, f.runner.run { refused++ })
        assertEquals(0, refused)
        assertEquals(1, f.needsToken)
        assertTrue("toujours en route", f.enabled.get())
        assertTrue(f.sent.isEmpty())
        assertTrue("événement carte SIM gardé pour l'envoi suivant", f.queue.peek()!!.event)
        f.tokens.value = token
        f.now += 1 * min
        assertEquals(SendOutcome.SENT, f.runner.run {})
        assertEquals("absent", f.sent.single().second.getString("simState"))
        assertNull(f.queue.peek())
    }

    @Test fun erreurPassagereGardeLeReleve() {
        val f = Fixture(ok, outcome = SendOutcome.RETRY)
        assertEquals(SendOutcome.RETRY, f.runner.run {})
        assertTrue(f.enabled.get())
        assertNull(f.queue.lastSent())
        f.outcome = SendOutcome.SENT
        assertEquals(SendOutcome.SENT, f.runner.run {})
        assertEquals(ok, f.queue.lastSent()?.status)
    }

    @Test fun evenementsCarteSimInconnueEtRafale() {
        val f = Fixture(ok)
        f.runner.run {}
        f.now += 1 * min
        assertNull("ready → unknown : pas d'événement", f.runner.observe(ok.copy(simState = "unknown"), f.now, always = false))
        assertTrue("unknown → absent : comparé à ready", f.runner.observe(ok.copy(simState = "absent"), f.now + 1, always = false)!!.event)
        f.queue.clearIf(f.queue.peek()!!.seq)
        assertTrue(f.runner.observe(ok, f.now + 2, always = false)!!.event)
        f.queue.clearIf(f.queue.peek()!!.seq)
        assertNull("même changement répété en rafale", f.runner.observe(ok.copy(simState = "absent"), f.now + 3, always = false))
    }
}
