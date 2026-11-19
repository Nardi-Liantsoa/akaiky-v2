package mg.nosytech.akaiky

import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import org.json.JSONObject

/**
 * Cœur de la surveillance en arrière-plan (NAR-180), sans Android : relevé comparé au dernier
 * état connu, envoi sous verrou, arrêt qui attend l'envoi en cours. BackgroundStatus le
 * branche sur WorkManager, les préférences et le Keystore ; les tests JVM l'exercent tel quel.
 * Garanties :
 *   - `run` relit `isEnabled` sous le verrou avant d'envoyer, et de nouveau avant de noter le
 *     succès : un arrêt survenu pendant l'envoi ne laisse aucune trace d'envoi ;
 *   - `stop` désactive d'abord (hors verrou), puis prend le verrou pour tout effacer : à son
 *     retour, aucun envoi n'est en vol et aucun ne partira.
 */
class StatusRunner(
    private val queue: StatusQueue,
    private val tokens: TokenStore,
    private val isEnabled: () -> Boolean,
    private val read: () -> StatusSnapshot,
    private val send: (token: String, payload: JSONObject) -> SendOutcome,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Jeton absent, illisible ou refusé : l'écran doit en émettre un autre. */
    private val markNeedsToken: () -> Unit = {},
    private val log: (String) -> Unit = {}
) {
    private val lock = ReentrantLock()

    /** Sous le verrou d'envoi : marche, arrêt. */
    fun <T> locked(block: () -> T): T = lock.withLock(block)

    /**
     * Relevé comparé au dernier état connu : événement batterie ou carte SIM (mémoire de la
     * carte tenue à jour). Noté dans la file si événement, ou toujours si `always`.
     */
    fun observe(current: StatusSnapshot, now: Long, always: Boolean): PendingStatus? = synchronized(queue) {
        val memory = queue.simMemory()
        val (sim, next) = BackgroundStatusPolicy.simEvent(memory, current.simState, now)
        if (next != memory) queue.saveSimMemory(next)
        val event = sim || BackgroundStatusPolicy.isBatteryEvent(queue.latestKnown(), current)
        if (event || always) queue.offer(current, event) else null
    }

    /** Envoi du relevé en attente (ou de l'actuel) s'il est dû ; null si rien n'est parti. */
    fun run(onRefused: () -> Unit): SendOutcome? {
        if (!isEnabled()) return null
        return lock.withLock {
            // Relu sous le verrou : un arrêt passé entre-temps n'envoie plus rien.
            if (!isEnabled()) return@withLock null
            val now = clock()
            val pending = observe(read(), now, always = true)!!
            if (!BackgroundStatusPolicy.shouldSend(queue.lastSent(), pending, now)) {
                queue.clearIf(pending.seq)
                return@withLock null
            }
            val token = tokens.read()
            if (token == null) {
                // Jeton absent ou illisible (clé Keystore perdue) : pas d'arrêt, nouvel essai à
                // la période suivante ; l'écran en émet un autre à son prochain démarrage.
                markNeedsToken()
                log("aucun jeton lisible")
                return@withLock SendOutcome.NO_TOKEN
            }
            val outcome = send(token, BackgroundStatusPolicy.payload(pending.status))
            log("signal en arrière-plan : $outcome")
            when (outcome) {
                SendOutcome.SENT -> if (isEnabled()) { queue.markSent(SentStatus(now, pending.status)); queue.clearIf(pending.seq) }
                SendOutcome.DROPPED -> queue.clearIf(pending.seq)
                SendOutcome.NEEDS_TOKEN -> onRefused()
                SendOutcome.RETRY, SendOutcome.NO_TOKEN -> Unit
            }
            outcome
        }
    }

    /** `disable` hors verrou, puis jeton et file effacés sous le verrou (envoi en cours attendu). */
    fun stop(disable: () -> Unit) {
        disable()
        lock.withLock {
            tokens.clear()
            queue.clear()
        }
    }
}
