package com.cozyshelves.app

import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * The one screen of the app: a WebView with the web build of Cozy Shelves (assets/web, served from
 * https://appassets.androidplatform.net so that the page runs in a secure context), the books of the picked folders
 * under /books/ (BooksPathHandler), the bridge window.AndroidBooks (BooksBridge), the back button, the lifecycle.
 * The page itself does everything else: the world, the library, the reader, the touch controls.
 */
class MainActivity : ComponentActivity() {
  internal lateinit var webView: WebView
  private lateinit var splash: View
  internal lateinit var folders: Folders
  private val handler = Handler(Looper.getMainLooper())
  private var resumed = false
  private var pendingPick: String? = null
  private var fileChooser: ValueCallback<Array<Uri>>? = null
  internal var debugReceiver: BroadcastReceiver? = null

  // the system's folder picker (Storage Access Framework); the result goes back to the page
  private val pickTree = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
    val id = pendingPick ?: return@registerForActivityResult
    pendingPick = null
    var entry: Folders.Entry? = null
    if (uri != null) {
      try { entry = folders.add(uri) } catch (e: SecurityException) {
        Log.w(TAG, "folder permission refused", e)
        Toast.makeText(this, R.string.folder_denied, Toast.LENGTH_LONG).show()
      }
    }
    deliverPick(id, entry)
  }

  // <input type="file"> of the page (the easel's reference photo)
  private val chooseFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
    val cb = fileChooser ?: return@registerForActivityResult
    fileChooser = null
    cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
  }

  // JavaScript timers stop a moment after the page went to the background, once its flush had time to run
  private val pauseTimers = Runnable { if (!resumed) webView.pauseTimers() }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    immersive()
    setContentView(R.layout.activity_main)
    webView = findViewById(R.id.web)
    splash = findViewById(R.id.splash)
    folders = Folders(this)

    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    val assets = WebViewAssetLoader.Builder()
      .addPathHandler("/assets/", WebAssetsHandler(this))
      .addPathHandler("/books/", BooksPathHandler(folders))
      .build()

    webView.settings.apply {
      @Suppress("SetJavaScriptEnabled")
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      // the page reads its files through the asset loader and the books through /books/: no file:// at all
      allowFileAccess = false
      mediaPlaybackRequiresUserGesture = false
      cacheMode = WebSettings.LOAD_DEFAULT
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      useWideViewPort = true
      loadWithOverviewMode = true
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
      textZoom = 100
      userAgentString = userAgentString + " CozyShelves/" + BuildConfig.VERSION_NAME
    }
    webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
    webView.setBackgroundColor(Color.parseColor("#E3DCCF"))
    webView.isHapticFeedbackEnabled = false
    webView.addJavascriptInterface(BooksBridge(this, folders), "AndroidBooks")

    webView.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        assets.shouldInterceptRequest(request.url)

      // links to the outside open in the system's browser; the page itself stays in the WebView, and its own frames
      // (the reader's sections are blob: documents in iframes, pictures come as data:) load as they are: answering
      // true here cancels the navigation, which left the reader on "Opening book" for ever
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val u = request.url
        val scheme = u.scheme ?: ""
        if (!request.isForMainFrame || u.host == HOST || scheme == "blob" || scheme == "data" || scheme == "about") return false
        if (scheme == "http" || scheme == "https") openExternal(u.toString())
        return true
      }

      override fun onPageCommitVisible(view: WebView, url: String) {
        // the page draws its own loading screen from here on; the native one may go after a short overlap
        handler.postDelayed({ hideSplash() }, 600)
      }

      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        // the renderer died (out of memory, a graphics crash): the activity is built again with a fresh WebView
        Log.w(TAG, "render process gone, crashed=" + detail.didCrash())
        (view.parent as? android.view.ViewGroup)?.removeView(view)
        view.destroy()
        handler.post { recreate() }
        return true
      }
    }

    webView.webChromeClient = object : WebChromeClient() {
      override fun onConsoleMessage(m: ConsoleMessage): Boolean {
        val text = m.message() + " (" + m.sourceId().substringAfterLast('/') + ":" + m.lineNumber() + ")"
        when (m.messageLevel()) {
          ConsoleMessage.MessageLevel.ERROR -> Log.e(WEB_TAG, text)
          ConsoleMessage.MessageLevel.WARNING -> Log.w(WEB_TAG, text)
          else -> Log.i(WEB_TAG, text)
        }
        return true
      }

      override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
        fileChooser?.onReceiveValue(null)
        fileChooser = callback
        try { chooseFile.launch(params.createIntent()) } catch (e: ActivityNotFoundException) {
          fileChooser = null
          callback.onReceiveValue(null)
        }
        return true
      }
    }

    onBackPressedDispatcher.addCallback(this) { back() }
    DebugHooks.install(this)
    webView.loadUrl("https://$HOST/assets/web/index.html?platform=android")
  }

  // ---- the page's requests -----------------------------------------------------------------------------------------

  /** JavaScript in the page, the result (JSON) to `then` on the main thread. */
  fun evaluate(js: String, then: ((String) -> Unit)? = null) {
    runOnUiThread { webView.evaluateJavascript(js) { r -> then?.invoke(r ?: "null") } }
  }

  fun pickFolder(requestId: String) {
    if (pendingPick != null) { deliverPick(requestId, null); return }
    pendingPick = requestId
    try { pickTree.launch(null) } catch (e: ActivityNotFoundException) {
      pendingPick = null
      Toast.makeText(this, R.string.no_picker, Toast.LENGTH_LONG).show()
      deliverPick(requestId, null)
    }
  }

  internal fun deliverPick(requestId: String, entry: Folders.Entry?) {
    val o = JSONObject().put("requestId", requestId)
    if (entry != null) o.put("key", entry.key).put("name", entry.name) else o.put("key", JSONObject.NULL).put("name", JSONObject.NULL)
    evaluate("window.__cozyshelvesWeb && window.__cozyshelvesWeb.androidFolder && window.__cozyshelvesWeb.androidFolder($o)")
  }

  fun keepScreenOn(on: Boolean) {
    if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  fun setOrientationMode(mode: String) {
    requestedOrientation = if (mode == "any") ActivityInfo.SCREEN_ORIENTATION_FULL_USER else ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
  }

  fun openExternal(url: String) {
    val u = Uri.parse(url)
    if (u.scheme != "http" && u.scheme != "https") return
    try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: ActivityNotFoundException) {
      Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show()
    }
  }

  fun vibrate(ms: Int) {
    val d = ms.coerceIn(1, 400).toLong()
    try {
      val v: Vibrator = if (Build.VERSION.SDK_INT >= 31) (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
      else @Suppress("DEPRECATION") (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
      v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE))
    } catch (_: Exception) {}
  }

  fun hideSplash() {
    if (splash.visibility == View.GONE) return
    splash.animate().alpha(0f).setDuration(350).withEndAction { splash.visibility = View.GONE }.start()
  }

  // ---- back button, lifecycle --------------------------------------------------------------------------------------

  /** The page decides: a panel closes, the menu opens; on the start menu it says false and the app steps back. */
  private fun back() {
    evaluate("(function(){try{return !!(window.__app&&window.__app.back&&window.__app.back())}catch(e){return false}})()") { r ->
      if (r != "true") moveTaskToBack(true)
    }
  }

  override fun onResume() {
    super.onResume()
    resumed = true
    handler.removeCallbacks(pauseTimers)
    webView.resumeTimers()
    webView.onResume()
    immersive()
  }

  override fun onPause() {
    resumed = false
    // everything the page has not written yet (IndexedDB writes are gathered for 2.5 s) goes out now
    webView.evaluateJavascript("window.__cozyshelvesWeb&&window.__cozyshelvesWeb.flush&&window.__cozyshelvesWeb.flush()", null)
    // the page sees document.hidden and rests the world; the timers follow once the flush had its moment
    webView.onPause()
    handler.postDelayed(pauseTimers, 500)
    super.onPause()
  }

  override fun onDestroy() {
    debugReceiver?.let { try { unregisterReceiver(it) } catch (_: Exception) {} }
    debugReceiver = null
    handler.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) immersive()
  }

  /** Full screen: the bars hide and come back with a swipe; the picture runs under the notch. */
  private fun immersive() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
    if (Build.VERSION.SDK_INT >= 28) {
      window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES }
    }
  }

  companion object {
    const val TAG = "CozyShelves"
    const val WEB_TAG = "CozyWeb"
    const val HOST = "appassets.androidplatform.net"
  }
}
