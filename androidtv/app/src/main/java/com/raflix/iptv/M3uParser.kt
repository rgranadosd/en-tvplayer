package com.raflix.iptv

import java.net.URLDecoder
import org.json.JSONObject

/**
 * The playlist reader, a port of player/src/utils.js (parseM3u, processStreamUrl, parseLicenseKeyValue,
 * parseStreamHeaders): the same channels from the same file. Unlike the browser, a native player sends any header,
 * so a Cookie stays a header instead of becoming a query string (extractAuthQuery).
 */
object M3uParser {

    private val GROUP = Regex("\\bgroup-title=\"([^\"]*)\"")
    private val LOGO = Regex("\\btvg-logo=\"([^\"]*)\"")
    private val TVG_ID = Regex("\\btvg-id=\"([^\"]*)\"")
    private val CHNO = Regex("\\btvg-chno=\"([^\"]*)\"")
    private val CHANNEL_NUMBER = Regex("\\bchannel-number=\"([^\"]*)\"")
    private val URL_DRM = Regex("[?&]drmLicense=([a-fA-F0-9-]+):([a-fA-F0-9-]+)")
    private val SINGLE_KEY = Regex("([a-fA-F0-9-]{16,}):([a-fA-F0-9-]{16,})")
    private val HEX = Regex("^[a-f0-9]+$")

