import { createFileRoute } from "@tanstack/react-router";

import { PrivacySettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/privacy")({
  component: PrivacySettingsPanel,
});
