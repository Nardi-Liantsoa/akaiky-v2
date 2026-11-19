package mg.nosytech.akaiky

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

/** Tâche WorkManager du signal en arrière-plan (NAR-180), règles dans BackgroundStatus. */
class BackgroundStatusWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        when (BackgroundStatus.run(applicationContext)) {
            SendOutcome.RETRY -> Result.retry()
            // Aucun jeton lisible : nouvel essai à la période suivante, sans relances rapprochées.
            SendOutcome.NO_TOKEN -> Result.success()
            else -> Result.success()
        }
    } catch (e: Exception) {
        // Jamais de plantage : le processus est celui du lanceur.
        Log.w("AkaikyStatus", "tâche en échec", e)
        Result.retry()
    }
}
