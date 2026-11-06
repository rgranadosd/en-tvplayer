package com.raflix.iptv

import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.TimeZone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

/**
 * The programme guide the playlist names (guide.js, raflix-share.js refreshGuide): its light one when it has one
 * (x-raflix-epg: a JSON window), else the XMLTV (url-tvg), read as a stream so a 3 MB file never sits in memory.
 * The next GUIDE_HOURS kept, by guide id; a channel's programmes come through its tvg-id (the first copy of its name
 * that has one the guide knows: guide.js guideByName).
 */
class Guide {

    @Volatile
    private var window: Map<String, List<Programme>> = emptyMap()

    val size: Int get() = window.size

    /** A channel's programmes, by its own guide id or that of another copy of the same name in the list. */
    fun programmesOf(channel: Channel, channels: List<Channel>): List<Programme> {
        channel.tvgId?.let { window[it] }?.let { return it }
        for (c in channels) {
            if (c.name == channel.name && c.tvgId != null) window[c.tvgId]?.let { return it }
        }
        return emptyList()
    }

    /** The programme on at `now` (of overlapping ones, the latest to start) and the first to start after it. */
    fun nowNext(programmes: List<Programme>, now: Long): Pair<Programme?, Programme?> {
        var on: Programme? = null
        for (p in programmes) if (p.start <= now && now < p.end) on = p
        val after = on?.end ?: now
        val next = programmes.firstOrNull { it !== on && it.start >= after && it.start > now }
        return on to next
    }

    /** Reads the guide the playlist text names; false when there is none or it failed (the last one is kept). */
    suspend fun refresh(m3uText: String?): Boolean = withContext(Dispatchers.IO) {
        val first = (m3uText ?: "").take(4000).substringBefore('\n')
        val now = System.currentTimeMillis()
        val until = now + GUIDE_HOURS * 3600_000L
        val light = Regex("\\bx-raflix-epg=\"([^\"]+)\"").find(first)?.groupValues?.get(1)?.trim()
        val xmltv = Regex("(?:url-tvg|x-tvg-url)=\"([^\"]+)\"").find(first)?.groupValues?.get(1)?.split(',')?.first()?.trim()
        val next = light?.let { runCatching { fromJson(Playlist.download(it, 20000), now, until) }.getOrNull() }
            ?: xmltv?.let { runCatching { open(it) { stream -> fromXmltv(stream, now, until) } }.getOrNull() }
            ?: return@withContext false
        window = next
        true
    }

    companion object {
        const val GUIDE_HOURS = 12

        /** {tvg-id: [[start, stop, title]]} (Unix seconds) -> the programmes overlapping from..until, by start. */
        fun fromJson(text: String, from: Long, until: Long): Map<String, List<Programme>> {
            val data = JSONObject(text)
            val out = HashMap<String, List<Programme>>()
            for (id in data.keys()) {
                val arr = data.optJSONArray(id) ?: continue
                val list = ArrayList<Programme>()
                for (i in 0 until arr.length()) {
                    val p = arr.optJSONArray(i) ?: continue
                    if (p.length() < 3 || p.opt(0) !is Number || p.opt(1) !is Number || p.opt(2) !is String) continue
                    val s = p.getLong(0) * 1000
                    val e = p.getLong(1) * 1000
                    if (e > from && s < until) list.add(Programme(s, e, p.getString(2)))
                }
                if (list.isNotEmpty()) out[id] = list.sortedBy { it.start }
            }
            return out
        }

        /** An XMLTV stream's programmes overlapping from..until, by channel id, by start. */
        fun fromXmltv(stream: InputStream, from: Long, until: Long): Map<String, List<Programme>> {
            val parser = XmlPullParserFactory.newInstance().newPullParser()
            parser.setInput(stream, null)
            val out = HashMap<String, MutableList<Programme>>()
            var id: String? = null
            var start = 0L
            var end = 0L
            var inProgramme = false
            var title: String? = null
            var event = parser.eventType
            while (event != XmlPullParser.END_DOCUMENT) {
                when (event) {
                    XmlPullParser.START_TAG -> when (parser.name) {
                        "programme" -> {
                            id = parser.getAttributeValue(null, "channel")
                            start = parseTime(parser.getAttributeValue(null, "start"))
                            end = parseTime(parser.getAttributeValue(null, "stop"))
                            inProgramme = id != null && start != Long.MIN_VALUE && end != Long.MIN_VALUE && end > from && start < until
                            title = null
                        }
                        "title" -> if (inProgramme && title == null) title = parser.nextText().trim()
                    }
                    XmlPullParser.END_TAG -> if (parser.name == "programme" && inProgramme) {
                        out.getOrPut(id!!) { ArrayList() }.add(Programme(start, end, title ?: ""))
                        inProgramme = false
                    }
                }
                event = parser.next()
            }
            for (list in out.values) list.sortBy { it.start }
            return out
        }

        /** "20261025091000 +0200" -> epoch ms (UTC without an offset); Long.MIN_VALUE when it isn't one. */
        fun parseTime(s: String?): Long {
            val m = Regex("^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})\\s*(?:([+-])(\\d{2}):?(\\d{2}))?").find(s ?: "")
                ?: return Long.MIN_VALUE
            val g = m.groupValues
            val cal = java.util.GregorianCalendar(TimeZone.getTimeZone("UTC"))
            cal.clear()
            cal.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
            val offsetMin = if (g[7].isEmpty()) 0 else (if (g[7] == "-") -1 else 1) * (g[8].toInt() * 60 + g[9].toInt())
            return cal.timeInMillis - offsetMin * 60_000L
        }

        private fun <T> open(address: String, read: (InputStream) -> T): T {
            val conn = (URL(address).openConnection() as HttpURLConnection).apply {
                connectTimeout = 20000
                readTimeout = 20000
                setRequestProperty("User-Agent", Playlist.USER_AGENT)
            }
            try {
                if (conn.responseCode !in 200..299) throw IllegalStateException("server returned " + conn.responseCode)
                val raw = conn.inputStream.buffered()
                val stream = if (address.substringBefore('?').endsWith(".gz")) java.util.zip.GZIPInputStream(raw) else raw
                return stream.use(read)
            } finally {
                conn.disconnect()
            }
        }
    }
}
