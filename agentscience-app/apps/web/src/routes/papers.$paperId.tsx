import { createFileRoute } from "@tanstack/react-router";

import { PaperDetailView } from "../components/PaperDetailView";

export const Route = createFileRoute("/papers/$paperId")({
  component: PaperDetailView,
});
