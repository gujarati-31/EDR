package com.edr.agent.crypto

import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypts and locks sensitive EDR recordings or files locally on the phone
 * when server upload fails, preventing them from being viewed, played, or indexed
 * by Android Gallery.
 *
 * Password protection: "prit@312005"
 * Encryption: AES-256-CBC with PKCS5Padding, randomized salt and IV.
 */
object EdrFileLocker {

    private const val TAG = "EdrFileLocker"
    const val PASSWORD_EDR = "prit@312005"
    const val LOCKED_EXTENSION = ".locked"

    // 6-byte magic marker 'EDRLK1'
    private val MAGIC_HEADER = byteArrayOf(
        'E'.code.toByte(),
        'D'.code.toByte(),
        'R'.code.toByte(),
        'L'.code.toByte(),
        'K'.code.toByte(),
        '1'.code.toByte()
    )

    private const val SALT_LEN = 16
    private const val IV_LEN = 16
    private const val BUFFER_SIZE = 32 * 1024

    private val secureRandom = SecureRandom()

    private fun deriveKey(password: String, salt: ByteArray): SecretKeySpec {
        val md = MessageDigest.getInstance("SHA-256")
        md.update(salt)
        md.update(password.toByteArray(Charsets.UTF_8))
        val keyBytes = md.digest()
        return SecretKeySpec(keyBytes, "AES")
    }

    /**
     * Checks if a file is an encrypted EDR locked file by extension and magic header.
     */
    fun isLockedFile(file: File): Boolean {
        if (!file.exists() || !file.isFile || !file.name.endsWith(LOCKED_EXTENSION)) {
            return false
        }
        if (file.length() < (MAGIC_HEADER.size + SALT_LEN + IV_LEN)) {
            return false
        }
        return try {
            FileInputStream(file).use { fis ->
                val header = ByteArray(MAGIC_HEADER.size)
                val read = fis.read(header)
                read == MAGIC_HEADER.size && header.contentEquals(MAGIC_HEADER)
            }
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Locks an unencrypted file by encrypting it with AES-256 and saving as `<filename>.locked`.
     * Upon successful encryption, the original unencrypted file is securely deleted from the phone.
     *
     * @param inputFile The raw file (e.g. video.mp4)
     * @param password Password for encryption, defaults to "prit@312005"
     * @return The resulting locked File, or null if encryption failed.
     */
    @Synchronized
    fun lockFile(inputFile: File, password: String = PASSWORD_EDR): File? {
        if (!inputFile.exists() || inputFile.length() == 0L) {
            Log.w(TAG, "Input file does not exist or is empty: ${inputFile.absolutePath}")
            return null
        }

        val targetLockedFile = File(inputFile.parentFile, "${inputFile.name}$LOCKED_EXTENSION")
        val tempLockedFile = File(inputFile.parentFile, "${inputFile.name}.${System.currentTimeMillis()}.tmp_lock")

        try {
            val salt = ByteArray(SALT_LEN)
            secureRandom.nextBytes(salt)

            val iv = ByteArray(IV_LEN)
            secureRandom.nextBytes(iv)

            val keySpec = deriveKey(password, salt)
            val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, IvParameterSpec(iv))

            FileOutputStream(tempLockedFile).use { fos ->
                // 1. Write magic header
                fos.write(MAGIC_HEADER)
                // 2. Write salt
                fos.write(salt)
                // 3. Write IV
                fos.write(iv)

                // 4. Stream ciphertext via CipherOutputStream
                CipherOutputStream(fos, cipher).use { cos ->
                    FileInputStream(inputFile).use { fis ->
                        val buffer = ByteArray(BUFFER_SIZE)
                        var bytesRead: Int
                        while (fis.read(buffer).also { bytesRead = it } != -1) {
                            cos.write(buffer, 0, bytesRead)
                        }
                        cos.flush()
                    }
                }
            }

            // Replace target atomically
            if (targetLockedFile.exists()) {
                targetLockedFile.delete()
            }
            if (!tempLockedFile.renameTo(targetLockedFile)) {
                tempLockedFile.copyTo(targetLockedFile, overwrite = true)
                tempLockedFile.delete()
            }

            // Remove unencrypted original file immediately
            val deletedOriginal = inputFile.delete()
            Log.i(TAG, "Successfully locked file -> ${targetLockedFile.name} (original deleted: $deletedOriginal)")
            return targetLockedFile

        } catch (e: Exception) {
            Log.e(TAG, "Failed locking file ${inputFile.name}: ${e.message}", e)
            if (tempLockedFile.exists()) {
                tempLockedFile.delete()
            }
            return null
        }
    }

    /**
     * Unlocks an encrypted .locked file into an unencrypted destination file.
     *
     * @param lockedFile The encrypted .locked file
     * @param outputFile The destination file (e.g. video.mp4 in cacheDir)
     * @param password Password for decryption, defaults to "prit@312005"
     * @return true if decryption succeeded, false otherwise.
     */
    @Synchronized
    fun unlockToFile(lockedFile: File, outputFile: File, password: String = PASSWORD_EDR): Boolean {
        if (!lockedFile.exists() || lockedFile.length() < (MAGIC_HEADER.size + SALT_LEN + IV_LEN)) {
            Log.w(TAG, "Locked file does not exist or invalid size: ${lockedFile.absolutePath}")
            return false
        }

        val tempOut = File(outputFile.parentFile, "${outputFile.name}.${System.currentTimeMillis()}.tmp_unlock")

        try {
            FileInputStream(lockedFile).use { fis ->
                val header = ByteArray(MAGIC_HEADER.size)
                val readHeader = fis.read(header)
                if (readHeader != MAGIC_HEADER.size || !header.contentEquals(MAGIC_HEADER)) {
                    Log.e(TAG, "Invalid magic header in locked file ${lockedFile.name}")
                    return false
                }

                val salt = ByteArray(SALT_LEN)
                if (fis.read(salt) != SALT_LEN) {
                    Log.e(TAG, "Failed reading salt from locked file ${lockedFile.name}")
                    return false
                }

                val iv = ByteArray(IV_LEN)
                if (fis.read(iv) != IV_LEN) {
                    Log.e(TAG, "Failed reading IV from locked file ${lockedFile.name}")
                    return false
                }

                val keySpec = deriveKey(password, salt)
                val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
                cipher.init(Cipher.DECRYPT_MODE, keySpec, IvParameterSpec(iv))

                FileOutputStream(tempOut).use { fos ->
                    CipherInputStream(fis, cipher).use { cis ->
                        val buffer = ByteArray(BUFFER_SIZE)
                        var bytesRead: Int
                        while (cis.read(buffer).also { bytesRead = it } != -1) {
                            fos.write(buffer, 0, bytesRead)
                        }
                        fos.flush()
                    }
                }
            }

            if (outputFile.exists()) {
                outputFile.delete()
            }
            if (!tempOut.renameTo(outputFile)) {
                tempOut.copyTo(outputFile, overwrite = true)
                tempOut.delete()
            }

            Log.i(TAG, "Successfully unlocked file -> ${outputFile.name} (${outputFile.length()} bytes)")
            return true

        } catch (e: Exception) {
            Log.e(TAG, "Failed unlocking file ${lockedFile.name}: ${e.message}", e)
            if (tempOut.exists()) {
                tempOut.delete()
            }
            return false
        }
    }
}
