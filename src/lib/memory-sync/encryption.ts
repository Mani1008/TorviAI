const KEY_STORAGE = "torvi_memory_sync_key_v1";
const ENC_PREFIX = "ENC1:";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function getOrCreateSyncKey(): Promise<CryptoKey> {
  const raw = localStorage.getItem(KEY_STORAGE);
  if (raw) {
    return crypto.subtle.importKey(
      "raw",
      base64ToBytes(raw),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", key);
  localStorage.setItem(KEY_STORAGE, bytesToBase64(new Uint8Array(exported)));
  return key;
}

/** Encrypt chunk body before cloud upload (AES-256-GCM, key stays on device). */
export async function encryptForCloud(plaintext: string): Promise<string> {
  const key = await getOrCreateSyncKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `${ENC_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export function isEncryptedCloudContent(content: string): boolean {
  return content.startsWith(ENC_PREFIX);
}

/** Decrypt cloud memory content when the local key is available. */
export async function decryptFromCloud(payload: string): Promise<string> {
  if (!isEncryptedCloudContent(payload)) return payload;

  const body = payload.slice(ENC_PREFIX.length);
  const sep = body.indexOf(":");
  if (sep < 0) throw new Error("Invalid encrypted memory payload");

  const iv = base64ToBytes(body.slice(0, sep));
  const ciphertext = base64ToBytes(body.slice(sep + 1));
  const key = await getOrCreateSyncKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}
