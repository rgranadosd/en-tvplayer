package com.raflix.iptv

import android.content.Context
import org.json.JSONArray

/**
 * What this TV remembers (favorites.js, config.js): its favorites and recently watched channels by name, the channel
 * it was on (by URL: logic.js findResumeIndex), the picture format. SharedPreferences, like localStorage there.
 */
class TvLists(context: Context) {

    private val prefs = context.getSharedPreferences("raflix", Context.MODE_PRIVATE)

    val favorites: List<String> get() = read(FAVORITES)
    val recent: List<String> get() = read(RECENT)

    var lastChannelUrl: String?
        get() = prefs.getString(LAST_URL, null)
        set(value) = prefs.edit().putString(LAST_URL, value).apply()

    var pictureFormat: Int
        get() = prefs.getInt(PICTURE_FORMAT, 0)
        set(value) = prefs.edit().putInt(PICTURE_FORMAT, value).apply()

    fun isFavorite(channel: Channel) = favorites.contains(channel.name)

    /** Red key: the channel joins or leaves the favorites. True when it's a favorite now. */
    fun toggleFavorite(channel: Channel): Boolean {
        val names = favorites.toMutableList()
        val on = !names.remove(channel.name)
        if (on) names.add(channel.name)
        write(FAVORITES, names)
        return on
    }

    /** The channel just watched first in the recent list, without its earlier place; the oldest out past RECENT_MAX. */
    fun noteWatched(channel: Channel) {
        write(RECENT, (listOf(channel.name) + recent.filter { it != channel.name }).take(RECENT_MAX))
    }

    private fun read(key: String): List<String> = try {
        val arr = JSONArray(prefs.getString(key, "[]"))
        List(arr.length()) { arr.getString(it) }
    } catch (_: Exception) {
        emptyList()
    }

    private fun write(key: String, names: List<String>) {
        prefs.edit().putString(key, JSONArray(names).toString()).apply()
    }

    companion object {
        const val RECENT_MAX = 20
        private const val FAVORITES = "favorites"
        private const val RECENT = "recent"
        private const val LAST_URL = "last_channel_url"
        private const val PICTURE_FORMAT = "picture_format"
    }
}