    fun parse(text: String): List<Channel> {
        val lines = text.split('\n')
        val result = ArrayList<Channel>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            if (!line.startsWith("#EXTINF:")) {
                i++
                continue
            }
            val sep = nameSeparator(line)
            val name = if (sep >= 0) line.substring(sep + 1).trim() else "Canal " + (result.size + 1)
            val attrs = if (sep >= 0) line.substring(0, sep) else line
            var clearKeys: Map<String, String> = emptyMap()
            var userAgent: String? = null
            val headers = LinkedHashMap<String, String>()

            var urlIdx = i + 1
            while (urlIdx < lines.size) {
                val next = lines[urlIdx].trim()
                val lower = next.lowercase()
                when {
                    next.startsWith("#KODIPROP:") -> {
                        if (lower.contains("stream_headers=")) {
                            val raw = next.substring(next.indexOf("stream_headers=") + "stream_headers=".length)
                            val (h, ua) = parseStreamHeaders(raw)
                            headers.putAll(h)
                            if (ua != null && userAgent == null) userAgent = ua
                        } else if (lower.contains("license_key=")) {
                            val raw = next.substring(next.indexOf("license_key=") + "license_key=".length)
                            parseLicenseKeyValue(raw)?.let { clearKeys = it }
                        }
                    }
                    next.startsWith("#EXTSYS") -> {}
                    next.startsWith("#EXTVLCOPT:") -> {
                        Regex("http-user-agent=(.+)").find(next)?.let { userAgent = it.groupValues[1].trim() }
                    }
                    next.startsWith("#EXTHTTP:") -> {
                        try {
                            val json = JSONObject(next.substring("#EXTHTTP:".length))
                            headers.clear()
                            for (k in json.keys()) headers[k] = json.get(k).toString()
                        } catch (_: Exception) {}
                    }
                    else -> break
                }
                urlIdx++
            }
            val rawUrl = lines.getOrNull(urlIdx)?.trim() ?: ""
            if (rawUrl.isNotEmpty() && !rawUrl.startsWith("#")) {
                if (clearKeys.isEmpty()) {
                    URL_DRM.find(rawUrl)?.let { m ->
                        parseLicenseKeyValue(m.groupValues[1] + ":" + m.groupValues[2])?.let { clearKeys = it }
                    }
                }
                val (url, extraHeaders) = processStreamUrl(rawUrl)
                headers.putAll(extraHeaders)
                val chno = (CHNO.find(attrs) ?: CHANNEL_NUMBER.find(attrs))?.groupValues?.get(1)?.trim()?.toIntOrNull()
                result.add(
                    Channel(
                        name = name,
                        url = url,
                        number = if (chno != null && chno > 0) chno else result.size + 1,
                        group = GROUP.find(attrs)?.groupValues?.get(1),
                        logo = LOGO.find(attrs)?.groupValues?.get(1),
                        tvgId = TVG_ID.find(attrs)?.groupValues?.get(1)?.takeIf { it.isNotEmpty() },
                        userAgent = userAgent,
                        headers = headers,
                        clearKeys = clearKeys,
                    ),
                )
                i = urlIdx + 1
            } else {
                i = urlIdx
            }
        }
        return result
    }

    /** The comma between the EXTINF attributes and the name: the first one outside quotes. */
    private fun nameSeparator(line: String): Int {
        var inQuotes = false
        for (idx in line.indices) {
            when (line[idx]) {
                '"' -> inQuotes = !inQuotes
                ',' -> if (!inQuotes) return idx
            }
        }
        return -1
    }

    /** Kodi `stream_headers` (`Key=Val&…`, values may be URL-encoded): the headers and the User-Agent among them. */
    fun parseStreamHeaders(raw: String): Pair<Map<String, String>, String?> {
        val headers = LinkedHashMap<String, String>()
        var userAgent: String? = null
        for (part in raw.split('&')) {
            val eq = part.indexOf('=')
            if (eq == -1) continue
            val key = part.substring(0, eq).trim()
            if (key.isEmpty()) continue
            var value = part.substring(eq + 1).trim()
            try {
                value = URLDecoder.decode(value, "UTF-8") // '+' is a space here as in the browser
            } catch (_: Exception) {}
            headers[key] = value
            if (key.equals("user-agent", ignoreCase = true) && userAgent == null) userAgent = value
        }
        return headers to userAgent
    }

    /**
     * Kodi `license_key` ClearKey value: `KID:KEY`, `{KID1:KEY1,KID2:KEY2}` or `{"KID1":"KEY1"}`. Hex without dashes,
     * lower-case; null for none or a license-server URL.
     */
    fun parseLicenseKeyValue(raw: String): Map<String, String>? {
        val value = raw.trim()
        if (value.isEmpty() || value.startsWith("http")) return null
        if (value.startsWith("{")) {
            val pairs = LinkedHashMap<String, String>()
            try {
                val json = JSONObject(value)
                for (k in json.keys()) pairs[k] = json.getString(k)
            } catch (_: Exception) {
                for (pair in value.removePrefix("{").removeSuffix("}").split(',')) {
                    val colon = pair.indexOf(':')
                    if (colon == -1) continue
                    val k = pair.substring(0, colon).trim().trim('"')
                    val v = pair.substring(colon + 1).trim().trim('"')
                    if (k.isNotEmpty() && v.isNotEmpty()) pairs[k] = v
                }
            }
            val keys = LinkedHashMap<String, String>()
            for ((k, v) in pairs) {
                val kid = normalizeHex(k.trim('"'))
                val key = normalizeHex(v.trim('"'))
                if (isHex(kid) && isHex(key)) keys[kid] = key
            }
            return keys.takeIf { it.isNotEmpty() }
        }
        val single = SINGLE_KEY.find(value) ?: return null
        val kid = normalizeHex(single.groupValues[1])
        val key = normalizeHex(single.groupValues[2])
        return if (isHex(kid) && isHex(key)) mapOf(kid to key) else null
    }

    private fun normalizeHex(s: String) = s.replace("-", "").lowercase()

    private fun isHex(s: String) = s.length >= 16 && HEX.matches(s)

    /**
     * The Kodi pipe suffix (`|Key=Val&…`, or URL-encoded `%7C`) off the stream URL: it's player syntax, not part of
     * the request. `edge-*` entries go back as query parameters, the rest are headers; DRM directives are skipped.
     */
    fun processStreamUrl(rawUrl: String): Pair<String, Map<String, String>> {
        var pipe = rawUrl.indexOf('|')
        val enc = rawUrl.lowercase().indexOf("%7c")
        var delim = 1
        if (enc != -1 && (pipe == -1 || enc < pipe)) {
            pipe = enc
            delim = 3
        }
        if (pipe == -1) return rawUrl to emptyMap()
        var base = rawUrl.substring(0, pipe)
        if (base.endsWith("?")) base = base.dropLast(1)
        val headers = LinkedHashMap<String, String>()
        val params = ArrayList<String>()
        for (part in rawUrl.substring(pipe + delim).split('&')) {
            val eq = part.indexOf('=')
            if (eq == -1) continue
            val key = part.substring(0, eq)
            val value = part.substring(eq + 1)
            if (key.equals("drmscheme", true) || key.equals("drmlicense", true)) continue
            if (key.startsWith("edge-")) params.add("$key=$value") else headers[key.lowercase()] = value
        }
        val url = if (params.isEmpty()) base else base + (if (base.contains('?')) "&" else "?") + params.joinToString("&")
        return url to headers
    }
}
