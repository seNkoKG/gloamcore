import { describe, expect, it } from "vitest";
import {
  defaultDesktopShortcuts,
  shortcutEventMatches,
  shortcutFromKeyboardEvent,
  shortcutIdentity,
  validateShortcut,
  validateShortcutDraft,
} from "./shortcuts";

describe("desktop shortcut settings", () => {
  it("ships a complete conflict-free default plan", () => {
    expect(validateShortcutDraft({
      ...defaultDesktopShortcuts,
      priceCheck: "CommandOrControl+D",
    }, { platform: "win32" })).toEqual({});
  });

  it("treats primary aliases as the same physical key on each OS", () => {
    expect(shortcutIdentity("CommandOrControl+D", "win32"))
      .toBe(shortcutIdentity("Ctrl+D", "win32"));
    expect(shortcutIdentity("CommandOrControl+D", "darwin"))
      .toBe(shortcutIdentity("Command+D", "darwin"));
  });

  it("marks both owners when two actions use the same accelerator", () => {
    const errors = validateShortcutDraft({
      ...defaultDesktopShortcuts,
      instantSearch: "Ctrl+D",
      priceCheck: "CommandOrControl+D",
    }, { platform: "win32" });
    expect(errors.instantSearch).toMatch(/another action/i);
    expect(errors.priceCheck).toMatch(/another action/i);
  });

  it("allows a dormant price-check key without hiding syntax errors", () => {
    expect(validateShortcutDraft({
      ...defaultDesktopShortcuts,
      instantSearch: "Ctrl+D",
      priceCheck: "CommandOrControl+D",
    }, { platform: "win32", priceCheckEnabled: false })).toEqual({});
    expect(validateShortcutDraft({
      ...defaultDesktopShortcuts,
      priceCheck: "not a key",
    }, { platform: "win32", priceCheckEnabled: false }).priceCheck).toBeTruthy();
  });

  it("matches local accelerators exactly and platform-aware", () => {
    const ctrlK = {
      key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
    } as unknown as KeyboardEvent;
    const winK = {
      key: "k", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false,
    } as KeyboardEvent;
    expect(shortcutEventMatches(ctrlK, "CommandOrControl+K", "win32")).toBe(true);
    expect(shortcutEventMatches(winK, "CommandOrControl+K", "win32")).toBe(false);
    expect(shortcutEventMatches(winK, "CommandOrControl+K", "darwin")).toBe(true);
    expect(shortcutEventMatches({ ...ctrlK, shiftKey: true } as KeyboardEvent, "Ctrl+K", "win32"))
      .toBe(false);
  });

  it("captures function keys, arrows and space in Electron notation", () => {
    expect(shortcutFromKeyboardEvent({
      key: "F8", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
    } as KeyboardEvent)).toBe("Ctrl+F8");
    expect(shortcutFromKeyboardEvent({
      key: "ArrowUp", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false,
    } as KeyboardEvent)).toBe("Alt+Up");
    expect(shortcutFromKeyboardEvent({
      key: " ", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true,
    } as KeyboardEvent)).toBe("Ctrl+Shift+Space");
    expect(shortcutFromKeyboardEvent({
      key: "/", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
    } as KeyboardEvent)).toBe("Ctrl+Slash");
  });

  it("handles AltGr and the platform meta key without double-firing", () => {
    const altGrQ = {
      key: "q",
      ctrlKey: true,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      getModifierState: (name: string) => name === "AltGraph",
    } as unknown as KeyboardEvent;
    expect(shortcutEventMatches(altGrQ, "AltGr+Q", "win32")).toBe(true);
    expect(shortcutEventMatches(altGrQ, "Q", "win32")).toBe(false);
    expect(shortcutFromKeyboardEvent(altGrQ, "win32")).toBe("AltGr+Q");

    const metaK = {
      key: "k", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false,
    } as KeyboardEvent;
    expect(shortcutFromKeyboardEvent(metaK, "win32")).toBe("Super+K");
    expect(shortcutFromKeyboardEvent(metaK, "darwin")).toBe("Command+K");
    expect(validateShortcut("Command+K", { platform: "win32" })).toMatch(/windows/i);
    expect(validateShortcut("Super+K", { platform: "darwin" })).toMatch(/macos/i);
  });
});
