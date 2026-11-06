package com.raflix.iptv

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * This TV's playlist (BuildConfig.PLAYLIST_URL): downloaded first (URLs rotate: main.js freshChannels), the copy
 * kept on disk when that fails. The text is kept, not the channels: the guide's addresses are in its first line.
 */
class Playlist(context: Context) {

    private val cacheFile = File(context.filesDir, "playlist.m3u")

    @Volatile
    var text: String? = null
        private set

    /** Whether the last load came from the disk copy (the list may be stale: main.js showStaleCacheNotice). */
    var fromCache = false
        private set

    val channels: List<Channel> get() = text?.let { M3uParser.parse(it) } ?: emptyList()

    /** Up to `retries` re-downloads with a growing pause (utils.js fetchPlaylistWithRetry), then the disk copy. */
    suspend fun load(retries: Int = 2): List<Channel> = withContext(Dispatchers.IO) {
        var lastError: Exception? = null
        for (attempt in 0..retries) {
            if (attempt > 0) delay(1500L * attempt)
            try {
                val fresh = download(BuildConfig.PLAYLIST_URL)
                if (!fresh.contains("#EXTM3U")) throw IllegalStateException("not an M3U playlist")
                val list = M3uParser.parse(fresh)
                if (list.isEmpty()) throw IllegalStateException("empty playlist")
                cacheFile.writeText(fresh)
                text = fresh
                fromCache = false
                return@withContext list
            } catch (e: Exception) {
                lastError = e
            }
        }
        if (cacheFile.exists()) {
            val cached = cacheFile.readText()
            val list = M3uParser.parse(cached)
            if (list.isNotEmpty()) {
                text = cached
                fromCache = true
                return@withContext list
            }
        }
        throw lastError ?: IllegalStateException("no playlist")
    }

    companion object {
        const val USER_AGENT = "RAFLIX-IPTV/" + BuildConfig.VERSION_NAME + " (Android TV)"

        /** A text file over HTTP(S), redirects followed; throws on anything but 2xx. */
        fun download(address: String, timeoutMs: Int = 15000, headers: Map<String, String> = emptyMap()): String {
            var url = URL(address)
            repeat(5) {
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    connectTimeout = timeoutMs
                    readTimeout = timeoutMs
                    instanceFollowRedirects = false
                    setRequestProperty("User-Agent", USER_AGENT)
                    for ((k, v) in headers) setRequestProperty(k, v)
                }
                try {
                    val code = conn.responseCode
                    val location = conn.getHeaderField("Location")
                    if (code in 300..399 && location != null) {
                        url = URL(url, location)
                        return@repeat
                    }
                    if (code !in 200..299) throw IllegalStateException("server returned $code")
                    return conn.inputStream.bufferedReader().use { it.readText() }
                } finally {
                    conn.disconnect()
                }
            }
            throw IllegalStateException("too many redirects")
        }
    }
}
