package mg.nosytech.akaiky

/**
 * SOS hors ligne (NAR-151) : plan et cascade d'appels, même règle que src/lib/sosCascade.ts
 * (cas partagés tests/fixtures/sos-cascade-cases.json). Pur : le service (SosService.kt) applique
 * les actions rendues et lui passe les événements du téléphone.
 *
 * Android ne dit pas quand un appel SORTANT est décroché (il faudrait être l'app téléphone
 * par défaut, ou READ_PRECISE_PHONE_STATE, réservée au système) : on ne voit que « en
 * ligne » dès la composition, puis « raccroché ». La durée connectée vient du journal
 * d'appels, après la fin. D'où : coupure après NO_ANSWER_S en ligne ; décroché = au moins
 * ANSWERED_MIN_S connectées ; décroché puis coupé par nous = le même contact rappelé une
 * fois, sans coupure.
 */
object SosCascade {
    const val ANSWERED_MIN_S = 8
    const val NO_ANSWER_S = 25
    const val DIAL_TIMEOUT_S = 10
    const val LOCATION_TIMEOUT_S = 10
    const val SIREN_MAX_S = 120
    /** État des appels illisible : fin d'un appel attendue dans le journal d'appels, 30 min au plus. */
    const val CALL_LOG_WAIT_MAX_MS = 30 * 60_000L
    /** SOS gardé sans service ni signe de vie depuis 2 min (jamais redistribué) : interrompu. */
    const val STALE_RUN_MS = 120_000L
    /** Délai de confirmation de l'écran (SOS_CONFIRM_MS de src/lib/sosCascade.ts). */
    const val CONFIRM_MS = 5_000L
    /** Lancement reçu par le service plus tard que ceci : l'écran est déjà passé à l'appel direct. */
    const val START_LATE_MS = 4_000L

    data class Contact(val id: String, val name: String, val phone: String, val position: Int, val parent: Boolean)
    data class Target(val id: String, val name: String, val number: String)
    data class Plan(val sms: List<Target>, val calls: List<Target>, val emergency: String)

    enum class Status { CALLING, ANSWERED, CANCELLED, EMERGENCY }
    data class State(val status: Status, val index: Int, val redial: Boolean)

    sealed class Event {
        data class Ended(val connectedS: Long, val endedByUs: Boolean) : Event()
        object Failed : Event()
        object Cancel : Event()
        object Incoming : Event()
        /** Le téléphone sonne pendant le SOS : seul un contact joignable prend le relais. */
        data class Ring(val fromContact: Boolean) : Event()
        object Emergency : Event()
    }

    sealed class Action {
        data class Call(val index: Int, val timeout: Boolean) : Action()
        object EndCall : Action()
        object DialEmergency : Action()
        object StopSiren : Action()
    }

    data class Step(val state: State, val actions: List<Action>)

    private fun target(c: Contact) = Target(c.id, c.name, c.phone)

    /** SMS : les parents, sinon tous ; appels : parents puis autres ; plage « école » : parents seuls appelés. */
    fun plan(contacts: List<Contact>, emergency: String, inSchool: Boolean): Plan {
        val sorted = contacts.sortedBy { it.position }
        val parents = sorted.filter { it.parent }
        val others = sorted.filter { !it.parent }
        val sms = if (parents.isNotEmpty()) parents else sorted
        val calls = if (inSchool) parents else parents + others
        return Plan(sms.map(::target), calls.map(::target), emergency)
    }

    private fun callAt(plan: Plan, index: Int): Step =
        if (index < plan.calls.size) Step(State(Status.CALLING, index, false), listOf(Action.Call(index, true)))
        else Step(State(Status.EMERGENCY, plan.calls.size, false), listOf(Action.DialEmergency))

    fun start(plan: Plan): Step = callAt(plan, 0)

