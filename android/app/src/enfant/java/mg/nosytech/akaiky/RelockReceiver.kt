package mg.nosytech.akaiky

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fin de la sortie temporaire (NAR-167) : l'alarme posée par Kiosk.openWindow ramène
 * l'app au premier plan, où sa reprise remet le verrou. Non exporté : seule l'alarme
 * de l'app (PendingIntent explicite) l'atteint.
 */
class RelockReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!Kiosk.isArmed(context) || Kiosk.isUnlocked(context)) return
        Kiosk.closeWindow(context)
        Kiosk.bringToFront(context)
    }
}
