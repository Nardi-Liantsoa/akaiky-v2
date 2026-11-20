package mg.nosytech.akaiky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LegacyIncomingTest {
    private val step = LegacyIncoming.Step.Ignore

    /** Chemin d'Android 8–9 de bout en bout : diffusion PHONE_STATE → numéro → décision → raccrocher ou non. */
    private fun legacyFlow(c: IncomingCases.Case, numberInBroadcast: Boolean): Pair<CallPolicy.Incoming, Boolean>? {
        val ring = LegacyIncoming.Ring()
        var s = ring.onState("RINGING", numberInBroadcast && c.number != null, c.number)
        // Copie sans numéro (Android 9) ou numéro masqué : relecture de l'état courant (vide si masqué).
        if (s == LegacyIncoming.Step.ReadNumber) s = ring.onNumberRead(true, c.number ?: "")
        val number = (s as? LegacyIncoming.Step.Decide ?: return null).number
        val decision = CallPolicy.screenIncoming(number, c.filtering, c.allowed, IncomingCases.e164Mg, c.reachable)
        return decision to LegacyIncoming.blocks(decision)
    }

    @Test fun memeDecisionQueLeServiceDeFiltrage() {
        assertTrue(IncomingCases.all.size >= 10)
        for (c in IncomingCases.all) for (inBroadcast in listOf(true, false)) {
            val (decision, hangup) = legacyFlow(c, inBroadcast) ?: error("${c.name} : jamais décidé")
            assertEquals(c.name, c.expected, decision)
            assertEquals(c.name, c.expected != CallPolicy.Incoming.RING, hangup)
        }
    }

    @Test fun seulementAvantAndroid10() {
        assertTrue(LegacyIncoming.applies(26))
        assertTrue(LegacyIncoming.applies(27))
        assertTrue(LegacyIncoming.applies(28))
        assertFalse(LegacyIncoming.applies(29))
        assertFalse(LegacyIncoming.applies(36))
        assertEquals(LegacyIncoming.Hangup.NONE, LegacyIncoming.hangup(29, answerCalls = true, callPhone = true))
        assertFalse(LegacyIncoming.active(29, true, true, true, true, true))
    }

    @Test fun moyenDeRaccrocherSelonLaVersion() {
        assertEquals(LegacyIncoming.Hangup.TELECOM, LegacyIncoming.hangup(28, answerCalls = true, callPhone = true))
        assertEquals(LegacyIncoming.Hangup.NONE, LegacyIncoming.hangup(28, answerCalls = false, callPhone = true))
        assertEquals(LegacyIncoming.Hangup.ITELEPHONY, LegacyIncoming.hangup(27, answerCalls = false, callPhone = true))
        assertEquals(LegacyIncoming.Hangup.ITELEPHONY, LegacyIncoming.hangup(26, answerCalls = true, callPhone = true))
        assertEquals(LegacyIncoming.Hangup.NONE, LegacyIncoming.hangup(26, answerCalls = true, callPhone = false))
    }

    @Test fun numeroLisibleEtFiltreActif() {
        // Android 9 : READ_CALL_LOG exigée en plus pour EXTRA_INCOMING_NUMBER.
        assertFalse(LegacyIncoming.numberReadable(28, readPhoneState = true, readCallLog = false))
        assertTrue(LegacyIncoming.numberReadable(28, readPhoneState = true, readCallLog = true))
        assertTrue(LegacyIncoming.numberReadable(26, readPhoneState = true, readCallLog = false))
        assertFalse(LegacyIncoming.numberReadable(26, readPhoneState = false, readCallLog = true))
        assertTrue(LegacyIncoming.active(28, true, true, true, true, false))
        assertTrue(LegacyIncoming.active(26, true, true, false, false, true))
        // Sans numéro lisible ou sans moyen de raccrocher : inactif (tout sonne, l'écran le dit).
        assertFalse(LegacyIncoming.active(28, true, true, false, true, true))
        assertFalse(LegacyIncoming.active(27, true, true, true, true, false))
        assertFalse(LegacyIncoming.active(26, false, true, true, true, true))
    }

    @Test fun android9DeuxDiffusionsUneSeuleDecision() {
        // Copie avec le numéro d'abord, puis copie sans : décidé une fois.
        val a = LegacyIncoming.Ring()
        assertEquals(LegacyIncoming.Step.Decide("+261341234567"), a.onState("RINGING", true, "+261341234567"))
        assertEquals(step, a.onState("RINGING", false, null))
        // Copie sans numéro d'abord : relecture en cours, la copie avec le numéro décide, la relecture est ignorée.
        val b = LegacyIncoming.Ring()
        assertEquals(LegacyIncoming.Step.ReadNumber, b.onState("RINGING", false, null))
        assertEquals(LegacyIncoming.Step.Decide("+261329876543"), b.onState("RINGING", true, "+261329876543"))
        assertEquals(step, b.onNumberRead(true, "+261329876543"))
        // IDLE : appel suivant décidé à nouveau.
        assertEquals(LegacyIncoming.Step.Idle, b.onState("IDLE", false, null))
        assertEquals(LegacyIncoming.Step.Decide("+261329876543"), b.onState("RINGING", true, "+261329876543"))
    }

    @Test fun numeroMasqueEtRelectureTardive() {
        val r = LegacyIncoming.Ring()
        assertEquals(LegacyIncoming.Step.ReadNumber, r.onState("RINGING", false, null))
        assertEquals(LegacyIncoming.Step.Decide(null), r.onNumberRead(true, ""))
        // Relecture arrivée quand l'appel ne sonne plus : rien.
        val late = LegacyIncoming.Ring()
        assertEquals(LegacyIncoming.Step.ReadNumber, late.onState("RINGING", false, null))
        assertEquals(step, late.onNumberRead(false, "+261329876543"))
    }

    @Test fun appelEnAttenteJamaisRaccroche() {
        // Un appel en ligne (décroché, ou sortant) : un second appel qui sonne n'est pas décidé,
        // raccrocher couperait l'appel en ligne.
        val r = LegacyIncoming.Ring()
        assertEquals(LegacyIncoming.Step.Decide("+261341234567"), r.onState("RINGING", true, "+261341234567"))
        assertEquals(step, r.onState("OFFHOOK", false, null))
        assertEquals(step, r.onState("RINGING", true, "+261329876543"))
        assertEquals(step, r.onNumberRead(true, "+261329876543"))
        assertEquals(LegacyIncoming.Step.Idle, r.onState("IDLE", false, null))
        val out = LegacyIncoming.Ring()
        assertEquals(step, out.onState("OFFHOOK", false, null))
        assertEquals(step, out.onState("RINGING", true, "+261329876543"))
        assertEquals(step, out.onState(null, false, null))
    }

    @Test fun android9RelectureVideJamaisUnParentRaccroche() {
        // Copie sans numéro d'abord, relecture vide : attente, la copie numérotée décide (parent).
        val r = LegacyIncoming.Ring()
        assertEquals(LegacyIncoming.Step.ReadNumber, r.onState("RINGING", false, null))
        val wait = r.onNumberRead(true, "", twinExpected = true) as LegacyIncoming.Step.AwaitTwin
        assertEquals(LegacyIncoming.Step.Decide("+261341234567"), r.onState("RINGING", true, "+261341234567"))
        assertEquals(step, r.onTwinTimeout(wait.ring, true))
        // Vrai numéro masqué : aucune copie numérotée, conclu à la fin de l'attente.
        val hidden = LegacyIncoming.Ring()
        hidden.onState("RINGING", false, null)
        val w = hidden.onNumberRead(true, null, twinExpected = true) as LegacyIncoming.Step.AwaitTwin
        assertEquals(LegacyIncoming.Step.Decide(null), hidden.onTwinTimeout(w.ring, true))
        // Fin de l'attente : ne sonne plus, décroché, ou autre sonnerie après IDLE → rien.
        val gone = LegacyIncoming.Ring()
        gone.onState("RINGING", false, null)
        val g = gone.onNumberRead(true, "", twinExpected = true) as LegacyIncoming.Step.AwaitTwin
        assertEquals(step, gone.onTwinTimeout(g.ring, false))
        val answered = LegacyIncoming.Ring()
        answered.onState("RINGING", false, null)
        val a = answered.onNumberRead(true, "", twinExpected = true) as LegacyIncoming.Step.AwaitTwin
        answered.onState("OFFHOOK", false, null)
        assertEquals(step, answered.onTwinTimeout(a.ring, true))
        val next = LegacyIncoming.Ring()
        next.onState("RINGING", false, null)
        val n = next.onNumberRead(true, "", twinExpected = true) as LegacyIncoming.Step.AwaitTwin
        next.onState("IDLE", false, null)
        assertEquals(LegacyIncoming.Step.ReadNumber, next.onState("RINGING", false, null))
        assertEquals(step, next.onTwinTimeout(n.ring, true))
        // Android 8 : une seule diffusion, relecture vide = masqué, décidé aussitôt.
        assertTrue(LegacyIncoming.twinExpected(28))
        assertFalse(LegacyIncoming.twinExpected(27))
        assertFalse(LegacyIncoming.twinExpected(26))
    }

    @Test fun appelEnLigneVuParLeModeAudio() {
        // Processus redémarré pendant un appel (OFFHOOK jamais vu) : le mode audio le dit.
        assertEquals(android.media.AudioManager.MODE_IN_CALL, LegacyIncoming.MODE_IN_CALL)
        assertEquals(android.media.AudioManager.MODE_IN_COMMUNICATION, LegacyIncoming.MODE_IN_COMMUNICATION)
        assertTrue(LegacyIncoming.otherCallActive(LegacyIncoming.MODE_IN_CALL))
        assertTrue(LegacyIncoming.otherCallActive(LegacyIncoming.MODE_IN_COMMUNICATION))
        assertFalse(LegacyIncoming.otherCallActive(android.media.AudioManager.MODE_RINGTONE))
        assertFalse(LegacyIncoming.otherCallActive(android.media.AudioManager.MODE_NORMAL))
    }
}
