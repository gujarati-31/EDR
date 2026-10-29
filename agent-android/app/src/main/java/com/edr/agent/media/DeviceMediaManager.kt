package com.edr.agent.media

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.Size
import java.io.ByteArrayOutputStream
import java.io.InputStream

object DeviceMediaManager {
    private const val TAG = "DeviceMediaManager"

    data class MediaItem(
        val id: Long,
        val name: String,
        val type: String, // "IMAGE" | "VIDEO"
        val mimeType: String,
        val size: Long,
        val dateModified: Long,
        val width: Int,
        val height: Int,
        val duration: Long,
        val bucket: String,
        val thumbnail: String? = null
    )

    fun fetchMediaList(
        context: Context,
        typeFilter: String = "ALL", // "ALL", "IMAGE", "VIDEO"
        bucketFilter: String? = null,
        searchQuery: String? = null,
        offset: Int = 0,
        limit: Int = 60,
        includeThumbnails: Boolean = true
    ): Map<String, Any> {
        val allItems = mutableListOf<MediaItem>()
        val bucketCounts = mutableMapOf<String, Int>()
        var totalImages = 0
        var totalVideos = 0

        // 1. Query Images
        if (typeFilter == "ALL" || typeFilter == "IMAGE") {
            try {
                val projection = arrayOf(
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.MIME_TYPE,
                    MediaStore.Images.Media.SIZE,
                    MediaStore.Images.Media.DATE_MODIFIED,
                    MediaStore.Images.Media.WIDTH,
                    MediaStore.Images.Media.HEIGHT,
                    MediaStore.Images.Media.BUCKET_DISPLAY_NAME
                )

                val cursor = context.contentResolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    null,
                    null,
                    "${MediaStore.Images.Media.DATE_MODIFIED} DESC"
                )

                cursor?.use {
                    val idCol = it.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                    val nameCol = it.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                    val mimeCol = it.getColumnIndex(MediaStore.Images.Media.MIME_TYPE)
                    val sizeCol = it.getColumnIndex(MediaStore.Images.Media.SIZE)
                    val dateCol = it.getColumnIndex(MediaStore.Images.Media.DATE_MODIFIED)
                    val widthCol = it.getColumnIndex(MediaStore.Images.Media.WIDTH)
                    val heightCol = it.getColumnIndex(MediaStore.Images.Media.HEIGHT)
                    val bucketCol = it.getColumnIndex(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)

                    while (it.moveToNext()) {
                        val id = it.getLong(idCol)
                        val name = it.getString(nameCol) ?: "Unknown"
                        val mime = if (mimeCol >= 0) it.getString(mimeCol) ?: "image/jpeg" else "image/jpeg"
                        val size = if (sizeCol >= 0) it.getLong(sizeCol) else 0L
                        val date = if (dateCol >= 0) it.getLong(dateCol) * 1000L else 0L
                        val width = if (widthCol >= 0) it.getInt(widthCol) else 0
                        val height = if (heightCol >= 0) it.getInt(heightCol) else 0
                        val bucket = if (bucketCol >= 0) it.getString(bucketCol) ?: "Other" else "Other"

                        bucketCounts[bucket] = (bucketCounts[bucket] ?: 0) + 1
                        totalImages++

                        var matches = true
                        if (!bucketFilter.isNullOrBlank() && !bucket.equals(bucketFilter, ignoreCase = true)) {
                            matches = false
                        }
                        if (!searchQuery.isNullOrBlank() && !name.contains(searchQuery, ignoreCase = true)) {
                            matches = false
                        }

                        if (matches) {
                            allItems.add(
                                MediaItem(
                                    id = id,
                                    name = name,
                                    type = "IMAGE",
                                    mimeType = mime,
                                    size = size,
                                    dateModified = date,
                                    width = width,
                                    height = height,
                                    duration = 0L,
                                    bucket = bucket
                                )
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed querying image MediaStore: ${e.message}")
            }
        }

        // 2. Query Videos
        if (typeFilter == "ALL" || typeFilter == "VIDEO") {
            try {
                val projection = arrayOf(
                    MediaStore.Video.Media._ID,
                    MediaStore.Video.Media.DISPLAY_NAME,
                    MediaStore.Video.Media.MIME_TYPE,
                    MediaStore.Video.Media.SIZE,
                    MediaStore.Video.Media.DATE_MODIFIED,
                    MediaStore.Video.Media.WIDTH,
                    MediaStore.Video.Media.HEIGHT,
                    MediaStore.Video.Media.DURATION,
                    MediaStore.Video.Media.BUCKET_DISPLAY_NAME
                )

                val cursor = context.contentResolver.query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    null,
                    null,
                    "${MediaStore.Video.Media.DATE_MODIFIED} DESC"
                )

                cursor?.use {
                    val idCol = it.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
                    val nameCol = it.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
                    val mimeCol = it.getColumnIndex(MediaStore.Video.Media.MIME_TYPE)
                    val sizeCol = it.getColumnIndex(MediaStore.Video.Media.SIZE)
                    val dateCol = it.getColumnIndex(MediaStore.Video.Media.DATE_MODIFIED)
                    val widthCol = it.getColumnIndex(MediaStore.Video.Media.WIDTH)
                    val heightCol = it.getColumnIndex(MediaStore.Video.Media.HEIGHT)
                    val durCol = it.getColumnIndex(MediaStore.Video.Media.DURATION)
                    val bucketCol = it.getColumnIndex(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)

                    while (it.moveToNext()) {
                        val id = it.getLong(idCol)
                        val name = it.getString(nameCol) ?: "Unknown"
                        val mime = if (mimeCol >= 0) it.getString(mimeCol) ?: "video/mp4" else "video/mp4"
                        val size = if (sizeCol >= 0) it.getLong(sizeCol) else 0L
                        val date = if (dateCol >= 0) it.getLong(dateCol) * 1000L else 0L
                        val width = if (widthCol >= 0) it.getInt(widthCol) else 0
                        val height = if (heightCol >= 0) it.getInt(heightCol) else 0
                        val duration = if (durCol >= 0) it.getLong(durCol) else 0L
                        val bucket = if (bucketCol >= 0) it.getString(bucketCol) ?: "Other" else "Other"

                        bucketCounts[bucket] = (bucketCounts[bucket] ?: 0) + 1
                        totalVideos++

                        var matches = true
                        if (!bucketFilter.isNullOrBlank() && !bucket.equals(bucketFilter, ignoreCase = true)) {
                            matches = false
                        }
                        if (!searchQuery.isNullOrBlank() && !name.contains(searchQuery, ignoreCase = true)) {
                            matches = false
                        }

                        if (matches) {
                            allItems.add(
                                MediaItem(
                                    id = id,
                                    name = name,
                                    type = "VIDEO",
                                    mimeType = mime,
                                    size = size,
                                    dateModified = date,
                                    width = width,
                                    height = height,
                                    duration = duration,
                                    bucket = bucket
                                )
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed querying video MediaStore: ${e.message}")
            }
        }

        // Sort all items newest first
        allItems.sortByDescending { it.dateModified }

        val totalMatched = allItems.size
        val safeOffset = offset.coerceAtLeast(0)
        val safeLimit = limit.coerceIn(1, 100)
        val pageItems = if (safeOffset < totalMatched) {
            allItems.subList(safeOffset, (safeOffset + safeLimit).coerceAtMost(totalMatched))
        } else {
            emptyList()
        }

        // Generate thumbnails for the paginated slice only
        val finalizedItems = pageItems.map { item ->
            val thumb = if (includeThumbnails) generateThumbnail(context, item.id, item.type) else null
            mapOf(
                "id" to item.id.toString(),
                "name" to item.name,
                "type" to item.type,
                "mimeType" to item.mimeType,
                "size" to item.size,
                "dateModified" to item.dateModified,
                "width" to item.width,
                "height" to item.height,
                "duration" to item.duration,
                "bucket" to item.bucket,
                "thumbnail" to (thumb ?: "")
            )
        }

        return mapOf(
            "totalCount" to (totalImages + totalVideos),
            "totalMatched" to totalMatched,
            "totalImages" to totalImages,
            "totalVideos" to totalVideos,
            "offset" to safeOffset,
            "limit" to safeLimit,
            "buckets" to bucketCounts,
            "items" to finalizedItems
        )
    }

    private fun generateThumbnail(context: Context, id: Long, type: String): String? {
        return try {
            val uri = if (type == "VIDEO") {
                ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id)
            } else {
                ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
            }

            val bmp: Bitmap? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                context.contentResolver.loadThumbnail(uri, Size(140, 140), null)
            } else {
                if (type == "VIDEO") {
                    MediaStore.Video.Thumbnails.getThumbnail(
                        context.contentResolver, id,
                        MediaStore.Video.Thumbnails.MINI_KIND, null
                    )
                } else {
                    MediaStore.Images.Thumbnails.getThumbnail(
                        context.contentResolver, id,
                        MediaStore.Images.Thumbnails.MINI_KIND, null
                    )
                }
            }

            if (bmp != null) {
                val baos = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, 48, baos)
                bmp.recycle()
                "data:image/jpeg;base64," + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            } else null
        } catch (e: Exception) {
            null
        }
    }

    fun streamMediaFile(
        context: Context,
        mediaId: Long,
        mediaType: String,
        requestId: String,
        chunkSize: Int = 262144, // 256 KB per chunk
        sendChunk: (Map<String, Any>) -> Unit
    ) {
        val uri = if (mediaType.equals("VIDEO", ignoreCase = true)) {
            ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, mediaId)
        } else {
            ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, mediaId)
        }

        var inputStream: InputStream? = null
        try {
            var fileName = "media_$mediaId"
            var mimeType = if (mediaType.equals("VIDEO", ignoreCase = true)) "video/mp4" else "image/jpeg"
            var totalBytes = 0L

            val cursor = context.contentResolver.query(
                uri,
                arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE, MediaStore.MediaColumns.SIZE),
                null, null, null
            )
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIdx = it.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                    val mimeIdx = it.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                    val sizeIdx = it.getColumnIndex(MediaStore.MediaColumns.SIZE)
                    if (nameIdx >= 0) fileName = it.getString(nameIdx) ?: fileName
                    if (mimeIdx >= 0) mimeType = it.getString(mimeIdx) ?: mimeType
                    if (sizeIdx >= 0) totalBytes = it.getLong(sizeIdx)
                }
            }

