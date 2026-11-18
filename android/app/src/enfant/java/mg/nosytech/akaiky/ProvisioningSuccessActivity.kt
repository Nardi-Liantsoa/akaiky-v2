package mg.nosytech.akaiky

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Fin du provisionnement signalée par le système (ACTION_PROVISIONING_SUCCESSFUL) :
 * on ouvre l'app tout de suite, pour que le jeton d'appairage (15 minutes) soit
 * échangé sans attendre. Selon la version d'Android et le parcours, cette action
 * peut ne pas être envoyée : l'écran parent dit alors d'ouvrir Akaiky Enfant.
 */
class ProvisioningSuccessActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            startActivity(it)
        }
        finish()
    }
}
