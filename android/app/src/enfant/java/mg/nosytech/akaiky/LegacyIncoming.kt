package mg.nosytech.akaiky

/**
 * Filtre des appels entrants d'Android 8–9 (NAR-172), règles pures (testées sur la JVM).
 * CallScreeningService et ROLE_CALL_SCREENING n'existent qu'à partir d'Android 10 : ici, la
 * diffusion PHONE_STATE (RINGING) réveille LegacyIncomingCallReceiver, qui prend la MÊME
 * décision que NAR-145 (CallPolicy.screenIncoming, via IncomingCalls.screen) puis raccroche.
 * Le téléphone a déjà commencé à sonner quand la diffusion arrive : courte sonnerie inévitable
 * (voir LegacyIncomingCallReceiver).
 */
object LegacyIncoming {
    const val Q = 29
    const val P = 28

    /** Actif seulement avant Android 10 : à partir de 10, le service de filtrage décide seul. */
    fun applies(sdk: Int): Boolean = sdk < Q

    /** Moyen de raccrocher un appel qui sonne. */
    enum class Hangup { TELECOM, ITELEPHONY, NONE }

    /**
     * Android 9 : TelecomManager.endCall (ANSWER_PHONE_CALLS). Android 8.0–8.1 : endCall
     * n'existe pas ; ITelephony.endCall par réflexion (interface cachée, sans restriction
     * d'accès avant Android 9 ; exige CALL_PHONE). silenceRinger est réservé au composeur par
     * défaut et au système (MODIFY_PHONE_STATE) avant Android 10 : jamais un moyen ici.
     */
    fun hangup(sdk: Int, answerCalls: Boolean, callPhone: Boolean): Hangup = when {
        !applies(sdk) -> Hangup.NONE
        sdk >= P -> if (answerCalls) Hangup.TELECOM else Hangup.NONE
        else -> if (callPhone) Hangup.ITELEPHONY else Hangup.NONE
    }

    /**
     * Numéro de l'appelant lisible : READ_PHONE_STATE, et READ_CALL_LOG en plus sur Android 9
     * (sans elle, EXTRA_INCOMING_NUMBER n'est jamais fourni : tout appel paraîtrait masqué).
     */
    fun numberReadable(sdk: Int, readPhoneState: Boolean, readCallLog: Boolean): Boolean =
        readPhoneState && (sdk < P || readCallLog)

    /**
     * Filtre réellement actif : récepteur activé, numéro lisible et un moyen de raccrocher.
     * Sinon il ne fait rien (tout sonne, comme Android 10+ sans le rôle) et l'écran de
     * l'enfant l'indique : jamais un parent raccroché faute de pouvoir lire son numéro.
     */
    fun active(sdk: Int, receiverEnabled: Boolean, readPhoneState: Boolean, readCallLog: Boolean, answerCalls: Boolean, callPhone: Boolean): Boolean =
        applies(sdk) && receiverEnabled && numberReadable(sdk, readPhoneState, readCallLog) &&
            hangup(sdk, answerCalls, callPhone) != Hangup.NONE

    /** Appel à raccrocher : hors liste, masqué ou contact hors des parents pendant une plage. */
    fun blocks(decision: CallPolicy.Incoming): Boolean = decision != CallPolicy.Incoming.RING

    /**
     * Appel en ligne d'après le mode audio (MODE_IN_CALL, MODE_IN_COMMUNICATION) : un appel qui
     * sonne alors est un appel en attente. Vérifié au moment de décider, en plus de l'état gardé
     * en mémoire (perdu si le processus a redémarré pendant l'appel) : raccrocher viserait
     * l'appel en ligne, peut-être celui d'un parent.
     */
    fun otherCallActive(audioMode: Int): Boolean = audioMode == MODE_IN_CALL || audioMode == MODE_IN_COMMUNICATION
    const val MODE_IN_CALL = 2
    const val MODE_IN_COMMUNICATION = 3

    /**
     * Android 9 : une diffusion avec le numéro suit (ou précède) celle sans numéro. Une relecture
     * vide n'y prouve pas un numéro masqué : on attend la copie avec le numéro avant de raccrocher.
     */
    fun twinExpected(sdk: Int): Boolean = sdk == P

    /** Attente de la copie avec le numéro (Android 9) avant de conclure à un numéro masqué. */
    const val TWIN_GRACE_MS = 3000L

    /** Étape à suivre pour une diffusion PHONE_STATE. */
    sealed class Step {
        /** Rien à faire (appel déjà décidé, décroché, état inconnu). */
        object Ignore : Step()
        /** Décider sur ce numéro (null : masqué). */
        data class Decide(val number: String?) : Step()
        /** Numéro absent de la diffusion : le relire (état courant du téléphone). */
        object ReadNumber : Step()
        /** Relecture vide sur Android 9 : attendre la copie avec le numéro (sonnerie `ring`). */
        data class AwaitTwin(val ring: Int) : Step()
        /** Fin de l'appel : oublier l'appel. */
        object Idle : Step()
    }

    /**
     * Un appel qui sonne n'est décidé qu'UNE fois. Android 9 envoie RINGING deux fois à une
     * app qui a READ_PHONE_STATE et READ_CALL_LOG : avec le numéro, et sans (absent aussi pour
     * un numéro masqué, d'où la relecture : l'absence d'extra ne prouve pas un numéro masqué).
     * Ordre entre les deux non garanti : la première réponse portant un numéro décide, les
     * suivantes sont ignorées ; « masqué » n'est conclu sur Android 9 qu'après TWIN_GRACE_MS
     * sans copie numérotée (jamais un parent raccroché pour une relecture vide).
     * Appel en attente (RINGING pendant un appel en ligne, OFFHOOK vu depuis IDLE) : jamais
     * décidé, car raccrocher couperait l'appel en ligne (TelecomManager.endCall et ITelephony
     * visent l'appel au premier plan). État réinitialisé par IDLE (fin de tout appel).
     */
    class Ring {
        private var decided = false
        private var inCall = false
        private var ring = 0

        @Synchronized
        fun onState(state: String?, hasNumber: Boolean, number: String?): Step = when (state) {
            "IDLE" -> { decided = false; inCall = false; ring++; Step.Idle }
            "OFFHOOK" -> { inCall = true; Step.Ignore }
            "RINGING" -> when {
                decided || inCall -> Step.Ignore
                hasNumber -> { decided = true; Step.Decide(number) }
                else -> Step.ReadNumber
            }
            else -> Step.Ignore
        }

        /**
         * Numéro relu (vide ou null : masqué), si l'appel sonne encore et n'est pas décidé.
         * `twinExpected` (Android 9) : une relecture vide attend la copie avec le numéro.
         */
        @Synchronized
        fun onNumberRead(stillRinging: Boolean, number: String?, twinExpected: Boolean = false): Step {
            if (decided || inCall || !stillRinging) return Step.Ignore
            val n = number?.takeIf { it.isNotEmpty() }
            if (n == null && twinExpected) return Step.AwaitTwin(ring)
            decided = true
            return Step.Decide(n)
        }

        /** Fin de l'attente : masqué si la même sonnerie dure, sans copie numérotée ni décroché. */
        @Synchronized
        fun onTwinTimeout(ring: Int, stillRinging: Boolean): Step {
            if (ring != this.ring || decided || inCall || !stillRinging) return Step.Ignore
            decided = true
            return Step.Decide(null)
        }
    }
}
