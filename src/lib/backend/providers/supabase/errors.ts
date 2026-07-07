/** Normalize Supabase PostgrestError / unknown throws into a readable string. */
export function formatSupabaseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [e.code, e.message, e.details, e.hint].filter(
      (p) => typeof p === "string" && p.length > 0
    );
    if (parts.length > 0) return parts.join(" — ");
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function isPostgresDuplicateError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    if ((err as { code?: string }).code === "23505") return true;
  }
  const msg = formatSupabaseError(err).toLowerCase();
  return (
    msg.includes("duplicate key") ||
    msg.includes("idx_memory_user_content_hash_unique") ||
    msg.includes("23505")
  );
}