    fun step(plan: Plan, state: State, event: Event): Step {
        val done = Step(state, emptyList())
        if (state.status == Status.ANSWERED || state.status == Status.CANCELLED) return done
        return when (event) {
            Event.Cancel -> Step(
                state.copy(status = Status.CANCELLED),
                if (state.status == Status.CALLING) listOf(Action.EndCall, Action.StopSiren) else listOf(Action.StopSiren)
            )
            // Un contact appelle (le filtre ne laisse sonner que lui) : il prend le relais.
            Event.Incoming -> Step(state.copy(status = Status.ANSWERED, index = -1), listOf(Action.StopSiren))
            // Appelant inconnu (ou numéro illisible) : ignoré, la cascade continue ; le filtre le rejette.
            is Event.Ring -> if (event.fromContact) Step(state.copy(status = Status.ANSWERED, index = -1), listOf(Action.StopSiren)) else done
            // L'enfant touche « Appeler les secours » : cascade arrêtée, sirène maintenue.
            Event.Emergency -> Step(
                state.copy(status = Status.EMERGENCY),
                if (state.status == Status.CALLING) listOf(Action.EndCall, Action.DialEmergency) else listOf(Action.DialEmergency)
            )
            Event.Failed -> if (state.status == Status.CALLING) callAt(plan, state.index + 1) else done
            is Event.Ended -> when {
                state.status != Status.CALLING -> done
                event.connectedS >= ANSWERED_MIN_S && event.endedByUs && !state.redial ->
                    Step(state.copy(redial = true), listOf(Action.Call(state.index, false)))
                event.connectedS >= ANSWERED_MIN_S -> Step(state.copy(status = Status.ANSWERED), listOf(Action.StopSiren))
                else -> callAt(plan, state.index + 1)
            }
        }
    }

    /**
     * Un SOS en cours refuse un nouveau départ ; fini (répondu, annulé, terminé) ou pas de
     * service : un nouveau SOS repart de zéro. null = position et SMS en cours (pas encore d'état).
     */
    fun inProgress(running: Boolean, finished: Boolean, status: Status?): Boolean =
        running && !finished && (status == null || status == Status.CALLING || status == Status.EMERGENCY)

    /**
     * Ligne libre (plus aucun appel qui puisse être en cours) ? Jamais d'appel lancé, ni de
     * cascade avancée, tant qu'un appel peut encore être en ligne. inCall : TelecomManager.isInCall,
     * null si illisible (jamais pris pour « libre »). Illisible : un appel qu'on n'a pas pu couper
     * (logRequired) n'est fini que quand son entrée apparaît au journal d'appels (écrite après le
     * raccroché), CALL_LOG_WAIT_MAX_MS au plus depuis son lancement.
     */
    fun lineFree(inCall: Boolean?, logSeen: Boolean, logRequired: Boolean, waitedMs: Long): Boolean = when (inCall) {
        true -> false
        false -> true
        null -> logSeen || !logRequired || waitedMs >= CALL_LOG_WAIT_MAX_MS
    }

    /** Dernier état publié par le service : SOS en cours (jamais l'état provisoire du plugin). */
    fun snapshotInProgress(active: Boolean, pending: Boolean, status: String?): Boolean =
        active && !pending && (status == null || status == "starting" || status == "calling" || status == "emergency")

    /** Lancement demandé, service pas encore là : CONFIRM_MS au plus (ensuite, il le refusera). */
    fun pendingLive(pendingSince: Long, now: Long): Boolean = pendingSince > 0 && now - pendingSince in 0 until CONFIRM_MS

    /**
     * Nouveau départ refusé (« already ») : service en cours, dernier état publié en cours,
     * lancement en attente du service, ou SOS gardé sur le téléphone qui va être repris.
     * Jamais deux SOS à la fois.
     */
    fun startBlocked(serviceInProgress: Boolean, snapshotInProgress: Boolean, pendingSince: Long, persistedLive: Boolean, now: Long): Boolean =
        serviceInProgress || snapshotInProgress || pendingLive(pendingSince, now) || persistedLive

    /**
     * Lancement reçu par le service : refusé si l'écran est déjà passé à l'appel direct
     * (fellBack, posé par cancel) ou, premier envoi, s'il arrive après START_LATE_MS (l'écran,
     * sans état confirmé à CONFIRM_MS, y passe de lui-même). Une redistribution n'est pas un départ.
     */
    fun dropStart(requestedAt: Long, now: Long, fellBack: Boolean, redelivered: Boolean): Boolean =
        fellBack || (!redelivered && requestedAt > 0 && now - requestedAt >= START_LATE_MS)

    /**
     * SOS gardé (préférences) sans service : interrompu si ni lancement ni signe de vie depuis
     * STALE_RUN_MS (le système ne l'a pas redistribué). Jamais montré « en cours ».
     */
    fun staleRun(p: Progress, serviceRunning: Boolean, now: Long): Boolean =
        !serviceRunning && now - maxOf(p.startedAt, p.touchedAt) > STALE_RUN_MS

