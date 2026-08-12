import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  MAX_INLINE_IMAGE_CHARS,
  MAX_WORKSPACE_BYTES,
  createToolkitRuntimeStore,
  sanitizeBoardElements,
  sanitizeOverlayBounds,
  sanitizePluginStorage,
  sanitizeWorkspace,
} = require("../electron/toolkit-runtime.cjs");

describe("toolkit runtime settings", () => {
  it("sanitizes macro text and rejects non-HTTPS cheat/plugin URLs", () => {
    const value = sanitizeWorkspace({
      macros: [{ id: "home", hotkey: "F5", text: "/hideout\n" }],
      cheatSheets: [{ title: "Safe", url: "https://example.com/a" }, { title: "Bad", url: "file:///secret" }, { title: "Credentials", url: "https://user@example.com/a" }],
      plugins: [{ name: "Bad", url: "javascript:alert(1)", enabled: true }, { name: "Incomplete", url: "https://", enabled: true }],
      theme: { accent: "red", background: "#101010", density: "comfortable" },
    });
    expect(value.macros[0].text).toBe("/hideout");
    expect(value.macros[0].enabled).toBe(false);
    expect(value.cheatSheets).toHaveLength(1);
    expect(value.plugins).toHaveLength(0);
    expect(value.theme).toEqual({ accent: "#35d9b5", background: "#101010", density: "comfortable" });
  });

  it("keeps finite overlay geometry and clamps unsafe dimensions", () => {
    expect(sanitizeOverlayBounds({ x: -900, y: 40.4, width: 100, height: 9000 })).toEqual({
      x: -900,
      y: 40,
      width: 320,
      height: 4096,
    });
    expect(sanitizeOverlayBounds({ x: "no", y: 0, width: 600, height: 400 })).toBeUndefined();
    expect(sanitizeWorkspace({ overlayBounds: { cheats: { x: 10, y: 20, width: 620, height: 580 } } }).overlayBounds.cheats).toEqual({ x: 10, y: 20, width: 620, height: 580 });
  });

  it("validates artboard elements, snapshots, images, and opt-in stash scrolling", () => {
    const image = "data:image/png;base64,aGVsbG8=";
    expect(sanitizeBoardElements([
      { id: "line", tool: "line", color: "#ffffff", width: 2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
      { id: "bad", tool: "script", points: [{ x: 1, y: 2 }] },
      { id: "image", tool: "image", src: "https://tracker.invalid/x.png", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    ])).toHaveLength(1);
    const value = sanitizeWorkspace({
      cheatSheets: [{ title: "Image", image }],
      whiteboard: { strokes: [{ id: "image", tool: "image", src: image, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }], snapshots: [{ name: "One", strokes: [] }] },
      stashScroll: { enabled: true, modifier: "Alt" },
    });
    expect(value.cheatSheets[0].image).toBe(image);
    expect(value.whiteboard.strokes).toHaveLength(1);
    expect(value.whiteboard.snapshots[0].name).toBe("One");
    expect(value.stashScroll).toEqual({ enabled: true, modifier: "Alt" });
    expect(sanitizeWorkspace({}).stashScroll.enabled).toBe(false);
  });

  it("keeps plugin capabilities opt-in and storage strictly namespaced and bounded", () => {
    const workspace = sanitizeWorkspace({ plugins: [{
      id: "price-helper",
      name: "Price helper",
      url: "https://plugins.example/app",
      enabled: true,
      permissions: { currentItem: true, gameCapture: false, openExternal: true },
      storage: { "safe:key": "value", "bad key": "also kept under a safe key", ignored: 10 },
    }] });
    expect(workspace.plugins[0]).toMatchObject({
      id: "price-helper",
      permissions: { currentItem: true, gameCapture: false, openExternal: true },
      storage: { "safe:key": "value", "bad-key": "also kept under a safe key" },
    });
    expect(sanitizePluginStorage({ huge: "x".repeat(20_000) }).huge).toHaveLength(16 * 1024);
    expect(sanitizeWorkspace({ plugins: [{ name: "Legacy", url: "https://example.com", enabled: true }] }).plugins[0]).toMatchObject({
      permissions: { currentItem: false, gameCapture: false, openExternal: false },
      storage: {},
    });
    expect(sanitizeWorkspace({ plugins: [{ name: "Draft", url: "", enabled: true }] }).plugins[0]).toMatchObject({
      name: "Draft",
      url: "",
      enabled: false,
    });
  });

  it("deduplicates macro and plugin identities before they reach shortcut or storage maps", () => {
    const workspace = sanitizeWorkspace({
      macros: [
        { id: "same", hotkey: "F5", text: "/hideout" },
        { id: "same", hotkey: "F6", text: "/remaining" },
      ],
      plugins: [
        { id: "same", name: "One", url: "https://one.example" },
        { id: "same", name: "Two", url: "https://two.example" },
      ],
    });
    expect(new Set(workspace.macros.map((entry: { id: string }) => entry.id)).size).toBe(2);
    expect(new Set(workspace.plugins.map((entry: { id: string }) => entry.id)).size).toBe(2);
  });

  it("preserves a corrupt workspace until the user explicitly recovers it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-toolkit-runtime-"));
    const file = path.join(root, "toolkit-workspace.json");
    fs.writeFileSync(file, "{broken", "utf8");
    const store = createToolkitRuntimeStore(root);
    store.load();
    expect(store.error()).toMatch(/could not be loaded/i);
    expect(() => store.save({})).toThrow(/recover it explicitly/i);
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");

    const recovered = store.recover();
    expect(recovered.backupName).toMatch(/\.bak$/);
    expect(fs.readFileSync(path.join(root, recovered.backupName), "utf8")).toBe("{broken");
    expect(store.error()).toBeNull();
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ version: 1 });
  });

  it("latches an oversized workspace without reading it as active or overwriting it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-toolkit-oversized-load-"));
    const file = path.join(root, "toolkit-workspace.json");
    fs.writeFileSync(file, `{"padding":"${"x".repeat(MAX_WORKSPACE_BYTES)}"}`, "utf8");
    const before = fs.statSync(file).size;
    const store = createToolkitRuntimeStore(root);
    store.load();
    expect(store.error()).toMatch(/2 MB safety limit/i);
    expect(() => store.save({})).toThrow(/recover it explicitly/i);
    expect(fs.statSync(file).size).toBe(before);
  });

  it("rejects oversized and cumulative images without replacing the last good workspace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-toolkit-budget-"));
    const store = createToolkitRuntimeStore(root);
    store.load();
    store.save({ macros: [{ id: "safe", hotkey: "F5", text: "/hideout" }] });
    const before = fs.readFileSync(store.filePath, "utf8");
    const prefix = "data:image/png;base64,";
    expect(() => store.save({
      cheatSheets: [{ title: "Too large", image: prefix + "a".repeat(MAX_INLINE_IMAGE_CHARS) }],
    })).toThrow(/image is too large/i);
    expect(fs.readFileSync(store.filePath, "utf8")).toBe(before);

    const image = prefix + "a".repeat(MAX_INLINE_IMAGE_CHARS - prefix.length - 32);
    expect(() => store.save({
      cheatSheets: Array.from({ length: 5 }, (_, index) => ({
        id: String(index),
        title: `Image ${index}`,
        image,
      })),
    })).toThrow(/2 MB safety limit/i);
    expect(fs.readFileSync(store.filePath, "utf8")).toBe(before);
  });
});
