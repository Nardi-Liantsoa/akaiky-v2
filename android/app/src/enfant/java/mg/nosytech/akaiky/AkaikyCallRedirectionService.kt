package mg.nosytech.akaiky

import android.net.Uri
import android.telecom.CallRedirectionService
import android.telecom.PhoneAccountHandle
import androidx.annotation.RequiresApi

/**
 * Filtre des appels sortants (NAR-169), Android 10+ avec le rôle ROLE_CALL_REDIRECTION :
 * tout appel composé sur le téléphone (composeur, « Ajouter un appel », autre app) passe
 * ici avant d'être lancé. Un appel d'urgence n'est jamais bloqué ni retardé : Telecom ne
 * l'envoie pas ici, et un numéro d'urgence de la liste de l'app est de toute façon composé
 * aussitôt, sans lecture (`CallPolicy.placeImmediately`), comme la messagerie vocale de
 * l'enfant (`voicemail:`). `sip:` et les autres schémas : refusés pendant le filtrage.
 * Sinon la décision est prise sur place, dans `onPlaceCall` : les préférences sont en
 * mémoire après leur premier chargement et les lectures de TelephonyManager ont leurs
 * valeurs de repli. Toute erreur annule l'appel (l'urgence est déjà passée). Une seule
 * réponse, donnée avant de rendre la main : elle vise toujours l'appel en cours.
 */
@RequiresApi(29)
class AkaikyCallRedirectionService : CallRedirectionService() {
    override fun onPlaceCall(handle: Uri, initialPhoneAccount: PhoneAccountHandle, allowInteractiveResponse: Boolean) {
        val scheme = handle.scheme
        val raw = if (scheme == "tel") handle.schemeSpecificPart else null
        val place = CallPolicy.placeOutgoing(scheme, raw) { OutgoingCalls.decide(this, raw, initialPhoneAccount) }
        try { if (place) placeCallUnmodified() else cancelCall() } catch (e: Exception) { /* liaison déjà défaite */ }
    }
}
