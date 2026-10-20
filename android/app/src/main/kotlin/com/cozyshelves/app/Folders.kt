package com.cozyshelves.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/**
 * The folders of books the user picked (ACTION_OPEN_DOCUMENT_TREE): their tree URIs with a persisted read permission,
 * kept in SharedPreferences under a short key, listed through DocumentsContract and served file by file to the page
 * (BooksPathHandler). Nothing outside a picked folder is ever read: a file is found only through the listing of its
 * folder, never through a path the request made up.
 */
class Folders(context: Context) {
  /** A picked folder; `dir` is a plain directory, which only debug builds register (the test library). */
  class Entry(val key: String, val uri: Uri?, val name: String, val dir: File? = null)
  class Item(val relPath: String, val name: String, val size: Long, val mtime: Long, val docId: String?, val file: File?)
  class Opened(val stream: InputStream, val size: Long, val mime: String)

  private val app = context.applicationContext
  private val prefs = app.getSharedPreferences("folders", Context.MODE_PRIVATE)
  private val entries = LinkedHashMap<String, Entry>()
  // key → relPath → item, filled by list(): open() looks a file up here
  private val listings = HashMap<String, Map<String, Item>>()

  init { load() }

  @Synchronized private fun load() {
    entries.clear()
    val json = prefs.getString("list", null) ?: return
    try {
      val arr = JSONArray(json)
      for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        val key = o.getString("key")
        entries[key] = Entry(key, Uri.parse(o.getString("uri")), o.optString("name", ""))
      }
    } catch (e: Exception) { Log.w(TAG, "folder list unreadable", e) }
  }

  @Synchronized private fun save() {
    val arr = JSONArray()
    for (e in entries.values) if (e.uri != null) arr.put(JSONObject().put("key", e.key).put("uri", e.uri.toString()).put("name", e.name))
    prefs.edit().putString("list", arr.toString()).apply()
  }

  @Synchronized fun all(): List<Entry> = entries.values.toList()
  @Synchronized fun get(key: String): Entry? = entries[key]

  /** Is the folder still readable: the entry exists and the system still holds our persisted permission. */
  fun available(key: String): Boolean {
    val e = get(key) ?: return false
    if (e.dir != null) return e.dir.isDirectory
    val uri = e.uri ?: return false
    return app.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }
  }

  /** A folder from the picker: the permission is persisted and the entry kept across restarts. */
  @Synchronized fun add(uri: Uri): Entry {
    app.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    entries.values.firstOrNull { it.uri == uri }?.let { return it }
    val e = Entry(newKey(), uri, nameOf(uri))
    entries[e.key] = e
    save()
    return e
  }

  /** Debug builds only: a plain directory on the device. Not saved; it is gone with the process. */
  @Synchronized fun addDir(dir: File): Entry {
    entries.values.firstOrNull { it.dir == dir }?.let { return it }
    val e = Entry(newKey(), null, dir.name, dir)
    entries[e.key] = e
    return e
  }

  @Synchronized fun forget(key: String) {
    val e = entries.remove(key) ?: return
    listings.remove(key)
    save()
    val uri = e.uri ?: return
    if (entries.values.none { it.uri == uri }) {
      try { app.contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: SecurityException) {}
    }
  }

  private fun newKey(): String {
    var k: String
    do { k = "f" + java.lang.Long.toString(System.nanoTime() xor (Math.random() * 1e12).toLong(), 36).takeLast(8) } while (entries.containsKey(k))
    return k
  }

  private fun nameOf(uri: Uri): String {
    try {
      val docUri = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
      app.contentResolver.query(docUri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) { val n = c.getString(0); if (!n.isNullOrBlank()) return n }
      }
    } catch (_: Exception) {}
    // "primary:Books/Novels" → "Novels"
    val id = try { DocumentsContract.getTreeDocumentId(uri) } catch (_: Exception) { "" }
    return id.substringAfterLast('/').substringAfterLast(':').ifBlank { "Books" }
  }

  /** The files of a folder, at most MAX_DEPTH levels deep, hidden names skipped; null when the folder is unavailable. */
  fun list(key: String): List<Item>? {
    val e = get(key) ?: return null
    val out = ArrayList<Item>()
    try {
      if (e.dir != null) walkDir(e.dir, "", 0, out)
      else {
        val uri = e.uri ?: return null
        if (!available(key)) return null
        walkTree(uri, DocumentsContract.getTreeDocumentId(uri), "", 0, out)
      }
    } catch (ex: Exception) { Log.w(TAG, "folder unreadable: " + e.name, ex); return null }
    synchronized(this) { listings[key] = out.associateBy { it.relPath } }
    return out
  }

  private fun walkTree(tree: Uri, docId: String, prefix: String, depth: Int, out: MutableList<Item>) {
    if (depth > MAX_DEPTH) return
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
    val dirs = ArrayList<Pair<String, String>>()
    app.contentResolver.query(children, PROJECTION, null, null, null)?.use { c ->
      while (c.moveToNext()) {
        val id = c.getString(0) ?: continue
        val name = c.getString(1) ?: continue
        if (name.startsWith(".")) continue
        if ((c.getString(2) ?: "") == DocumentsContract.Document.MIME_TYPE_DIR) { dirs.add(id to name); continue }
        out.add(Item(prefix + name, name, if (c.isNull(3)) 0 else c.getLong(3), if (c.isNull(4)) 0 else c.getLong(4), id, null))
      }
    }
    for ((id, name) in dirs) walkTree(tree, id, "$prefix$name/", depth + 1, out)
  }

  private fun walkDir(dir: File, prefix: String, depth: Int, out: MutableList<Item>) {
    if (depth > MAX_DEPTH) return
    val files = dir.listFiles() ?: return
    for (f in files.sortedBy { it.name }) {
      if (f.name.startsWith(".")) continue
      if (f.isDirectory) walkDir(f, prefix + f.name + "/", depth + 1, out)
      else if (f.isFile) out.add(Item(prefix + f.name, f.name, f.length(), f.lastModified(), null, f))
    }
  }

  /** The JSON the page gets: [{ relPath, name, size, mtime }], or null when the folder is unavailable. */
  fun listJson(key: String): String? {
    val items = list(key) ?: return null
    val arr = JSONArray()
    for (it in items) arr.put(JSONObject().put("relPath", it.relPath).put("name", it.name).put("size", it.size).put("mtime", it.mtime))
    return arr.toString()
  }

  /** A file of a folder by the path of the listing (never by a path of its own making). */
  fun open(key: String, relPath: String): Opened? {
    val e = get(key) ?: return null
    var item = synchronized(this) { listings[key]?.get(relPath) }
    if (item == null) { list(key); item = synchronized(this) { listings[key]?.get(relPath) } }
    if (item == null) return null
    val mime = mimeOf(item.name)
    try {
      if (item.file != null) {
        val f = item.file
        if (!f.isFile) return null
        return Opened(FileInputStream(f), f.length(), mime)
      }
      val uri = e.uri ?: return null
      val docUri = DocumentsContract.buildDocumentUriUsingTree(uri, item.docId ?: return null)
      val stream = app.contentResolver.openInputStream(docUri) ?: return null
      return Opened(stream, item.size, mime)
    } catch (ex: Exception) { Log.w(TAG, "open failed: $relPath", ex); return null }
  }

  companion object {
    const val TAG = "CozyBooks"
    /** The same depth as the scanner of the desktop and the browser (electron/library/shelving.js MAX_DEPTH). */
    const val MAX_DEPTH = 8
    private val PROJECTION = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )
    private val MIME = mapOf(
      "epub" to "application/epub+zip", "pdf" to "application/pdf", "mobi" to "application/x-mobipocket-ebook",
      "azw" to "application/vnd.amazon.ebook", "azw3" to "application/vnd.amazon.ebook", "fb2" to "application/x-fictionbook+xml",
      "cbz" to "application/vnd.comicbook+zip", "txt" to "text/plain", "md" to "text/markdown", "html" to "text/html",
      "htm" to "text/html", "xhtml" to "application/xhtml+xml",
    )
    fun mimeOf(name: String): String {
      val ext = name.substringAfterLast('.', "").lowercase()
      return MIME[ext] ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }
  }
}
