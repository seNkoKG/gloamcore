import { Preferences } from "@capacitor/preferences";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOverviewPayload,
  isWikiCargoPayload,
  isWikiImagePayload,
  mobileBridge,
  sanitizeStoredMobileToolkitWorkspace,
  sanitizeStoredMobileSettings,
  serializeMobileToolkitWorkspace,
} from "./mobile-bridge";

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

afterEach(() => vi.restoreAllMocks());

describe("mobile response payload validation", () => {
  it("requires every market line and associated array entry to be an object", () => {
    expect(isOverviewPayload({ lines: [] })).toBe(true);
    expect(isOverviewPayload({ lines: [null] })).toBe(false);
    expect(isOverviewPayload({ lines: [{}], items: [null] })).toBe(false);
    expect(
      isOverviewPayload({
        lines: [{ id: "one", sparkline: { data: [1, null, 2] } }],
        core: { items: [{ id: "one" }], rates: {} },
      }),
    ).toBe(true);
    expect(
      isOverviewPayload({ lines: [{ id: "one", explicitModifiers: "invalid" }] }),
    ).toBe(false);
  });

  it("rejects malformed Wiki row collections before caching them", () => {
    expect(isWikiCargoPayload({ cargoquery: [{ title: { name: "Divine Orb" } }] }))
      .toBe(true);
    expect(isWikiCargoPayload({ cargoquery: [null] })).toBe(false);
    expect(isWikiImagePayload({ query: { pages: [{ imageinfo: [] }] } })).toBe(
      true,
    );
    expect(isWikiImagePayload({ query: { pages: [null] } })).toBe(false);
  });

  it("repairs corrupt persisted settings instead of returning invalid runtime types", () => {
    const result = sanitizeStoredMobileSettings({
      alwaysOnTop: "false",
      opacity: "zero",
      compact: true,
      shortcuts: { toggleWidget: 42 },
      priceCheck: {
        enabled: "yes",
        hotkey: 12,
        rollTolerance: "NaN",
        maxHistory: Number.POSITIVE_INFINITY,
      },
    });

    expect(result).toMatchObject({
      alwaysOnTop: false,
      opacity: 1,
      compact: true,
      shortcuts: {
        toggleWidget: "CommandOrControl+Shift+E",
      },
      priceCheck: {
        enabled: true,
        hotkey: "CommandOrControl+D",
        rollTolerance: 10,
        maxHistory: 50,
        captureMode: "auto-copy",
      },
    });
    expect(typeof result.alwaysOnTop).toBe("boolean");
    expect(typeof result.opacity).toBe("number");
    expect(typeof result.priceCheck.rollTolerance).toBe("number");
  });

  it("sanitizes and bounds durable mobile toolkit workspaces", () => {
    const workspace = sanitizeStoredMobileToolkitWorkspace({
      version: 1,
      macros: [
        { id: "macro one", label: "Hideout", hotkey: "Ctrl+H", text: "/hideout", enabled: true },
        { id: "broken", hotkey: "", text: "" },
      ],
      cheatSheets: [
        { id: "sheet", title: "Notes", category: "General", body: "Keep", url: "javascript:alert(1)", image: "not-an-image", pinned: true },
      ],
      theme: { accent: "bad", background: "#010203", density: "comfortable" },
      whiteboard: {
        strokes: [{ id: "line", tool: "line", color: "#112233", width: 3, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], ignored: "x".repeat(10_000) }],
        snapshots: [],
      },
      stashScroll: { enabled: true, modifier: "Alt" },
      plugins: [],
    });

    expect(workspace.macros).toHaveLength(1);
    expect(workspace.macros[0]).toMatchObject({ id: "macro-one", text: "/hideout" });
    expect(workspace.cheatSheets[0]).toMatchObject({ url: "", image: "" });
    expect(workspace.theme).toEqual({
      accent: "#35d9b5",
      background: "#010203",
      density: "comfortable",
    });
    expect(workspace.whiteboard.strokes[0]).not.toHaveProperty("ignored");
    expect(workspace.stashScroll).toEqual({ enabled: true, modifier: "Alt" });
    expect(() => sanitizeStoredMobileToolkitWorkspace({ version: 2 })).toThrow(
      /unsupported format/i,
    );

    const image = `data:image/png;base64,${"A".repeat(450_000)}`;
    expect(() => serializeMobileToolkitWorkspace({
      version: 1,
      cheatSheets: Array.from({ length: 5 }, (_, index) => ({
        id: `sheet-${index}`,
        title: `Sheet ${index}`,
        category: "General",
        body: "",
        url: "",
        image,
        pinned: false,
      })),
    })).toThrow(/2 MB safety limit/i);
  });

  it("persists and recovers the mobile toolkit through native Preferences", async () => {
    const storage = new Map<string, string>();
    vi.spyOn(Preferences, "get").mockImplementation(async ({ key }) => ({
      value: storage.get(key) ?? null,
    }));
    vi.spyOn(Preferences, "set").mockImplementation(async ({ key, value }) => {
      storage.set(key, value);
    });
    vi.spyOn(Preferences, "remove").mockImplementation(async ({ key }) => {
      storage.delete(key);
    });

    const saved = await mobileBridge.saveToolkitWorkspace({
      version: 1,
      macros: [{ id: "hideout", label: "Hideout", hotkey: "Ctrl+H", text: "/hideout", enabled: true }],
      cheatSheets: [],
      theme: { accent: "#35d9b5", background: "#080f14", density: "compact" },
      whiteboard: { strokes: [], snapshots: [] },
      overlayBounds: {},
      stashScroll: { enabled: false, modifier: "Ctrl" },
      plugins: [],
    });
    expect(saved.workspace.macros[0].text).toBe("/hideout");
    await expect(mobileBridge.getToolkitWorkspace()).resolves.toMatchObject({
      macros: [{ text: "/hideout" }],
    });

    const recovered = await mobileBridge.recoverToolkitWorkspace();
    expect(recovered.backupName).toMatch(/^toolkit-workspace-v1:recovered:/);
    expect(recovered.workspace.macros).toEqual([]);
    expect(storage.has("toolkit-workspace-v1")).toBe(false);
    expect([...storage.keys()].some((key) => key.startsWith("toolkit-workspace-v1:recovered:")))
      .toBe(true);
  });
});
