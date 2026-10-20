package com.cozyshelves.app

import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * window.AndroidBooks in the page (docs/CONTRACTS.md, "Android-App"). Every method runs on the WebView's bridge
 * thread; what touches the activity is posted to the main thread. The folder picker answers through
 * window.__cozyshelvesWeb.androidFolder({ requestId, key, name }) (null for key and name when cancelled).
 * Nothing here returns personal data: no paths, no account, no device identifiers.
 */
class BooksBridge(private val activity: MainActivity, private val folders: Folders) {
  @JavascriptInterface
  fun version(): String = BuildConfig.VERSION_NAME

  @JavascriptInterface
  fun info(): String = JSONObject()
    .put("version", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
    .put("sdk", Build.VERSION.SDK_INT).put("debug", BuildConfig.DEBUG).toString()

  /** The picked folders: [{ key, name, available }]. */
  @JavascriptInterface
  fun folders(): String {
    val arr = JSONArray()
    for (e in folders.all()) arr.put(JSONObject().put("key", e.key).put("name", e.name).put("available", folders.available(e.key)))
    return arr.toString()
  }

  @JavascriptInterface
  fun hasFolder(key: String): Boolean = folders.available(key)

  @JavascriptInterface
  fun folderName(key: String): String? = folders.get(key)?.name

  /** Opens the system's folder picker; the answer comes through androidFolder() with this request id. */
  @JavascriptInterface
  fun pickFolder(requestId: String) { activity.runOnUiThread { activity.pickFolder(requestId) } }

  @JavascriptInterface
  fun forgetFolder(key: String) { folders.forget(key) }

  /** All files of the folder as JSON [{ relPath, name, size, mtime }], null when it cannot be read. */
  @JavascriptInterface
  fun listFiles(key: String): String? = folders.listJson(key)

  @JavascriptInterface
  fun keepScreenOn(on: Boolean) { activity.runOnUiThread { activity.keepScreenOn(on) } }

  /** "landscape" (the world) or "any" (the reader may turn with the phone). */
  @JavascriptInterface
  fun setOrientation(mode: String) { activity.runOnUiThread { activity.setOrientationMode(mode) } }

  @JavascriptInterface
  fun openExternal(url: String) { activity.runOnUiThread { activity.openExternal(url) } }

  @JavascriptInterface
  fun vibrate(ms: Int) { activity.vibrate(ms) }

  /** The page has drawn its first picture: the start screen goes. */
  @JavascriptInterface
  fun ready() { activity.runOnUiThread { activity.hideSplash() } }

  /** "Quit" in the menu: the app goes to the background (Android has no quit of its own). */
  @JavascriptInterface
  fun exit() { activity.runOnUiThread { activity.moveTaskToBack(true) } }
}
