/**
 * Interview / Meeting role definitions.
 *
 * Users choose a role (and optionally a specialisation) instead of picking
 * a raw LLM. The model is chosen automatically and never shown in the UI.
 *
 * Design principle: the best model for each use-case is baked in here.
 * When a better model becomes available, update this file — the UI stays the same.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type InterviewRoleId =
  | "coding"
  | "behavioural"
  | "consulting"
  | "data_analyst"
  | "tech_meeting"
  | "sales_meeting"
  | "general";

export type SpecialisationId =
  // Coding specialisations
  | "dsa"
  | "system_design"
  | "fullstack_mern"
  | "fullstack_mean"
  | "backend_apis"
  | "ai_ml"
  | "devops_cloud"
  // Data Analyst specialisations
  | "sql_analytics"
  | "ml_data"
  | "bi_reporting"
  // Consulting specialisations
  | "case_interview"
  | "market_sizing"
  | "strategy"
  // General
  | "none";

export interface InterviewRole {
  id: InterviewRoleId;
  label: string;
  description: string;
  /** Icon name from lucide-react */
  icon: string;
  specialisations: Specialisation[];
}

export interface Specialisation {
  id: SpecialisationId;
  label: string;
}

// ─── Data ────────────────────────────────────────────────────────────────────

export const INTERVIEW_ROLES: InterviewRole[] = [
  {
    id: "coding",
    label: "Coding Interview",
    description: "Algorithms, data structures, system design, full stack",
    icon: "Code2",
    specialisations: [
      { id: "dsa", label: "DSA / Algorithms" },
      { id: "system_design", label: "System Design" },
      { id: "fullstack_mern", label: "Full Stack — MERN" },
      { id: "fullstack_mean", label: "Full Stack — MEAN" },
      { id: "backend_apis", label: "Backend / APIs" },
      { id: "ai_ml", label: "AI / ML Engineering" },
      { id: "devops_cloud", label: "DevOps / Cloud" },
    ],
  },
  {
    id: "behavioural",
    label: "Behavioural Interview",
    description: "STAR method, leadership principles, conflict, culture fit",
    icon: "Users",
    specialisations: [],
  },
  {
    id: "consulting",
    label: "Consulting Interview",
    description: "Case interviews, market sizing, strategy, frameworks",
    icon: "LineChart",
    specialisations: [
      { id: "case_interview", label: "Case Interview" },
      { id: "market_sizing", label: "Market Sizing" },
      { id: "strategy", label: "Strategy" },
    ],
  },
  {
    id: "data_analyst",
    label: "Data Analyst",
    description: "SQL, metrics, A/B testing, BI, product analytics",
    icon: "BarChart2",
    specialisations: [
      { id: "sql_analytics", label: "SQL & Analytics" },
      { id: "ml_data", label: "ML / Data Science" },
      { id: "bi_reporting", label: "BI & Reporting" },
    ],
  },
  {
    id: "tech_meeting",
    label: "Tech / Corporate Meeting",
    description: "Architecture reviews, sprint planning, stakeholder calls",
    icon: "Building2",
    specialisations: [],
  },
  {
    id: "sales_meeting",
    label: "Sales Meeting",
    description: "Discovery calls, demos, objection handling, closing",
    icon: "Handshake",
    specialisations: [],
  },
  {
    id: "general",
    label: "General / Other",
    description: "Any other meeting or interview type",
    icon: "Sparkles",
    specialisations: [],
  },
];

// ─── Model mapping ───────────────────────────────────────────────────────────
// Maps (role, specialisation) → internal model ID.
// Users never see these — they see the role label only.

type ModelMapping = Partial<Record<SpecialisationId, string>>;
type RoleModelMap = Record<InterviewRoleId, { default: string; specialisations?: ModelMapping }>;

export const ROLE_MODEL_MAP: RoleModelMap = {
  coding: {
    // DeepSeek V3 is the top coding model for most coding scenarios
    default: "deepseek/deepseek-chat-v3-0324",
    specialisations: {
      dsa: "deepseek/deepseek-chat-v3-0324",       // Best for algorithms / competitive programming
      system_design: "anthropic/claude-3.7-sonnet", // Best structured, long-form system design answers
      fullstack_mern: "deepseek/deepseek-chat-v3-0324",
      fullstack_mean: "deepseek/deepseek-chat-v3-0324",
      backend_apis: "deepseek/deepseek-chat-v3-0324",
      ai_ml: "openai/o4-mini",                     // Math-heavy, reasoning-heavy
      devops_cloud: "anthropic/claude-3.7-sonnet",  // Best for architecture and infra explanations
    },
  },
  behavioural: {
    // Claude excels at nuanced, empathetic, STAR-formatted answers
    default: "anthropic/claude-3.7-sonnet",
  },
  consulting: {
    // GPT-4o is best for structured frameworks and case maths
    default: "openai/gpt-4o",
    specialisations: {
      case_interview: "openai/gpt-4o",
      market_sizing: "openai/o4-mini",             // Math-heavy estimation
      strategy: "openai/gpt-4o",
    },
  },
  data_analyst: {
    // o4-mini for analytics/SQL reasoning
    default: "openai/o4-mini",
    specialisations: {
      sql_analytics: "openai/o4-mini",
      ml_data: "openai/o4-mini",
      bi_reporting: "openai/gpt-4o",
    },
  },
  tech_meeting: {
    // Large context window for long meetings / architecture docs
    default: "google/gemini-pro-1.5",
  },
  sales_meeting: {
    // Fast, conversational, persuasive
    default: "anthropic/claude-3.5-haiku",
  },
  general: {
    // Free tier model — good enough for anything unspecified
    default: "nvidia/nemotron-3-super-120b-a12b:free",
  },
};

/**
 * Resolve the internal model ID for a given role + specialisation.
 * This is the only place in the codebase that maps user intent to LLM.
 */
export function resolveModelForRole(
  roleId: InterviewRoleId,
  specId: SpecialisationId | null,
): string {
  const entry = ROLE_MODEL_MAP[roleId];
  if (specId && specId !== "none" && entry.specialisations?.[specId]) {
    return entry.specialisations[specId];
  }
  return entry.default;
}

export const DEFAULT_ROLE_ID: InterviewRoleId = "coding";
export const DEFAULT_SPEC_ID: SpecialisationId = "dsa";
