package mg.nosytech.akaiky

import org.json.JSONObject

/** Relevé envoyé au serveur (vocabulaire de server/src/device-status.js). */
data class StatusSnapshot(val batteryPct: Int?, val charging: Boolean?, val network: String, val simState: String)

/** Dernier signal accepté par le serveur. */
data class SentStatus(val at: Long, val status: StatusSnapshot)

/** Relevé en attente d'envoi (un seul : le plus récent) ; `event` force l'envoi. */
data class PendingStatus(val seq: Long, val status: StatusSnapshot, val event: Boolean)

/** Changement d'état de la carte SIM noté comme événement, à l'heure `at`. */
data class SimTransition(val from: String, val to: String, val at: Long)

/**
 * Mémoire de la carte SIM : dernier état connu (jamais « unknown ») et événements récents,
 * pour ne pas répéter un même changement qui se reproduit en rafale (contact de la carte).
 */
data class SimMemory(val known: String?, val recent: List<SimTransition> = emptyList())

/**
 * Règles pures de la surveillance en arrière-plan (NAR-180), proches de l'écran
 * (src/lib/heartbeat.ts, heartbeatDue) : un signal par période de 15 minutes, sauf
 * événement (batterie qui passe sous 15 %, état de la carte SIM qui change), tout de suite.
 * Différences voulues : marge de 2 minutes sur la période (WorkManager avance ou retarde la
 * tâche de quelques minutes : sans marge, une tâche partie à 14 min 50 sauterait son tour et
 * le signal suivant viendrait à 30 min) ; carte SIM « unknown » jamais comparée (état
 * transitoire au démarrage du modem, pas un changement) ; même changement de carte SIM répété
 * en moins de 2 minutes : pas de nouvel envoi immédiat (le relevé part à la période).
 */
object BackgroundStatusPolicy {
    const val EVERY_MS = 15 * 60_000L
    /** Envoi dû à partir de 13 minutes depuis le dernier (marge de 2 minutes sur la période). */
    const val DUE_MS = EVERY_MS - 2 * 60_000L
    const val SIM_DEBOUNCE_MS = 2 * 60_000L
    const val BATTERY_LOW = 15
    private val NETWORKS = setOf("wifi", "mobile", "none", "unknown")
    private val SIM_STATES = setOf("ready", "absent", "locked", "unknown")

    /** Relevé natif → corps du serveur. « other » (Ethernet, VPN) compté avec le Wi-Fi, comme l'écran. */
    fun snapshot(batteryPct: Int?, charging: Boolean?, network: String, simState: String) = StatusSnapshot(
        batteryPct?.takeIf { it in 0..100 },
        charging,
        when (network) { "cellular" -> "mobile"; "none" -> "none"; "wifi", "other" -> "wifi"; else -> "unknown" },
        if (simState in SIM_STATES) simState else "unknown"
    )

    /** Batterie qui passe sous 15 %, par rapport au dernier état connu. */
    fun isBatteryEvent(previous: StatusSnapshot?, next: StatusSnapshot): Boolean {
        if (previous == null) return false
        val wasLow = previous.batteryPct != null && previous.batteryPct < BATTERY_LOW
        val isLow = next.batteryPct != null && next.batteryPct < BATTERY_LOW
        return isLow && !wasLow
    }

    /**
     * Carte SIM : événement si l'état change par rapport au dernier état connu, aucun des deux
     * n'étant « unknown », et si ce même changement n'a pas déjà été noté il y a moins de
     * 2 minutes. Rend aussi la mémoire mise à jour (état connu suivi même sans événement).
     */
    fun simEvent(memory: SimMemory, next: String, now: Long): Pair<Boolean, SimMemory> {
        if (next !in SIM_STATES || next == "unknown") return false to memory
        val known = memory.known ?: return false to memory.copy(known = next)
        if (known == next) return false to memory
        val recent = memory.recent.filter { now >= it.at && now - it.at < SIM_DEBOUNCE_MS }
        if (recent.any { it.from == known && it.to == next }) return false to SimMemory(next, recent)
        return true to SimMemory(next, recent + SimTransition(known, next, now))
    }

    /** Envoi dû : jamais envoyé, 13 minutes écoulées, horloge reculée, ou batterie qui passe sous 15 %. */
    fun due(last: SentStatus?, next: StatusSnapshot, now: Long): Boolean {
        if (last == null) return true
        if (now - last.at >= DUE_MS || now < last.at) return true
        return isBatteryEvent(last.status, next)
    }

    /** Envoi du relevé en attente : événement noté, ou règle des 15 minutes. */
    fun shouldSend(last: SentStatus?, pending: PendingStatus, now: Long): Boolean =
        pending.event || due(last, pending.status, now)

    /** Corps de POST /api/device/heartbeat : les quatre champs, et `background: true`. */
    fun payload(s: StatusSnapshot): JSONObject = JSONObject()
        .put("batteryPct", s.batteryPct ?: JSONObject.NULL)
        .put("charging", s.charging ?: JSONObject.NULL)
        .put("network", if (s.network in NETWORKS) s.network else "unknown")
        .put("simState", if (s.simState in SIM_STATES) s.simState else "unknown")
        .put("background", true)

    fun encode(s: StatusSnapshot): String = JSONObject()
        .put("b", s.batteryPct ?: JSONObject.NULL)
        .put("c", s.charging ?: JSONObject.NULL)
        .put("n", s.network)
        .put("s", s.simState)
        .toString()

    fun encodeSim(m: SimMemory): String = JSONObject()
        .put("k", m.known ?: JSONObject.NULL)
        .put("r", org.json.JSONArray(m.recent.map { JSONObject().put("f", it.from).put("t", it.to).put("a", it.at) }))
        .toString()

    fun decodeSim(raw: String?): SimMemory = try {
        if (raw == null) SimMemory(null) else JSONObject(raw).let { o ->
            val r = o.getJSONArray("r")
            SimMemory(
                if (o.isNull("k")) null else o.getString("k"),
                (0 until r.length()).map { i -> r.getJSONObject(i).let { SimTransition(it.getString("f"), it.getString("t"), it.getLong("a")) } }
            )
        }
    } catch (e: Exception) {
        SimMemory(null)
    }

    fun decode(raw: String?): StatusSnapshot? = try {
        if (raw == null) null else JSONObject(raw).let { o ->
            StatusSnapshot(
                if (o.isNull("b")) null else o.getInt("b"),
                if (o.isNull("c")) null else o.getBoolean("c"),
                o.getString("n"),
                o.getString("s")
            )
        }
    } catch (e: Exception) {
        null
    }
}
