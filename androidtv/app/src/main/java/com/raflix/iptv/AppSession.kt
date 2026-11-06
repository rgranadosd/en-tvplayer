package com.raflix.iptv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Process
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import kotlinx.coroutines.cancel

/** Leaving the app or putting the TV to sleep ends this session, not a resumable player task. */
@UnstableApi
class AppSession(
    private val activity: AppCompatActivity,
    private val engine: PlayerEngine,
    private val sidebar: Sidebar,
    private val osd: Osd,
    private val handler: Handler,
) {
    private var closed = false
    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF) close(returnHome = true)
        }
    }

    init {
        activity.registerReceiver(screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF))
    }

    fun close(returnHome: Boolean = false) {
        if (closed) return
        closed = true
        activity.unregisterReceiver(screenOff)
        activity.lifecycleScope.cancel()
        handler.removeCallbacksAndMessages(null)
        sidebar.close()
        osd.close()
        engine.stop()
        if (returnHome) {
            activity.startActivity(Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            })
        }
        activity.finishAndRemoveTask()
        // Cancellation alone cannot interrupt blocking HTTP reads; end only our own process as requested.
        Process.killProcess(Process.myPid())
    }
}
