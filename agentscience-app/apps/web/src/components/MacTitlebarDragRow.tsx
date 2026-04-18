import { cn, isMacPlatform } from "../lib/utils";
import { isElectron } from "../env";
import { useDesktopFullScreen } from "../hooks/useDesktopFullScreen";

interface MacTitlebarDragRowProps {
  className?: string;
}

/**
 * Empty 36px drag strip that reserves vertical space for the macOS traffic
 * lights on windowed Electron. It is intentionally button-free: the sidebar
 * toggle lives inside the sidebar header (and is mirrored in page headers
 * when the sidebar is collapsed) so nothing ever "floats" next to the
 * traffic lights.
 *
 * Renders nothing in native fullscreen (traffic lights are hidden) or on any
 * non-Mac / non-Electron target.
 */
export function MacTitlebarDragRow({ className }: MacTitlebarDragRowProps) {
  const isMac = isElectron && isMacPlatform(navigator.platform);
  const isFullScreen = useDesktopFullScreen();

  if (!isMac || isFullScreen) return null;

  return <div className={cn("drag-region h-9 shrink-0", className)} />;
}
