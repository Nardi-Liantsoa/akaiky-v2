package mg.nosytech.akaiky

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SosCascadeTest {
    // Cas partagés avec src/lib/sosCascade.test.ts (écran de l'enfant) : même résultat.
    private val shared = JSONObject(File("../../tests/fixtures/sos-cascade-cases.json").readText())

    private fun label(plan: SosCascade.Plan, a: SosCascade.Action) = when (a) {
        is SosCascade.Action.Call -> "call:" + plan.calls[a.index].name + (if (a.timeout) "" else ":noTimeout")
        SosCascade.Action.EndCall -> "endCall"
        SosCascade.Action.DialEmergency -> "dialEmergency"
        SosCascade.Action.StopSiren -> "stopSiren"
    }

    private fun event(o: JSONObject): SosCascade.Event = when (o.getString("type")) {
        "ended" -> SosCascade.Event.Ended(o.getLong("connectedS"), o.getBoolean("endedByUs"))
        "failed" -> SosCascade.Event.Failed
        "cancel" -> SosCascade.Event.Cancel
        "incoming" -> SosCascade.Event.Incoming
        "ring" -> SosCascade.Event.Ring(o.getBoolean("fromContact"))
        "emergency" -> SosCascade.Event.Emergency
        else -> error("événement inconnu")
    }

    private fun names(a: org.json.JSONArray) = (0 until a.length()).map { a.getString(it) }

    @Test fun casPartagesAvecLEcran() {
        val contacts = shared.getJSONObject("contacts")
        val cases = shared.getJSONArray("cases")
        assertTrue(cases.length() > 10)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val list = names(c.getJSONArray("contacts")).map {
                val o = contacts.getJSONObject(it)
                SosCascade.Contact(o.getString("id"), o.getString("name"), o.getString("phone"), o.getInt("position"), o.optBoolean("parent", false))
            }
            val plan = SosCascade.plan(list, "117", c.getBoolean("inSchool"))
            assertEquals(name, names(c.getJSONArray("sms")), plan.sms.map { it.name })
            assertEquals(name, names(c.getJSONArray("calls")), plan.calls.map { it.name })
            var step = SosCascade.start(plan)
            val trace = step.actions.map { label(plan, it) }.toMutableList()
            val events = c.getJSONArray("events")
            for (k in 0 until events.length()) {
                step = SosCascade.step(plan, step.state, event(events.getJSONObject(k)))
                trace += step.actions.map { label(plan, it) }
            }
            assertEquals(name, names(c.getJSONArray("trace")), trace)
            assertEquals(name, c.getString("status"), step.state.status.name.lowercase())
        }
    }

    // Cas partagés : un SOS en cours refuse un nouveau départ, un SOS fini laisse repartir.
    @Test fun nouveauDepartCommeLEcran() {
        val runs = shared.getJSONArray("runs")
        assertTrue(runs.length() >= 5)
        for (i in 0 until runs.length()) {
            val r = runs.getJSONObject(i)
            val status = r.optString("status", "").takeIf { it.isNotEmpty() && it != "starting" }?.let { SosCascade.Status.valueOf(it.uppercase()) }
            val busy = SosCascade.inProgress(r.getBoolean("active"), r.optBoolean("finished", false), status)
            assertEquals(r.getString("name"), r.getBoolean("inProgress"), busy)
        }
    }

    private val reachable = setOf("+261341111111", "+261343333333")

    @Test fun sonnerieDUnContactConnuParSonNumero() {
        assertTrue(SosCascade.ringFromContact(setOf("+261341111111"), reachable, 0, 1_000_000))
    }

    @Test fun sonnerieDUnInconnuIgnoree() {
        // Numéro lu, hors liste : ignoré, même si le filtre a laissé sonner quelqu'un juste avant.
        assertEquals(false, SosCascade.ringFromContact(setOf("+261349999999"), reachable, 999_000, 1_000_000))
        // Numéro illisible (Android 12+) et rien de laissé sonner par le filtre : ignoré.
        assertEquals(false, SosCascade.ringFromContact(null, reachable, 0, 1_000_000))
        // Laissé sonner il y a trop longtemps : ignoré.
        assertEquals(false, SosCascade.ringFromContact(emptySet(), reachable, 1_000_000 - SosCascade.SCREENED_WINDOW_MS - 1, 1_000_000))
        // Laissé sonner par le filtre (numéro autorisé) à l'instant : un contact.
        assertTrue(SosCascade.ringFromContact(null, reachable, 995_000, 1_000_000))
    }

    @Test fun inconnuQuiSonnePendantLaCascade() {
        val plan = SosCascade.plan(listOf(contact("maman", true), contact("papa", true)), "117", false)
        val calling = SosCascade.start(plan).state
        val ring = SosCascade.step(plan, calling, SosCascade.Event.Ring(SosCascade.ringFromContact(setOf("+261349999999"), reachable, 0, 1)))
        assertEquals(calling, ring.state)
        assertTrue(ring.actions.isEmpty())
    }

    @Test fun sansEtatDesAppelsNiJournal() {
        // Créneau fixe : coupé à 25 s, journal muet, pas de temps « en ligne » mesuré : 0 s, contact suivant.
        val plan = SosCascade.plan(listOf(contact("maman", true), contact("papa", true)), "117", false)
        val calling = SosCascade.start(plan).state
        val next = SosCascade.step(plan, calling, SosCascade.Event.Ended(SosCascade.connected(null, null, true), true))
        assertEquals(1, next.state.index)
        assertEquals(listOf<SosCascade.Action>(SosCascade.Action.Call(1, true)), next.actions)
        // Journal lisible : décroché 30 s puis coupé par le créneau → même contact rappelé.
        val redial = SosCascade.step(plan, calling, SosCascade.Event.Ended(SosCascade.connected(30, null, true), true))
        assertEquals(listOf<SosCascade.Action>(SosCascade.Action.Call(0, false)), redial.actions)
    }

    @Test fun journalIllisibleAppelMinuteNonDecroche() {
        // Appel coupé au créneau de 25 s, journal muet : pas décroché, malgré 25 s « en ligne ».
        assertEquals(0L, SosCascade.connected(null, 25, true))
        val plan = SosCascade.plan(listOf(contact("maman", true), contact("papa", true)), "117", false)
        val first = SosCascade.step(plan, SosCascade.start(plan).state, SosCascade.Event.Ended(SosCascade.connected(null, 25, true), true))
        assertEquals(listOf<SosCascade.Action>(SosCascade.Action.Call(1, true)), first.actions)
        val last = SosCascade.step(plan, first.state, SosCascade.Event.Ended(SosCascade.connected(null, 25, true), true))
        assertEquals(SosCascade.Status.EMERGENCY, last.state.status)
        assertEquals(listOf<SosCascade.Action>(SosCascade.Action.DialEmergency), last.actions)
        // Le journal fait foi quand il est lisible.
        assertEquals(3L, SosCascade.connected(3, 25, true))
        assertEquals(30L, SosCascade.connected(30, null, true))
        // Rappel sans coupure (décroché confirmé par le journal), journal muet : temps en ligne mesuré.
        assertEquals(40L, SosCascade.connected(null, 40, false))
        assertEquals(0L, SosCascade.connected(null, null, false))
    }

    @Test fun repriseApresMortDuProcessus() {
        val plan = SosCascade.plan(listOf(contact("maman", true), contact("papa", true), contact("mamie", false)), "117", false)
        val calling = SosCascade.State(SosCascade.Status.CALLING, 1, false)
        val saved = SosCascade.Progress("run-1", 42L, mapOf("maman" to "sent", "papa" to "pending"), calling, 1234L)
        val back = SosCascade.Progress.fromJson(saved.toJson())
        assertEquals(saved, back)
        // Ni numéro ni position dans ce qui est gardé.
        assertEquals(false, saved.toJson().contains("+261"))
        val r = SosCascade.resume(plan, back!!)
        assertEquals(SosCascade.ResumeKind.CHECK_CALL, r.kind)
        // SMS confirmé jamais renvoyé ; SMS sans résultat connu renvoyé.
        assertEquals(listOf("Papa"), r.smsTo.map { it.name })
        // Avant la cascade : position et SMS refaits pour les seuls non confirmés, puis les appels.
        val starting = SosCascade.resume(plan, saved.copy(state = null))
        assertEquals(SosCascade.ResumeKind.RESTART, starting.kind)
        assertEquals(listOf("Papa"), starting.smsTo.map { it.name })
        // Fini : rien à refaire.
        val done = SosCascade.resume(plan, saved.copy(state = calling.copy(status = SosCascade.Status.ANSWERED)))
        assertEquals(SosCascade.ResumeKind.DONE, done.kind)
        assertTrue(done.smsTo.isEmpty())
        // Secours : sirène reprise, SMS non confirmés renvoyés.
        assertEquals(SosCascade.ResumeKind.EMERGENCY, SosCascade.resume(plan, saved.copy(state = calling.copy(status = SosCascade.Status.EMERGENCY))).kind)
        // Avancement illisible : ignoré (nouveau départ, jamais de plantage).
        assertEquals(null, SosCascade.Progress.fromJson("{"))
        assertEquals(null, SosCascade.Progress.fromJson(null))
    }

    @Test fun ligneLibreJamaisSupposee() {
        // isInCall lisible et vrai : on attend, sans limite de temps.
        assertEquals(false, SosCascade.lineFree(true, false, true, 10 * SosCascade.CALL_LOG_WAIT_MAX_MS))
        assertEquals(false, SosCascade.lineFree(true, true, false, 0))
        assertEquals(true, SosCascade.lineFree(false, false, true, 0))
        // Illisible, appel pas coupé : fini seulement quand son entrée apparaît au journal.
        assertEquals(false, SosCascade.lineFree(null, false, true, 0))
        assertEquals(false, SosCascade.lineFree(null, false, true, 25 * 60_000L))
        assertEquals(true, SosCascade.lineFree(null, true, true, 30_000L))
        // Plafond de 30 min depuis le lancement.
        assertEquals(false, SosCascade.lineFree(null, false, true, SosCascade.CALL_LOG_WAIT_MAX_MS - 1))
        assertEquals(true, SosCascade.lineFree(null, false, true, SosCascade.CALL_LOG_WAIT_MAX_MS))
        // Illisible, appel coupé par nous (endCall a réussi) ou aucun appel précédent : libre.
        assertEquals(true, SosCascade.lineFree(null, false, false, 0))
    }

    @Test fun jamaisDeuxSosALaFois() {
        val now = 1_000_000L
        assertEquals(false, SosCascade.startBlocked(false, false, 0L, false, now))
        assertEquals(true, SosCascade.startBlocked(true, false, 0L, false, now))
        assertEquals(true, SosCascade.startBlocked(false, true, 0L, false, now))
        assertEquals(true, SosCascade.startBlocked(false, false, 0L, true, now))
        // Lancement en attente du service : refusé jusqu'à la fin du délai de confirmation.
        assertEquals(true, SosCascade.startBlocked(false, false, now - 1, false, now))
        assertEquals(true, SosCascade.startBlocked(false, false, now - SosCascade.CONFIRM_MS + 1, false, now))
        assertEquals(false, SosCascade.startBlocked(false, false, now - SosCascade.CONFIRM_MS, false, now))
        // Dernier état publié : en cours seulement s'il vient du service.
        assertEquals(true, SosCascade.snapshotInProgress(true, false, "calling"))
        assertEquals(true, SosCascade.snapshotInProgress(true, false, "starting"))
        assertEquals(true, SosCascade.snapshotInProgress(true, false, "emergency"))
        assertEquals(false, SosCascade.snapshotInProgress(true, true, "starting"))
        assertEquals(false, SosCascade.snapshotInProgress(true, false, "answered"))
        assertEquals(false, SosCascade.snapshotInProgress(false, false, "calling"))
        assertEquals(false, SosCascade.snapshotInProgress(false, false, "interrupted"))
    }

    @Test fun lancementApresLeRepliDeLEcran() {
        val t = 50_000L
        // À l'heure, pas de repli : lancé.
        assertEquals(false, SosCascade.dropStart(t, t + 500, false, false))
        // Repli signalé par l'écran (cancel fallback) : jamais lancé, même redistribué.
        assertEquals(true, SosCascade.dropStart(t, t + 500, true, false))
        assertEquals(true, SosCascade.dropStart(t, t + 500, true, true))
        // Reçu trop tard : l'écran est passé à l'appel direct (avant ses 5 s de confirmation).
        assertTrue(SosCascade.START_LATE_MS < SosCascade.CONFIRM_MS)
        assertEquals(true, SosCascade.dropStart(t, t + SosCascade.START_LATE_MS, false, false))
        // Redistribution d'un SOS en cours : jamais refusée pour son âge.
        assertEquals(false, SosCascade.dropStart(t, t + 3_600_000L, false, true))
        // Ancienne coque (heure absente) : lancé.
        assertEquals(false, SosCascade.dropStart(0L, t, false, false))
    }

    @Test fun sosGardeSansServiceInterrompu() {
        val p = SosCascade.Progress("run-1", 1_000L, emptyMap(), null, 0L, 0L)
        // Service présent : jamais interrompu.
        assertEquals(false, SosCascade.staleRun(p, true, 1_000L + 10 * SosCascade.STALE_RUN_MS))
        // Sans service : attendu 2 min (redistribution possible), puis interrompu.
        assertEquals(false, SosCascade.staleRun(p, false, 1_000L + SosCascade.STALE_RUN_MS))
        assertEquals(true, SosCascade.staleRun(p, false, 1_001L + SosCascade.STALE_RUN_MS))
        // Signe de vie récent (SOS long, processus tué à l'instant) : encore repris.
        val touched = p.copy(touchedAt = 600_000L)
        assertEquals(false, SosCascade.staleRun(touched, false, 650_000L))
        assertEquals(true, SosCascade.staleRun(touched, false, 600_001L + SosCascade.STALE_RUN_MS))
        // Gardé et relu avec son signe de vie.
        assertEquals(touched, SosCascade.Progress.fromJson(touched.toJson()))
    }

    private fun contact(name: String, parent: Boolean): SosCascade.Contact {
        val o = shared.getJSONObject("contacts").getJSONObject(name)
        return SosCascade.Contact(name, o.getString("name"), o.getString("phone"), o.getInt("position"), parent)
    }

    @Test fun smsRempliCommeLEcran() {
        val text = SosCascade.fillSms("geo:{lat},{lon} (~{acc} m, {time})", -18.879191, -147.507903, 1234.4f, "23:59")
        assertEquals("geo:-18.87919,-147.50790 (~1234 m, 23:59)", text)
    }
}
