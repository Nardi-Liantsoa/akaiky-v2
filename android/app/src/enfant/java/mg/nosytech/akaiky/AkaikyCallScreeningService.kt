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
        // Appels sortants (Android 10+ les présente aussi) : jamais filtrés ici.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && details.callDirection != Call.Details.DIRECTION_INCOMING) {
            respondToCall(details, CallResponse.Builder().build())
            return
        }
        val decision = IncomingCalls.screen(this, details.handle?.schemeSpecificPart)
        val response = CallResponse.Builder()
        if (decision != CallPolicy.Incoming.RING) {
            response.setDisallowCall(true).setRejectCall(true).setSkipNotification(true)
        }
        respondToCall(details, response.build())
    }
}
