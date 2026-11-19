package mg.nosytech.akaiky

import java.io.IOException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HeartbeatClientTest {
    private data class Call(val url: String, val headers: Map<String, String>, val body: String)

    private class Server(val code: () -> Int) : HttpPost {
        val calls = mutableListOf<Call>()
        override fun post(url: String, headers: Map<String, String>, body: String): Int {
            calls += Call(url, headers, body)
            return code()
        }
    }

    private val payload = BackgroundStatusPolicy.payload(StatusSnapshot(50, false, "wifi", "ready"))
    private val token = "A".repeat(43)

    @Test fun envoieLeSignalAvecLeJetonSignalDeVieSeulement() {
        val server = Server { 200 }
        assertEquals(SendOutcome.SENT, HeartbeatClient("https://api.test/api", server).send(token, payload))
        val c = server.calls.single()
        assertEquals("https://api.test/api/device/heartbeat", c.url)
        assertEquals("Heartbeat $token", c.headers["Authorization"])
        assertEquals("application/json", c.headers["Content-Type"])
        assertNull("aucune origine : envoi hors WebView", c.headers["Origin"])
        assertEquals(true, JSONObject(c.body).getBoolean("background"))
    }

    @Test fun issueSelonLaReponse() {
        for ((code, outcome) in listOf(200 to SendOutcome.SENT, 204 to SendOutcome.SENT, 401 to SendOutcome.NEEDS_TOKEN,
            400 to SendOutcome.DROPPED, 403 to SendOutcome.RETRY, 429 to SendOutcome.RETRY, 500 to SendOutcome.RETRY, 503 to SendOutcome.RETRY)) {
            assertEquals("HTTP $code", outcome, HeartbeatClient("https://x/api", Server { code }).send(token, payload))
        }
    }

    @Test fun erreurReseauAReessayer() {
        val server = HttpPost { _, _, _ -> throw IOException("hors ligne") }
        assertEquals(SendOutcome.RETRY, HeartbeatClient("https://x/api", server).send(token, payload))
    }

    @Test fun adresseEtJetonValides() {
        assertEquals("https://api.test/api", HeartbeatClient.validBase(" https://api.test/api/ "))
        assertNull(HeartbeatClient.validBase("http://api.test/api"))
        assertNull(HeartbeatClient.validBase("https://"))
        assertNull(HeartbeatClient.validBase(null))
        assertEquals(token, HeartbeatClient.validToken(token))
        assertNull(HeartbeatClient.validToken("A".repeat(42)))
        assertNull(HeartbeatClient.validToken("A".repeat(42) + "="))
        assertNull(HeartbeatClient.validToken(null))
    }
}
