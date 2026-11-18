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

    /** Décision sur un appel entrant (NAR-145). */
    enum class Incoming { RING, BLOCK_UNKNOWN, BLOCK_HIDDEN }

    /**
     * Seul un contact autorisé fait sonner le téléphone ; un numéro masqué ou hors liste
     * est rejeté. `matches` compare deux numéros (PhoneNumberUtils sur le téléphone :
     * format national ou international). Liste vide : rien ne sonne, sauf si le filtrage
     * est inactif (`filtering` faux : téléphone pas encore appairé ou libéré).
     */
    fun screenIncoming(number: String?, filtering: Boolean, allowed: Set<String>, matches: (String, String) -> Boolean): Incoming {
        if (!filtering) return Incoming.RING
        val n = normalize(number) ?: return Incoming.BLOCK_HIDDEN
        return if (allowed.any { matches(n, it) }) Incoming.RING else Incoming.BLOCK_UNKNOWN
    }
}
