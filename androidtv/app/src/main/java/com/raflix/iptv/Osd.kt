package com.raflix.iptv

import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import java.util.Calendar

/**
 * The on-screen messages (ui.js showChannelOsd, showNowNext, showTransientNotice, showBuffering, the error line):
 * one OSD box at the top left that the latest message takes over, a spinner in the middle while a channel loads, a
 * line at the bottom when it failed.
 */
class Osd(root: View) {

    private val box: View = root.findViewById(R.id.osd)
    private val title: TextView = root.findViewById(R.id.osd_title)
    private val line1: TextView = root.findViewById(R.id.osd_line1)
    private val line2: TextView = root.findViewById(R.id.osd_line2)
    private val loading: View = root.findViewById(R.id.loading)
    private val loadingText: TextView = root.findViewById(R.id.loading_text)
    private val errorLine: TextView = root.findViewById(R.id.error_line)
    private val handler = Handler(Looper.getMainLooper())
    private val hide = Runnable { box.visibility = View.GONE }

    /** A channel just started: its number and name, briefly. */
    fun showChannel(channel: Channel) {
        show(channel.number.toString() + "  " + channel.name, null, null, CHANNEL_MS)
    }

    /** What's on the channel now and next (nothing without a guide for it). */
    fun showNowNext(channel: Channel, now: Programme?, next: Programme?, nowLabel: String, nextLabel: String) {
        if (now == null && next == null) return
        show(
            channel.number.toString() + "  " + channel.name,
            now?.let { "$nowLabel  " + clock(it.start) + "–" + clock(it.end) + "  " + it.title },
            next?.let { "$nextLabel  " + clock(it.start) + "  " + it.title },
            NOW_NEXT_MS,
        )
    }

    fun notice(text: String, ms: Long = NOTICE_MS) = show(text, null, null, ms)

    fun loading(text: String?) {
        errorLine.visibility = View.GONE
        loadingText.text = text ?: ""
        loading.visibility = View.VISIBLE
    }

    fun hideLoading() {
        loading.visibility = View.GONE
    }

    fun error(text: String?) {
        loading.visibility = View.GONE
        errorLine.text = text ?: ""
        errorLine.visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    private fun show(head: String, first: String?, second: String?, ms: Long) {
        handler.removeCallbacks(hide)
        title.text = head
        line1.text = first ?: ""
        line1.visibility = if (first == null) View.GONE else View.VISIBLE
        line2.text = second ?: ""
        line2.visibility = if (second == null) View.GONE else View.VISIBLE
        box.visibility = View.VISIBLE
        handler.postDelayed(hide, ms)
    }

    companion object {
        private const val CHANNEL_MS = 2000L
        private const val NOW_NEXT_MS = 6000L
        private const val NOTICE_MS = 5000L

        fun clock(ms: Long): String {
            val c = Calendar.getInstance().apply { timeInMillis = ms }
            return String.format("%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
        }
    }
}
