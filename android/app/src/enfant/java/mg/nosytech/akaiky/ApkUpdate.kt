package mg.nosytech.akaiky

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings
import android.telecom.TelecomManager
import android.util.Log
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Mise à jour de l'app enfant par elle-même, téléphone verrouillé (NAR-170).
 *
 * Téléchargement dans le cache privé, SHA-256 du fichier comparé à celui du serveur, puis
 * archive lue par PackageManager : même paquet, version annoncée et strictement supérieure,
 * même certificat que l'app installée (ApkUpdatePolicy). Installation par PackageInstaller
 * (Device Owner : sans confirmation). DISALLOW_INSTALL_APPS n'est levée qu'autour de la
 * remise de la session (fenêtre persistée), et reposée : au résultat, quel qu'il soit
 * (ApkUpdateReceiver), par une alarme de sécurité de 5 minutes, et à tout démarrage de l'app
 * ou du téléphone qui trouve la fenêtre (Kiosk.enforce, BOOT_COMPLETED, MY_PACKAGE_REPLACED).
 */
object ApkUpdate {
    private const val TAG = "AkaikyUpdate"
    private const val PREFS = "akaiky.update"
    private const val SAFETY_REQUEST = 1701
    private const val RESULT_REQUEST = 1702
    const val ACTION_RESULT = "mg.nosytech.akaiky.APK_UPDATE_RESULT"
    const val ACTION_SAFETY = "mg.nosytech.akaiky.APK_UPDATE_SAFETY"

    /** Restrictions levées pendant la fenêtre ; DISALLOW_INSTALL_UNKNOWN_SOURCES reste posée. */
    private val windowRestrictions = listOf(UserManager.DISALLOW_INSTALL_APPS)

    /** Un seul téléchargement ou installation à la fois, hors du fil des plugins. */
    private val worker = Executors.newSingleThreadExecutor()

    /** Fenêtre ouverte par CE processus, pour l'installation en cours (jamais persisté). */
    @Volatile private var heldSessionId: Int? = null
    @Volatile private var running = false

    class Refused(val code: String, message: String) : Exception(message)

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun dpm(context: Context) = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private fun admin(context: Context) = ComponentName(context, AkaikyDeviceAdminReceiver::class.java)
    private fun bootCount(context: Context): Int = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

    fun installedVersion(context: Context): Long = versionOf(context.packageManager.getPackageInfo(context.packageName, 0))

