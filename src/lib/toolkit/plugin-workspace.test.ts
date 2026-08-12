import { describe, expect, it } from "vitest";
import type { ToolkitWorkspace } from "../../types";
import {
  assertPersistablePluginStorage,
  mergePersistedPluginStorageIntoDraft,
  persistedPluginForPreview,
  pluginCapabilities,
  workspaceWithPersistedPluginStorage,
  workspaceWithLatestPersistedPluginStorage,
} from "./plugin-workspace";

function workspace(): ToolkitWorkspace {
  return {
    version: 1,
    macros: [{ id: "saved", label: "Saved", hotkey: "Ctrl+1", text: "/hideout", enabled: false }],
    cheatSheets: [],
    theme: { accent: "#35d9b5", background: "#080f14", density: "compact" },
    whiteboard: { strokes: [], snapshots: [] },
    overlayBounds: {},
    stashScroll: { enabled: false, modifier: "Ctrl" },
    plugins: [{
      id: "plugin",
      name: "Saved plugin",
      url: "https://example.com/tool",
      enabled: true,
      permissions: { currentItem: false, gameCapture: false, openExternal: false },
      storage: { before: "1" },
    }],
  };
}

describe("saved plugin activation boundaries", () => {
  it("refuses previews after unsaved URL or permission changes", () => {
    const saved = workspace();
    const urlDraft = structuredClone(saved);
    urlDraft.plugins[0].url = "https://example.net/unsaved";
    const permissionDraft = structuredClone(saved);
    permissionDraft.plugins[0].permissions.currentItem = true;

    expect(persistedPluginForPreview(saved, saved, "plugin")).toEqual(saved.plugins[0]);
    expect(persistedPluginForPreview(urlDraft, saved, "plugin")).toBeNull();
    expect(persistedPluginForPreview(permissionDraft, saved, "plugin")).toBeNull();
  });

  it("persists storage against the saved snapshot and preserves unrelated draft edits", () => {
    const saved = workspace();
    const draft = structuredClone(saved);
    draft.macros[0].label = "Unsaved macro edit";
    draft.plugins[0].permissions.currentItem = true;

    const storageSave = workspaceWithPersistedPluginStorage(saved, "plugin", { after: "2" });
    expect(storageSave.macros[0].label).toBe("Saved");
    expect(storageSave.plugins[0].permissions.currentItem).toBe(false);

    const merged = mergePersistedPluginStorageIntoDraft(draft, storageSave, "plugin");
    expect(merged.macros[0].label).toBe("Unsaved macro edit");
    expect(merged.plugins[0].permissions.currentItem).toBe(true);
    expect(merged.plugins[0].storage).toEqual({ after: "2" });
  });

  it("rejects storage that the runtime would otherwise truncate silently", () => {
    expect(() => assertPersistablePluginStorage({ "bad key": "value" })).toThrow(/keys may contain/i);
    expect(() => assertPersistablePluginStorage(Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`key-${index}`, "value"]),
    ))).toThrow(/64 keys/);
    expect(() => assertPersistablePluginStorage({ key: "x".repeat(16 * 1024 + 1) })).toThrow(/16 KB/);
  });

  it("does not let a stale editor save roll back host-owned storage", () => {
    const saved = workspace();
    saved.plugins[0].storage = { latest: "2" };
    const draft = workspace();
    draft.macros[0].label = "User edit";
    draft.plugins[0].storage = { before: "1" };

    const reconciled = workspaceWithLatestPersistedPluginStorage(draft, saved);
    expect(reconciled.macros[0].label).toBe("User edit");
    expect(reconciled.plugins[0].storage).toEqual({ latest: "2" });
  });

  it("advertises the complete PoE 1 host capability contract", () => {
    expect(pluginCapabilities()).toEqual(expect.arrayContaining([
      "get-leagues", "get-current-item", "capture-game", "storage:get", "open-external",
    ]));
  });
});
