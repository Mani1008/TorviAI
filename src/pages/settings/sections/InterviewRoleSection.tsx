import {
  INTERVIEW_ROLES,
  DEFAULT_ROLE_ID,
  type InterviewRoleId,
  type SpecialisationId,
} from "@/config/interview-roles.constants";
import {
  Code2,
  Users,
  LineChart,
  BarChart2,
  Building2,
  ShoppingBag,
  Sparkles,
  Info,
  Check,
} from "lucide-react";

const ROLE_ICONS: Record<string, React.ReactNode> = {
  Code2: <Code2 className="h-5 w-5" />,
  Users: <Users className="h-5 w-5" />,
  LineChart: <LineChart className="h-5 w-5" />,
  BarChart2: <BarChart2 className="h-5 w-5" />,
  Building2: <Building2 className="h-5 w-5" />,
  Handshake: <ShoppingBag className="h-5 w-5" />,
  Sparkles: <Sparkles className="h-5 w-5" />,
};

interface InterviewRoleSectionProps {
  selectedRole: InterviewRoleId;
  selectedSpec: SpecialisationId | null;
  onRoleSelect: (roleId: InterviewRoleId) => void;
  onSpecSelect: (specId: SpecialisationId) => void;
}

export function InterviewRoleSection({
  selectedRole,
  selectedSpec,
  onRoleSelect,
  onSpecSelect,
}: InterviewRoleSectionProps) {
  const currentRole =
    INTERVIEW_ROLES.find((r) => r.id === selectedRole) ??
    INTERVIEW_ROLES.find((r) => r.id === DEFAULT_ROLE_ID)!;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Interview / meeting type</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Torvi picks an AI model tuned for your role and specialisation.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {INTERVIEW_ROLES.map((role) => {
          const isSelected = role.id === selectedRole;
          return (
            <button
              key={role.id}
              type="button"
              onClick={() => onRoleSelect(role.id)}
              className={`relative text-left rounded-xl border p-4 transition-all ${
                isSelected
                  ? "border-primary bg-primary/8"
                  : "border-border bg-background hover:border-primary/40 hover:bg-accent/40"
              }`}
            >
              {isSelected && (
                <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
              )}
              <div className={`mb-2 ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                {ROLE_ICONS[role.icon]}
              </div>
              <p className="text-sm font-medium leading-tight">{role.label}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">{role.description}</p>
            </button>
          );
        })}
      </div>

      {currentRole.specialisations.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Specialisation
          </p>
          <div className="flex flex-wrap gap-2">
            {currentRole.specialisations.map((spec) => {
              const isActive = selectedSpec === spec.id;
              return (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => onSpecSelect(spec.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {spec.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          AI model is selected automatically from your specialisation.
        </p>
      </div>
    </section>
  );
}
