import { cn } from "../lib/utils";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";

interface SidebarReopenTriggerProps {
  className?: string;
}

/**
 * Renders the sidebar toggle inside a page header when the sidebar is
 * collapsed, providing a stable place for the user to bring it back. The
 * button lives on the content side (not next to the traffic lights) so its
 * position is identical in windowed and fullscreen modes.
 *
 * Returns `null` on desktop because the collapsed icon rail stays visible
 * there; mobile still needs an in-header trigger for the sheet.
 */
export function SidebarReopenTrigger({ className }: SidebarReopenTriggerProps) {
  const { isMobile, open } = useSidebar();
  if (open || !isMobile) return null;

  return (
    <SidebarTrigger
      className={cn(
        "size-7 shrink-0 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        className,
      )}
      aria-label="Expand sidebar"
    />
  );
}
