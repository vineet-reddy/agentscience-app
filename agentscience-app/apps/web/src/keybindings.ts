import { isMacPlatform } from "./lib/utils";

export interface ShortcutEventLike {
  type?: string;
  code?: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutMatchContext {
  terminalFocus: boolean;
  terminalOpen: boolean;
}

interface ShortcutMatchOptions {
  platform?: string;
  context?: Partial<ShortcutMatchContext>;
}

type ShortcutCommand =
  | "terminal.toggle"
  | "terminal.split"
  | "terminal.new"
  | "terminal.close"
  | "diff.toggle"
  | "chat.new"
  | "chat.newLocal"
  | "editor.openFavorite";

interface ShortcutDefinition {
  key: string;
  modKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

interface FixedShortcutBinding {
  command: ShortcutCommand;
  shortcut: ShortcutDefinition;
  when?: "terminalFocus" | "notTerminalFocus";
}

const TERMINAL_WORD_BACKWARD = "\u001bb";
const TERMINAL_WORD_FORWARD = "\u001bf";
const TERMINAL_LINE_START = "\u0001";
const TERMINAL_LINE_END = "\u0005";

const FIXED_SHORTCUTS: ReadonlyArray<FixedShortcutBinding> = [
  { command: "terminal.toggle", shortcut: { key: "j", modKey: true } },
  {
    command: "terminal.split",
    shortcut: { key: "d", modKey: true },
    when: "terminalFocus",
  },
  {
    command: "terminal.new",
    shortcut: { key: "n", modKey: true },
    when: "terminalFocus",
  },
  {
    command: "terminal.close",
    shortcut: { key: "w", modKey: true },
    when: "terminalFocus",
  },
  {
    command: "diff.toggle",
    shortcut: { key: "d", modKey: true },
    when: "notTerminalFocus",
  },
  {
    command: "chat.new",
    shortcut: { key: "n", modKey: true },
    when: "notTerminalFocus",
  },
  {
    command: "chat.new",
    shortcut: { key: "o", modKey: true, shiftKey: true },
    when: "notTerminalFocus",
  },
  {
    command: "chat.newLocal",
    shortcut: { key: "n", modKey: true, shiftKey: true },
    when: "notTerminalFocus",
  },
  { command: "editor.openFavorite", shortcut: { key: "o", modKey: true } },
] as const;

const EVENT_CODE_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  BracketLeft: ["["],
  BracketRight: ["]"],
  Digit0: ["0"],
  Digit1: ["1"],
  Digit2: ["2"],
  Digit3: ["3"],
  Digit4: ["4"],
  Digit5: ["5"],
  Digit6: ["6"],
  Digit7: ["7"],
  Digit8: ["8"],
  Digit9: ["9"],
};

function normalizeEventKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === "esc") return "escape";
  return normalized;
}

function resolveEventKeys(event: ShortcutEventLike): Set<string> {
  const keys = new Set([normalizeEventKey(event.key)]);
  const aliases = event.code ? EVENT_CODE_KEY_ALIASES[event.code] : undefined;
  if (!aliases) return keys;

  for (const alias of aliases) {
    keys.add(alias);
  }
  return keys;
}

function resolvePlatform(options: ShortcutMatchOptions | undefined): string {
  return options?.platform ?? navigator.platform;
}

function resolveContext(options: ShortcutMatchOptions | undefined): ShortcutMatchContext {
  return {
    terminalFocus: false,
    terminalOpen: false,
    ...options?.context,
  };
}

function matchesWhenClause(
  binding: FixedShortcutBinding,
  context: ShortcutMatchContext,
): boolean {
  if (binding.when === "terminalFocus") {
    return context.terminalFocus;
  }
  if (binding.when === "notTerminalFocus") {
    return !context.terminalFocus;
  }
  return true;
}

function matchesShortcutModifiers(
  event: ShortcutEventLike,
  shortcut: ShortcutDefinition,
  platform = navigator.platform,
): boolean {
  const useMetaForMod = isMacPlatform(platform);
  const expectedMeta = Boolean(shortcut.metaKey || (shortcut.modKey && useMetaForMod));
  const expectedCtrl = Boolean(shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod));
  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.shiftKey === Boolean(shortcut.shiftKey) &&
    event.altKey === Boolean(shortcut.altKey)
  );
}

