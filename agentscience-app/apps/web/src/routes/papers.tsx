import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Thin pass-through layout for the `/papers` branch. The list and detail
 * routes render their own chrome so this file deliberately does nothing
 * beyond hosting an `<Outlet />`.
 */
function PapersLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/papers")({
  component: PapersLayout,
});
