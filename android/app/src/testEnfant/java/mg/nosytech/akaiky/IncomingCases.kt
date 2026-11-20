package mg.nosytech.akaiky

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Cas partagés tests/fixtures/incoming-call-cases.json (Android 10+ et Android 8–9). */
object IncomingCases {
    data class Case(val name: String, val number: String?, val filtering: Boolean, val allowed: Set<String>, val reachable: Set<String>, val emergencyWindow: Boolean, val expected: CallPolicy.Incoming)

    // Lecture E.164 simplifiée (PhoneNumberUtils sur le téléphone) : « 0… » malgache → +261…, comparaison exacte.
    val e164Mg = { number: String, contact: String -> (if (number.startsWith("0")) "+261" + number.drop(1) else number) == contact }

    private fun set(a: JSONArray) = (0 until a.length()).map { a.getString(it) }.toSet()

    val all: List<Case> by lazy {
        val shared = JSONObject(File("../../tests/fixtures/incoming-call-cases.json").readText())
        val parents = set(shared.getJSONArray("parents"))
        val cases = shared.getJSONArray("cases")
        (0 until cases.length()).map { i ->
            val c = cases.getJSONObject(i)
            val allowed = set(if (c.has("allowed")) c.getJSONArray("allowed") else shared.getJSONArray("allowed"))
            // Fenêtre des secours (NAR-196) : la règle pure EmergencyWindow, la même sur les deux chemins.
            // `dialled` (NAR-197) : l'appel n'est noté (EmergencyCalls.record) que si le numéro composé est une urgence de l'app.
            val mark = c.optJSONObject("emergency")
                ?.takeIf { !it.has("dialled") || CallPolicy.isEmergency(it.getString("dialled")) }
                ?.let { EmergencyWindow.Mark(it.getLong("atElapsed"), it.getInt("boot")) }
            val now = c.optJSONObject("now")
            Case(
                c.getString("name"),
                if (c.isNull("number")) null else c.getString("number"),
                c.getBoolean("filtering"),
                allowed,
                CallPolicy.reachable(allowed, parents, c.getBoolean("inSchool")),
                now != null && EmergencyWindow.isOpen(mark, now.getLong("elapsed"), now.getInt("boot")),
                CallPolicy.Incoming.valueOf(c.getString("expected")),
            )
        }
    }
}
