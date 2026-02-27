import { describe, it, expect } from "vitest";
import { encrypt, decrypt, generateKey, deriveEncryptionKey } from "../../src/auth/encryption";

describe("encryption", () => {
  const key = generateKey();

  it("encrypt then decrypt round-trips", () => {
    const plaintext = "hello world";
    const ciphertext = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, key);
    expect(decrypted).toBe(plaintext);
  });

  it("different plaintexts produce different ciphertexts", () => {
    const ct1 = encrypt("alpha", key);
    const ct2 = encrypt("bravo", key);
    expect(ct1.equals(ct2)).toBe(false);
  });

  it("same plaintext produces different ciphertexts (random IV)", () => {
    const ct1 = encrypt("same", key);
    const ct2 = encrypt("same", key);
    expect(ct1.equals(ct2)).toBe(false);
  });

  it("decrypt with wrong key throws", () => {
    const ciphertext = encrypt("secret", key);
    const wrongKey = generateKey();
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });

  it("tampered ciphertext throws (GCM auth tag validation)", () => {
    const ciphertext = encrypt("test data", key);
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("empty string encrypts/decrypts correctly", () => {
    const ciphertext = encrypt("", key);
    const decrypted = decrypt(ciphertext, key);
    expect(decrypted).toBe("");
  });

  it("unicode text round-trips", () => {
    const unicode = "日本語テスト 🎉 café résumé";
    const ciphertext = encrypt(unicode, key);
    const decrypted = decrypt(ciphertext, key);
    expect(decrypted).toBe(unicode);
  });

  it("generateKey() returns 32 bytes", () => {
    const k = generateKey();
    expect(k).toBeInstanceOf(Buffer);
    expect(k.length).toBe(32);
  });

  it("generateKey() produces unique keys", () => {
    const k1 = generateKey();
    const k2 = generateKey();
    expect(k1.equals(k2)).toBe(false);
  });

  it("rejects truncated ciphertext", () => {
    expect(() => decrypt(Buffer.alloc(10), key)).toThrow("Invalid ciphertext: too short");
  });
});

describe("deriveEncryptionKey", () => {
  it("accepts 64-char hex string and returns 32-byte buffer", () => {
    const hex = "a".repeat(64);
    const result = deriveEncryptionKey(hex);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
    expect(result).toEqual(Buffer.from(hex, "hex"));
  });

  it("accepts uppercase hex", () => {
    const hex = "AB".repeat(32);
    const result = deriveEncryptionKey(hex);
    expect(result.length).toBe(32);
  });

  it("falls back to UTF-8 for non-hex strings >= 32 bytes", () => {
    const key = "x".repeat(40);
    const result = deriveEncryptionKey(key);
    expect(result.length).toBe(32);
    expect(result).toEqual(Buffer.from(key, "utf8").subarray(0, 32));
  });

  it("throws for strings shorter than 32 bytes (non-hex)", () => {
    expect(() => deriveEncryptionKey("short")).toThrow("must be at least 32 bytes");
  });

  it("derived key can encrypt and decrypt", () => {
    const hex = generateKey().toString("hex");
    const derived = deriveEncryptionKey(hex);
    const ct = encrypt("test", derived);
    expect(decrypt(ct, derived)).toBe("test");
  });

  it("both code paths produce same key for hex input", () => {
    const hex = generateKey().toString("hex");
    const key1 = deriveEncryptionKey(hex);
    const key2 = deriveEncryptionKey(hex);
    expect(key1.equals(key2)).toBe(true);
  });
});
