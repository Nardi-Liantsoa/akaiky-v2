package mg.nosytech.akaiky

/**
 * Règles du verrou de l'app enfant (NAR-167), sans dépendance Android : testées par
 * KioskPolicyTest. Le plugin (KioskPlugin) les applique avec DevicePolicyManager.
 */
object KioskPolicy {
    /** Sortie temporaire bornée : 15 minutes au plus (CdC §5.3). */
    const val MAX_UNLOCK_MINUTES = 15

    fun clampMinutes(minutes: Int): Int = minutes.coerceIn(1, MAX_UNLOCK_MINUTES)

    /**
     * Fenêtre de sortie, mesurée sur l'horloge depuis le démarrage (elapsedRealtime) :
     * changer l'heure du téléphone ne la prolonge pas, et un redémarrage la ferme
     * (numéro de démarrage différent, ou horloge repartie de zéro).
     */
    data class Window(val startElapsed: Long, val untilElapsed: Long, val boot: Int)

    fun open(nowElapsed: Long, boot: Int, minutes: Int): Window =
        Window(nowElapsed, nowElapsed + clampMinutes(minutes) * 60_000L, boot)

    fun isOpen(window: Window?, nowElapsed: Long, boot: Int): Boolean =
        window != null &&
            window.boot == boot &&
            nowElapsed >= window.startElapsed &&
            nowElapsed < window.untilElapsed &&
            // Une fenêtre plus longue que permis (préférences modifiées) ne vaut rien.
            window.untilElapsed - window.startElapsed <= MAX_UNLOCK_MINUTES * 60_000L

    /**
     * Paquets autorisés pendant le verrou : l'app, puis le composeur et Telecom, sans
     * lesquels l'écran d'appel (décrocher, raccrocher) et le composeur d'urgence ne
     * s'affichent pas en lock task. Pas de contrôle « installé » : depuis Android 11, la
     * visibilité des paquets le ferait échouer en silence (vu sur émulateur), et un nom
     * absent ne donne rien (installer une app est interdit par le verrou).
     */
    fun lockTaskPackages(own: String, callPackages: List<String?>): Array<String> =
        (listOf(own) + callPackages.filterNotNull().map { it.trim() }.filter { it.isNotEmpty() && it != own })
            .distinct()
            .toTypedArray()
}
