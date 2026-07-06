export type BackendProvider = "appwrite" | "supabase";

/** Active cloud backend — defaults to Appwrite until cutover. */
export function getBackendProvider(): BackendProvider {
  const raw = (
    import.meta.env.VITE_BACKEND_PROVIDER ??
    import.meta.env.BACKEND_PROVIDER ??
    "appwrite"
  ).toLowerCase();
  return raw === "supabase" ? "supabase" : "appwrite";
}

export function isSupabaseProvider(): boolean {
  return getBackendProvider() === "supabase";
}

export function isAppwriteProvider(): boolean {
  return getBackendProvider() === "appwrite";
}
