package mg.nosytech.akaiky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Relevé unique à la demande (NAR-204). */
class LocationFixTest {
    private val s = 1_000_000_000L
    private fun at(sec: Long, acc: Float?) = LocationFix.Sample(sec * s, -18.9, 47.5, acc)

    @Test fun seulementApresLaDemande() {
        assertFalse(LocationFix.fresh(at(9, 5f), 10 * s))
        assertTrue(LocationFix.fresh(at(10, 5f), 10 * s))
    }

    @Test fun precisArreteLAttente() {
        assertTrue(LocationFix.good(at(1, 25f)))
        assertFalse(LocationFix.good(at(1, 26f)))
        // Précision inconnue : mauvaise.
        assertFalse(LocationFix.good(at(1, null)))
    }

    @Test fun lePlusPrecisPuisLePlusRecent() {
        val a = at(1, 80f)
        assertEquals(at(2, 40f), LocationFix.better(a, at(2, 40f)))
        assertEquals(a, LocationFix.better(a, at(3, 90f)))
        assertEquals(at(4, 80f), LocationFix.better(a, at(4, 80f)))
        assertEquals(a, LocationFix.better(a, at(5, null)))
        assertEquals(at(5, null), LocationFix.better(null, at(5, null)))
        // Précision connue, même mauvaise, avant une précision inconnue (seule envoyable).
        assertEquals(at(6, 150_000f), LocationFix.better(at(5, null), at(6, 150_000f)))
    }

    @Test fun ageEtPrecisionEnvoyes() {
        // Âge en secondes entières ; précision au mètre supérieur (jamais plus précis qu'il n'est).
        val r = LocationFix.result(at(10, 12.2f), 13 * s + 600_000_000L)!!
        assertEquals(3L, r.ageS)
        assertEquals(13, r.accuracyM)
        assertEquals(3L, LocationFix.result(at(10, 5f), 13 * s)!!.ageS)
        assertEquals(0L, LocationFix.result(at(10, 5f), 9 * s)!!.ageS)
        assertNull(LocationFix.result(at(10, 5f), 131 * s))
    }

    @Test fun sansPrecisionJamaisEnvoye() {
        assertNull(LocationFix.result(at(10, null), 10 * s))
        assertNull(LocationFix.result(LocationFix.Sample(10 * s, -18.9, 47.5, Float.NaN), 10 * s))
    }

    @Test fun coordonneesValides() {
        assertTrue(LocationFix.valid(at(1, 5f)))
        assertFalse(LocationFix.valid(LocationFix.Sample(0, Double.NaN, 47.5, 5f)))
        assertFalse(LocationFix.valid(LocationFix.Sample(0, 91.0, 47.5, 5f)))
        assertFalse(LocationFix.valid(LocationFix.Sample(0, 0.0, 181.0, 5f)))
    }
}
