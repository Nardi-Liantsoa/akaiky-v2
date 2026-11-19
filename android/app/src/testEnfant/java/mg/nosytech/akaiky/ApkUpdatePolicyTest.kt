package mg.nosytech.akaiky

import mg.nosytech.akaiky.ApkUpdatePolicy.Archive
import mg.nosytech.akaiky.ApkUpdatePolicy.Installed
import mg.nosytech.akaiky.ApkUpdatePolicy.Signers
import mg.nosytech.akaiky.ApkUpdatePolicy.Verdict
import mg.nosytech.akaiky.ApkUpdatePolicy.Window
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkUpdatePolicyTest {
    private val pkg = "mg.nosytech.akaiky.enfant"
    private val certA = "a".repeat(64)
    private val certB = "b".repeat(64)
    private val sha = "c".repeat(64)
    private val installed = Installed(pkg, 5, Signers(setOf(certA), listOf(certA)))
    private fun archive(packageName: String = pkg, version: Long = 6, signers: Signers = Signers(setOf(certA), listOf(certA))) =
        Archive(packageName, version, signers)

    @Test fun archiveConformeAcceptee() {
        assertEquals(Verdict.OK, ApkUpdatePolicy.verify(installed, 6, sha, sha, archive()))
        // Empreinte en majuscules (même fichier) : acceptée.
        assertEquals(Verdict.OK, ApkUpdatePolicy.verify(installed, 6, sha, sha.uppercase(), archive()))
    }

    @Test fun empreinteDuFichierDifferenteRefusee() {
        assertEquals(Verdict.SHA_MISMATCH, ApkUpdatePolicy.verify(installed, 6, sha, "d".repeat(64), archive()))
    }

    @Test fun archiveIllisibleRefusee() {
        assertEquals(Verdict.UNREADABLE, ApkUpdatePolicy.verify(installed, 6, sha, sha, null))
    }

    @Test fun autrePaquetRefuse() {
        assertEquals(Verdict.WRONG_PACKAGE, ApkUpdatePolicy.verify(installed, 6, sha, sha, archive(packageName = "mg.nosytech.akaiky")))
    }

    @Test fun versionAnnonceeEtStrictementSuperieure() {
        assertEquals(Verdict.VERSION_MISMATCH, ApkUpdatePolicy.verify(installed, 7, sha, sha, archive(version = 6)))
        assertEquals(Verdict.NOT_NEWER, ApkUpdatePolicy.verify(installed, 5, sha, sha, archive(version = 5)))
        assertEquals(Verdict.NOT_NEWER, ApkUpdatePolicy.verify(installed, 4, sha, sha, archive(version = 4)))
    }

    @Test fun autreCertificatRefuse() {
        assertEquals(Verdict.WRONG_SIGNER, ApkUpdatePolicy.verify(installed, 6, sha, sha, archive(signers = Signers(setOf(certB), listOf(certB)))))
        // Signataire supplémentaire, ou aucun : refusé.
        assertEquals(Verdict.WRONG_SIGNER, ApkUpdatePolicy.verify(installed, 6, sha, sha, archive(signers = Signers(setOf(certA, certB)))))
        assertEquals(Verdict.WRONG_SIGNER, ApkUpdatePolicy.verify(installed, 6, sha, sha, archive(signers = Signers(emptySet()))))
    }

    @Test fun rotationDeCleDansLeBonSensSeulement() {
        // Nouvelle clé B dont l'historique contient la clé installée A : acceptée (Android l'accepte aussi).
        assertTrue(ApkUpdatePolicy.sameSigner(Signers(setOf(certA), listOf(certA)), Signers(setOf(certB), listOf(certA, certB))))
        // Archive signée par l'ANCIENNE clé A d'une app passée à B : refusée.
        assertFalse(ApkUpdatePolicy.sameSigner(Signers(setOf(certB), listOf(certA, certB)), Signers(setOf(certA), listOf(certA))))
        assertFalse(ApkUpdatePolicy.sameSigner(Signers(emptySet()), Signers(emptySet())))
    }

    @Test fun adresseHttpsSeuleSaufLocaleEnDebug() {
        assertEquals("https://akaiky.test/downloads/akaiky-enfant.apk", ApkUpdatePolicy.validUrl("https://akaiky.test/downloads/akaiky-enfant.apk", false))
        assertNull(ApkUpdatePolicy.validUrl("http://akaiky.test/a.apk", true))
        assertNull(ApkUpdatePolicy.validUrl("http://127.0.0.1:8099/a.apk", false))
        assertEquals("http://127.0.0.1:8099/a.apk", ApkUpdatePolicy.validUrl("http://127.0.0.1:8099/a.apk", true))
        assertNull(ApkUpdatePolicy.validUrl("file:///sdcard/a.apk", true))
        assertNull(ApkUpdatePolicy.validUrl("https://a b/x", false))
        assertNull(ApkUpdatePolicy.validUrl(null, false))
    }

    @Test fun empreinteEtTaille() {
        assertEquals(sha, ApkUpdatePolicy.validSha256(sha.uppercase()))
        assertNull(ApkUpdatePolicy.validSha256("c".repeat(63)))
        assertNull(ApkUpdatePolicy.validSha256("g".repeat(64)))
        assertTrue(ApkUpdatePolicy.sizeAccepted(-1))
        assertTrue(ApkUpdatePolicy.sizeAccepted(ApkUpdatePolicy.MAX_BYTES))
        assertFalse(ApkUpdatePolicy.sizeAccepted(ApkUpdatePolicy.MAX_BYTES + 1))
    }

    @Test fun fenetreReposeeAuDemarrageEtApresEchec() {
        val w = Window(openedElapsed = 10_000, boot = 3)
        // Aucune fenêtre : rien à faire.
        assertFalse(ApkUpdatePolicy.mustRestore(null, false, 20_000, 3))
        // Fenêtre retrouvée par un autre processus (app tuée, remplacée, résultat reçu) : reposée.
        assertTrue(ApkUpdatePolicy.mustRestore(w, false, 10_001, 3))
        // Processus qui installe, dans le délai : gardée ouverte, et Kiosk.enforce ne la repose pas.
        assertFalse(ApkUpdatePolicy.mustRestore(w, true, 10_000 + ApkUpdatePolicy.WINDOW_MS - 1, 3))
        assertTrue(ApkUpdatePolicy.installAllowedNow(w, true, 11_000, 3))
        // Délai dépassé, redémarrage, horloge repartie : reposée.
        assertTrue(ApkUpdatePolicy.mustRestore(w, true, 10_000 + ApkUpdatePolicy.WINDOW_MS, 3))
        assertTrue(ApkUpdatePolicy.mustRestore(w, true, 11_000, 4))
        assertTrue(ApkUpdatePolicy.mustRestore(w, true, 5_000, 3))
        assertFalse(ApkUpdatePolicy.installAllowedNow(w, false, 11_000, 3))
        assertFalse(ApkUpdatePolicy.installAllowedNow(null, true, 11_000, 3))
    }
}
