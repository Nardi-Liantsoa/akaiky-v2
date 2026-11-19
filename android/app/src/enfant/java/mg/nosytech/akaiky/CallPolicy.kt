package mg.nosytech.akaiky

/**
 * Règles d'appel de l'app enfant (NAR-142), vérifiées côté natif en plus de l'interface :
 * aucun clavier, et un numéro hors de la liste reçue du parent est refusé ici aussi.
 */
object CallPolicy {
    /** Numéros d'urgence acceptés (112 partout en GSM ; 117 police à Madagascar ; 15/17/18 en France). */
    val EMERGENCY = setOf("112", "117", "118", "119", "15", "17", "18", "114", "911")

    /** Forme comparable : « + » initial et chiffres seulement. */
    fun normalize(number: String?): String? {
        if (number == null) return null
        val trimmed = number.trim()
        val digits = trimmed.filter { it.isDigit() }
        if (digits.isEmpty() || digits.length > 15) return null
        return if (trimmed.startsWith("+")) "+$digits" else digits
    }

    /** Numéro E.164 présent dans la liste des contacts autorisés. */
    fun isAllowed(number: String?, allowed: Set<String>): Boolean {
        val n = normalize(number) ?: return false
        return n.startsWith("+") && allowed.contains(n)
    }

    fun isEmergency(number: String?): Boolean = normalize(number)?.let { it in EMERGENCY } == true

    /**
     * Numéros joignables à cet instant (NAR-176) : pendant une plage « école », les seuls
     * parents (contacts liés à un owner ou manager), toujours pris dans la liste autorisée ;
     * sinon toute la liste.
     */
    fun reachable(allowed: Set<String>, parents: Set<String>, inSchool: Boolean): Set<String> =
        if (inSchool) allowed.intersect(parents) else allowed

    /** Décision sur un appel entrant (NAR-145). */
    /** BLOCK_SCHEDULE : contact de la liste refusé parce qu'une plage « école » est en cours (NAR-176). */
    enum class Incoming { RING, BLOCK_UNKNOWN, BLOCK_HIDDEN, BLOCK_SCHEDULE }

    /**
     * Seul un contact autorisé fait sonner le téléphone ; un numéro masqué ou hors liste
     * est rejeté. `matches` compare deux numéros (PhoneNumberUtils sur le téléphone :
     * format national ou international). Liste vide : rien ne sonne, sauf si le filtrage
     * est inactif (`filtering` faux : téléphone pas encore appairé ou libéré).
     * `reachable` : numéros joignables maintenant (les parents pendant une plage, voir
     * `reachable()`) ; un contact de la liste qui n'y est pas donne BLOCK_SCHEDULE.
     * Pas d'exception pour les numéros d'urgence : un numéro présenté se falsifie facilement.
     */
    fun screenIncoming(number: String?, filtering: Boolean, allowed: Set<String>, matches: (String, String) -> Boolean, reachable: Set<String> = allowed): Incoming {
        if (!filtering) return Incoming.RING
        val n = normalize(number) ?: return Incoming.BLOCK_HIDDEN
        if (reachable.any { matches(n, it) }) return Incoming.RING
        return if (allowed.any { matches(n, it) }) Incoming.BLOCK_SCHEDULE else Incoming.BLOCK_UNKNOWN
    }
}
