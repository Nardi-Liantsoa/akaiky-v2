package mg.nosytech.akaiky

import android.app.Activity
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings
import android.util.Log
import android.telecom.TelecomManager

/**
 * Mode appareil dédié de l'app enfant (NAR-167), appliqué par l'app Device Owner.
 *
 * - « Armé » (posé par l'écran de l'enfant une fois le téléphone appairé, retiré s'il
 *   est retiré par le parent) : restrictions, lanceur par défaut, liste du lock task.
 * - « Verrouillé » : armé et aucune fenêtre de sortie ouverte. L'activité principale
 *   entre en lock task à chaque reprise (Kiosk.enforce depuis KioskPlugin.handleOnResume).
 * - Fenêtre de sortie (code parent) : 15 minutes au plus, fermée par une alarme qui
 *   rouvre l'app, par l'écran de l'enfant, et par tout redémarrage.
 *
 * Sans Device Owner (développement, app installée à la main), rien n'est appliqué.
 */
object Kiosk {
    // Aussi lues par AllowedApps (liste autorisée, apps cachées par nous, NAR-143).
    internal const val PREFS = "akaiky.kiosk"
    private const val RELOCK_REQUEST = 1670

    // Restrictions posées tant que le téléphone est armé, sortie temporaire comprise :
    // la sortie ouvre les réglages au parent, jamais la réinitialisation ni l'installation.
    private fun restrictions(): List<String> = buildList {
        add(UserManager.DISALLOW_FACTORY_RESET)
        add(UserManager.DISALLOW_SAFE_BOOT)
        add(UserManager.DISALLOW_ADD_USER)
        add(UserManager.DISALLOW_INSTALL_APPS)
        add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        add(UserManager.DISALLOW_UNINSTALL_APPS)
        add(UserManager.DISALLOW_USB_FILE_TRANSFER)
        add(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA)
        // L'heure ne recule pas : le délai entre deux essais de code en dépend.
        add(UserManager.DISALLOW_CONFIG_DATE_TIME)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) add(UserManager.DISALLOW_AIRPLANE_MODE)
        // Débogage USB : coupé dans l'APK distribué seulement ; une version de
        // développement garde adb, sans quoi un émulateur verrouillé est perdu.
        if (!BuildConfig.DEBUG) add(UserManager.DISALLOW_DEBUGGING_FEATURES)
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun dpm(context: Context) = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private fun admin(context: Context) = ComponentName(context, AkaikyDeviceAdminReceiver::class.java)
    private fun home(context: Context) = ComponentName(context.packageName, "mg.nosytech.akaiky.MainActivity")

    fun isDeviceOwner(context: Context): Boolean = dpm(context).isDeviceOwnerApp(context.packageName)
    fun isArmed(context: Context): Boolean = prefs(context).getBoolean("armed", false)

    private fun bootCount(context: Context): Int =
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

    private fun window(context: Context): KioskPolicy.Window? {
        val p = prefs(context)
        if (!p.contains("until")) return null
        return KioskPolicy.Window(p.getLong("start", 0), p.getLong("until", 0), p.getInt("boot", -1))
    }

    fun isUnlocked(context: Context): Boolean =
        KioskPolicy.isOpen(window(context), SystemClock.elapsedRealtime(), bootCount(context))

    /** Fin de la sortie en cours, en heure réelle (ms), pour l'affichage ; null si verrouillé. */
    fun unlockedUntil(context: Context): Long? {
        val w = window(context) ?: return null
        if (!isUnlocked(context)) return null
        return System.currentTimeMillis() + (w.untilElapsed - SystemClock.elapsedRealtime())
    }

    fun isInLockTask(context: Context): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    fun arm(context: Context) {
        prefs(context).edit().putBoolean("armed", true).apply()
    }

    fun openWindow(context: Context, minutes: Int) {
        val w = KioskPolicy.open(SystemClock.elapsedRealtime(), bootCount(context), minutes)
        prefs(context).edit().putLong("start", w.startElapsed).putLong("until", w.untilElapsed).putInt("boot", w.boot).apply()
        scheduleRelock(context, w.untilElapsed)
    }

    fun closeWindow(context: Context) {
        prefs(context).edit().remove("start").remove("until").remove("boot").apply()
        cancelRelock(context)
    }

