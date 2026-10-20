package com.cozyshelves.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.File

/**
 * Debug builds only (the release variant has an empty DebugHooks): build/android-check.js drives the app through two
 * broadcasts and reads the answers in logcat under the tag CozyEval.
 *   am broadcast -a com.cozyshelves.app.EVAL --es id 7 --es js64 <base64 of JavaScript>   → "CozyEval: 7 <result JSON>"
 *   am broadcast -a com.cozyshelves.app.USE_FOLDER --es path /sdcard/Documents/Testbuecher → a plain folder as a
 *     books folder (the debug manifest asks for MANAGE_EXTERNAL_STORAGE; the check grants it with appops)
 * window.CozyDebug.result(id, json) answers for a promise's result.
 */
object DebugHooks {
  const val TAG = "CozyEval"

  fun install(activity: MainActivity) {
    activity.webView.addJavascriptInterface(DebugBridge(), "CozyDebug")
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
          "com.cozyshelves.app.EVAL" -> {
            val id = intent.getStringExtra("id") ?: "0"
            val js = intent.getStringExtra("js") ?: intent.getStringExtra("js64")?.let { String(Base64.decode(it, Base64.DEFAULT), Charsets.UTF_8) } ?: return
            activity.evaluate(js) { r -> Log.i(TAG, "$id $r") }
          }
          "com.cozyshelves.app.USE_FOLDER" -> {
            val path = intent.getStringExtra("path") ?: return
            val dir = File(path)
            if (!dir.isDirectory) { Log.w(TAG, "no such folder: $path"); return }
            val e = activity.folders.addDir(dir)
            val o = JSONObject().put("requestId", "debug").put("key", e.key).put("name", e.name)
            activity.evaluate("window.__cozyshelvesWeb&&window.__cozyshelvesWeb.androidFolder&&window.__cozyshelvesWeb.androidFolder($o)") { Log.i(TAG, "folder " + e.key + " " + it) }
          }
        }
      }
    }
    val filter = IntentFilter().apply { addAction("com.cozyshelves.app.EVAL"); addAction("com.cozyshelves.app.USE_FOLDER") }
    if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    else activity.registerReceiver(receiver, filter)
    activity.debugReceiver = receiver
  }
}

class DebugBridge {
  @JavascriptInterface
  fun result(id: String, json: String) { Log.i(DebugHooks.TAG, "$id $json") }
}
