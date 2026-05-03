function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export async function deriveKey(passphrase: string, saltBase64: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBuffer(saltBase64),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(
  plaintext: string,
  key: CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  return {
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv),
  };
}

export async function decryptText(
  ciphertextBase64: string,
  ivBase64: string,
  key: CryptoKey
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBuffer(ivBase64) },
    key,
    base64ToBuffer(ciphertextBase64)
  );

  return new TextDecoder().decode(decrypted);
}
