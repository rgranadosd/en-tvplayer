package com.raflix.iptv

/** A playlist entry, as player/src/utils.js parseM3u builds it (channelNumber -> number). */
data class Channel(
    val name: String,
    val url: String,
    val number: Int,
    val group: String?,
    val logo: String?,
    val tvgId: String?,
    val userAgent: String?,
    val headers: Map<String, String>,
    /** ClearKey pairs, key id -> key, lower-case hex without dashes; empty when the channel isn't encrypted. */
    val clearKeys: Map<String, String>,
) {
    val groupName: String get() = group ?: UNGROUPED

    companion object {
        const val UNGROUPED = "Ungrouped"
    }
}

/** A guide programme: start and end in epoch ms, title (guide.js {s, e, t}). */
data class Programme(val start: Long, val end: Long, val title: String)
