package com.raflix.iptv

import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

/**
 * The left sidebar (ui.js): the groups, a group's channels, or the menu (the right sidebar there), one list at a
 * time, a highlighted row moved with the remote. It closes by itself after a while without a key (INACTIVITY_MS).
 */
class Sidebar(private val panel: View, private val title: TextView, private val list: RecyclerView, private val host: Host) {

    interface Host {
        fun groups(): List<Group>
        fun currentChannel(): Channel?
        fun nowOn(channel: Channel): String
        fun menuRows(): List<Row>
        fun onChannelChosen(channel: Channel)
        fun onMenuChosen(index: Int)
        fun groupsTitle(): String
        fun menuTitle(): String
        fun channelsCount(n: Int): String
    }

    enum class Mode { CLOSED, GROUPS, CHANNELS, MENU }

    var mode = Mode.CLOSED
        private set

    /** The group the channel list shows, and the one Channel Up/Down zap within (ui.js selectedGroup). */
    var selectedGroup: String = Groups.ALL
        private set

    private var displayChannels: List<Channel> = emptyList()
    private val adapter = RowAdapter()
    private val handler = Handler(Looper.getMainLooper())
    private val autoClose = Runnable { close() }

    init {
        list.layoutManager = LinearLayoutManager(list.context)
        list.adapter = adapter
        list.itemAnimator = null
    }

    val isOpen: Boolean get() = mode != Mode.CLOSED

    /** The channel under the highlight, in the channel list. */
    val focusedChannel: Channel? get() = if (mode == Mode.CHANNELS) displayChannels.getOrNull(adapter.focused) else null

    /** Open on the current group's channels, the one playing highlighted (ui.js toggleSidebar). */
    fun open() {
        showChannels(selectedGroup)
    }

    fun showChannels(group: String) {
        selectedGroup = group
        displayChannels = Groups.channelsOf(host.groups(), group)
        mode = Mode.CHANNELS
        title.text = group
        val current = host.currentChannel()
        val focus = displayChannels.indexOfFirst { it === current }.let { if (it >= 0) it else 0 }
        adapter.submit(channelRows(), focus)
        reveal(focus)
        show()
    }

    fun showGroups() {
        mode = Mode.GROUPS
        title.text = host.groupsTitle()
        val groups = host.groups()
        val focus = groups.indexOfFirst { it.name == selectedGroup }.let { if (it >= 0) it else 0 }
        adapter.submit(groupRows(), focus)
        reveal(focus)
        show()
    }

    fun showMenu() {
        mode = Mode.MENU
        title.text = host.menuTitle()
        adapter.submit(host.menuRows(), 0)
        reveal(0)
        show()
    }

    fun close() {
        handler.removeCallbacks(autoClose)
        mode = Mode.CLOSED
        panel.visibility = View.GONE
    }

    /** The highlight one row up or down, wrapping around. */
    fun move(step: Int) {
        val count = adapter.itemCount
        if (count == 0) return
        val next = (adapter.focused + step + count) % count
        adapter.setFocused(next)
        reveal(next)
    }

    /** The highlighted row: a group opens its channels, a channel plays, a menu entry acts. */
    fun select() {
        when (mode) {
            Mode.GROUPS -> host.groups().getOrNull(adapter.focused)?.let { showChannels(it.name) }
            Mode.CHANNELS -> focusedChannel?.let { host.onChannelChosen(it) }
            Mode.MENU -> host.onMenuChosen(adapter.focused)
            Mode.CLOSED -> {}
        }
    }

    /** Highlights a channel of the list on screen, if it's there (a number key tuned it). */
    fun focusChannel(channel: Channel) {
        if (mode != Mode.CHANNELS) return
        val idx = displayChannels.indexOfFirst { it === channel }
        if (idx >= 0) {
            adapter.setFocused(idx)
            reveal(idx)
        }
    }

    /** The guide or this TV's lists changed: the rows on screen follow, the highlight stays. */
    fun refresh() {
        when (mode) {
            Mode.CHANNELS -> {
                displayChannels = Groups.channelsOf(host.groups(), selectedGroup)
                adapter.submit(channelRows(), adapter.focused)
            }
            Mode.GROUPS -> adapter.submit(groupRows(), adapter.focused)
            Mode.MENU -> adapter.submit(host.menuRows(), adapter.focused)
            Mode.CLOSED -> {}
        }
    }

    /** A key was pressed while open: the auto-close waits again. */
    fun touch() {
        if (!isOpen) return
        handler.removeCallbacks(autoClose)
        handler.postDelayed(autoClose, INACTIVITY_MS)
    }

    private fun channelRows(): List<Row> {
        val current = host.currentChannel()
        return displayChannels.map { Row(it.number.toString(), it.name, host.nowOn(it), it === current) }
    }

    private fun groupRows(): List<Row> =
        host.groups().map { Row("", it.name, host.channelsCount(it.channels.size), it.name == selectedGroup) }

    private fun show() {
        panel.visibility = View.VISIBLE
        touch()
    }

    private fun reveal(index: Int) {
        list.post { RowAdapter.reveal(list, index) }
    }

    companion object {
        private const val INACTIVITY_MS = 8000L
    }
}
