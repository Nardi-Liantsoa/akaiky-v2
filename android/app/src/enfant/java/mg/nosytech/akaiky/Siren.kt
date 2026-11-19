package mg.nosytech.akaiky

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Log
import kotlin.math.PI
import kotlin.math.sign
import kotlin.math.sin

/**
 * Sirène du SOS (NAR-151) : son synthétisé ici (balayage 650 → 1350 Hz aller-retour en
 * une seconde, onde à moitié carrée pour porter loin), aucun fichier ni droit d'auteur.
 * Flux « alarme » poussé au maximum (le volume d'avant est rendu à l'arrêt) : sonne même
 * téléphone en silencieux. Mise en pause pendant un appel (on ne s'entendrait pas).
 */
class Siren(context: Context) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var track: AudioTrack? = null
    private var previousVolume = -1
    var playing = false
        private set
    private var stopped = false
    val isStopped get() = stopped

    fun start() {
        if (track != null || stopped) return
        try {
            previousVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
            audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            val pcm = samples()
            val t = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(pcm.size * 2)
                .build()
            t.write(pcm, 0, pcm.size)
            t.setLoopPoints(0, pcm.size, -1)
            t.play()
            track = t
            playing = true
            Log.i(TAG, "Sirène lancée")
        } catch (e: Exception) {
            Log.w(TAG, "Sirène impossible", e)
        }
    }

    fun pause() {
        if (!playing) return
        try { track?.pause() } catch (e: Exception) { }
        playing = false
    }

    fun resume() {
        if (stopped || playing || track == null) return
        try { track?.play(); playing = true } catch (e: Exception) { }
    }

    fun stop() {
        if (stopped) return
        stopped = true
        playing = false
        try { track?.stop() } catch (e: Exception) { }
        track?.release()
        track = null
        if (previousVolume >= 0) try { audio.setStreamVolume(AudioManager.STREAM_ALARM, previousVolume, 0) } catch (e: Exception) { }
        Log.i(TAG, "Sirène arrêtée")
    }

    private fun samples(): ShortArray {
        val n = RATE
        val out = ShortArray(n)
        var phase = 0.0
        for (i in 0 until n) {
            val x = i.toDouble() / n
            val f = 650 + 700 * (if (x < 0.5) x * 2 else (1 - x) * 2)
            phase += 2 * PI * f / RATE
            val s = sin(phase)
            out[i] = ((0.6 * sign(s) + 0.4 * s) * 0.9 * Short.MAX_VALUE).toInt().toShort()
        }
        return out
    }

    companion object {
        private const val TAG = "AkaikySos"
        private const val RATE = 22050
    }
}
