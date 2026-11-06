package com.raflix.iptv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The cases of player/src/parse-m3u.test.js: the native reader must see the same channels. */
class M3uParserTest {

    @Test
    fun namesGroupsAndNumbers() {
        val ch = M3uParser.parse(
            "#EXTM3U\n#EXTINF:-1 tvg-chno=\"7\" group-title=\"News\",BBC News\nhttps://cdn.example.com/bbc.m3u8\n" +
                "#EXTINF:-1 group-title=\"Sports\",ESPN\nhttps://cdn.example.com/espn.m3u8\n",
        )
        assertEquals(2, ch.size)
        assertEquals("BBC News", ch[0].name)
        assertEquals("News", ch[0].group)
        assertEquals(7, ch[0].number)
        assertNull(ch[0].logo)
        assertEquals("https://cdn.example.com/bbc.m3u8", ch[0].url)
        assertEquals(2, ch[1].number)
    }

    @Test
    fun indexNumberAndNullGroup() {
        val ch = M3uParser.parse("#EXTM3U\n#EXTINF:-1,Plain\nhttps://x.example.com/a.ts\n")
        assertEquals("Plain", ch[0].name)
        assertNull(ch[0].group)
        assertEquals(Channel.UNGROUPED, ch[0].groupName)
        assertEquals(1, ch[0].number)
    }

    @Test
    fun commasInsideQuotedNames() {
        val ch = M3uParser.parse("#EXTM3U\n#EXTINF:-1 group-title=\"A\",Show, With, Commas\nhttps://x.example.com/a\n")
        assertEquals("Show, With, Commas", ch[0].name)
    }

    @Test
    fun kodipropStreamHeaders() {
        val ch = M3uParser.parse(
            "#EXTM3U\n#EXTINF:-1,Auth Channel\n" +
                "#KODIPROP:inputstream.adaptive.stream_headers=User-Agent=CustomUA&Referer=https%3A%2F%2Fsite.example%2F\n" +
                "https://x.example.com/live\n",
        )
        assertEquals("CustomUA", ch[0].userAgent)
        assertEquals("https://site.example/", ch[0].headers["Referer"])
    }

    @Test
    fun singleLicenseKey() {
        val ch = M3uParser.parse(
            "#EXTM3U\n#EXTINF:-1,DRM One\n#KODIPROP:inputstream.adaptive.license_key=abcdef1234567890:1234567890abcdef\n" +
                "https://x.example.com/cenc.mpd\n",
        )
        assertEquals(mapOf("abcdef1234567890" to "1234567890abcdef"), ch[0].clearKeys)
    }

    @Test
    fun multiKeyLicenseDict() {
        val ch = M3uParser.parse(
            "#EXTM3U\n#EXTINF:-1,DRM Multi\n" +
                "#KODIPROP:inputstream.adaptive.license_key={\"abcdef1234567890\":\"1234567890abcdef\",\"0011223344556677\":\"8899aabbccddeeff\"}\n" +
                "https://x.example.com/cenc.mpd\n",
        )
        assertEquals(2, ch[0].clearKeys.size)
        assertEquals("abcdef1234567890", ch[0].clearKeys.keys.first())
    }

    @Test
    fun cookieStaysAHeader() {
        val ch = M3uParser.parse(
            "#EXTM3U\n#EXTINF:-1,Token Channel\n#KODIPROP:inputstream.adaptive.stream_headers=Cookie=__hdnea__%3DSTV_TOKEN123\n" +
                "https://x.example.com/live.m3u8\n",
        )
        assertEquals("__hdnea__=STV_TOKEN123", ch[0].headers["Cookie"])
    }

    @Test
    fun pipeSuffix() {
        val ch = M3uParser.parse("#EXTM3U\n#EXTINF:-1,Pipe\nhttps://x.example.com/live|User-Agent=UA1&edge-token=ABC\n")
        assertEquals("https://x.example.com/live?edge-token=ABC", ch[0].url)
        assertEquals("UA1", ch[0].headers["user-agent"])
    }

    @Test
    fun drmLicenseInUrl() {
        val ch = M3uParser.parse("#EXTM3U\n#EXTINF:-1,Tok\nhttps://x.example.com/a.mpd?drmLicense=abcdef1234567890:1234567890abcdef\n")
        assertEquals(mapOf("abcdef1234567890" to "1234567890abcdef"), ch[0].clearKeys)
    }

    @Test
    fun exthttpAndVlcopt() {
        val ch = M3uParser.parse(
            "#EXTM3U\n#EXTINF:-1,Http\n#EXTHTTP:{\"Authorization\":\"******\"}\n#EXTVLCOPT:http-user-agent=VlcUA\nhttps://x.example.com/a\n",
        )
        assertEquals("******", ch[0].headers["Authorization"])
        assertEquals("VlcUA", ch[0].userAgent)
    }

    @Test
    fun commentsAndEntriesWithoutUrl() {
        val ch = M3uParser.parse("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:-1,No URL\n#EXTINF:-1,Has URL\nhttps://x.example.com/a\n")
        assertEquals(1, ch.size)
        assertEquals("Has URL", ch[0].name)
    }

    @Test
    fun garbage() {
        assertTrue(M3uParser.parse("not a playlist").isEmpty())
        assertTrue(M3uParser.parse("").isEmpty())
    }

    @Test
    fun logoAndTvgId() {
        val ch = M3uParser.parse("#EXTM3U\n#EXTINF:-1 tvg-id=\"es.tv1\" tvg-logo=\"http://x/l.png\" group-title=\"G\",Logo TV\nhttp://x/s.m3u8\n")
        assertEquals("http://x/l.png", ch[0].logo)
        assertEquals("es.tv1", ch[0].tvgId)
    }
}
