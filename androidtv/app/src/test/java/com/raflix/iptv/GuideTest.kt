package com.raflix.iptv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** guide.js guideFromJson, parseXmltvTime, guideWindow, nowNext, guideByName, with the native reader. */
class GuideTest {

    private val guide = Guide()

    @Test
    fun xmltvTime() {
        assertEquals(1761376200000L, Guide.parseTime("20251025091000 +0200")) // 07:10 UTC
        assertEquals(1761383400000L, Guide.parseTime("20251025091000"))
        assertEquals(Long.MIN_VALUE, Guide.parseTime("yesterday"))
        assertEquals(Long.MIN_VALUE, Guide.parseTime(null))
    }

    @Test
    fun lightGuideWindow() {
        val json = """{"a": [[100, 200, "One"], [200, 300, "Two"], [900, 950, "Late"], "junk"], "b": []}"""
        val w = Guide.fromJson(json, 150_000, 400_000)
        assertEquals(listOf("One", "Two"), w["a"]!!.map { it.title })
        assertEquals(100_000L, w["a"]!![0].start)
        assertNull(w["b"])
    }

    @Test
    fun xmltvWindow() {
        val xml = """<?xml version="1.0"?><tv>
            <programme start="20250101100000 +0000" stop="20250101110000 +0000" channel="c1"><title lang="es">A &amp; B</title><desc>x</desc></programme>
            <programme start="20250101110000 +0000" stop="20250101120000 +0000" channel="c1"><title>Second</title></programme>
            <programme start="20250102110000 +0000" stop="20250102120000 +0000" channel="c1"><title>Tomorrow</title></programme>
            </tv>"""
        val from = Guide.parseTime("20250101103000 +0000")
        val w = Guide.fromXmltv(xml.byteInputStream(), from, from + 3 * 3600_000)
        assertEquals(listOf("A & B", "Second"), w["c1"]!!.map { it.title })
    }

    @Test
    fun nowAndNext() {
        val p = listOf(Programme(0, 100, "open-ended"), Programme(50, 80, "event"), Programme(100, 120, "after"))
        val (now, next) = guide.nowNext(p, 60)
        assertEquals("event", now!!.title)
        assertEquals("after", next!!.title) // the first to start after the one on
        val (none, first) = guide.nowNext(p, 130)
        assertNull(none)
        assertNull(first)
    }

    @Test
    fun programmesThroughAnotherCopyOfTheName() {
        val a = channel("La 1", tvgId = null)
        val b = channel("La 1", tvgId = "la1")
        assertEquals(emptyList<Programme>(), guide.programmesOf(a, listOf(a, b))) // no guide loaded yet
    }

    private fun channel(name: String, tvgId: String?) =
        Channel(name, "http://x/$name", 1, null, null, tvgId, null, emptyMap(), emptyMap())
}
