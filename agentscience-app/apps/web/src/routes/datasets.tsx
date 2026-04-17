import { createFileRoute } from "@tanstack/react-router";

import { DatasetsView } from "../components/DatasetsView";

export const Route = createFileRoute("/datasets")({
  component: DatasetsView,
});
