import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decrypt(data: Buffer, key: Buffer): string {
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid ciphertext: too short");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function generateKey(): Buffer {
  return crypto.randomBytes(32);
}

/**
 * Derive a 32-byte encryption key from a hex-encoded string.
 * Accepts a 64-character hex string (32 bytes).
 * Falls back to UTF-8 truncation for backward compatibility with non-hex keys.
 */
export function deriveEncryptionKey(keyString: string): Buffer {
  // Prefer hex-encoded keys (64 hex chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(keyString)) {
    return Buffer.from(keyString, "hex");
  }
  // Fallback: UTF-8 encoding, must be at least 32 bytes
  const buf = Buffer.from(keyString, "utf8");
  if (buf.length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 bytes (prefer 64-char hex string)");
  }
  return buf.subarray(0, 32);
}
