import { Client, Account, Databases, Storage } from "appwrite";

// MEDIUM-06: VITE_ prefixed variables are inlined into the production JS bundle
// by Vite at build time. These IDs are NOT secret — the Appwrite JS SDK requires
// the project ID to function. Security is enforced by Appwrite collection-level
// permissions: every collection MUST use Role.user($userId) for read/write so
// that users can only access their own documents. Never use Role.any() on
// collections that contain user data.
//
// No production project ID / regional endpoint is hardcoded — set them in `.env`
// (see `.env.example`). Hardcoding would publish your cloud project to every fork.
const ENDPOINT =
  import.meta.env.VITE_APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || "";

export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID || "";

export const COLLECTION_IDS = {
  USER_PROFILES: import.meta.env.VITE_APPWRITE_COLLECTION_USER_PROFILES || "",
  CONVERSATIONS: import.meta.env.VITE_APPWRITE_COLLECTION_CONVERSATIONS || "",
  SYSTEM_PROMPTS: import.meta.env.VITE_APPWRITE_COLLECTION_SYSTEM_PROMPTS || "",
  USER_SETTINGS: import.meta.env.VITE_APPWRITE_COLLECTION_USER_SETTINGS || "",
  SCREENSHOTS: import.meta.env.VITE_APPWRITE_COLLECTION_SCREENSHOTS || "",
  // Rate-limit counters — user READ-ONLY. All writes go through Rust (APPWRITE_API_SECRET).
  // See src-tauri/src/usage.rs for the security rationale.
  USER_USAGE: import.meta.env.VITE_APPWRITE_COLLECTION_USER_USAGE || "",
} as const;

// Screenshots image bucket — optional; set VITE_APPWRITE_BUCKET_SCREENSHOTS in .env
export const BUCKET_IDS = {
  SCREENSHOTS: import.meta.env.VITE_APPWRITE_BUCKET_SCREENSHOTS || "",
} as const;

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export { client };

/** Returns true if Appwrite env vars are configured. */
export function isAppwriteConfigured(): boolean {
  return !!(PROJECT_ID && DATABASE_ID);
}

/**
 * Ping the Appwrite backend on app launch to verify endpoint/project setup.
 * Called automatically from main.tsx — check the browser/devtools console for results.
 */
export function pingAppwrite(): void {
  client
    .ping()
    .then(() => {
      console.log("[Appwrite] Ping OK — backend reachable at", ENDPOINT);
    })
    .catch((e: unknown) => {
      console.warn("[Appwrite] Ping failed — check endpoint/project config:", e);
    });
}
