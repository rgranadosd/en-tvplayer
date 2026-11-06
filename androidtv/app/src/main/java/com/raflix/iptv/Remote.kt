package com.raflix.iptv

import android.view.KeyEvent

/** What the remote's keys mean (remote.js), with Android TV key codes; null for a key the app doesn't use. */
enum class Action {
    UP, DOWN, LEFT, RIGHT, SELECT, BACK, CHANNEL_UP, CHANNEL_DOWN, PLAY_PAUSE, STOP, NEXT, PREV,
    RED, GREEN, YELLOW, BLUE, MENU, RELOAD, NUMBER
}

object Remote {
    fun actionOf(keyCode: Int): Action? = when (keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> Action.UP
        KeyEvent.KEYCODE_DPAD_DOWN -> Action.DOWN
        KeyEvent.KEYCODE_DPAD_LEFT -> Action.LEFT
        KeyEvent.KEYCODE_DPAD_RIGHT -> Action.RIGHT
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> Action.SELECT
        KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> Action.BACK
        KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> Action.CHANNEL_UP
        KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> Action.CHANNEL_DOWN
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_SPACE -> Action.PLAY_PAUSE
        KeyEvent.KEYCODE_MEDIA_STOP -> Action.STOP
        KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> Action.NEXT
        KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_REWIND -> Action.PREV
        KeyEvent.KEYCODE_PROG_RED -> Action.RED
        KeyEvent.KEYCODE_PROG_GREEN -> Action.GREEN
        KeyEvent.KEYCODE_PROG_YELLOW -> Action.YELLOW
        KeyEvent.KEYCODE_PROG_BLUE -> Action.BLUE
        KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_INFO -> Action.MENU
        KeyEvent.KEYCODE_R -> Action.RELOAD
        in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9, in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> Action.NUMBER
        else -> null
    }

    /** The digit of a NUMBER key. */
    fun digitOf(keyCode: Int): Int = when (keyCode) {
        in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> keyCode - KeyEvent.KEYCODE_0
        else -> keyCode - KeyEvent.KEYCODE_NUMPAD_0
    }
}
