package mg.nosytech.akaiky

import org.json.JSONArray
import java.time.Instant
import java.time.ZoneId

/**
 * Plages « école » (NAR-176), même règle que src/lib/schedule.ts (activeWindow) : jours en
 * masque (bit 0 = lundi … bit 6 = dimanche), début et fin en minutes depuis minuit dans le
 * fuseau de la famille ; fin ≤ début = la plage traverse minuit (commence le jour coché,
 * finit le lendemain). Calculé ici, sans réseau ni WebView : le filtre d'appels tourne
 * même écran éteint. Cas de test partagés : tests/fixtures/schedule-cases.json.
 */
object SchoolSchedule {
    data class Rule(val days: Int, val startMin: Int, val endMin: Int)

    private const val DAY = 1440
    private const val WEEK = 7 * DAY
    const val DEFAULT_ZONE = "Indian/Antananarivo"

    /** Fuseau utilisable, sinon Madagascar (comme safeTimeZone côté écran). */
    fun zone(id: String?): ZoneId = try { ZoneId.of(id ?: DEFAULT_ZONE) } catch (e: Exception) { ZoneId.of(DEFAULT_ZONE) }

    /** Minute de la semaine (lundi 0:00 = 0) dans le fuseau donné. */
    fun weekMinute(epochMillis: Long, zone: ZoneId): Int {
        val t = Instant.ofEpochMilli(epochMillis).atZone(zone)
        return (t.dayOfWeek.value - 1) * DAY + t.hour * 60 + t.minute
    }

    private fun valid(r: Rule) = r.days in 1..127 && r.startMin in 0..1439 && r.endMin in 0..1439 && r.startMin != r.endMin

    /** Une plage couvre-t-elle cet instant ? Les plages mal formées sont ignorées. */
    fun isActive(epochMillis: Long, rules: List<Rule>, zone: ZoneId): Boolean {
        val m = weekMinute(epochMillis, zone)
        for (r in rules) {
            if (!valid(r)) continue
            val length = if (r.endMin > r.startMin) r.endMin - r.startMin else DAY - r.startMin + r.endMin
            for (d in 0 until 7) {
                if (r.days and (1 shl d) == 0) continue
                val a = d * DAY + r.startMin
                val b = a + length
                if ((m in a until b) || (m + WEEK in a until b)) return true
            }
        }
        return false
    }

    /** Plages reçues de l'écran (JSON : [{days, startMin, endMin}]) ; illisible = aucune. */
    fun parse(json: String?): List<Rule> = try {
        val a = JSONArray(json ?: "[]")
        (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            if (!o.has("days") || !o.has("startMin") || !o.has("endMin")) null
            else Rule(o.optInt("days"), o.optInt("startMin"), o.optInt("endMin"))
        }
    } catch (e: Exception) { emptyList() }
}
