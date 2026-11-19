package mg.nosytech.akaiky

import android.content.Context
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Appels entrants vus par le filtre (NAR-145), en attente d'être repris par l'écran de
 * l'enfant (file du journal, envoi au serveur). Le service de filtrage tourne sans
 * WebView : il écrit ici, l'app relit (peek) puis acquitte (ack) ce qu'elle a gardé.
 * Préférences privées de l'app (téléphone Device Owner, sauvegarde désactivée) ; 500
 * événements au plus, les plus anciens tombent.
 */
object IncomingCalls {
    private const val PREFS = "akaiky.calls"
    private const val KEY = "incoming"
    private const val MAX = 500

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Filtrage actif : une liste a été reçue du parent (téléphone appairé). */
    fun isFiltering(context: Context): Boolean = prefs(context).getBoolean("filtering", false)
    fun allowed(context: Context): Set<String> = prefs(context).getStringSet("allowed", emptySet()) ?: emptySet()
    fun country(context: Context): String = prefs(context).getString("country", null) ?: "MG"
    /** Numéros des parents et plages « école » (NAR-176), reçus avec la liste. */
    fun parents(context: Context): Set<String> = prefs(context).getStringSet("parents", emptySet()) ?: emptySet()
    fun inSchool(context: Context, now: Long = System.currentTimeMillis()): Boolean {
        val p = prefs(context)
        return SchoolSchedule.isActive(now, SchoolSchedule.parse(p.getString("schedules", null)), SchoolSchedule.zone(p.getString("timezone", null)))
    }
    /** Numéros joignables maintenant : la liste, ou ses seuls parents pendant une plage. */
    fun reachable(context: Context, allowed: Set<String> = allowed(context)): Set<String> =
        CallPolicy.reachable(allowed, parents(context), inSchool(context))

    /** Forme E.164 d'un numéro reçu (national ou international), sinon chiffres bruts. */
    fun toE164(number: String, country: String): String {
        val n = CallPolicy.normalize(number) ?: return number
        if (n.startsWith("+")) return n
        return PhoneNumberUtils.formatNumberToE164(n, country) ?: n
    }

    /** Pays possibles d'un numéro national : configuration du parent, carte SIM, réseau. */
    fun countries(context: Context): List<String> {
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        return listOfNotNull(country(context), tm?.simCountryIso, tm?.networkCountryIso)
            .map { it.uppercase() }.filter { it.length == 2 }.distinct()
    }

    /**
     * Lectures E.164 possibles d'un numéro reçu : tel quel s'il a déjà son « + », avec un
     * « + » ajouté (indicatif présenté sans « + »), et au format national de chaque pays
     * possible. Comparaison ensuite EXACTE à la liste : jamais la comparaison souple
     * d'Android (deux numéros aux 7 derniers chiffres égaux seraient confondus).
     */
    fun candidates(number: String, countries: List<String>): Set<String> {
        val n = CallPolicy.normalize(number) ?: return emptySet()
        if (n.startsWith("+")) return setOf(n)
        // Lectures nationales d'abord (« 00 » international compris), puis l'indicatif
        // présenté sans « + » ; jamais « +0… », qui n'est pas un numéro E.164.
        val out = linkedSetOf<String>()
        for (c in countries) PhoneNumberUtils.formatNumberToE164(n, c)?.let { if (it.matches(E164)) out.add(it) }
        if (n.length >= 11 && !n.startsWith("0")) out.add("+$n")
        return out
    }

    private val E164 = Regex("^\\+[1-9][0-9]{6,14}$")

    /**
     * Numéro à noter : le contact autorisé reconnu s'il y en a un (le journal retrouve
     * son nom), sinon la première lecture E.164, sinon les chiffres reçus.
     * Moins de 2 chiffres (« -1 », « 2 » : numéro retenu par le réseau) = masqué.
     */
    fun displayNumber(raw: String?, countries: List<String>, allowed: Set<String>): String? {
        val n = CallPolicy.normalize(raw) ?: return null
        if (n.trimStart('+').length < 2) return null
        val readings = candidates(n, countries)
        return readings.firstOrNull { it in allowed } ?: readings.firstOrNull() ?: n
    }

    /**
     * Dernier appel entrant qu'a laissé sonner le filtre (numéro autorisé, liste active) :
     * le SOS (SosService) y reconnaît, sur Android 12+, un contact qui rappelle l'enfant.
     */
    fun markScreenedAllowed(context: Context, at: Long) { prefs(context).edit().putLong("screenedAllowedAt", at).commit() }
    fun screenedAllowedAt(context: Context): Long = prefs(context).getLong("screenedAllowedAt", 0L)

    /** school : refusé parce qu'une plage « école » était en cours (contact non parent). */
    @Synchronized
    fun record(context: Context, kind: String, phone: String?, startedAt: Long, school: Boolean = false) {
        val list = read(context)
        list.put(JSONObject().apply {
            put("id", UUID.randomUUID().toString())
            put("kind", kind)
            if (phone != null) put("phone", phone)
            if (school) put("school", true)
            put("startedAt", startedAt)
        })
        val kept = JSONArray()
        for (i in maxOf(0, list.length() - MAX) until list.length()) kept.put(list.get(i))
        // commit (synchrone) : le service de filtrage peut être arrêté dès sa réponse rendue.
        prefs(context).edit().putString(KEY, kept.toString()).commit()
    }

    @Synchronized
    fun peek(context: Context): JSONArray = read(context)

    @Synchronized
    fun ack(context: Context, ids: Set<String>) {
        val list = read(context)
        val kept = JSONArray()
        for (i in 0 until list.length()) {
            val e = list.optJSONObject(i) ?: continue
            if (e.optString("id") !in ids) kept.put(e)
        }
        // commit (synchrone) : le service de filtrage peut être arrêté dès sa réponse rendue.
        prefs(context).edit().putString(KEY, kept.toString()).commit()
    }

    private fun read(context: Context): JSONArray =
        try { JSONArray(prefs(context).getString(KEY, "[]")) } catch (e: Exception) { JSONArray() }
}
