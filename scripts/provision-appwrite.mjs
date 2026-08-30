#!/usr/bin/env node
/**
 * Provision Torvi's Appwrite backend (database, collections, bucket).
 *
 * Prerequisites (Appwrite Console):
 *   1. Create a new project at https://cloud.appwrite.io
 *   2. Settings → API Keys → create key with scopes:
 *      databases.*, collections.*, attributes.*, indexes.*,
 *      buckets.*, documents.read, documents.write
 *   3. Auth → Settings → add Web platform with hostname: localhost
 *   4. Auth → OAuth2 → enable Google (add Google Cloud OAuth client ID + secret)
 *
 * Usage:
 *   APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1 \
 *   APPWRITE_PROJECT_ID=your_project_id \
 *   APPWRITE_API_SECRET=your_api_key \
 *   node scripts/provision-appwrite.mjs
 */

const ENDPOINT = (process.env.APPWRITE_ENDPOINT || "").replace(/\/$/, "");
const PROJECT_ID = process.env.APPWRITE_PROJECT_ID || "";
const API_KEY = process.env.APPWRITE_API_SECRET || "";
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || "torvi_db";

if (!ENDPOINT || !PROJECT_ID || !API_KEY) {
  console.error(`
Missing required environment variables:
  APPWRITE_ENDPOINT      e.g. https://cloud.appwrite.io/v1
  APPWRITE_PROJECT_ID    from Appwrite Console → Project Settings
  APPWRITE_API_SECRET    server API key (NOT the client SDK key)

Optional:
  APPWRITE_DATABASE_ID   defaults to torvi_db
`);
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "X-Appwrite-Project": PROJECT_ID,
  "X-Appwrite-Key": API_KEY,
};

async function api(method, path, body) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text };
  }
  if (!res.ok && res.status !== 409) {
    throw new Error(`${method} ${path} → ${res.status}: ${json.message || text}`);
  }
  return { status: res.status, json };
}

