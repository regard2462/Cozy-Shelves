package com.cozyshelves.app

/** Release builds: no broadcast receiver, no evaluation of foreign JavaScript, no plain folders. */
object DebugHooks {
  fun install(@Suppress("UNUSED_PARAMETER") activity: MainActivity) {}
}
