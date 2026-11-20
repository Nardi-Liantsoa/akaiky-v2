package mg.nosytech.akaiky

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Filtre des appels sortants d'Android 8–9 (NAR-169) : diffusion ordonnée NEW_OUTGOING_CALL
 * (priorité 999, PROCESS_OUTGOING_CALLS accordée d'office en Device Owner). Un numéro hors
 * liste et hors urgence est annulé : `resultData` vidé ET diffusion interrompue, pour
 * qu'aucun récepteur suivant ne remette un numéro. La messagerie vocale (`voicemail:`) ne
 * passe pas par cette diffusion. Android 10+ : récepteur désactivé (`outgoing_receiver_enabled`),
 * le service de redirection décide seul.
 */
class OutgoingCallReceiver : BroadcastReceiver() {
    @Suppress("DEPRECATION")
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_NEW_OUTGOING_CALL) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return
        val raw = resultData ?: intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER)
        // Urgence : composée sans aucune décision ; notée pour la fenêtre des secours (NAR-196).
        if (CallPolicy.isEmergency(raw)) { EmergencyCalls.record(context); return }
        val place = try { OutgoingCalls.allows(OutgoingCalls.decide(context, raw)) } catch (e: Exception) { false }
        if (!place) {
            resultData = null
            abortBroadcast()
        }
    }
}
