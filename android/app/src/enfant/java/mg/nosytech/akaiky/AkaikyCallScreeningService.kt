package mg.nosytech.akaiky

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService

/**
 * Filtre des appels entrants de l'app enfant (NAR-145), Android 10 et plus (rôle
 * ROLE_CALL_SCREENING). Seul un contact autorisé fait sonner le téléphone ; un numéro
 * hors liste ou masqué est rejeté sans sonnerie et noté (`call_blocked`). Un appel
 * accepté est noté aussi (`call_in`), sa durée est lue après l'appel.
 * Décision prise ici, sans réseau, sur la liste reçue du parent (CallPlugin.setAllowed),
 * par IncomingCalls.screen, commune au récepteur d'Android 8–9 (NAR-172).
 */
class AkaikyCallScreeningService : CallScreeningService() {
    override fun onScreenCall(details: Call.Details) {
        // Appels sortants (Android 10+ les présente aussi, appels d'urgence compris : vérifié sur
        // Android 14) : jamais filtrés ici. Un appel aux secours ouvre la fenêtre des secours
        // (NAR-196) : seul endroit d'Android 10+ qui voit un appel d'urgence, quel que soit le
        // composeur (le service de redirection ne les reçoit pas).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && details.callDirection != Call.Details.DIRECTION_INCOMING) {
            // Réponse d'abord : l'appel n'attend jamais l'écriture.
            respondToCall(details, CallResponse.Builder().build())
            try {
                if (details.callDirection == Call.Details.DIRECTION_OUTGOING && details.handle?.scheme == "tel" &&
                    OutgoingCalls.isEmergency(this, details.handle?.schemeSpecificPart)) EmergencyCalls.record(this)
            } catch (e: Exception) { /* jamais d'exception hors du service */ }
            return
        }
        val decision = IncomingCalls.screen(this, details.handle?.schemeSpecificPart)
        val response = CallResponse.Builder()
        if (!CallPolicy.rings(decision)) {
            response.setDisallowCall(true).setRejectCall(true).setSkipNotification(true)
        }
        respondToCall(details, response.build())
    }
}
