package mg.nosytech.akaiky

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.os.Bundle
import android.os.PersistableBundle

/**
 * Android 10 et plus (obligatoire dès Android 12) : dernière étape du provisionnement,
 * extras du QR fournis ici. Rien à imposer encore (verrouillage : NAR-139) ; on retient
 * le jeton et on rend la main. L'app s'ouvre ensuite sur l'écran de l'enfant.
 */
class PolicyComplianceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        ProvisioningStore.saveFrom(this, intent.getParcelableExtra<PersistableBundle>(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE))
        setResult(RESULT_OK)
        finish()
    }
}
