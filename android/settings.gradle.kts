// The Android app of Cozy Shelves: one module, the web build (dist/web) in its assets. See docs/strands/android.md.
pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}
rootProject.name = "CozyShelves"
include(":app")