    /**
     * Applique l'état voulu. Appelée à chaque reprise de l'activité, à chaque action de
     * l'écran de l'enfant, et par l'alarme de fin de sortie. À appeler sur le fil principal.
     */
    fun enforce(context: Context, activity: Activity?) {
        if (!isDeviceOwner(context) || !isArmed(context)) return
        val dpm = dpm(context)
        val admin = admin(context)
        // Chaque politique isolément : un refus d'un constructeur (exception) n'empêche
        // jamais les suivantes, et surtout pas le verrou d'écran en fin de fonction.
        // Mise à jour de l'app (NAR-170) : une fenêtre d'installation abandonnée est refermée ;
        // celle que ce processus tient pour une installation en cours n'est pas reposée ici.
        safely("mise à jour") { ApkUpdate.restoreIfNeeded(context) }
        val installing = try { ApkUpdate.installAllowedNow(context) } catch (e: Exception) { false }
        for (r in restrictions()) {
            if (installing && r == UserManager.DISALLOW_INSTALL_APPS) continue
            safely("restriction $r") { dpm.addUserRestriction(admin, r) }
        }
        // Lanceur par défaut : le bouton d'accueil et le redémarrage ramènent ici (C06).
        safely("lanceur") {
            val homeFilter = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, homeFilter, home(context))
        }
        safely("paquets") { dpm.setLockTaskPackages(admin, lockTaskPackages(context)) }
        // Filtre des appels sortants d'Android 8–9 (NAR-169).
        safely("appels sortants") { OutgoingCalls.grant(context) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Accueil (sans effet : l'accueil, c'est l'app), écran d'appel entrant
            // (porté par les notifications), menu d'arrêt. Ni aperçu des apps, ni infos système.
            safely("fonctions") {
                dpm.setLockTaskFeatures(
                    admin,
                    DevicePolicyManager.LOCK_TASK_FEATURE_HOME or
                        DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS or
                        DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS
                )
            }
        }
        if (isUnlocked(context)) {
            safely("barre d'état") { dpm.setStatusBarDisabled(admin, false) }
            if (activity != null && isInLockTask(context)) safely("fin du lock task") { activity.stopLockTask() }
        } else {
            if (window(context) != null) closeWindow(context)
            safely("barre d'état") { dpm.setStatusBarDisabled(admin, true) }
            if (activity != null && !isInLockTask(context)) safely("lock task") { activity.startLockTask() }
        }
    }

    private inline fun safely(what: String, block: () -> Unit) {
        try { block() } catch (e: Exception) { Log.w("AkaikyKiosk", "Politique non appliquée : $what", e) }
    }

    /** Téléphone retiré par le parent : il redevient un téléphone ordinaire, réinitialisable. */
    fun disarm(context: Context, activity: Activity?) {
        prefs(context).edit().putBoolean("armed", false).apply()
        closeWindow(context)
        if (!isDeviceOwner(context)) return
        val dpm = dpm(context)
        val admin = admin(context)
        if (activity != null && isInLockTask(context)) safely("fin du lock task") { activity.stopLockTask() }
        safely("paquets") { dpm.setLockTaskPackages(admin, emptyArray()) }
        safely("barre d'état") { dpm.setStatusBarDisabled(admin, false) }
        safely("lanceur") { dpm.clearPackagePersistentPreferredActivities(admin, context.packageName) }
        // Apps cachées (NAR-143) : liste autorisée oubliée tout de suite, puis toutes rendues.
        safely("applications") { AllowedApps.releaseAll(context) }
        for (r in restrictions() + UserManager.DISALLOW_DEBUGGING_FEATURES) safely("restriction $r") { dpm.clearUserRestriction(admin, r) }
    }

    private fun lockTaskPackages(context: Context): Array<String> {
        val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
        val system = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) telecom?.systemDialerPackage else null
        val base = KioskPolicy.lockTaskPackages(
            context.packageName,
            listOf(telecom?.defaultDialerPackage, system, "com.android.server.telecom", "com.android.phone"),
        )
        // Apps autorisées par le parent (NAR-143) : lancées depuis l'écran, sans quitter le verrou ;
        // retirées pendant une plage « école » (relu à chaque enforce : début et fin de plage vus
        // par le minuteur de l'écran, plages reçues, ouverture d'app, retour au premier plan).
        return AppsPolicy.lockTaskPackages(base, AllowedApps.allowed(context), IncomingCalls.inSchool(context))
    }

    private fun relockIntent(context: Context): PendingIntent =
        PendingIntent.getBroadcast(
            context, RELOCK_REQUEST,
            Intent(context, RelockReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    // Alarme exacte (USE_EXACT_ALARM : APK hors Play Store) : le verrou revient à l'heure,
    // même app fermée. Sans droit d'alarme exacte, alarme approchée : l'écran de l'enfant
    // et chaque reprise de l'app referment aussi la fenêtre.
    private fun scheduleRelock(context: Context, atElapsed: Long) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = relockIntent(context)
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, atElapsed, pi)
        else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, atElapsed, pi)
    }

    private fun cancelRelock(context: Context) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(relockIntent(context))
    }

    /** Applique l'état voulu depuis n'importe quel fil (passe par le fil principal). */
    fun enforceOnMain(context: Context, activity: Activity?) {
        val run = Runnable { safely("verrou") { enforce(context, activity) } }
        if (activity != null) activity.runOnUiThread(run)
        else android.os.Handler(android.os.Looper.getMainLooper()).post(run)
    }

    /** Ramène l'app au premier plan (fin de sortie) : sa reprise remet le verrou. */
    fun bringToFront(context: Context) {
        val intent = Intent(Intent.ACTION_MAIN).apply {
            component = home(context)
            addCategory(Intent.CATEGORY_HOME)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        }
        runCatching { context.startActivity(intent) }
    }
}