            inputStream = context.contentResolver.openInputStream(uri)
            if (inputStream == null) {
                sendChunk(
                    mapOf(
                        "type" to "MEDIA_FILE_ERROR",
                        "requestId" to requestId,
                        "error" to "Unable to open input stream for media URI"
                    )
                )
                return
            }

            val buffer = ByteArray(chunkSize)
            var bytesRead: Int
            var chunkIndex = 0
            val estimatedChunks = if (totalBytes > 0) Math.ceil(totalBytes.toDouble() / chunkSize).toInt() else 1

            while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                val isLast = bytesRead < chunkSize || (totalBytes > 0 && (chunkIndex + 1) * chunkSize >= totalBytes)
                val chunkData = if (bytesRead == chunkSize) buffer else buffer.copyOf(bytesRead)
                val base64Data = Base64.encodeToString(chunkData, Base64.NO_WRAP)

                sendChunk(
                    mapOf(
                        "type" to "MEDIA_FILE_CHUNK",
                        "requestId" to requestId,
                        "mediaId" to mediaId.toString(),
                        "mimeType" to mimeType,
                        "fileName" to fileName,
                        "chunkIndex" to chunkIndex,
                        "totalChunks" to estimatedChunks,
                        "totalBytes" to totalBytes,
                        "dataBase64" to base64Data,
                        "isLast" to isLast
                    )
                )
                chunkIndex++
                if (isLast) break
            }

            // If file was empty
            if (chunkIndex == 0) {
                sendChunk(
                    mapOf(
                        "type" to "MEDIA_FILE_CHUNK",
                        "requestId" to requestId,
                        "mediaId" to mediaId.toString(),
                        "mimeType" to mimeType,
                        "fileName" to fileName,
                        "chunkIndex" to 0,
                        "totalChunks" to 1,
                        "totalBytes" to 0L,
                        "dataBase64" to "",
                        "isLast" to true
                    )
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error streaming media file: ${e.message}", e)
            sendChunk(
                mapOf(
                    "type" to "MEDIA_FILE_ERROR",
                    "requestId" to requestId,
                    "error" to (e.message ?: "Stream failed")
                )
            )
        } finally {
            try {
                inputStream?.close()
            } catch (ignored: Exception) {}
        }
    }
}

