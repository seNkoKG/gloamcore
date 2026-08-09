import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_DESKTOP_SHORTCUTS,
  registerGlobalShortcutSetBestEffort,
  replaceGlobalShortcutPlan,
  replaceGlobalShortcutSet,
  sanitizeDesktopShortcuts,
  validateShortcutPlan,
} = require("../electron/shortcut-settings.cjs") as {
  DEFAULT_DESKTOP_SHORTCUTS: Record<string, string>;
  registerGlobalShortcutSetBestEffort: (options: Record<string, unknown>) => {
    registered: Record<string, string>;
    failures: Array<{ key: string; accelerator: string }>;
  };
  replaceGlobalShortcutPlan: (options: Record<string, unknown>) => {
    ok: boolean;
    registered: Record<string, string>;
    failedKey?: string;
    failedAccelerator?: string;
    rollbackComplete?: boolean;
  };
  replaceGlobalShortcutSet: (options: Record<string, unknown>) => {
    ok: boolean;
    registered: Record<string, string>;
    failedAccelerator?: string;
    rollbackComplete?: boolean;
  };
  sanitizeDesktopShortcuts: (
    value: unknown,
    fallback?: Record<string, string>,
  ) => Record<string, string>;
  validateShortcutPlan: (value: unknown, platform?: string) => string;
};

function fakeRegistry(initial: string[] = [], unavailable: string[] = []) {
  const active = new Set(initial);
  const blocked = new Set(unavailable);
  return {
    active,
    register(accelerator: string) {
      if (blocked.has(accelerator) || active.has(accelerator)) return false;
      active.add(accelerator);
      return true;
    },
    unregister(accelerator: string) {
      active.delete(accelerator);
    },
  };
}

describe("main-process shortcut settings", () => {
  it("fills missing legacy settings with stable defaults", () => {
    expect(sanitizeDesktopShortcuts({ focusItemSearch: "F6" })).toEqual({
      ...DEFAULT_DESKTOP_SHORTCUTS,
      focusItemSearch: "F6",
    });
  });

  it("detects Windows alias collisions in the complete plan", () => {
    expect(validateShortcutPlan({
      shortcuts: { ...DEFAULT_DESKTOP_SHORTCUTS, instantSearch: "Ctrl+D" },
      priceCheck: { enabled: true, hotkey: "CommandOrControl+D" },
    }, "win32")).toMatch(/already assigned/i);
  });

  it("rejects platform-invalid meta aliases before OS registration", () => {
    expect(validateShortcutPlan({
      shortcuts: {
        ...DEFAULT_DESKTOP_SHORTCUTS,
        toggleWidget: "Command+Shift+E",
      },
      priceCheck: { enabled: true, hotkey: "CommandOrControl+D" },
    }, "win32")).toMatch(/windows/i);
    expect(validateShortcutPlan({
      shortcuts: {
        ...DEFAULT_DESKTOP_SHORTCUTS,
        toggleWidget: "Super+Shift+E",
      },
      priceCheck: { enabled: true, hotkey: "CommandOrControl+D" },
    }, "darwin")).toMatch(/macos/i);
  });

  it("rolls every global shortcut back when Windows rejects one candidate", () => {
    const previous = { widget: "Ctrl+Shift+E", search: "Ctrl+Shift+Space" };
    const next = { widget: "Ctrl+F8", search: "Ctrl+F9" };
    const registry = fakeRegistry(Object.values(previous), ["Ctrl+F9"]);
    const result = replaceGlobalShortcutSet({
      globalShortcut: registry,
      previous,
      next,
      callbacks: { widget() {}, search() {} },
    });
    expect(result.ok).toBe(false);
    expect(result.failedAccelerator).toBe("Ctrl+F9");
    expect(result.rollbackComplete).toBe(true);
    expect([...registry.active].sort()).toEqual(Object.values(previous).sort());
    expect(result.registered).toEqual(previous);
  });

  it("probes an inactive price-check key and rolls back the whole plan", () => {
    const previous = { widget: "Ctrl+Shift+E", search: "Ctrl+Shift+Space" };
    const next = { widget: "Ctrl+F8", search: "Ctrl+F9" };
    const registry = fakeRegistry(Object.values(previous), ["Ctrl+F10"]);
    const result = replaceGlobalShortcutPlan({
      globalShortcut: registry,
      previousDesktop: previous,
      nextDesktop: next,
      probeAccelerator: "Ctrl+F10",
      callbacks: { widget() {}, search() {} },
    });
    expect(result).toMatchObject({
      ok: false,
      failedKey: "priceCheck",
      failedAccelerator: "Ctrl+F10",
      rollbackComplete: true,
      registered: previous,
    });
    expect([...registry.active].sort()).toEqual(Object.values(previous).sort());
  });

  it("removes a successful price-key probe until the game target is active", () => {
    const registry = fakeRegistry();
    const result = replaceGlobalShortcutPlan({
      globalShortcut: registry,
      previousDesktop: {},
      nextDesktop: { widget: "Ctrl+F8", search: "Ctrl+F9" },
      probeAccelerator: "Ctrl+F10",
      callbacks: { widget() {}, search() {} },
    });
    expect(result.ok).toBe(true);
    expect([...registry.active].sort()).toEqual(["Ctrl+F8", "Ctrl+F9"]);
    expect(registry.active.has("Ctrl+F10")).toBe(false);
  });

  it("keeps valid startup globals when one persisted key is unavailable", () => {
    const registry = fakeRegistry([], ["Ctrl+F9"]);
    const result = registerGlobalShortcutSetBestEffort({
      globalShortcut: registry,
      next: { widget: "Ctrl+F8", search: "Ctrl+F9", click: "Ctrl+F10" },
      callbacks: { widget() {}, search() {}, click() {} },
    });
    expect(result.failures).toEqual([{ key: "search", accelerator: "Ctrl+F9" }]);
    expect(result.registered).toEqual({ widget: "Ctrl+F8", click: "Ctrl+F10" });
    expect([...registry.active].sort()).toEqual(["Ctrl+F10", "Ctrl+F8"]);
  });
});
