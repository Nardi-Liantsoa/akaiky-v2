package mg.nosytech.akaiky

/**
 * Règles de la mise à jour de l'app enfant sur le téléphone verrouillé (NAR-170), sans
 * dépendance Android : testées par ApkUpdatePolicyTest. ApkUpdate les applique avec
 * PackageManager, PackageInstaller et DevicePolicyManager.
 */
object ApkUpdatePolicy {
    /** Taille maximale téléchargée : au-delà, le fichier est refusé avant d'être lu en entier. */
    const val MAX_BYTES = 150L * 1024 * 1024

    /**
     * Fenêtre d'installation (restriction DISALLOW_INSTALL_APPS levée) : refermée par le
     * résultat de l'installation, et au plus tard après ce délai (alarme, démarrage de l'app).
     */
    const val WINDOW_MS = 5L * 60_000

    enum class Verdict {
        OK,
        /** SHA-256 du fichier différent de celui annoncé par le serveur. */
        SHA_MISMATCH,
        /** Archive illisible par PackageManager (tronquée, pas un APK). */
        UNREADABLE,
        WRONG_PACKAGE,
        /** versionCode de l'archive différent de celui annoncé. */
        VERSION_MISMATCH,
        /** versionCode pas strictement supérieur à la version installée. */
        NOT_NEWER,
        /** Certificat de signature différent de celui de l'app installée. */
        WRONG_SIGNER,
    }

    /**
     * Signataires, en SHA-256 hexadécimal minuscule. `current` : signataires actuels (plusieurs
     * seulement pour un APK à signataires multiples). `lineage` : historique de rotation de clé
     * (Android 9+, signataire unique), du plus ancien au actuel ; vide sinon.
     */
    data class Signers(val current: Set<String>, val lineage: List<String> = emptyList())

    data class Archive(val packageName: String, val versionCode: Long, val signers: Signers)

    data class Installed(val packageName: String, val versionCode: Long, val signers: Signers)

    /**
     * Signataire accepté : exactement les mêmes certificats actuels ; ou, pour une rotation de
     * clé (signataire unique des deux côtés), le certificat installé dans l'historique de la
     * nouvelle archive — la seule rotation qu'Android accepte lui-même. Jamais l'inverse (une
     * archive signée par une clé ANCIENNE de l'historique installé). Ensemble vide : refusé.
     */
    fun sameSigner(installed: Signers, archive: Signers): Boolean {
        if (installed.current.isEmpty() || archive.current.isEmpty()) return false
        if (installed.current == archive.current) return true
        return installed.current.size == 1 && archive.current.size == 1 && archive.lineage.contains(installed.current.first())
    }

    fun verify(installed: Installed, announcedVersion: Long, expectedSha256: String, fileSha256: String, archive: Archive?): Verdict = when {
        !fileSha256.equals(expectedSha256, ignoreCase = true) -> Verdict.SHA_MISMATCH
        archive == null -> Verdict.UNREADABLE
        archive.packageName != installed.packageName -> Verdict.WRONG_PACKAGE
        archive.versionCode != announcedVersion -> Verdict.VERSION_MISMATCH
        archive.versionCode <= installed.versionCode -> Verdict.NOT_NEWER
        !sameSigner(installed.signers, archive.signers) -> Verdict.WRONG_SIGNER
        else -> Verdict.OK
    }

    /** SHA-256 hexadécimal annoncé par le serveur (64 caractères). */
    fun validSha256(sha: String?): String? = sha?.trim()?.lowercase()?.takeIf { Regex("^[0-9a-f]{64}$").matches(it) }

    /**
     * Adresse du fichier : https seulement. Version de développement : aussi
     * http://127.0.0.1:<port>/ (adb reverse, réseau de debug seul, jamais dans l'APK distribué).
     */
    fun validUrl(url: String?, debug: Boolean): String? {
        val u = url?.trim() ?: return null
        if (u.isEmpty() || u.length > 2048 || u.any { it.isWhitespace() }) return null
        if (Regex("^https://[A-Za-z0-9.-]+(:\\d+)?/\\S*$").matches(u)) return u
        if (debug && Regex("^http://127\\.0\\.0\\.1:\\d+/\\S*$").matches(u)) return u
        return null
    }

    /** Taille annoncée (Content-Length, -1 si inconnue) acceptable avant téléchargement. */
    fun sizeAccepted(contentLength: Long): Boolean = contentLength <= MAX_BYTES

    /**
     * Fenêtre d'installation persistée : ouverte (restriction levée) à `openedElapsed`, pendant
     * le démarrage `boot`. Tant qu'elle existe, la restriction est à remettre.
     */
    data class Window(val openedElapsed: Long, val boot: Int)

    /**
     * Restriction à remettre maintenant ? Oui pour toute fenêtre gardée, sauf celle que CE
     * processus tient pour une installation en cours, et seulement dans son délai : un autre
     * processus (app tuée, mise à jour faite, redémarrage) ou un délai dépassé la referment.
     */
    fun mustRestore(window: Window?, heldByThisProcess: Boolean, nowElapsed: Long, boot: Int): Boolean {
        if (window == null) return false
        if (!heldByThisProcess) return true
        if (boot != window.boot || nowElapsed < window.openedElapsed) return true
        return nowElapsed - window.openedElapsed >= WINDOW_MS
    }

    /** Restriction d'installation tenue levée par cette installation, à ne pas reposer par Kiosk.enforce. */
    fun installAllowedNow(window: Window?, heldByThisProcess: Boolean, nowElapsed: Long, boot: Int): Boolean =
        window != null && heldByThisProcess && !mustRestore(window, true, nowElapsed, boot)
}
