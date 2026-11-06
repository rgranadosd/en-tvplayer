package com.raflix.iptv

import org.junit.Assert.assertEquals
import org.junit.Test

/** ui.js extractGroups and logic.js channelsByName: "All Channels", this TV's lists when they have something, then the playlist's groups A-Z. */
class GroupsTest {

    private fun ch(name: String, group: String?) = Channel(name, "http://x/$name", 1, group, null, null, null, emptyMap(), emptyMap())

    @Test
    fun allThenSortedGroups() {
        val list = listOf(ch("b", "Sports"), ch("a", "News"), ch("c", null), ch("a", "Events"))
        val names = Groups.build(list, emptyList(), emptyList()).map { it.name }
        assertEquals(listOf(Groups.ALL, "Events", "News", "Sports", Channel.UNGROUPED), names)
    }

    @Test
    fun ownListsComeFirstWhenTheyHaveSomething() {
        val list = listOf(ch("b", "Sports"), ch("a", "News"))
        val groups = Groups.build(list, listOf("a"), listOf("gone"))
        assertEquals(listOf(Groups.ALL, Groups.FAVORITES, "News", "Sports"), groups.map { it.name })
        assertEquals(listOf("a"), groups[1].channels.map { it.name })
    }

    @Test
    fun channelsByNameKeepsOrderAndFirstCopy() {
        val list = listOf(ch("b", "Sports"), ch("a", "News"), ch("a", "Events"))
        val out = Groups.channelsByName(list, listOf("a", "zzz", "b"))
        assertEquals(listOf("News", "Sports"), out.map { it.group })
    }

    @Test
    fun unknownGroupShowsEverything() {
        val list = listOf(ch("b", "Sports"), ch("a", "News"))
        val groups = Groups.build(list, emptyList(), emptyList())
        assertEquals(2, Groups.channelsOf(groups, "Nope").size)
        assertEquals(1, Groups.channelsOf(groups, "News").size)
    }
}
