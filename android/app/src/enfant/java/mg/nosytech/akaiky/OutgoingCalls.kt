package mg.nosytech.akaiky

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telecom.PhoneAccountHandle
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Filtre des appels sortants (NAR-169) : décision commune au service de redirection
 * (Android 10+, rôle ROLE_CALL_REDIRECTION) et au récepteur NEW_OUTGOING_CALL (Android 8–9).
 * Mêmes préférences que le filtre des appels entrants (liste, parents, plages, `filtering`),
 * aucun réseau. Rien n'est noté au journal : une ligne locale, sans numéro.
 */
object OutgoingCalls {
    private const val TAG = "AkaikyOutgoing"

    fun decide(context: Context, raw: String?, account: PhoneAccountHandle? = null): CallPolicy.Outgoing {
        val filtering = IncomingCalls.isFiltering(context)
        if (!filtering) return CallPolicy.Outgoing.PLACE
        val allowed = IncomingCalls.allowed(context)
        val reachable = IncomingCalls.reachable(context, allowed)
        val country = routingCountry(context, account)
        val decision = CallPolicy.screenOutgoing(raw, true, allowed, reachable,
            { number, contact -> contact in candidates(number, country) },
            { number -> isEmergency(context, number) })
        // Urgence connue du téléphone seulement (carte SIM, réseau) : fenêtre des secours (NAR-196).
        if (decision == CallPolicy.Outgoing.EMERGENCY) EmergencyCalls.record(context)
        if (decision != CallPolicy.Outgoing.PLACE && decision != CallPolicy.Outgoing.EMERGENCY) {
            Log.i(TAG, "Appel sortant refusé : $decision")
        }
        return decision
    }

    /** Rôle de redirection des appels (Android 10+) détenu : le service décide. */
    fun redirectionHeld(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_CALL_REDIRECTION) == true

    fun allows(decision: CallPolicy.Outgoing) = CallPolicy.allows(decision)

    /**
     * Filtre des appels sortants réellement actif : Android 10+, rôle de redirection détenu ;
     * Android 8–9, récepteur NEW_OUTGOING_CALL activé et PROCESS_OUTGOING_CALLS accordée.
     */
    @Suppress("DEPRECATION")
    fun filterActive(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return redirectionHeld(context)
        val receiver = ComponentName(context, OutgoingCallReceiver::class.java)
        val enabled = when (context.packageManager.getComponentEnabledSetting(receiver)) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT ->
                context.resources.getBoolean(R.bool.outgoing_receiver_enabled)
            else -> false
        }
        return enabled && ContextCompat.checkSelfPermission(context, Manifest.permission.PROCESS_OUTGOING_CALLS) ==
            PackageManager.PERMISSION_GRANTED
    }

    /**
     * Pays où l'appel est acheminé : un numéro national composé est lu par le réseau qui
     * le porte (réseau, puis carte SIM, puis pays de la configuration du parent). Android 10+ :
     * réseau et carte SIM du compte qui passe l'appel (double SIM), sinon ceux par défaut.
     */
    private fun routingCountry(context: Context, account: PhoneAccountHandle?): String {
        val default = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        val tm = if (account != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try { default?.createForPhoneAccountHandle(account) } catch (e: Exception) { null } ?: default
        } else default
        val network = try { tm?.networkCountryIso } catch (e: Exception) { null }
        val sim = try { tm?.simCountryIso } catch (e: Exception) { null }
        return listOfNotNull(network, sim, IncomingCalls.country(context))
            .map { it.uppercase() }.firstOrNull { it.length == 2 } ?: "MG"
    }

    /**
     * Lectures E.164 d'un numéro composé : tel quel s'il a son « + », sinon sa lecture au
     * format national (« 00 » international compris) du seul pays d'acheminement. Jamais
     * l'indicatif sans « + » (le réseau le lit comme un numéro national), jamais la
     * comparaison souple d'Android.
     */
    private fun candidates(number: String, country: String): Set<String> {
        if (number.startsWith("+")) return setOf(number)
        val e164 = PhoneNumberUtils.formatNumberToE164(number, country) ?: return emptySet()
        return if (e164.matches(E164)) setOf(e164) else emptySet()
    }

    private val E164 = Regex("^\\+[1-9][0-9]{6,14}$")

    /**
     * Numéro d'urgence : liste de l'app, puis ceux que connaît le téléphone (carte SIM, réseau).
     * Un `*` ou `#` (code de service) n'en est jamais un.
     */
    fun isEmergency(context: Context, number: String?): Boolean {
        if (number.isNullOrBlank() || number.any { it == '*' || it == '#' }) return false
        if (CallPolicy.isEmergency(number)) return true
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                (context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager)?.isEmergencyNumber(number) == true
            } else {
                @Suppress("DEPRECATION")
                PhoneNumberUtils.isEmergencyNumber(number)
            }
        } catch (e: Exception) {
            false
        }
    }

    /**
     * PROCESS_OUTGOING_CALLS (récepteur d'Android 8–9) accordée d'office en Device Owner.
     * Permission « restreinte » à partir d'Android 10 : sans effet garanti, le rôle de
     * redirection y prend le relais.
     */
    @Suppress("DEPRECATION")
    fun grant(context: Context) {
        val permission = Manifest.permission.PROCESS_OUTGOING_CALLS
        if (ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) return
        try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
            if (!dpm.isDeviceOwnerApp(context.packageName)) return
            val admin = ComponentName(context.packageName, "mg.nosytech.akaiky.AkaikyDeviceAdminReceiver")
            dpm.setPermissionGrantState(admin, context.packageName, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
        } catch (e: Exception) {
            Log.w(TAG, "Permission des appels sortants non accordée", e)
        }
    }
}
