import { describe, expect, it } from "vitest";
import { defaultPriceCheckSettings } from "./price-check/types";
import { defaultDesktopShortcuts } from "./shortcuts";
import {
  createSerialTaskQueue,
  mergeDesktopSettingsPatch,
  reconcileSettingsSnapshot,
  sanitizeDesktopSettingsPatch,
  sanitizeDesktopSettingsSnapshot,
} from "./settings-sync";

describe("settings synchronization", () => {
  it("keeps pending local fields while accepting unrelated remote fields", () => {
    const local = { hotkey: "Ctrl+F2", tolerance: 14, online: false };
    const result = reconcileSettingsSnapshot({
      authoritative: { hotkey: "Ctrl+D", tolerance: 10, online: true },
      authoritativeRevision: 4,
      incoming: { hotkey: "Ctrl+D", tolerance: 18, online: false },
      incomingRevision: 5,
      local,
      pendingKeys: new Set<keyof typeof local>(["hotkey"]),
    });

    expect(result.accepted).toBe(true);
    expect(result.visible).toEqual({
      hotkey: "Ctrl+F2",
      tolerance: 18,
      online: false,
    });
  });

  it("does not let a stale load or save response replace a newer snapshot", () => {
    const authoritative = { hotkey: "Ctrl+F3", tolerance: 20 };
    const result = reconcileSettingsSnapshot({
      authoritative,
      authoritativeRevision: 9,
      incoming: { hotkey: "Ctrl+F2", tolerance: 10 },
      incomingRevision: 8,
      local: authoritative,
      pendingKeys: [],
    });

    expect(result.accepted).toBe(false);
    expect(result.authoritative).toBe(authoritative);
    expect(result.visible).toEqual(authoritative);
    expect(result.authoritativeRevision).toBe(9);
  });

  it("serializes rapid same-field and different-field writes after failures", async () => {
    const applied: Array<{ hotkey?: string; tolerance?: number }> = [];
    let current = { hotkey: "Ctrl+D", tolerance: 10 };
    const queue = createSerialTaskQueue(async (patch: Partial<typeof current>) => {
      if (patch.hotkey === "invalid") throw new Error("unavailable");
      await Promise.resolve();
      current = { ...current, ...patch };
      applied.push(patch);
      return current;
    });

    const failed = queue.run({ hotkey: "invalid" });
    const first = queue.run({ tolerance: 12 });
    const second = queue.run({ tolerance: 18 });
    const third = queue.run({ hotkey: "Ctrl+F2" });

    await expect(failed).rejects.toThrow("unavailable");
    await expect(Promise.all([first, second, third])).resolves.toBeDefined();
    expect(current).toEqual({ hotkey: "Ctrl+F2", tolerance: 18 });
    expect(applied).toEqual([
      { tolerance: 12 },
      { tolerance: 18 },
      { hotkey: "Ctrl+F2" },
    ]);
  });

  it("preserves every unrelated nested price-check field in partial saves", () => {
    const current = {
      alwaysOnTop: false,
      opacity: 0.9,
      compact: false,
      clickThrough: false,
      startMinimized: false,
      autoCheckUpdates: false,
      updateChannel: "stable" as const,
      shortcuts: defaultDesktopShortcuts,
      priceCheck: {
        ...defaultPriceCheckSettings,
        hotkey: "CommandOrControl+F2",
        rollTolerance: 7,
      },
      settingsRevision: 3,
    };
    const next = mergeDesktopSettingsPatch(current, {
      priceCheck: { defaultOnlineOnly: false },
    });

    expect(next.priceCheck.hotkey).toBe("CommandOrControl+F2");
    expect(next.priceCheck.rollTolerance).toBe(7);
    expect(next.priceCheck.defaultOnlineOnly).toBe(false);
    expect(next.shortcuts).toEqual(defaultDesktopShortcuts);
    expect(next.shortcuts).not.toBe(current.shortcuts);
    expect(current.priceCheck.defaultOnlineOnly).toBe(true);
  });

  it("keeps corrupt persisted and runtime values behind typed settings boundaries", () => {
    const current = {
      alwaysOnTop: false,
      opacity: 0.9,
      compact: false,
      clickThrough: false,
      startMinimized: false,
      autoCheckUpdates: false,
      updateChannel: "stable" as const,
      shortcuts: { ...defaultDesktopShortcuts },
      priceCheck: {
        ...defaultPriceCheckSettings,
        rollTolerance: 7,
        maxHistory: 50,
      },
    };
    const corrupt = {
      alwaysOnTop: "false",
      opacity: "zero",
      compact: true,
      shortcuts: { toggleWidget: 42 },
      priceCheck: {
        enabled: "yes",
        rollTolerance: "NaN",
        maxHistory: 999,
        captureMode: "manual",
      },
      settingsRevision: 99,
    };

    const snapshot = sanitizeDesktopSettingsSnapshot(corrupt, current);
    expect(snapshot).toMatchObject({
      alwaysOnTop: false,
      opacity: 0.9,
      compact: true,
      priceCheck: {
        enabled: true,
        rollTolerance: 7,
        maxHistory: 200,
        captureMode: "auto-copy",
      },
    });
    expect(snapshot).not.toHaveProperty("settingsRevision");
    expect(snapshot.shortcuts.toggleWidget).toBe("");

    const patch = sanitizeDesktopSettingsPatch(corrupt, current);
    const next = mergeDesktopSettingsPatch(current, patch);
    expect(typeof next.alwaysOnTop).toBe("boolean");
    expect(typeof next.opacity).toBe("number");
    expect(typeof next.priceCheck.rollTolerance).toBe("number");
    expect(next).not.toHaveProperty("settingsRevision");
  });
});
