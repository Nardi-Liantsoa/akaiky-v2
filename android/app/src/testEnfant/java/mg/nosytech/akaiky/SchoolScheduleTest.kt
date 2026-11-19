package mg.nosytech.akaiky

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant
import java.time.ZoneId

class SchoolScheduleTest {
    // Cas partagés avec src/lib/schedule.test.ts (écran de l'enfant) : même résultat.
    private val shared = JSONObject(File("../../tests/fixtures/schedule-cases.json").readText())

    @Test fun casPartagesAvecLEcran() {
        val rules = shared.getJSONObject("rules")
        val cases = shared.getJSONArray("cases")
        assertTrue(cases.length() > 10)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val names = c.getJSONArray("rules")
            val list = (0 until names.length()).map { k ->
                val r = rules.getJSONObject(names.getString(k))
                SchoolSchedule.Rule(r.getInt("days"), r.getInt("startMin"), r.getInt("endMin"))
            }
            val at = Instant.parse(c.getString("at")).toEpochMilli()
            assertEquals(c.getString("name"), c.getBoolean("active"), SchoolSchedule.isActive(at, list, ZoneId.of(c.getString("tz"))))
        }
    }

    @Test fun planteMalFormeeIgnoreeEtFuseauInconnu() {
        val monday10 = Instant.parse("2026-11-16T07:00:00Z").toEpochMilli()
        assertFalse(SchoolSchedule.isActive(monday10, listOf(SchoolSchedule.Rule(0, 480, 960), SchoolSchedule.Rule(31, 600, 600)), SchoolSchedule.zone(null)))
        assertEquals(ZoneId.of("Indian/Antananarivo"), SchoolSchedule.zone("Madagascar"))
        assertEquals(emptyList<SchoolSchedule.Rule>(), SchoolSchedule.parse("pas du json"))
        assertEquals(listOf(SchoolSchedule.Rule(31, 480, 960)), SchoolSchedule.parse("""[{"days":31,"startMin":480,"endMin":960},{"days":31}]"""))
    }

    @Test fun pendantLaPlageSeulsLesParentsSontJoignables() {
        val allowed = setOf("+261341111111", "+261342222222", "+261343333333")
        val parents = setOf("+261341111111", "+261349999999")
        assertEquals(setOf("+261341111111"), CallPolicy.reachable(allowed, parents, inSchool = true))
        assertEquals(allowed, CallPolicy.reachable(allowed, parents, inSchool = false))
        // Mamie (contact non parent) est refusée pendant la plage, et la cause est la plage.
        val reachable = CallPolicy.reachable(allowed, parents, inSchool = true)
        val eq = { a: String, b: String -> a == b }
        assertEquals(CallPolicy.Incoming.BLOCK_SCHEDULE, CallPolicy.screenIncoming("+261343333333", true, allowed, eq, reachable))
        assertEquals(CallPolicy.Incoming.RING, CallPolicy.screenIncoming("+261341111111", true, allowed, eq, reachable))
        // Inconnu : reste BLOCK_UNKNOWN ; numéro court (117 présenté) : pas d'exception.
        assertEquals(CallPolicy.Incoming.BLOCK_UNKNOWN, CallPolicy.screenIncoming("+261329876543", true, allowed, eq, reachable))
        assertEquals(CallPolicy.Incoming.BLOCK_UNKNOWN, CallPolicy.screenIncoming("117", true, allowed, eq, reachable))
        // Hors plage : comportement d'avant (reachable = allowed).
        assertEquals(CallPolicy.Incoming.RING, CallPolicy.screenIncoming("+261343333333", true, allowed, eq))
        // Aucun parent dans la liste : plus personne ne sonne pendant la plage.
        assertEquals(CallPolicy.Incoming.BLOCK_SCHEDULE, CallPolicy.screenIncoming("+261341111111", true, allowed, eq, CallPolicy.reachable(allowed, emptySet(), true)))
    }
}
