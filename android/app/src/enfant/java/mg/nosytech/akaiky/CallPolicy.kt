package mg.nosytech.akaiky

/**
 * Règles d'appel de l'app enfant (NAR-142), vérifiées côté natif en plus de l'interface :
 * aucun clavier, et un numéro hors de la liste reçue du parent est refusé ici aussi.
 */
object CallPolicy {
    /**
     * Numéros d'urgence de l'app (NAR-197) : toujours composables, et leur appel ouvre la
     * fenêtre des secours (NAR-196). Madagascar seulement, plus les numéros que tout
     * téléphone GSM achemine vers les secours. Sources (vérifiées le 20/11/2026) :
     * - 117 police (numéro général des secours depuis un mobile) :
     *   https://travel.gc.ca/destinations/madagascar ,
     *   https://www.gov.uk/foreign-travel-advice/madagascar/health
     * - 118 pompiers : https://www.anwb.nl/vakantie/madagaskar/reisvoorbereiding/voor-vertrek
     * - 147 Ligne Verte, signalement des violences faites aux enfants, gratuite chez les trois
     *   opérateurs, 24 h/24 : https://www.unicef.org/madagascar/communiqu%C3%A9s-de-presse/lunicef-et-la-commune-urbaine-dantananarivo-signent-un-plan-daction
     * - 112 et 911 : reconnus comme urgences par tout téléphone, carte SIM ou non
     *   (3GPP TS 22.101) : https://eena.org/blog/is-112-a-valid-emergency-number-in-america/
     * Retirés : 15, 17, 18 (France ; le 17 malgache n'existe que depuis un fixe), 114 (France),
     * 119 (aucune source pour Madagascar). Le SAMU (124 selon des sites secondaires, démenti
     * par gov.uk) n'est pas ajouté tant qu'une source officielle ne le confirme pas.
     * À revoir avant toute sortie dans un autre pays (docs/MOBILE.md, « Numéros d'urgence »).
     * Cas partagés : tests/fixtures/emergency-numbers.json.
     */
    val EMERGENCY = setOf("117", "118", "147", "112", "911")

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

    /**
     * Numéro d'urgence : la saisie, privée de ses espaces, tirets et parenthèses, n'est faite
     * que de chiffres et figure dans la liste. Un « + » initial (« +112 », « +117 » : lus
     * comme un indicatif international) n'en fait pas une urgence de l'app : la décision
     * normale s'applique. Un « * » ou un « # » (code de service, USSD comme « *117# »)
     * n'est jamais une urgence.
     */
    fun isEmergency(number: String?): Boolean {
        val compact = number?.trim()?.filterNot { it == ' ' || it == '-' || it == '(' || it == ')' } ?: return false
        if (!compact.matches(DIGITS)) return false
        return compact in EMERGENCY
    }

    private val DIGITS = Regex("^[0-9]+$")

    /**
     * Numéros joignables à cet instant (NAR-176) : pendant une plage « école », les seuls
     * parents (contacts liés à un owner ou manager), toujours pris dans la liste autorisée ;
     * sinon toute la liste.
     */
    fun reachable(allowed: Set<String>, parents: Set<String>, inSchool: Boolean): Set<String> =
        if (inSchool) allowed.intersect(parents) else allowed

    /** Décision sur un appel entrant (NAR-145). */
    /** BLOCK_SCHEDULE : contact de la liste refusé parce qu'une plage « école » est en cours (NAR-176). */
    /**
     * RING_EMERGENCY_WINDOW (NAR-196) : appel qui aurait été refusé, laissé sonner parce que
     * l'enfant a appelé les secours il y a moins de 30 min (leur rappel vient souvent d'un
     * numéro inconnu ou masqué). Noté `call_in` avec la marque `emergencyWindow`.
     */
    enum class Incoming { RING, RING_EMERGENCY_WINDOW, BLOCK_UNKNOWN, BLOCK_HIDDEN, BLOCK_SCHEDULE }

    /** L'appel sonne (contact joignable, filtrage inactif, ou fenêtre des secours). */
    fun rings(decision: Incoming): Boolean = decision == Incoming.RING || decision == Incoming.RING_EMERGENCY_WINDOW

