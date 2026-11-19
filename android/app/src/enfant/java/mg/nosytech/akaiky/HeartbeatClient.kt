package mg.nosytech.akaiky

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** Réponse HTTP réduite à son code. */
fun interface HttpPost {
    /** Code HTTP de la réponse. */
    @Throws(IOException::class)
    fun post(url: String, headers: Map<String, String>, body: String): Int
}

/** Issue d'un envoi du signal. */
enum class SendOutcome {
    /** Accepté par le serveur. */
    SENT,
    /** Réseau, serveur indisponible, trop d'envois (429), refus d'origine : à réessayer. */
    RETRY,
    /** Refusé pour son contenu (400) : jamais renvoyé tel quel. */
    DROPPED,
    /** Jeton « signal de vie » refusé (401) : surveillance arrêtée, l'écran en émettra un autre. */
    NEEDS_TOKEN,
    /** Aucun jeton lisible ici (stockage vide ou clé perdue) : rien n'est envoyé, nouvel essai à la période suivante. */
    NO_TOKEN
}

/**
 * Envoi du signal en arrière-plan (NAR-180) avec le jeton « signal de vie »
 * (`Authorization: Heartbeat <jeton>`), émis par le serveur à l'écran
 * (POST /api/device/heartbeat-token) et confié au natif. Il n'ouvre que
 * POST /api/device/heartbeat : le natif ne touche jamais à la session d'appareil, que seul
 * l'écran renouvelle (aucune rotation croisée, aucun rejeu possible). Pas d'en-tête Origin :
 * le serveur accepte ce schéma sans origine sur cette seule route.
 */
class HeartbeatClient(
    private val base: String,
    private val http: HttpPost,
    /** Journal de diagnostic (jamais un jeton). */
    private val log: (String) -> Unit = {}
) {
    fun send(token: String, payload: JSONObject): SendOutcome {
        val code = try {
            http.post("$base/device/heartbeat", mapOf("Content-Type" to "application/json", "Authorization" to "Heartbeat $token"), payload.toString())
        } catch (e: Exception) {
            // Réseau coupé, réponse illisible : rien n'est perdu, le relevé reste en attente.
            log("envoi impossible : ${e.javaClass.simpleName}")
            return SendOutcome.RETRY
        }
        return outcomeOf(code)
    }

    companion object {
        fun outcomeOf(code: Int): SendOutcome = when {
            code in 200..299 -> SendOutcome.SENT
            code == 401 -> SendOutcome.NEEDS_TOKEN
            code == 400 -> SendOutcome.DROPPED
            else -> SendOutcome.RETRY
        }

        /** Adresse de l'API admise : https seulement (comme vite.config.ts pour API_BASE). */
        fun validBase(base: String?): String? =
            base?.trim()?.trimEnd('/')?.takeIf { it.startsWith("https://") && it.length > "https://".length && !it.contains(' ') }

        /** Jeton émis par le serveur : 256 bits en base64url, 43 caractères. */
        fun validToken(token: String?): String? = token?.takeIf { Regex("^[A-Za-z0-9_-]{43}$").matches(it) }

        /** Transport réel : HttpURLConnection, délais de 15 s, aucun cookie, corps de réponse ignoré. */
        val urlConnection = HttpPost { url, headers, body ->
            val c = URL(url).openConnection() as HttpURLConnection
            try {
                c.requestMethod = "POST"
                c.connectTimeout = 15_000
                c.readTimeout = 15_000
                c.useCaches = false
                c.instanceFollowRedirects = false
                c.doOutput = true
                headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = c.responseCode
                (if (code >= 400) c.errorStream else c.inputStream)?.use { it.readBytes() }
                code
            } finally {
                c.disconnect()
            }
        }
    }
}
