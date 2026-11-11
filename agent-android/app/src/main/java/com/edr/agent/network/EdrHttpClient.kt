package com.edr.agent.network

import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Centralized shared OkHttpClient registry.
 *
 * Sharing one base client ensures a single ConnectionPool and Dispatcher thread pool across
 * the entire app instead of spawning 8 separate HTTP pools and keepalive thread sets.
 */
object EdrHttpClient {
    private val baseClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectionPool(ConnectionPool(4, 30, TimeUnit.SECONDS))
            .connectTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    /** Standard REST telemetry/upload client (15s connect, 30s read/write). */
    val apiClient: OkHttpClient
        get() = baseClient

    /** Short-timeout client for connection-status polling (3s connect/read). */
    val pollClient: OkHttpClient by lazy {
        baseClient.newBuilder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(3, TimeUnit.SECONDS)
            .build()
    }

    /** Longer-timeout client for video/large file uploads (30s connect, 60s write/read). */
    val uploadClient: OkHttpClient by lazy {
        baseClient.newBuilder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    /** Long-timeout client for OTA APK downloads. */
    val downloadClient: OkHttpClient by lazy {
        baseClient.newBuilder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build()
    }

    /** Persistent WebSocket client with 25s ping keepalive and infinite read timeout. */
    val wsClient: OkHttpClient by lazy {
        baseClient.newBuilder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
            .build()
    }
}
