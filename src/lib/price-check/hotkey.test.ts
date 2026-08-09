import { describe, expect, it } from "vitest";
import { validatePriceCheckHotkey } from "./hotkey";
import { defaultDesktopShortcuts } from "../shortcuts";

describe("price-check hotkey validation", () => {
  it.each([
    "CommandOrControl+D",
    "CmdOrCtrl+F12",
    "Ctrl+Alt+P",
    "Control+Shift+7",
    "AltGr+Q",
    "Super+PageDown",
    "Shift+Plus",
  ])("accepts the Electron accelerator %s", (shortcut) => {
    expect(validatePriceCheckHotkey(shortcut)).toBe("");
  });

  it("requires both a modifier and exactly one common key", () => {
    expect(validatePriceCheckHotkey("D")).toMatch(/modifier/i);
    expect(validatePriceCheckHotkey("Ctrl+Shift")).toMatch(/exactly one/i);
    expect(validatePriceCheckHotkey("Ctrl+D+E")).toMatch(/exactly one/i);
  });

  it("rejects duplicate tokens and equivalent modifier aliases", () => {
    expect(validatePriceCheckHotkey("Ctrl+Ctrl+D")).toMatch(/repeat/i);
    expect(validatePriceCheckHotkey("Ctrl+CTRL+D")).toMatch(/repeat/i);
    expect(validatePriceCheckHotkey("Ctrl+Control+D")).toMatch(/repeat/i);
    expect(validatePriceCheckHotkey("Alt+Option+D")).toMatch(/repeat/i);
  });

  it("rejects unknown modifiers, unsupported keys, and malformed separators", () => {
    expect(validatePriceCheckHotkey("Foo+D")).toMatch(/unknown/i);
    expect(validatePriceCheckHotkey("Ctrl+F25")).toMatch(/unknown/i);
    expect(validatePriceCheckHotkey("Ctrl++D")).not.toBe("");
    expect(validatePriceCheckHotkey("Ctrl + D")).not.toBe("");
  });

  it.each([
    "Ctrl+Shift+E",
    "Control+Shift+L",
    "CommandOrControl+Shift+Space",
    "CmdOrCtrl+SHIFT+e",
  ])("rejects the app-reserved shortcut %s", (shortcut) => {
    expect(validatePriceCheckHotkey(shortcut, defaultDesktopShortcuts))
      .toMatch(/already assigned/i);
  });

  it.each(["Ctrl+C", "Control+C", "CommandOrControl+C"])(
    "rejects the copy-recursive shortcut %s",
    (shortcut) => {
      expect(validatePriceCheckHotkey(shortcut)).toMatch(/reserved.*copy/i);
    },
  );

  it("does not over-block distinct shortcuts", () => {
    expect(validatePriceCheckHotkey("Ctrl+Shift+R")).toBe("");
    expect(validatePriceCheckHotkey("Ctrl+Alt+Shift+E")).toBe("");
  });
});
