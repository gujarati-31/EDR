package com.edr.agent.crypto

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object EdrCrypto {
    private const val ALGORITHM = "AES/GCM/NoPadding"
    private const val KEY_ALGORITHM = "AES"
    private const val IV_LENGTH_BYTES = 12
    private const val TAG_LENGTH_BITS = 128
    private const val TAG_LENGTH_BYTES = 16

    // 4-byte magic marker 'EDR1' matching the central backend
    private val MAGIC_HEADER = byteArrayOf(0x45, 0x44, 0x52, 0x31)

    private val secureRandom = SecureRandom()

    // Default shared master secret; can be overridden via SyncPreferences
    var masterSecret: String = "edr-soc-defense-master-key-2026-secure-aes256"

    private fun getSecretKey(): SecretKey {
        val md = MessageDigest.getInstance("SHA-256")
        val keyBytes = md.digest(masterSecret.toByteArray(Charsets.UTF_8))
        return SecretKeySpec(keyBytes, KEY_ALGORITHM)
    }

    fun isEncrypted(data: ByteArray): Boolean {
        if (data.size < 32) return false
        return data[0] == MAGIC_HEADER[0] &&
               data[1] == MAGIC_HEADER[1] &&
               data[2] == MAGIC_HEADER[2] &&
               data[3] == MAGIC_HEADER[3]
    }

    /**
     * Encrypts byte array with AES-256-GCM.
     * Output format: [4 bytes 'EDR1'] + [12 bytes IV] + [16 bytes AuthTag + Ciphertext]
     */
    fun encrypt(plainBytes: ByteArray): ByteArray {
        val key = getSecretKey()
        val iv = ByteArray(IV_LENGTH_BYTES)
        secureRandom.nextBytes(iv)

        val cipher = Cipher.getInstance(ALGORITHM)
        val spec = GCMParameterSpec(TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, key, spec)

        val cipherWithTag = cipher.doFinal(plainBytes)

        // Note: Java/Android AES/GCM/NoPadding appends the 16-byte authentication tag
        // at the end of cipherWithTag.
        // We separate tag and ciphertext to match backend format:
        // [MAGIC 4B] + [IV 12B] + [TAG 16B] + [CIPHERTEXT (size - 16)]
        val cipherLen = cipherWithTag.size - TAG_LENGTH_BYTES
        val ciphertext = cipherWithTag.copyOfRange(0, cipherLen)
        val tag = cipherWithTag.copyOfRange(cipherLen, cipherWithTag.size)

        val result = ByteArray(MAGIC_HEADER.size + iv.size + tag.size + ciphertext.size)
        var offset = 0

        System.arraycopy(MAGIC_HEADER, 0, result, offset, MAGIC_HEADER.size)
        offset += MAGIC_HEADER.size

        System.arraycopy(iv, 0, result, offset, iv.size)
        offset += iv.size

        System.arraycopy(tag, 0, result, offset, tag.size)
        offset += tag.size

        System.arraycopy(ciphertext, 0, result, offset, ciphertext.size)

        return result
    }

    /**
     * Decrypts an AES-256-GCM encrypted byte array.
     */
    fun decrypt(encrypted: ByteArray): ByteArray {
        if (!isEncrypted(encrypted)) {
            return encrypted
        }

        val key = getSecretKey()
        val iv = encrypted.copyOfRange(4, 4 + IV_LENGTH_BYTES)
        val tag = encrypted.copyOfRange(4 + IV_LENGTH_BYTES, 4 + IV_LENGTH_BYTES + TAG_LENGTH_BYTES)
        val ciphertext = encrypted.copyOfRange(4 + IV_LENGTH_BYTES + TAG_LENGTH_BYTES, encrypted.size)

        // Android Cipher expects [CIPHERTEXT + TAG]
        val combined = ByteArray(ciphertext.size + tag.size)
        System.arraycopy(ciphertext, 0, combined, 0, ciphertext.size)
        System.arraycopy(tag, 0, combined, ciphertext.size, tag.size)

        val cipher = Cipher.getInstance(ALGORITHM)
        val spec = GCMParameterSpec(TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, key, spec)

        return cipher.doFinal(combined)
    }

    fun encryptBase64(plainBytes: ByteArray): String {
        val encrypted = encrypt(plainBytes)
        return Base64.encodeToString(encrypted, Base64.NO_WRAP)
    }

    fun decryptBase64(cipherBase64: String): ByteArray {
        val encrypted = Base64.decode(cipherBase64, Base64.NO_WRAP)
        return decrypt(encrypted)
    }
}

