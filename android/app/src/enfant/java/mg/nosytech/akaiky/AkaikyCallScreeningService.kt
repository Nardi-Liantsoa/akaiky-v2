package mg.nosytech.akaiky

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService

/**
 * Filtre des appels entrants de l'app enfant (NAR-145), Android 10 et plus (rôle
 * ROLE_CALL_SCREENING). Seul un contact autorisé fait sonner le téléphone ; un numéro
 * hors liste ou masqué est rejeté sans sonnerie et noté (`call_blocked`). Un appel
 * accepté est noté aussi (`call_in`), sa durée est lue après l'appel.
 * Décision prise ici, sans réseau, sur la liste reçue du parent (CallPlugin.setAllowed).
 */
class AkaikyCallScreeningService : CallScreeningService() {
    override fun onScreenCall(details: Call.Details) {
        // Appels sortants (Android 10+ les présente aussi) : jamais filtrés ici.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && details.callDirection != Call.Details.DIRECTION_INCOMING) {
            respondToCall(details, CallResponse.Builder().build())
            return
        }
        val raw = details.handle?.schemeSpecificPart
        val countries = IncomingCalls.countries(this)
        val filtering = IncomingCalls.isFiltering(this)
        val allowedSet = IncomingCalls.allowed(this)
        // Numéro noté : le contact reconnu s'il y en a un ; null si masqué (moins de 2 chiffres).
        val shown = IncomingCalls.displayNumber(raw, countries, allowedSet)
        // Décision sur TOUTES les lectures du numéro reçu (pas seulement celle notée).
        val decision = CallPolicy.screenIncoming(if (shown == null) null else raw, filtering, allowedSet) { number, allowed ->
            allowed in IncomingCalls.candidates(number, countries)
        }
        val now = System.currentTimeMillis()
        val response = CallResponse.Builder()
        when (decision) {
            CallPolicy.Incoming.RING -> if (filtering && shown != null) IncomingCalls.record(this, "call_in", shown, now)
            CallPolicy.Incoming.BLOCK_UNKNOWN, CallPolicy.Incoming.BLOCK_HIDDEN -> {
                response.setDisallowCall(true).setRejectCall(true).setSkipNotification(true)
                IncomingCalls.record(this, "call_blocked", if (decision == CallPolicy.Incoming.BLOCK_HIDDEN) null else shown, now)
            }
        }
        respondToCall(details, response.build())
    }
}
