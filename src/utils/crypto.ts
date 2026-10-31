import crypto from 'node:crypto'
import 'dotenv/config'

const ALGORITHM = 'aes-256-gcm'

// Get encryption key from env, fallback to a consistent development key if not set.
// A strong 32-byte key is required for aes-256.
const ENCRYPTION_KEY_STR = process.env.ENCRYPTION_KEY || 'a_very_insecure_dev_key_must_chg'

if (process.env.NODE_ENV === 'production' && ENCRYPTION_KEY_STR === 'a_very_insecure_dev_key_must_chg') {
  throw new Error('CRITICAL SECURITY ERROR: You must set a secure ENCRYPTION_KEY environment variable in production.')
}

const ENCRYPTION_KEY = crypto.scryptSync(ENCRYPTION_KEY_STR, 'salt', 32)

/**
 * Encrypts a plaintext secret into a format safe for DB storage.
 * Output format: iv:authTag:encryptedData (hex encoded)
 */
export function encryptSecret(plaintext: string): string {
  // Generate a random 12-byte initialization vector
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag().toString('hex')

  // Return IV, AuthTag, and Ciphertext concatenated by colons
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypts a secret that was encrypted by encryptSecret().
 */
export function decryptSecret(ciphertextStr: string): string {
  const parts = ciphertextStr.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted string format. Token may be legacy or corrupted.')
  }

  const [ivHex, authTagHex, encryptedHex] = parts
  const iv = Buffer.from(ivHex!, 'hex')
  const authTag = Buffer.from(authTagHex!, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedHex!, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
