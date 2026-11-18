package mg.nosytech.akaiky

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle

/**
 * Receveur Device Admin de l'app enfant, désigné Device Owner par le QR de
 * provisionnement (nom fixé dans server/src/routes/devices.js, DEVICE_ADMIN_COMPONENT).
 * Il retient le jeton d'appairage ; le verrou est posé ensuite par l'app (Kiosk, NAR-167).
 */
class AkaikyDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        @Suppress("DEPRECATION")
        val extras = intent.getParcelableExtra<PersistableBundle>(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
        ProvisioningStore.saveFrom(context, extras)
        // Android 8 et 9 : rien d'autre ne termine le provisionnement, on ouvre l'app.
        // Android 10 et plus : PolicyComplianceActivity clôt le parcours et l'assistant
        // de configuration ouvre l'app ensuite ; l'ouvrir ici la poserait par-dessus.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(it)
            }
        }
    }
}
