package mg.nosytech.akaiky

/** Stockage clé → texte (SharedPreferences sur le téléphone, table en mémoire en test). */
interface KeyValueStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
}

/**
 * File d'envoi du signal en arrière-plan (NAR-180) : une seule place, le relevé le plus
 * récent. Hors ligne, chaque nouveau relevé remplace le précédent ; un événement noté
 * (batterie basse, carte SIM) reste noté jusqu'à l'envoi. Un envoi réussi ne vide la place
 * que si rien de plus récent n'y est arrivé pendant l'envoi (numéro de séquence).
 */
class StatusQueue(private val store: KeyValueStore) {
    @Synchronized
    fun offer(status: StatusSnapshot, event: Boolean): PendingStatus {
        val previous = peek()
        val seq = (store.get(K_SEQ)?.toLongOrNull() ?: 0L) + 1
        val next = PendingStatus(seq, status, event || previous?.event == true)
        store.put(K_PENDING, BackgroundStatusPolicy.encode(status))
        store.put(K_SEQ, next.seq.toString())
        store.put(K_EVENT, next.event.toString())
        return next
    }

    @Synchronized
    fun peek(): PendingStatus? {
        val status = BackgroundStatusPolicy.decode(store.get(K_PENDING)) ?: return null
        return PendingStatus(store.get(K_SEQ)?.toLongOrNull() ?: 0L, status, store.get(K_EVENT) == "true")
    }

    /** Vide la place si elle contient encore ce relevé ; vrai si vidée. */
    @Synchronized
    fun clearIf(seq: Long): Boolean {
        val current = peek() ?: return false
        if (current.seq != seq) return false
        store.remove(K_PENDING)
        store.remove(K_EVENT)
        return true
    }

    @Synchronized
    fun lastSent(): SentStatus? {
        val at = store.get(K_SENT_AT)?.toLongOrNull() ?: return null
        val status = BackgroundStatusPolicy.decode(store.get(K_SENT)) ?: return null
        return SentStatus(at, status)
    }

    @Synchronized
    fun markSent(sent: SentStatus) {
        store.put(K_SENT, BackgroundStatusPolicy.encode(sent.status))
        store.put(K_SENT_AT, sent.at.toString())
    }

    /** Dernier état connu (en attente, sinon envoyé) : base de détection des événements. */
    @Synchronized
    fun latestKnown(): StatusSnapshot? = peek()?.status ?: lastSent()?.status

    /** Mémoire de la carte SIM (BackgroundStatusPolicy.simEvent). */
    @Synchronized
    fun simMemory(): SimMemory {
        val m = BackgroundStatusPolicy.decodeSim(store.get(K_SIM))
        // Première fois : dernier état connu repris des relevés gardés.
        return if (m.known != null) m else m.copy(known = latestKnown()?.simState?.takeIf { it != "unknown" })
    }

    @Synchronized
    fun saveSimMemory(m: SimMemory) {
        store.put(K_SIM, BackgroundStatusPolicy.encodeSim(m))
    }

    /** Tout oublier (arrêt de la surveillance), sauf la séquence : un envoi encore en cours ne videra jamais un relevé arrivé après. */
    @Synchronized
    fun clear() {
        for (k in listOf(K_PENDING, K_EVENT, K_SENT, K_SENT_AT, K_SIM)) store.remove(k)
    }

    private companion object {
        const val K_PENDING = "pending"
        const val K_SEQ = "pending_seq"
        const val K_EVENT = "pending_event"
        const val K_SENT = "sent"
        const val K_SENT_AT = "sent_at"
        const val K_SIM = "sim_memory"
    }
}
