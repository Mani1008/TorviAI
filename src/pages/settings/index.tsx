import { useSearchParams } from "react-router";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  type SettingsSectionId,
} from "@/config/settings-sections.constants";
import { loadMemorySyncSettings, saveMemorySyncSettings } from "@/lib/backend";
import { useState } from "react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { GeneralSection } from "./sections/GeneralSection";
import { PrivacyControlsSection } from "./sections/PrivacyControlsSection";
import { DataSection } from "./sections/DataSection";
import { IntegrationsSection } from "./sections/IntegrationsSection";
import { AccountSection } from "./sections/AccountSection";
import { SubscriptionSection } from "./sections/SubscriptionSection";

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const activeSection: SettingsSectionId = isSettingsSectionId(sectionParam)
    ? sectionParam
    : DEFAULT_SETTINGS_SECTION;

  const [cloudMemorySync, setCloudMemorySync] = useState(
    () => loadMemorySyncSettings().enabled
  );

  const handleSectionChange = (sectionId: SettingsSectionId) => {
    setSearchParams({ section: sectionId }, { replace: true });
  };

  const renderSection = () => {
    switch (activeSection) {
      case "general":
        return <GeneralSection />;
      case "privacy":
        return <PrivacyControlsSection />;
      case "data":
        return (
          <DataSection
            cloudMemorySync={cloudMemorySync}
            onCloudMemorySyncChange={(enabled) => {
              setCloudMemorySync(enabled);
              saveMemorySyncSettings({ enabled });
            }}
          />
        );
      case "integrations":
        return <IntegrationsSection />;
      case "account":
        return <AccountSection />;
      case "subscription":
        return <SubscriptionSection />;
      default:
        return null;
    }
  };

  return (
    <SettingsShell
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
    >
      {renderSection()}
    </SettingsShell>
  );
}
