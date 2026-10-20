package com.cozyshelves.app

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

/** Serves /books/<key>/<relPath> of https://appassets.androidplatform.net out of the picked folders (Folders.open). */
class BooksPathHandler(private val folders: Folders) : WebViewAssetLoader.PathHandler {
  override fun handle(path: String): WebResourceResponse {
    val slash = path.indexOf('/')
    if (slash <= 0 || slash == path.length - 1) return notFound()
    val opened = folders.open(path.substring(0, slash), path.substring(slash + 1)) ?: return notFound()
    val headers = mapOf("Content-Length" to opened.size.toString(), "Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
    return WebResourceResponse(opened.mime, null, 200, "OK", headers, opened.stream)
  }

  private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
}

/**
 * The web build in the assets (/assets/web/…), with the types the page depends on: the stock handler guesses them
 * from the name and answers "text/plain" for what it does not know, which a module script or a WebAssembly stream
 * refuses.
 */
class WebAssetsHandler(context: Context) : WebViewAssetLoader.PathHandler {
  private val inner = WebViewAssetLoader.AssetsPathHandler(context)

  override fun handle(path: String): WebResourceResponse? {
    val response = inner.handle(path) ?: return null
    val ext = path.substringAfterLast('/').substringAfterLast('.', "").lowercase()
    MIME[ext]?.let { response.mimeType = it }
    return response
  }

  companion object {
    private val MIME = mapOf(
      "html" to "text/html", "htm" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
      "json" to "application/json", "webmanifest" to "application/manifest+json", "wasm" to "application/wasm",
      "woff2" to "font/woff2", "woff" to "font/woff", "ttf" to "font/ttf", "otf" to "font/otf", "svg" to "image/svg+xml",
      "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "webp" to "image/webp", "txt" to "text/plain",
      "md" to "text/markdown", "bcmap" to "application/octet-stream", "pfb" to "application/octet-stream", "xml" to "application/xml",
    )
  }
}
