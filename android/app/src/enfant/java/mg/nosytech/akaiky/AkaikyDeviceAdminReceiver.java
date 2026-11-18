package mg.nosytech.akaiky;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.os.PersistableBundle;

/**
 * Receveur Device Admin de l'app enfant, désigné Device Owner par le QR de
 * provisionnement (nom fixé dans server/src/routes/devices.js, DEVICE_ADMIN_COMPONENT).
 * Ici, il ne fait que retenir le jeton d'appairage ; le verrouillage viendra avec NAR-139.
 */
public class AkaikyDeviceAdminReceiver extends DeviceAdminReceiver {

    // Android 8 à 11 : fin du provisionnement, extras du QR dans l'intention.
    @Override
    public void onProfileProvisioningComplete(Context context, Intent intent) {
        PersistableBundle extras = intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE);
        ProvisioningStore.saveFrom(context, extras);
        // Ouvre l'app : le web échange le jeton dès le premier écran.
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launch);
        }
    }
}
