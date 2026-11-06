package com.raflix.iptv

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import com.raflix.iptv.databinding.ActivityMainBinding
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The app (main.js): the playlist, the channel playing, the remote; the sidebar and the OSD do the drawing. */
@UnstableApi
class MainActivity : AppCompatActivity(), Sidebar.Host, PlayerEngine.Listener {

    private lateinit var binding: ActivityMainBinding
    private lateinit var engine: PlayerEngine
    private lateinit var sidebar: Sidebar
    private lateinit var osd: Osd
    private lateinit var lists: TvLists
    private lateinit var playlist: Playlist
    private lateinit var session: AppSession
    private val guide = Guide()
    private val handler = Handler(Looper.getMainLooper())

    private var channels: List<Channel> = emptyList()
    private var groups: List<Group> = emptyList()
    private var current: Channel? = null
    private var nowNextPending = false
    private var numberBuffer = ""
    private val numberJump = Runnable { jumpToNumber() }
    private var lastBackAt = 0L
    private var exitDialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        hideSystemBars()
        lists = TvLists(this)
        playlist = Playlist(this)
        osd = Osd(binding.root)
        sidebar = Sidebar(binding.sidebar, binding.sidebarTitle, binding.sidebarList, this)
        engine = PlayerEngine(this, binding.playerView, this)
        engine.start(lists.pictureFormat)
        session = AppSession(this, engine, sidebar, osd, handler)
        loadPlaylist()
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) session.close()
    }

    private fun hideSystemBars() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    }

    private fun loadPlaylist() {
        osd.loading(getString(R.string.loading_playlist))
        lifecycleScope.launch {
            try {
                channels = playlist.load()
            } catch (_: Exception) {
                osd.error(getString(R.string.playlist_failed))
                return@launch
            }
            rebuildGroups()
            if (playlist.fromCache) osd.notice(getString(R.string.stale_cache))
            val resume = channels.firstOrNull { it.url == lists.lastChannelUrl } ?: channels.first()
            tune(resume)
            startGuide()
        }
    }

    /** First 10 s after a channel is up (never slowing it), then every 30 minutes (main.js startGuide). */
    private fun startGuide() {
        lifecycleScope.launch {
            delay(GUIDE_AFTER_MS)
            while (true) {
                if (guide.refresh(playlist.text)) sidebar.refresh()
                delay(GUIDE_EVERY_MS)
            }
        }
    }

    private fun rebuildGroups() {
        groups = Groups.build(channels, lists.favorites, lists.recent)
    }

    private fun tune(channel: Channel) {
        current = channel
        nowNextPending = true
        lists.noteWatched(channel)
        lists.lastChannelUrl = channel.url
        rebuildGroups()
        osd.error(null)
        osd.showChannel(channel)
        engine.tune(channel)
    }

    /** CH Up/Down: the adjacent channel in the group on screen, wrapping around (main.js zapChannel). */
    private fun zap(step: Int) {
        val list = Groups.channelsOf(groups, sidebar.selectedGroup)
        if (list.isEmpty()) return
        val idx = list.indexOf(current)
        tune(list[(idx + step + list.size) % list.size])
    }

    /** Blue key, or the menu: the channel from scratch (player.js reloadChannel). */
    private fun reload() {
        current?.let {
            osd.error(null)
            engine.tune(it)
        }
    }

    private fun jumpToNumber() {
        val number = numberBuffer.toIntOrNull()
        numberBuffer = ""
        if (number == null) return
        val channel = Groups.channelsOf(groups, sidebar.selectedGroup).firstOrNull { it.number == number }
            ?: channels.firstOrNull { it.number == number } ?: return
        tune(channel)
        if (sidebar.isOpen) sidebar.focusChannel(channel) else osd.showChannel(channel)
    }

    private fun toggleFavorite(channel: Channel?) {
        channel ?: return
        val on = lists.toggleFavorite(channel)
        osd.notice(getString(if (on) R.string.favorite_added else R.string.favorite_removed, channel.name), 2500)
        rebuildGroups()
        sidebar.refresh()
    }

    private fun cyclePictureFormat() {
        val names = resources.getStringArray(R.array.picture_formats)
        val next = (lists.pictureFormat + 1) % names.size
        lists.pictureFormat = next
        engine.applyPictureFormat(next)
        osd.notice(getString(R.string.picture_format, names[next]), 2500)
        sidebar.refresh()
    }

    private fun confirmExit() {
        if (exitDialog?.isShowing == true) return
        exitDialog = AlertDialog.Builder(this)
            .setMessage(R.string.exit_question)
            .setPositiveButton(R.string.exit) { _, _ -> session.close(returnHome = true) }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    override fun onBuffering() {
        osd.loading(getString(R.string.loading_channel, current?.name ?: ""))
    }

    override fun onPlaying() {
        osd.hideLoading()
        osd.error(null)
        val channel = current ?: return
        if (nowNextPending) {
            nowNextPending = false
            val (now, next) = guide.nowNext(guide.programmesOf(channel, channels), System.currentTimeMillis())
            osd.showNowNext(channel, now, next, getString(R.string.now), getString(R.string.next))
        }
    }

    override fun onRetry(attempt: Int) = osd.loading(getString(R.string.retrying, current?.name ?: "", attempt + 1))

    override fun onFailed(message: String) = osd.error(message)

    override fun groups() = groups
    override fun currentChannel() = current
    override fun groupsTitle(): String = getString(R.string.groups)
    override fun menuTitle(): String = getString(R.string.menu)
    override fun channelsCount(n: Int): String = getString(R.string.channels_count, n)

    override fun nowOn(channel: Channel): String =
        guide.nowNext(guide.programmesOf(channel, channels), System.currentTimeMillis()).first?.title ?: ""

    override fun menuRows(): List<Row> {
        val favorite = current?.let { lists.isFavorite(it) } ?: false
        val format = resources.getStringArray(R.array.picture_formats)[lists.pictureFormat]
        return listOf(
            Row("", getString(if (favorite) R.string.remove_favorite else R.string.add_favorite), ""),
            Row("", getString(R.string.picture_format, format), ""),
            Row("", getString(R.string.reload_channel), ""),
            Row("", getString(R.string.exit), ""),
        )
    }

    override fun onChannelChosen(channel: Channel) {
        sidebar.close()
        if (channel !== current) tune(channel)
    }

    override fun onMenuChosen(index: Int) {
        when (index) {
            0 -> {
                toggleFavorite(current)
                sidebar.refresh()
            }
            1 -> cyclePictureFormat()
            2 -> {
                sidebar.close()
                reload()
            }
            3 -> {
                sidebar.close()
                confirmExit()
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val action = Remote.actionOf(keyCode) ?: return super.onKeyDown(keyCode, event)
        if (action == Action.BACK) {
            val now = System.currentTimeMillis()
            if (now - lastBackAt < 600) return true
            lastBackAt = now
        }
        if (action == Action.NUMBER) {
            numberBuffer += Remote.digitOf(keyCode)
            handler.removeCallbacks(numberJump)
            handler.postDelayed(numberJump, NUMBER_MS)
            sidebar.touch()
            return true
        }
        if (sidebar.isOpen) {
            sidebar.touch()
            onSidebarKey(action)
        } else {
            onPlayerKey(action)
        }
        return true
    }

    private fun onSidebarKey(action: Action) {
        when (action) {
            Action.UP, Action.CHANNEL_DOWN -> sidebar.move(-1)
            Action.DOWN, Action.CHANNEL_UP -> sidebar.move(1)
            Action.SELECT -> sidebar.select()
            Action.BACK -> if (sidebar.mode == Sidebar.Mode.CHANNELS && sidebar.selectedGroup != Groups.ALL) sidebar.showGroups() else sidebar.close()
            Action.LEFT -> when (sidebar.mode) {
                Sidebar.Mode.CHANNELS -> sidebar.showGroups()
                else -> sidebar.close()
            }
            Action.RIGHT -> if (sidebar.mode == Sidebar.Mode.MENU) sidebar.close() else sidebar.showMenu()
            Action.MENU -> sidebar.close()
            Action.GREEN -> sidebar.showGroups()
            Action.RED -> toggleFavorite(sidebar.focusedChannel ?: current)
            Action.YELLOW -> cyclePictureFormat()
            Action.BLUE, Action.RELOAD -> reload()
            Action.PLAY_PAUSE -> engine.togglePlay()
            else -> {}
        }
    }

    private fun onPlayerKey(action: Action) {
        when (action) {
            Action.UP, Action.PREV, Action.CHANNEL_DOWN -> zap(-1)
            Action.DOWN, Action.NEXT, Action.CHANNEL_UP -> zap(1)
            Action.LEFT, Action.SELECT -> sidebar.open()
            Action.RIGHT, Action.MENU -> sidebar.showMenu()
            Action.GREEN -> sidebar.showGroups()
            Action.BACK -> confirmExit()
            Action.PLAY_PAUSE -> engine.togglePlay()
            Action.STOP -> {
                engine.stop()
                osd.hideLoading()
                osd.notice(getString(R.string.stopped))
                sidebar.open()
            }
            Action.RED -> toggleFavorite(current)
            Action.YELLOW -> cyclePictureFormat()
            Action.BLUE, Action.RELOAD -> reload()
            else -> {}
        }
    }

    companion object {
        private const val NUMBER_MS = 500L
        private const val GUIDE_AFTER_MS = 10_000L
        private const val GUIDE_EVERY_MS = 30 * 60_000L
    }
}
