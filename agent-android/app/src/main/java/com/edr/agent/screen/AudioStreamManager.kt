package com.edr.agent.screen

import android.content.Context

/**
 * Audio streaming is disabled in this build.
 * All methods are no-ops — only live screen mirroring is active.
 */
object AudioStreamManager {
    fun startStreaming(context: Context) {
        // Audio disabled — screen-only streaming mode
    }

    fun stopStreaming() {
        // Audio disabled — no-op
    }
}
