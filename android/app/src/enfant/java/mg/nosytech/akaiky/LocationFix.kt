package mg.nosytech.akaiky

/**
 * Relevé unique de position à la demande d'un parent (NAR-204) : règles pures, testées sur la
 * JVM (LocationFixTest). Jamais de suivi : un relevé par demande, au plus TIMEOUT_MS d'attente.
 *
 * Seuls comptent les relevés pris après le début de la demande (horloge monotone
 * `elapsedRealtimeNanos`, jamais l'heure du téléphone) : une « dernière position connue »
 * plus ancienne ne répond pas à la demande (le serveur la refuserait, `stale_position`).
 * Le premier relevé assez précis (GOOD_M) arrête l'attente ; sinon, au délai, le plus précis.
 */
object LocationFix {
    const val TIMEOUT_MS = 20_000L
    const val GOOD_M = 25f
    /** Précision inconnue : comptée comme mauvaise, gardée faute de mieux. */
    private const val UNKNOWN_M = 100_000f
    /** Âge envoyé au serveur (POST /api/device/positions, `ageS` ≤ 120). */
    const val MAX_AGE_S = 120L

    data class Sample(val elapsedNs: Long, val lat: Double, val lng: Double, val accuracyM: Float?)
    data class Result(val lat: Double, val lng: Double, val accuracyM: Int, val ageS: Long)

    fun fresh(s: Sample, startedNs: Long): Boolean = s.elapsedNs >= startedNs
    fun accuracy(s: Sample): Float = s.accuracyM?.takeIf { it >= 0f && !it.isNaN() } ?: UNKNOWN_M
    fun good(s: Sample): Boolean = accuracy(s) <= GOOD_M
    fun valid(s: Sample): Boolean = !s.lat.isNaN() && !s.lng.isNaN() && s.lat in -90.0..90.0 && s.lng in -180.0..180.0

    /** Le meilleur entre deux relevés acceptés : le plus précis, à précision égale le plus récent. */
    fun better(a: Sample?, b: Sample): Sample =
        if (a == null || accuracy(b) < accuracy(a) || (accuracy(b) == accuracy(a) && b.elapsedNs > a.elapsedNs)) b else a

    /** Résultat envoyé au serveur ; null si le relevé est trop vieux (il ne l'est pas, sauf horloge folle). */
    fun result(s: Sample, nowNs: Long): Result? {
        val age = Math.max(0L, (nowNs - s.elapsedNs) / 1_000_000_000L)
        if (age > MAX_AGE_S) return null
        return Result(s.lat, s.lng, Math.min(100_000f, accuracy(s)).toInt(), age)
    }
}
