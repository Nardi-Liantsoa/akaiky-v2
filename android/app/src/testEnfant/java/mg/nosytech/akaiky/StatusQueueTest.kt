package mg.nosytech.akaiky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusQueueTest {
    private class MemoryStore : KeyValueStore {
        val data = HashMap<String, String>()
        override fun get(key: String) = data[key]
        override fun put(key: String, value: String) { data[key] = value }
        override fun remove(key: String) { data.remove(key) }
    }

    private val a = StatusSnapshot(14, false, "none", "ready")
    private val b = StatusSnapshot(12, false, "none", "absent")
    private val c = StatusSnapshot(30, true, "wifi", "absent")

    @Test fun neGardeQueLeDernierReleve() {
        val q = StatusQueue(MemoryStore())
        q.offer(a, event = false)
        q.offer(b, event = false)
        q.offer(c, event = false)
        assertEquals(c, q.peek()?.status)
    }

    @Test fun unEvenementNoteResteNoteJusquALEnvoi() {
        val q = StatusQueue(MemoryStore())
        q.offer(a, event = true)
        val p = q.offer(b, event = false)
        assertTrue(p.event)
        assertEquals(b, p.status)
        assertTrue(q.clearIf(p.seq))
        assertNull(q.peek())
        assertFalse(q.offer(c, event = false).event)
    }

    @Test fun envoiReussiNeVidePasUnReleveArrivePendantLEnvoi() {
        val q = StatusQueue(MemoryStore())
        val sending = q.offer(a, event = true)
        q.offer(b, event = false)
        assertFalse(q.clearIf(sending.seq))
        assertEquals(b, q.peek()?.status)
    }

    @Test fun survitAuRedemarrageDuProcessus() {
        val store = MemoryStore()
        StatusQueue(store).apply { offer(b, event = true); markSent(SentStatus(42, a)) }
        val q = StatusQueue(store)
        assertEquals(PendingStatus(1, b, true), q.peek())
        assertEquals(SentStatus(42, a), q.lastSent())
        assertEquals(b, q.latestKnown())
    }

    @Test fun arretOublieToutSaufLaSequence() {
        val q = StatusQueue(MemoryStore())
        val old = q.offer(a, event = true)
        q.markSent(SentStatus(1, a))
        q.clear()
        assertNull(q.peek())
        assertNull(q.lastSent())
        q.offer(b, event = false)
        assertFalse("ancien envoi encore en cours", q.clearIf(old.seq))
    }

    @Test fun memoireDeLaCarteSimGardeeEtOublieeALArret() {
        val store = MemoryStore()
        val q = StatusQueue(store)
        assertEquals("rien de connu", SimMemory(null), q.simMemory())
        q.markSent(SentStatus(1, a))
        assertEquals("reprise du dernier envoi", "ready", q.simMemory().known)
        val m = SimMemory("absent", listOf(SimTransition("ready", "absent", 5)))
        q.saveSimMemory(m)
        assertEquals(m, StatusQueue(store).simMemory())
        q.clear()
        assertEquals(SimMemory(null), q.simMemory())
        q.markSent(SentStatus(2, a.copy(simState = "unknown")))
        assertNull("« unknown » n'est pas un état connu", q.simMemory().known)
    }
}
