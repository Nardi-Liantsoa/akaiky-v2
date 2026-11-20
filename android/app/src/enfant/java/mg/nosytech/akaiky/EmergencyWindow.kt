package mg.nosytech.akaiky

/**
 * Fenêtre des secours (NAR-196), règles pures (testées sur la JVM) : après un appel de l'enfant
 * à un numéro d'urgence, tout appel entrant sonne pendant 30 minutes, car le rappel des secours
 * vient souvent d'un numéro inconnu ou masqué. Mesurée sur l'horloge depuis le démarrage
 * (elapsedRealtime) avec le numéro de démarrage, comme la sortie du verrou (KioskPolicy) :
 * changer l'heure du téléphone ne l'ouvre ni ne la prolonge, et un redémarrage la ferme.
 */
object EmergencyWindow {
    const val MINUTES = 30
    const val DURATION_MS = MINUTES * 60_000L

    /** Dernier appel aux secours vu : instant (elapsedRealtime, ms) et numéro de démarrage. */
    data class Mark(val atElapsed: Long, val boot: Int)

    /**
     * Fenêtre ouverte : même démarrage, horloge depuis le démarrage pas revenue en arrière
     * (redémarrage même si le numéro de démarrage est illisible) et moins de 30 min écoulées.
     * Un instant négatif (préférences abîmées) ne vaut rien : jamais de débordement du calcul.
     */
    fun isOpen(mark: Mark?, nowElapsed: Long, boot: Int): Boolean =
        mark != null &&
            mark.boot == boot &&
            mark.atElapsed >= 0 &&
            nowElapsed >= mark.atElapsed &&
            nowElapsed - mark.atElapsed < DURATION_MS
}
