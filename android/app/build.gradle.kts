// The Cozy Shelves app for Android: a WebView that shows the web build (dist/web, copied into src/main/assets/web by
// build/android.js) and serves the books of a folder the user picked. The version is the one of package.json.
//
// Signing: the release key lives OUTSIDE the repository. The build looks for a keystore.properties
// (storeFile, storePassword, keyAlias, keyPassword; storeFile relative to that file) at
//   1. $COZYSHELVES_SIGNING (a path to the properties file),
//   2. the Gradle property cozyshelves.signing (-Pcozyshelves.signing=…, or ~/.gradle/gradle.properties),
//   3. <repository>/.android-signing/keystore.properties (ignored by git),
// or at the environment variables COZYSHELVES_KEYSTORE_FILE, COZYSHELVES_KEYSTORE_PASSWORD, COZYSHELVES_KEY_ALIAS,
// COZYSHELVES_KEY_PASSWORD (CI). Without a key the release APK is built unsigned (app-release-unsigned.apk).
import groovy.json.JsonSlurper
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

val repoRoot: File = rootProject.projectDir.parentFile
val packageJson = JsonSlurper().parse(File(repoRoot, "package.json")) as Map<*, *>
val appVersion = packageJson["version"] as String
// 0.8.0 → 800, 1.2.3 → 10203: every release counts up
val appVersionCode = appVersion.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
  .let { (it.getOrElse(0) { 0 }) * 10000 + (it.getOrElse(1) { 0 }) * 100 + (it.getOrElse(2) { 0 }) }

val signingProps = Properties()
val signingFile: File? = listOfNotNull(
  System.getenv("COZYSHELVES_SIGNING"),
  project.findProperty("cozyshelves.signing") as String?,
  File(repoRoot, ".android-signing/keystore.properties").path,
).map { File(it) }.firstOrNull { it.isFile }
signingFile?.inputStream()?.use { signingProps.load(it) }
fun signingValue(key: String, env: String): String? = System.getenv(env) ?: signingProps.getProperty(key)
val keystoreFile: File? = signingValue("storeFile", "COZYSHELVES_KEYSTORE_FILE")?.let { p ->
  val f = File(p)
  if (f.isAbsolute) f else File(signingFile?.parentFile ?: repoRoot, p)
}
val hasReleaseKey = keystoreFile?.isFile == true && signingValue("storePassword", "COZYSHELVES_KEYSTORE_PASSWORD") != null

android {
  namespace = "com.cozyshelves.app"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.cozyshelves.app"
    minSdk = 26
    targetSdk = 35
    versionCode = appVersionCode
    versionName = appVersion
    // the page is the same in every language; the app's own strings are German and English
    resourceConfigurations += listOf("en", "de")
  }

  signingConfigs {
    if (hasReleaseKey) {
      create("release") {
        storeFile = keystoreFile
        storePassword = signingValue("storePassword", "COZYSHELVES_KEYSTORE_PASSWORD")
        // the alias of the release key, made when the app was still called Cozystacks (build/android-keystore.js)
        keyAlias = signingValue("keyAlias", "COZYSHELVES_KEY_ALIAS") ?: "cozystacks"
        keyPassword = signingValue("keyPassword", "COZYSHELVES_KEY_PASSWORD") ?: signingValue("storePassword", "COZYSHELVES_KEYSTORE_PASSWORD")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      if (hasReleaseKey) signingConfig = signingConfigs.getByName("release")
    }
    debug {
      isMinifyEnabled = false
    }
  }

  // the big files of the web build stay uncompressed in the APK: the WebView reads them straight from the archive
  androidResources {
    noCompress += listOf("wasm", "woff2", "woff", "ttf", "otf", "png", "jpg", "jpeg", "bcmap", "pfb")
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    buildConfig = true
  }

  packaging {
    resources.excludes += listOf("META-INF/*.version", "META-INF/LICENSE*", "META-INF/NOTICE*", "DebugProbesKt.bin")
  }

  lint {
    abortOnError = false
  }
}

kotlin {
  compilerOptions {
    jvmTarget.set(JvmTarget.JVM_17)
  }
}

dependencies {
  // WebViewAssetLoader (https://appassets.androidplatform.net, a secure context for the page)
  implementation("androidx.webkit:webkit:1.12.1")
  // the back-button dispatcher and the activity result contracts (the folder picker)
  implementation("androidx.activity:activity-ktx:1.9.3")
  implementation("androidx.core:core-ktx:1.15.0")
}

// the assets must hold the web build: build/android.js copies it; a plain Gradle run says what is missing
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
  doFirst {
    val web = File(projectDir, "src/main/assets/web/index.html")
    if (!web.isFile) throw GradleException("No web build in app/src/main/assets/web. Run `npm run build:android` in the repository (it runs the web build and copies dist/web here).")
  }
}
