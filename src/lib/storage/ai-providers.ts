import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";
import {
  DEFAULT_MODEL_ID,
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

// ─── Raw model ID (internal, used by AI request function) ────────────────────

export function saveSelectedModel(modelId: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, modelId);
}

export function loadSelectedModel(): string {
  return safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) ?? DEFAULT_MODEL_ID;
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