    /**
     * Seul un contact autorisé fait sonner le téléphone ; un numéro masqué ou hors liste
     * est rejeté. `matches` compare deux numéros (PhoneNumberUtils sur le téléphone :
     * format national ou international). Liste vide : rien ne sonne, sauf si le filtrage
     * est inactif (`filtering` faux : téléphone pas encore appairé ou libéré).
     * `reachable` : numéros joignables maintenant (les parents pendant une plage, voir
     * `reachable()`) ; un contact de la liste qui n'y est pas donne BLOCK_SCHEDULE.
     * Pas d'exception pour les numéros d'urgence : un numéro présenté se falsifie facilement.
     * `emergencyWindow` (NAR-196, voir EmergencyWindow.isOpen) : l'enfant a appelé les secours
     * il y a moins de 30 min ; tout appel qui aurait été refusé (inconnu, masqué, contact hors
     * plage) sonne alors, sous RING_EMERGENCY_WINDOW. Un contact joignable reste RING.
     */
    fun screenIncoming(number: String?, filtering: Boolean, allowed: Set<String>, matches: (String, String) -> Boolean, reachable: Set<String> = allowed, emergencyWindow: Boolean = false): Incoming {
        if (!filtering) return Incoming.RING
        val n = normalize(number)
        val decision = when {
            n == null -> Incoming.BLOCK_HIDDEN
            reachable.any { matches(n, it) } -> Incoming.RING
            allowed.any { matches(n, it) } -> Incoming.BLOCK_SCHEDULE
            else -> Incoming.BLOCK_UNKNOWN
        }
        return if (decision != Incoming.RING && emergencyWindow) Incoming.RING_EMERGENCY_WINDOW else decision
    }

    /** Décision sur un appel sortant (NAR-169). */
    enum class Outgoing { PLACE, EMERGENCY, BLOCK_UNKNOWN, BLOCK_SCHEDULE, BLOCK_INVALID }

    /**
     * Tout appel sortant du téléphone (composeur, « Ajouter un appel », autre app) : un numéro
     * d'urgence passe TOUJOURS, même liste vide ou pendant une plage ; sinon seul un numéro
     * joignable maintenant (`reachable` : la liste, ou ses seuls parents pendant une plage)
     * est composé. Filtrage inactif (pas encore appairé, ou libéré) : tout passe.
     * `isEmergency` : liste de l'app et numéros d'urgence connus du téléphone ; `matches` :
     * lectures E.164 du numéro composé comparées EXACTEMENT, comme pour les appels entrants.
     */
    fun screenOutgoing(number: String?, filtering: Boolean, allowed: Set<String>, reachable: Set<String>, matches: (String, String) -> Boolean, isEmergency: (String) -> Boolean): Outgoing {
        if (!filtering) return Outgoing.PLACE
        val raw = number?.trim().orEmpty()
        // Code de service (« * », « # ») : jamais une urgence, même si ses chiffres en forment une.
        val dialable = raw.none { it == '*' || it == '#' }
        if (dialable && raw.isNotEmpty() && isEmergency(raw)) return Outgoing.EMERGENCY
        val n = normalize(raw) ?: return Outgoing.BLOCK_INVALID
        if (dialable && isEmergency(n)) return Outgoing.EMERGENCY
        if (reachable.any { matches(n, it) }) return Outgoing.PLACE
        return if (allowed.any { matches(n, it) }) Outgoing.BLOCK_SCHEDULE else Outgoing.BLOCK_UNKNOWN
    }

    /** Appel composé : contact joignable ou urgence. */
    fun allows(decision: Outgoing) = decision == Outgoing.PLACE || decision == Outgoing.EMERGENCY

    /**
     * Réponse immédiate du service de redirection (Android 10+), sans aucune lecture :
     * messagerie vocale (`voicemail:`, la boîte de l'enfant lui-même) ou numéro d'urgence
     * (`tel:`) composés aussitôt. `sip:` et tout autre schéma passent par la décision
     * complète (refusés pendant le filtrage : numéro illisible).
     */
    fun placeImmediately(scheme: String?, raw: String?): Boolean =
        scheme == "voicemail" || (scheme == "tel" && isEmergency(raw))

    /**
     * Décision synchrone d'un appel sortant (Android 10+) : réponse immédiate d'abord
     * (`decide`, qui lit les préférences, n'est alors jamais appelé), puis la décision
     * complète ; toute erreur annule l'appel (une urgence est déjà passée à l'étape 1).
     */
    fun placeOutgoing(scheme: String?, raw: String?, decide: () -> Outgoing): Boolean {
        if (placeImmediately(scheme, raw)) return true
        return try { allows(decide()) } catch (e: Exception) { false }
    }
}
