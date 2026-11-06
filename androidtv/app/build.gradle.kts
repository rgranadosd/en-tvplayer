import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The app's version from the repository's package.json (the release script bumps it): 1.2.3 -> 10203.
val appVersion = ((JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>)["version"] as String)
val versionParts = appVersion.substringBefore('-').split('.').map { it.toInt() }

// This TV's playlist, from player/playlists.local.json (not in git: its URL carries a login), picked with
// RAFLIX_TV=<name>: the same rule as the Tizen builds. The build stops without it, with an unknown TV or an unfilled
// <…>, rather than ship another TV's login.
fun tvPlaylist(): Pair<String, String> {
    val file = rootProject.file("../player/playlists.local.json")
    if (!file.exists()) throw GradleException("player/playlists.local.json is missing: the app needs this TV's playlist")
    val data = JsonSlurper().parse(file) as Map<*, *>
    val tvs = (data["tvs"] as? Map<*, *>) ?: throw GradleException("playlists.local.json needs a list per TV ({\"tvs\": …})")
    val tv = System.getenv("RAFLIX_TV")
    val list = tvs[tv] as? List<*>
        ?: throw GradleException("playlists.local.json has a list per TV: build with RAFLIX_TV=" + tvs.keys.joinToString("|"))
    val entry = list.firstOrNull() as? Map<*, *> ?: throw GradleException("playlists.local.json: the $tv TV has no playlist")
    val url = entry["url"] as? String ?: ""
    if (url.isEmpty() || Regex("[<>]").containsMatchIn(url)) throw GradleException("playlists.local.json: fill in the $tv TV's login")
    return (entry["name"] as? String ?: "Raflix") to url
}

android {
    namespace = "com.raflix.iptv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.raflix.iptv"
        minSdk = 26
        targetSdk = 35
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
        versionName = appVersion

        val (playlistName, playlistUrl) = tvPlaylist()
        buildConfigField("String", "PLAYLIST_NAME", "\"$playlistName\"")
        buildConfigField("String", "PLAYLIST_URL", "\"$playlistUrl\"")
        buildConfigField("String", "TV_NAME", "\"${System.getenv("RAFLIX_TV")}\"")
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val media3 = "1.5.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-exoplayer-dash:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // the real org.json and XmlPull for the JVM tests (the SDK's are stubs there)
    testImplementation("net.sf.kxml:kxml2:2.3.0")
    testImplementation("xmlpull:xmlpull:1.1.3.1")
}