    @Suppress("DEPRECATION")
    private fun versionOf(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    /** Dernière tentative (heure réelle, ms) et dernier résultat, pour l'écran (essai toutes les 6 h). */
    fun status(context: Context): Map<String, Any?> {
        val p = prefs(context)
        return mapOf(
            "versionCode" to installedVersion(context),
            "lastAttemptAt" to p.getLong("lastAttemptAt", 0L).takeIf { it > 0 },
            "lastResult" to p.getString("lastResult", null),
            "running" to running,
            // NAR-191 : lu par le runtime OTA de l'écran (src/lib/otaUpdate.ts), qui n'agit qu'au repos.
            "busy" to busy(context),
        )
    }

    private fun record(context: Context, result: String) {
        Log.i(TAG, "résultat : $result")
        prefs(context).edit().putString("lastResult", result).apply()
    }

    // --- Fenêtre d'installation -------------------------------------------------------------

    private fun window(context: Context): ApkUpdatePolicy.Window? {
        val p = prefs(context)
        if (!p.getBoolean("install_window_open", false)) return null
        return ApkUpdatePolicy.Window(p.getLong("window_opened", 0L), p.getInt("window_boot", -1))
    }

    /** Restriction d'installation levée en ce moment par cette installation (Kiosk.enforce ne la repose pas). */
    @Synchronized
    fun installAllowedNow(context: Context): Boolean =
        ApkUpdatePolicy.installAllowedNow(window(context), heldSessionId != null, SystemClock.elapsedRealtime(), bootCount(context))

    /** Fenêtre gardée par un autre processus, ou trop vieille : restriction reposée. Sûr partout. */
    @Synchronized
    fun restoreIfNeeded(context: Context) {
        try {
            if (ApkUpdatePolicy.mustRestore(window(context), heldSessionId != null, SystemClock.elapsedRealtime(), bootCount(context))) {
                closeWindow(context, "fenêtre retrouvée")
            }
        } catch (e: Exception) {
            Log.w(TAG, "restriction non vérifiée", e)
        }
    }

    // Ouverture, fermeture et vérification sérialisées : un Kiosk.enforce (fil principal) ne voit
    // jamais une fenêtre persistée sans son détenteur, et ne la referme donc pas à tort.
    @Synchronized
    private fun openWindow(context: Context, sessionId: Int) {
        heldSessionId = sessionId
        // Persistée AVANT de lever la restriction : un processus tué entre les deux la repose.
        prefs(context).edit()
            .putBoolean("install_window_open", true)
            .putLong("window_opened", SystemClock.elapsedRealtime())
            .putInt("window_boot", bootCount(context))
            .putLong("window_opened_at", System.currentTimeMillis())
            .commit()
        scheduleSafety(context)
        for (r in windowRestrictions) dpm(context).clearUserRestriction(admin(context), r)
        Log.i(TAG, "fenêtre d'installation ouverte (session $sessionId)")
    }

    /** Reposée dans tous les cas (téléphone armé), puis fenêtre oubliée. */
    @Synchronized
    fun closeWindow(context: Context, why: String) {
        heldSessionId = null
        if (Kiosk.isDeviceOwner(context) && Kiosk.isArmed(context)) {
            for (r in windowRestrictions) {
                try { dpm(context).addUserRestriction(admin(context), r) } catch (e: Exception) { Log.w(TAG, "restriction $r non reposée", e) }
            }
        }
        prefs(context).edit().remove("install_window_open").remove("window_opened").remove("window_boot").remove("window_opened_at").commit()
        cancelSafety(context)
        Log.i(TAG, "fenêtre d'installation fermée : $why")
    }

    private fun safetyIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, SAFETY_REQUEST,
        Intent(context, ApkUpdateReceiver::class.java).setAction(ACTION_SAFETY),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun scheduleSafety(context: Context) {
        val at = SystemClock.elapsedRealtime() + ApkUpdatePolicy.WINDOW_MS
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, safetyIntent(context))
        else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, safetyIntent(context))
        // Même processus vivant : aussi sur le fil principal, sans attendre l'alarme.
        Handler(Looper.getMainLooper()).postDelayed({ restoreIfNeeded(context) }, ApkUpdatePolicy.WINDOW_MS + 1_000)
    }

    private fun cancelSafety(context: Context) {
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(safetyIntent(context))
    }

    // --- Téléchargement, vérification, installation ------------------------------------------

    /** Lance la mise à jour sur son fil ; `done(code)` : null = session remise au système. */
    fun install(context: Context, url: String, sha256: String, versionCode: Long, done: (String?, String) -> Unit) {
        val app = context.applicationContext
        synchronized(this) {
            if (running) return done("in_progress", "Mise à jour déjà en cours.")
            running = true
        }
        worker.execute {
            try {
                run(app, url, sha256, versionCode)
                done(null, "Installation remise au système.")
            } catch (e: Refused) {
                record(app, e.code)
                done(e.code, e.message ?: e.code)
            } catch (e: Exception) {
                Log.w(TAG, "mise à jour en échec", e)
                record(app, "failed")
                done("failed", "Mise à jour impossible.")
            } finally {
                running = false
            }
        }
    }

    private fun run(context: Context, url: String, sha256: String, versionCode: Long) {
        if (!Kiosk.isDeviceOwner(context)) throw Refused("not_device_owner", "Mise à jour silencieuse réservée au Device Owner.")
        val installedVersion = installedVersion(context)
        if (versionCode <= installedVersion) throw Refused("not_newer", "Version déjà installée.")
        if (busy(context)) throw Refused("busy", "SOS ou appel en cours.")
        prefs(context).edit().putLong("lastAttemptAt", System.currentTimeMillis()).apply()

        val dir = File(context.cacheDir, "apk-update").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "update.apk")
        try {
            val fileSha = download(url, file)
            val archive = readArchive(context, file)
            val verdict = ApkUpdatePolicy.verify(installed(context), versionCode, sha256, fileSha, archive)
            if (verdict != ApkUpdatePolicy.Verdict.OK) throw Refused(verdict.name.lowercase(), "APK refusé : $verdict")
            // Revérifié juste avant d'installer : le téléchargement a pu durer.
            if (busy(context)) throw Refused("busy", "SOS ou appel en cours.")
            commit(context, file)
            record(context, "committed")
        } finally {
            file.delete()
        }
    }

    /** SOS en cours, gardé ou en lancement ; appel en cours (ou illisible : jamais pris pour « libre »). */
    fun busy(context: Context): Boolean {
        if (SosService.running != null || SosService.persistedRun(context) != null || SosRun.snapshot()?.optBoolean("active") == true) return true
        val inCall = try { context.getSystemService(TelecomManager::class.java)?.isInCall } catch (e: Exception) { null }
        return inCall != false
    }

    private fun download(url: String, file: File): String {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 15_000
            c.readTimeout = 30_000
            c.instanceFollowRedirects = true
            c.useCaches = false
            c.setRequestProperty("Accept-Encoding", "identity")
            val code = c.responseCode
            if (code != 200) throw Refused("download_failed", "Téléchargement refusé ($code).")
            if (!ApkUpdatePolicy.sizeAccepted(c.contentLengthLong)) throw Refused("too_large", "APK trop gros.")
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            c.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > ApkUpdatePolicy.MAX_BYTES) throw Refused("too_large", "APK trop gros.")
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                    out.fd.sync()
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        } catch (e: IOException) {
            throw Refused("download_failed", "Téléchargement interrompu.")
        } finally {
            c.disconnect()
        }
    }

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Suppress("DEPRECATION")
    private fun signersOf(info: PackageInfo): ApkUpdatePolicy.Signers {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val s = info.signingInfo
            if (s != null) {
                return if (s.hasMultipleSigners()) {
                    ApkUpdatePolicy.Signers(s.apkContentsSigners.map { sha256Hex(it.toByteArray()) }.toSet())
                } else {
                    val history = s.signingCertificateHistory.map { sha256Hex(it.toByteArray()) }
                    // Historique du plus ancien au actuel : le dernier signe l'archive.
                    ApkUpdatePolicy.Signers(setOfNotNull(history.lastOrNull()), history)
                }
            }
        }
        return ApkUpdatePolicy.Signers((info.signatures ?: emptyArray()).map { sha256Hex(it.toByteArray()) }.toSet())
    }

    @Suppress("DEPRECATION")
    private val signingFlags: Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    private fun installed(context: Context): ApkUpdatePolicy.Installed {
        val info = context.packageManager.getPackageInfo(context.packageName, signingFlags)
        return ApkUpdatePolicy.Installed(context.packageName, versionOf(info), signersOf(info))
    }

    private fun readArchive(context: Context, file: File): ApkUpdatePolicy.Archive? = try {
        val info = context.packageManager.getPackageArchiveInfo(file.absolutePath, signingFlags)
        info?.let { ApkUpdatePolicy.Archive(it.packageName, versionOf(it), signersOf(it)) }
    } catch (e: Exception) {
        null
    }

    private fun commit(context: Context, file: File) {
        val installer = context.packageManager.packageInstaller
        // Sessions laissées par une tentative précédente (processus tué) : abandonnées.
        for (s in installer.mySessions) runCatching { installer.abandonSession(s.sessionId) }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(file.length())
            setInstallReason(PackageManager.INSTALL_REASON_POLICY)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        // Restriction posée : Android refuse aussi la création de session. Fenêtre ouverte alors
        // dès la création (quelques secondes de plus : copie d'un fichier local déjà vérifié).
        val sessionId = try {
            installer.createSession(params)
        } catch (e: SecurityException) {
            Log.i(TAG, "création de session refusée sous la restriction : fenêtre ouverte dès maintenant")
            if (otherInstallActive(context, -1)) throw Refused("installer_busy", "Autre installation en cours.")
            openWindow(context, -1)
            try { installer.createSession(params) } catch (e2: Exception) { closeWindow(context, "session impossible"); throw e2 }
        }
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("akaiky-enfant.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out, 64 * 1024) }
                    session.fsync(out)
                }
                // Aucune autre installation en cours au moment d'ouvrir (ou de garder) la fenêtre.
                if (otherInstallActive(context, sessionId)) throw Refused("installer_busy", "Autre installation en cours.")
                if (heldSessionId == null) openWindow(context, sessionId) else heldSessionId = sessionId
                watchOtherSessions(context, sessionId)
                session.commit(resultIntent(context).intentSender)
            }
        } catch (e: Exception) {
            runCatching { installer.abandonSession(sessionId) }
            closeWindow(context, "remise impossible")
            throw e
        }
    }

    /** Une session d'un autre installateur, active : jamais de fenêtre ouverte en même temps. */
    private fun otherInstallActive(context: Context, ours: Int): Boolean = try {
        context.packageManager.packageInstaller.allSessions.any {
            it.sessionId != ours && it.isActive && it.installerPackageName != context.packageName
        }
    } catch (e: Exception) {
        true
    }

    /**
     * Pendant la fenêtre, toute autre session (autre installateur) la referme aussitôt : la
     * restriction revient avant qu'elle puisse être remise. Notre propre installation peut
     * alors échouer (sans danger, nouvel essai plus tard).
     */
    private fun watchOtherSessions(context: Context, ours: Int) {
        val installer = context.packageManager.packageInstaller
        val callback = object : PackageInstaller.SessionCallback() {
            private fun check(id: Int) {
                if (heldSessionId == null) { runCatching { installer.unregisterSessionCallback(this) }; return }
                if (id == ours) return
                val info = runCatching { installer.getSessionInfo(id) }.getOrNull()
                if (info == null || info.installerPackageName != context.packageName) {
                    Log.w(TAG, "autre installation pendant la fenêtre : restriction reposée")
                    closeWindow(context, "autre installation")
                    runCatching { installer.unregisterSessionCallback(this) }
                }
            }
            override fun onCreated(sessionId: Int) = check(sessionId)
            override fun onBadgingChanged(sessionId: Int) {}
            override fun onActiveChanged(sessionId: Int, active: Boolean) { if (active) check(sessionId) }
            override fun onProgressChanged(sessionId: Int, progress: Float) {}
            override fun onFinished(sessionId: Int, success: Boolean) {
                if (sessionId == ours) runCatching { installer.unregisterSessionCallback(this) }
            }
        }
        installer.registerSessionCallback(callback, Handler(Looper.getMainLooper()))
    }

    // Mutable : le système y ajoute le statut et l'identifiant de session (Android 12+).
    private fun resultIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, RESULT_REQUEST,
        Intent(context, ApkUpdateReceiver::class.java).setAction(ACTION_RESULT),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0),
    )

    /** Résultat de PackageInstaller : restriction reposée dans tous les cas. */
    fun onResult(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
        when (status) {
            PackageInstaller.STATUS_SUCCESS -> record(context, "installed")
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Ne devrait pas arriver en Device Owner : jamais montré à l'enfant, session abandonnée.
                if (sessionId >= 0) runCatching { context.packageManager.packageInstaller.abandonSession(sessionId) }
                record(context, "user_action_refused")
            }
            else -> record(context, "install_failed:$status")
        }
        closeWindow(context, "résultat $status")
    }

    /** App remplacée (nouvelle version) : restriction reposée, app rouverte (lock task à la reprise). */
    fun onPackageReplaced(context: Context) {
        restoreIfNeeded(context)
        if (Kiosk.isDeviceOwner(context) && Kiosk.isArmed(context)) Kiosk.bringToFront(context)
    }
}