    /**
     * Sonnerie pendant le SOS : vient-elle d'un contact joignable ? Numéro connu (Android 8 à 11,
     * READ_CALL_LOG) : une de ses lectures E.164 doit être dans la liste. Numéro inconnu (Android 12+,
     * TelephonyCallback ne le donne pas) : le filtre (rôle de filtrage tenu) doit avoir laissé sonner
     * un numéro autorisé dans les SCREENED_WINDOW_MS précédentes. Sinon : ignoré.
     */
    const val SCREENED_WINDOW_MS = 15_000L
    fun ringFromContact(callerReadings: Set<String>?, reachable: Set<String>, screenedAllowedAt: Long, now: Long): Boolean =
        if (!callerReadings.isNullOrEmpty()) callerReadings.any { it in reachable }
        else screenedAllowedAt in 1..now && now - screenedAllowedAt <= SCREENED_WINDOW_MS

    /**
     * Durée connectée d'un appel fini : celle du journal d'appels s'il l'a. Journal illisible :
     * un appel minuté (coupé au créneau de NO_ANSWER_S) compte 0, donc pas décroché, la cascade
     * continue (le temps « en ligne » court dès la composition : il ne prouve rien) ; un rappel
     * sans coupure (décroché déjà confirmé par le journal) garde le temps « en ligne » mesuré,
     * sinon 0.
     */
    fun connected(logS: Long?, offhookS: Long?, timed: Boolean): Long =
        logS ?: if (timed) 0 else offhookS ?: 0

    /** Avancement d'un SOS gardé sur le téléphone : reprise après la mort du processus. */
    data class Progress(
        val runId: String, val startedAt: Long, val sms: Map<String, String>,
        val state: State?, val callPlacedAt: Long,
        /** Dernier signe de vie du service (écrit toutes les 30 s) : SOS interrompu sinon. */
        val touchedAt: Long = 0L
    ) {
        /** Gardé dans les préférences privées : jamais de numéro ni de position, seulement des étapes. */
        fun toJson(): String = org.json.JSONObject()
            .put("runId", runId).put("startedAt", startedAt).put("callPlacedAt", callPlacedAt).put("touchedAt", touchedAt)
            .put("sms", org.json.JSONObject(sms as Map<*, *>))
            .apply { state?.let { put("status", it.status.name).put("index", it.index).put("redial", it.redial) } }
            .toString()

        companion object {
            fun fromJson(raw: String?): Progress? = try {
                val o = org.json.JSONObject(raw ?: return null)
                val sms = o.optJSONObject("sms")
                val status = o.optString("status", "")
                Progress(
                    o.getString("runId"), o.optLong("startedAt"),
                    sms?.keys()?.asSequence()?.associateWith { sms.getString(it) } ?: emptyMap(),
                    if (status.isEmpty()) null else State(Status.valueOf(status), o.optInt("index"), o.optBoolean("redial")),
                    o.optLong("callPlacedAt"), o.optLong("touchedAt")
                )
            } catch (e: Exception) { null }
        }
    }

    /**
     * Reprise d'un SOS (START_REDELIVER_INTENT) : RESTART = position, SMS puis cascade ;
     * CHECK_CALL = appel en cours à la mort du processus (attendre sa fin, lire le journal,
     * puis la suite) ; EMERGENCY = secours, sirène reprise jusqu'à ses 2 min ; DONE = rien.
     * smsTo : destinataires à (re)servir, jamais ceux dont l'envoi est confirmé (« sent ») ;
     * un SMS confié sans résultat connu repart (un doublon vaut mieux qu'un SMS perdu).
     */
    enum class ResumeKind { RESTART, CHECK_CALL, EMERGENCY, DONE }
    data class Resume(val kind: ResumeKind, val smsTo: List<Target>)

    fun resume(plan: Plan, p: Progress): Resume {
        val s = p.state
        val unsent = plan.sms.filter { p.sms[it.id] != "sent" }
        return when (s?.status) {
            null -> Resume(ResumeKind.RESTART, unsent)
            Status.CALLING -> Resume(ResumeKind.CHECK_CALL, unsent)
            Status.EMERGENCY -> Resume(ResumeKind.EMERGENCY, unsent)
            Status.ANSWERED, Status.CANCELLED -> Resume(ResumeKind.DONE, emptyList())
        }
    }

    /** Texte du SMS : modèle traduit par l'écran (prénom posé), position remplie ici. */
    fun fillSms(template: String, lat: Double, lon: Double, acc: Float, time: String): String =
        template.replace("{lat}", String.format(java.util.Locale.ROOT, "%.5f", lat))
            .replace("{lon}", String.format(java.util.Locale.ROOT, "%.5f", lon))
            .replace("{acc}", Math.round(acc).toString())
            .replace("{time}", time)
}
