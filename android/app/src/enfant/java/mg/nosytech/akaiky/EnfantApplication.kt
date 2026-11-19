package mg.nosytech.akaiky

import android.app.Application
import android.util.Log

/**
 * Processus de l'app enfant, quel qu'en soit le déclencheur (lanceur, récepteur, alarme) : une
 * fenêtre d'installation laissée ouverte par un processus tué est refermée tout de suite, sans
 * attendre le chargement de la WebView (NAR-170).
 */
class EnfantApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        try { ApkUpdate.restoreIfNeeded(this) } catch (e: Exception) { Log.w("AkaikyUpdate", "restriction non vérifiée", e) }
    }
}
