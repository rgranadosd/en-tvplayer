package com.raflix.iptv

/** A sidebar group: "All Channels", this TV's two lists when they have something, then the playlist's, A-Z (ui.js extractGroups). */
data class Group(val name: String, val channels: List<Channel>)

object Groups {
    const val ALL = "All Channels"
    const val FAVORITES = "★ Favorites"
    const val RECENT = "Recently watched"

    fun build(channels: List<Channel>, favorites: List<String>, recent: List<String>): List<Group> {
        val own = listOf(FAVORITES to favorites, RECENT to recent)
            .map { (name, names) -> Group(name, channelsByName(channels, names)) }
            .filter { it.channels.isNotEmpty() }
        val real = channels.groupBy { it.groupName }.toSortedMap().map { (name, list) -> Group(name, list) }
        return listOf(Group(ALL, channels)) + own + real
    }

    /** The channels with these names, in the names' order: the first copy of each (logic.js channelsByName). */
    fun channelsByName(channels: List<Channel>, names: List<String>): List<Channel> =
        names.mapNotNull { name -> channels.firstOrNull { it.name == name } }

    /** The channels a group shows now (logic.js filterDisplayChannels); the whole list for an unknown group. */
    fun channelsOf(groups: List<Group>, groupName: String?): List<Channel> =
        groups.firstOrNull { it.name == groupName }?.channels ?: groups.first().channels
}
