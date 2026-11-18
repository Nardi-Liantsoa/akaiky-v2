package mg.nosytech.akaiky

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle
import android.os.PersistableBundle

/**
 * Android 10 et plus (obligatoire dès Android 12) : le système demande au DPC quel
 * mode il veut. Akaiky ne connaît qu'un mode : appareil entièrement géré (Device Owner).
 */
class ProvisioningModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        ProvisioningStore.saveFrom(this, intent.getParcelableExtra<PersistableBundle>(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE))
        setResult(RESULT_OK, Intent().putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE))
        finish()
    }
}
