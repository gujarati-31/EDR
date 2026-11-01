plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.edr.agent"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.edr.agent"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "2.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
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
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    // WorkManager for 11:00 PM Scheduled Delta Sync
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // OkHttp for REST uploads and persistent WebSockets
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // JSON handling
    implementation("com.google.code.gson:gson:2.11.0")
}

