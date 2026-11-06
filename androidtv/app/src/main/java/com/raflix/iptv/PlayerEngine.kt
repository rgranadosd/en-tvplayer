package com.raflix.iptv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.drm.DefaultDrmSessionManager
import androidx.media3.exoplayer.drm.DrmSessionManager
import androidx.media3.exoplayer.drm.FrameworkMediaDrm
import androidx.media3.exoplayer.drm.LocalMediaDrmCallback
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Playback (player.js, with ExoPlayer in place of Shaka): one channel at a time, its own User-Agent and headers,
 * ClearKey from the playlist's inline keys. A failure retries the same channel with a growing pause, a few times,
 * then gives up with a message (player.js lastResortDecision, forbiddenRetryDelay).
 */
@UnstableApi
class PlayerEngine(private val context: Context, private val view: PlayerView, private val listener: Listener) {

    interface Listener {
        fun onBuffering()
        fun onPlaying()
        fun onFailed(message: String)
        fun onRetry(attempt: Int)
    }

    private val handler = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var current: Channel? = null
    private var attempts = 0
    private var retry: Runnable? = null

    fun start(pictureFormat: Int) {
        view.useController = false
        view.setKeepContentOnPlayerReset(false)
        applyPictureFormat(pictureFormat)
    }

    /** Plays the channel from scratch; the same channel again is the reload. */
    fun tune(channel: Channel) {
        cancelRetry()
        current = channel
        attempts = 0
        open(channel)
    }

    fun togglePlay() {
        val p = player ?: return
        if (p.isPlaying) {
            p.pause()
        } else {
            if (p.playbackState == Player.STATE_IDLE) p.prepare()
            p.seekToDefaultPosition() // back to the live edge after a pause
            p.play()
        }
    }

    fun stop() {
        cancelRetry()
        current = null
        release()
    }

    /** 0 fit (black bars), 1 full screen (stretch), 2 zoom (crop): logic.js PICTURE_FORMATS auto/full/original. */
    fun applyPictureFormat(format: Int) {
        view.resizeMode = when (format) {
            1 -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            2 -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    fun release() {
        cancelRetry()
        player?.release()
        player = null
        view.player = null
    }

    private fun open(channel: Channel) {
        release()
        listener.onBuffering()
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(channel.userAgent ?: Playlist.USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(15000)
            .setDefaultRequestProperties(channel.headers.filterKeys { !it.equals("user-agent", true) })
        val sources = DefaultMediaSourceFactory(context).setDataSourceFactory(http)
        if (channel.clearKeys.isNotEmpty()) {
            val drm = clearKeyManager(channel.clearKeys)
            sources.setDrmSessionManagerProvider { drm }
        }
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(15000, 50000, 1500, 3000) // a quick start on an old TV, then a comfortable buffer
            .build()
        val p = ExoPlayer.Builder(context)
            .setMediaSourceFactory(sources)
            .setLoadControl(loadControl)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> listener.onBuffering()
                    Player.STATE_READY -> {
                        attempts = 0
                        listener.onPlaying()
                    }
                    Player.STATE_ENDED -> scheduleRetry(context.getString(R.string.stream_ended)) // a live stream never ends on purpose
                    else -> {}
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                scheduleRetry(describe(error))
            }
        })
        p.setMediaItem(MediaItem.fromUri(channel.url))
        p.playWhenReady = true
        p.prepare()
        player = p
        view.player = p
    }

    private fun scheduleRetry(reason: String) {
        val channel = current ?: return
        if (attempts >= MAX_ATTEMPTS) {
            listener.onFailed(reason)
            return
        }
        attempts++
        listener.onRetry(attempts)
        cancelRetry()
        val r = Runnable { if (current === channel) open(channel) }
        retry = r
        handler.postDelayed(r, RETRY_DELAYS_MS[minOf(attempts - 1, RETRY_DELAYS_MS.size - 1)])
    }

    private fun cancelRetry() {
        retry?.let { handler.removeCallbacks(it) }
        retry = null
    }

    private fun describe(error: PlaybackException): String = when (error.errorCode) {
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> context.getString(R.string.stream_refused, httpStatus(error))
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> context.getString(R.string.stream_connection_failed)
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED -> context.getString(R.string.stream_unsupported)
        PlaybackException.ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED,
        PlaybackException.ERROR_CODE_DRM_SCHEME_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DRM_UNSPECIFIED -> context.getString(R.string.stream_drm_failed)
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED -> context.getString(R.string.stream_unreadable)
        else -> context.getString(R.string.stream_failed, error.errorCode)
    }

    private fun httpStatus(error: PlaybackException): String {
        val cause = error.cause as? androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException ?: return ""
        return " (" + cause.responseCode + ")"
    }

    companion object {
        private const val MAX_ATTEMPTS = 5
        private val RETRY_DELAYS_MS = longArrayOf(1500, 3000, 5000, 8000, 12000)

        /** ClearKey with the playlist's keys: a JWK set answered locally, no license server. */
        fun clearKeyManager(keys: Map<String, String>): DrmSessionManager {
            val jwks = JSONArray()
            for ((kid, key) in keys) {
                jwks.put(JSONObject().put("kty", "oct").put("kid", base64Url(kid)).put("k", base64Url(key)))
            }
            val response = JSONObject().put("keys", jwks).put("type", "temporary").toString()
            return DefaultDrmSessionManager.Builder()
                .setUuidAndExoMediaDrmProvider(C.CLEARKEY_UUID, FrameworkMediaDrm.DEFAULT_PROVIDER)
                .setMultiSession(true)
                .build(LocalMediaDrmCallback(response.toByteArray()))
        }

        private fun base64Url(hex: String): String {
            val bytes = ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
            return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        }
    }
}
