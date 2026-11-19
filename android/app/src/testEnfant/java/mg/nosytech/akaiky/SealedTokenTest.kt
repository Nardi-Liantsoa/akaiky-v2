package mg.nosytech.akaiky

import javax.crypto.KeyGenerator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SealedTokenTest {
    private fun key() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val token = "t".repeat(43) // jeton factice généré : pas de valeur ressemblant à un secret

    @Test fun allerRetourEtIvNeuf() {
        val k = key()
        val a = SealedToken.seal(token, k)
        val b = SealedToken.seal(token, k)
        assertNotEquals("IV aléatoire : deux chiffrés différents", a, b)
        assertEquals(token, SealedToken.open(a, k))
        assertEquals(token, SealedToken.open(b, k))
        assertEquals(false, a.contains(token))
    }

    @Test fun autreCleOuValeurAltereeIllisible() {
        val k = key()
        val sealed = SealedToken.seal(token, k)
        assertNull(SealedToken.open(sealed, key()))
        val (iv, data) = sealed.split('.')
        val flipped = data.substring(0, 5) + (if (data[5] == 'A') 'B' else 'A') + data.substring(6)
        assertNull(SealedToken.open("$iv.$flipped", k))
        assertNull(SealedToken.open("pas un chiffré", k))
        assertNull(SealedToken.open(null, k))
    }
}