async function waitForAttribute(databaseId, collectionId, key) {
  for (let i = 0; i < 30; i++) {
    const { json } = await api(
      "GET",
      `/databases/${databaseId}/collections/${collectionId}/attributes/${key}`
    );
    if (json.status === "available") return;
    if (json.status === "failed") {
      throw new Error(`Attribute ${collectionId}.${key} failed: ${json.error}`);
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for attribute ${collectionId}.${key}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureDatabase() {
  const { status } = await api("POST", "/databases", {
    databaseId: DATABASE_ID,
    name: "Torvi DB",
  });
  console.log(status === 409 ? "✓ Database exists" : "✓ Database created");
}

async function ensureCollection(collectionId, name, { documentSecurity, permissions }) {
  const { status } = await api("POST", `/databases/${DATABASE_ID}/collections`, {
    collectionId,
    name,
    documentSecurity,
    permissions: permissions ?? [],
  });
  console.log(status === 409 ? `✓ Collection ${collectionId} exists` : `✓ Collection ${collectionId} created`);
}

async function ensureStringAttr(collectionId, key, size, required = false) {
  const path = `/databases/${DATABASE_ID}/collections/${collectionId}/attributes/string`;
  const { status } = await api("POST", path, { key, size, required, array: false });
  if (status !== 409) await waitForAttribute(DATABASE_ID, collectionId, key);
}

async function ensureIntAttr(collectionId, key, { min, max, required = false, default: def } = {}) {
  const path = `/databases/${DATABASE_ID}/collections/${collectionId}/attributes/integer`;
  const body = { key, required, array: false };
  if (min !== undefined) body.min = min;
  if (max !== undefined) body.max = max;
  if (def !== undefined) body.default = def;
  const { status } = await api("POST", path, body);
  if (status !== 409) await waitForAttribute(DATABASE_ID, collectionId, key);
}

async function ensureBoolAttr(collectionId, key, required = false) {
  const path = `/databases/${DATABASE_ID}/collections/${collectionId}/attributes/boolean`;
  const { status } = await api("POST", path, { key, required, array: false });
  if (status !== 409) await waitForAttribute(DATABASE_ID, collectionId, key);
}

async function ensureDatetimeAttr(collectionId, key, required = false) {
  const path = `/databases/${DATABASE_ID}/collections/${collectionId}/attributes/datetime`;
  const { status } = await api("POST", path, { key, required, array: false });
  if (status !== 409) await waitForAttribute(DATABASE_ID, collectionId, key);
}

async function ensureIndex(collectionId, key, attributes, orders = []) {
  const { status } = await api("POST", `/databases/${DATABASE_ID}/collections/${collectionId}/indexes`, {
    key,
    type: "key",
    attributes,
    orders: orders.length ? orders : attributes.map(() => "ASC"),
  });
  if (status !== 409) await sleep(2000);
}

async function ensureBucket(bucketId, name) {
  const { status } = await api("POST", "/storage/buckets", {
    bucketId,
    name,
    permissions: [],
    fileSecurity: true,
    enabled: true,
  });
  console.log(status === 409 ? `✓ Bucket ${bucketId} exists` : `✓ Bucket ${bucketId} created`);
}

async function main() {
  console.log("\nProvisioning Torvi Appwrite backend...\n");

  await ensureDatabase();

  // user_profiles — user read+write on own docs (set per-document at create time)
  await ensureCollection("user_profiles", "User Profiles", { documentSecurity: true });
  await ensureStringAttr("user_profiles", "name", 256, true);
  await ensureStringAttr("user_profiles", "email", 320, true);
  await ensureStringAttr("user_profiles", "plan", 64, true);
  await ensureBoolAttr("user_profiles", "isActive", false);

  // conversations
  await ensureCollection("conversations", "Conversations", { documentSecurity: true });
  await ensureStringAttr("conversations", "userId", 64, true);
  await ensureStringAttr("conversations", "title", 512, false);
  await ensureDatetimeAttr("conversations", "createdAt", false);
  await ensureDatetimeAttr("conversations", "updatedAt", false);
  await ensureIndex("conversations", "idx_userId", ["userId"]);
  await ensureIndex("conversations", "idx_updatedAt", ["updatedAt"], ["DESC"]);

  // system_prompts
  await ensureCollection("system_prompts", "System Prompts", { documentSecurity: true });
  await ensureStringAttr("system_prompts", "userId", 64, true);
  await ensureStringAttr("system_prompts", "name", 256, false);
  await ensureStringAttr("system_prompts", "prompt", 65535, false);
  await ensureDatetimeAttr("system_prompts", "createdAt", false);
  await ensureDatetimeAttr("system_prompts", "updatedAt", false);
  await ensureIndex("system_prompts", "idx_userId", ["userId"]);

  // user_settings
  await ensureCollection("user_settings", "User Settings", { documentSecurity: true });
  await ensureStringAttr("user_settings", "selectedModel", 256, false);
  await ensureStringAttr("user_settings", "responseLength", 64, false);
  await ensureStringAttr("user_settings", "language", 64, false);
  await ensureStringAttr("user_settings", "systemPrompt", 65535, false);

  // screenshot metadata
  await ensureCollection("screenshot", "Screenshots", { documentSecurity: true });
  await ensureStringAttr("screenshot", "userid", 64, true);
  await ensureStringAttr("screenshot", "prompt", 4096, false);
  await ensureDatetimeAttr("screenshot", "capturedAt", false);
  await ensureStringAttr("screenshot", "storageField", 64, false);

  // user_usage — NO collection permissions; Rust API key writes; user read-only per doc
  await ensureCollection("user_usage", "User Usage", { documentSecurity: true, permissions: [] });
  await ensureIntAttr("user_usage", "aiResponsesUsed", { min: 0, max: 600, default: 0 });
  await ensureIntAttr("user_usage", "listeningSecondsUsed", { min: 0, max: 40000, default: 0 });

  const BUCKET_ID = "screenshots";
  await ensureBucket(BUCKET_ID, "Screenshots");

  console.log(`
══════════════════════════════════════════════════════════════
Done! Add these values to your .env file:
══════════════════════════════════════════════════════════════

VITE_APPWRITE_ENDPOINT=${ENDPOINT}
VITE_APPWRITE_PROJECT_ID=${PROJECT_ID}
VITE_APPWRITE_DATABASE_ID=${DATABASE_ID}
VITE_APPWRITE_COLLECTION_USER_PROFILES=user_profiles
VITE_APPWRITE_COLLECTION_CONVERSATIONS=conversations
VITE_APPWRITE_COLLECTION_SYSTEM_PROMPTS=system_prompts
VITE_APPWRITE_COLLECTION_USER_SETTINGS=user_settings
VITE_APPWRITE_COLLECTION_SCREENSHOTS=screenshot
VITE_APPWRITE_COLLECTION_USER_USAGE=user_usage
VITE_APPWRITE_BUCKET_SCREENSHOTS=${BUCKET_ID}
APPWRITE_API_SECRET=${API_KEY}

══════════════════════════════════════════════════════════════
Manual steps in Appwrite Console (required for sign-in):
══════════════════════════════════════════════════════════════

1. Auth → Settings → Platforms → Add platform → Web App
   Hostname: localhost

2. Auth → Settings → OAuth2 → Google → Enable
   - Create OAuth credentials in Google Cloud Console
   - Authorized redirect URI (shown in Appwrite):
     ${ENDPOINT}/account/sessions/oauth2/callback/google/${PROJECT_ID}

3. Restart the Torvi dev app after updating .env

`);
}

main().catch((err) => {
  console.error("\nProvisioning failed:", err.message);
  process.exit(1);
});
