import { PageLayout } from "@/layouts";
import { RESPONSE_LENGTHS, RESPONSE_LANGUAGES } from "@/lib/response-settings.constants";

/**
 * Response settings page — length and language preferences.
 *
 * TODO: Wire up save/load with storage layer.
 * TODO: Add interactive selectors.
 */
export default function Responses() {
  return (
    <PageLayout
      title="Responses"
      description="Configure AI response length and language"
    >
      <div className="space-y-8">
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Response Length
          </h3>
          <div className="space-y-2">
            {RESPONSE_LENGTHS.map((len) => (
              <div
                key={len.id}
                className="rounded-lg border border-border p-3"
              >
                <p className="text-sm font-medium">{len.label}</p>
                <p className="text-xs text-muted-foreground">
                  {len.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Response Language
          </h3>
          <p className="text-sm text-muted-foreground">
            {RESPONSE_LANGUAGES.length} languages available
          </p>
        </section>
      </div>
    </PageLayout>
  );
}
