import { assert, describe, it } from "vitest";

import {
  formatShortcutLabel,
  isOpenFavoriteEditorShortcut,
  isTerminalClearShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  terminalNavigationShortcutData,
  type ShortcutEventLike,
} from "./keybindings";

function event(overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return {
    key: "j",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("resolveShortcutCommand", () => {
  it("matches terminal toggle on macOS and Windows", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ metaKey: true }), { platform: "MacIntel" }),
      "terminal.toggle",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ ctrlKey: true }), { platform: "Win32" }),
      "terminal.toggle",
    );
  });

  it("routes shared shortcuts by terminal focus", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "n", ctrlKey: true }),
        {
          platform: "Linux",
          context: { terminalFocus: false },
        },
      ),
      "chat.new",
    );
    assert.isNull(
      resolveShortcutCommand(
        event({ key: "w", ctrlKey: true }),
        {
          platform: "Linux",
          context: { terminalFocus: false },
        },
      ),
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "n", ctrlKey: true }),
        {
          platform: "Linux",
          context: { terminalFocus: true },
        },
      ),
      "terminal.new",
    );
  });

  it("uses non-terminal defaults when the terminal is not focused", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "n", ctrlKey: true }),
        {
          platform: "Linux",
          context: { terminalFocus: false },
        },
      ),
      "chat.new",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "d", metaKey: true }),
        {
          platform: "MacIntel",
          context: { terminalFocus: false },
        },
      ),
      "diff.toggle",
    );
  });

  it("matches chat.newLocal and open favorite editor shortcuts", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "n", metaKey: true, shiftKey: true }),
        {
          platform: "MacIntel",
          context: { terminalFocus: false },
        },
      ),
      "chat.newLocal",
    );
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", ctrlKey: true }), {
        platform: "Linux",
      }),
    );
  });
});

describe("shortcutLabelForCommand", () => {
  it("formats fixed shortcut labels", () => {
    assert.strictEqual(shortcutLabelForCommand("terminal.toggle", "MacIntel"), "⌘J");
    assert.strictEqual(
      shortcutLabelForCommand("terminal.new", {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
      "Ctrl+N",
    );
    assert.strictEqual(shortcutLabelForCommand("editor.openFavorite", "Linux"), "Ctrl+O");
  });

  it("returns null when a shortcut is inactive in the current context", () => {
    assert.isNull(
      shortcutLabelForCommand("terminal.close", {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
    );
  });

  it("formats explicit shortcut definitions", () => {
    assert.strictEqual(
      formatShortcutLabel({ key: "o", modKey: true, shiftKey: true }, "MacIntel"),
      "⇧⌘O",
    );
    assert.strictEqual(
      formatShortcutLabel({ key: "o", modKey: true, shiftKey: true }, "Linux"),
      "Ctrl+Shift+O",
    );
  });
});

describe("terminal shortcuts", () => {
  it("matches terminal clear shortcuts", () => {
    assert.isTrue(
      isTerminalClearShortcut(event({ key: "l", ctrlKey: true }), "Linux"),
    );
    assert.isTrue(
      isTerminalClearShortcut(event({ key: "k", metaKey: true }), "MacIntel"),
    );
    assert.isFalse(
      isTerminalClearShortcut(event({ key: "k", ctrlKey: true }), "MacIntel"),
    );
  });

  it("maps terminal navigation shortcuts", () => {
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", altKey: true }), "MacIntel"),
      "\u001bb",
    );
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowRight", metaKey: true }), "MacIntel"),
      "\u0005",
    );
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", ctrlKey: true }), "Linux"),
      "\u001bb",
    );
    assert.isNull(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", shiftKey: true }), "Linux"),
    );
  });
});
