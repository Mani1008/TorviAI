import type { LucideIcon } from "lucide-react";
import {
  Settings2,
  ShieldCheck,
  Database,
  Plug,
  UserRound,
  CreditCard,
} from "lucide-react";

export type SettingsSectionId =
  | "general"
  | "privacy"
  | "data"
  | "integrations"
  | "account"
  | "subscription";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** When false, shows a "Soon" badge — section shell exists but content is minimal. */
  ready: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    label: "General",
    description: "Your profile and how Torvi addresses you.",
    icon: Settings2,
    ready: true,
  },
  {
    id: "privacy",
    label: "Privacy Controls",
    description: "Control what Torvi can see. Excluded content won't appear in your context.",
    icon: ShieldCheck,
    ready: true,
  },
  {
    id: "data",
    label: "Data & Memory",
    description: "Local context storage and optional cloud sync.",
    icon: Database,
    ready: true,
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Connect Gmail and Calendar to feed your support-ops company brain.",
    icon: Plug,
    ready: true,
  },
  {
    id: "account",
    label: "Account",
    description: "Sessions, sign-out, and account security.",
    icon: UserRound,
    ready: true,
  },
  {
    id: "subscription",
    label: "Subscription",
    description: "Plan, usage limits, and billing.",
    icon: CreditCard,
    ready: true,
  },
];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

export function getSettingsSection(id: string | null | undefined): SettingsSection {
  return (
    SETTINGS_SECTIONS.find((section) => section.id === id) ??
    SETTINGS_SECTIONS.find((section) => section.id === DEFAULT_SETTINGS_SECTION)!
  );
}

export function isSettingsSectionId(value: string | null): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}
