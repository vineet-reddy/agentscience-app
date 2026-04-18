import { createFileRoute } from "@tanstack/react-router";

import { PapersView } from "../components/PapersView";

export const Route = createFileRoute("/papers/")({
  component: PapersView,
});
