# The page calls the bridge by name: its methods must survive R8.
-keepclassmembers class com.cozyshelves.app.BooksBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class com.cozyshelves.app.DebugBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
