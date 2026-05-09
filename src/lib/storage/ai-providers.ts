import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import {
  DEFAULT_MODEL_ID,
  OPENROUTER_MODELS,
} from "@/config/models.constants";
import {
  type InterviewRoleId,
  type SpecialisationId,
  DEFAULT_ROLE_ID,
  DEFAULT_SPEC_ID,
  resolveModelForRole,
} from "@/config/interview-roles.constants";

const ROLE_KEY = "torvi_interview_role";
const SPEC_KEY = "torvi_interview_spec";

/** All model IDs known to this build (duplicates ALLOWED_MODELS in api.rs). */
const KNOWN_MODEL_IDS = new Set(OPENROUTER_MODELS.map((m) => m.id));

// ─── Raw model ID (internal, used by AI request function) ────────────────────

export function saveSelectedModel(modelId: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, modelId);
}

/**
 * Load the selected model ID.
 * If the stored value is from an old session and is no longer a known model,
 * fall back to DEFAULT_MODEL_ID so the app never sends an unknown model to Rust.
 */
export function loadSelectedModel(): string {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_MODEL);
  if (stored && KNOWN_MODEL_IDS.has(stored)) return stored;
  // Stale / unknown — reset to default and persist
  safeLocalStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, DEFAULT_MODEL_ID);
  return DEFAULT_MODEL_ID;
}

// ─── Interview role + specialisation (user-facing) ───────────────────────────

export function saveInterviewRole(roleId: InterviewRoleId): void {
  safeLocalStorage.setItem(ROLE_KEY, roleId);
}

export function loadInterviewRole(): InterviewRoleId {
  return (safeLocalStorage.getItem(ROLE_KEY) as InterviewRoleId | null) ?? DEFAULT_ROLE_ID;
}

export function saveInterviewSpec(specId: SpecialisationId): void {
  safeLocalStorage.setItem(SPEC_KEY, specId);
}

export function loadInterviewSpec(): SpecialisationId {
  return (safeLocalStorage.getItem(SPEC_KEY) as SpecialisationId | null) ?? DEFAULT_SPEC_ID;
}

/**
 * Persist role + specialisation and derive + save the underlying model ID.
 * This is the single write path — keeps raw model in sync with user intent.
 */
export function applyInterviewRole(
  roleId: InterviewRoleId,
  specId: SpecialisationId | null,
): void {
  saveInterviewRole(roleId);
  saveInterviewSpec(specId ?? DEFAULT_SPEC_ID);
  const modelId = resolveModelForRole(roleId, specId);
  saveSelectedModel(modelId);
}