function matchesShortcut(
  event: ShortcutEventLike,
  shortcut: ShortcutDefinition,
  platform = navigator.platform,
): boolean {
  if (!matchesShortcutModifiers(event, shortcut, platform)) return false;
  return resolveEventKeys(event).has(shortcut.key);
}

function findShortcutForCommand(
  command: ShortcutCommand,
  options?: ShortcutMatchOptions,
): ShortcutDefinition | null {
  const context = resolveContext(options);
  for (const binding of FIXED_SHORTCUTS) {
    if (binding.command !== command) continue;
    if (!matchesWhenClause(binding, context)) continue;
    return binding.shortcut;
  }
  return null;
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  options?: ShortcutMatchOptions,
): ShortcutCommand | null {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);

  for (const binding of FIXED_SHORTCUTS) {
    if (!matchesWhenClause(binding, context)) continue;
    if (!matchesShortcut(event, binding.shortcut, platform)) continue;
    return binding.command;
  }
  return null;
}

function formatShortcutKeyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "Up";
  if (key === "arrowdown") return "Down";
  if (key === "arrowleft") return "Left";
  if (key === "arrowright") return "Right";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function formatShortcutLabel(
  shortcut: ShortcutDefinition,
  platform = navigator.platform,
): string {
  const keyLabel = formatShortcutKeyLabel(shortcut.key);
  const useMetaForMod = isMacPlatform(platform);
  const showMeta = Boolean(shortcut.metaKey || (shortcut.modKey && useMetaForMod));
  const showCtrl = Boolean(shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod));
  const showAlt = Boolean(shortcut.altKey);
  const showShift = Boolean(shortcut.shiftKey);

  if (useMetaForMod) {
    return `${showCtrl ? "\u2303" : ""}${showAlt ? "\u2325" : ""}${showShift ? "\u21e7" : ""}${showMeta ? "\u2318" : ""}${keyLabel}`;
  }

  const parts: string[] = [];
  if (showCtrl) parts.push("Ctrl");
  if (showAlt) parts.push("Alt");
  if (showShift) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(keyLabel);
  return parts.join("+");
}

export function shortcutLabelForCommand(
  command: ShortcutCommand,
  options?: string | ShortcutMatchOptions,
): string | null {
  const resolvedOptions =
    typeof options === "string" ? { platform: options } : options;
  const platform = resolvePlatform(resolvedOptions);
  const shortcut = findShortcutForCommand(command, resolvedOptions);
  return shortcut ? formatShortcutLabel(shortcut, platform) : null;
}

export function isOpenFavoriteEditorShortcut(
  event: ShortcutEventLike,
  options?: ShortcutMatchOptions,
): boolean {
  return resolveShortcutCommand(event, options) === "editor.openFavorite";
}

export function isTerminalClearShortcut(
  event: ShortcutEventLike,
  platform = navigator.platform,
): boolean {
  if (event.type !== undefined && event.type !== "keydown") {
    return false;
  }

  const key = event.key.toLowerCase();

  if (key === "l" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    return true;
  }

  return (
    isMacPlatform(platform) &&
    key === "k" &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function terminalNavigationShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
): string | null {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (event.shiftKey) return null;

  const key = normalizeEventKey(event.key);
  if (key !== "arrowleft" && key !== "arrowright") {
    return null;
  }

  const moveWord = key === "arrowleft" ? TERMINAL_WORD_BACKWARD : TERMINAL_WORD_FORWARD;
  const moveLine = key === "arrowleft" ? TERMINAL_LINE_START : TERMINAL_LINE_END;

  if (isMacPlatform(platform)) {
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      return moveWord;
    }
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      return moveLine;
    }
    return null;
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    return moveWord;
  }

  if (event.altKey && !event.metaKey && !event.ctrlKey) {
    return moveWord;
  }

  return null;
}
