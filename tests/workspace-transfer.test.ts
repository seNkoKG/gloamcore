import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { browserSupportBundle } from "../src/lib/workspace-transfer";

const require = createRequire(import.meta.url);
const transfer = require("../electron/workspace-transfer.cjs") as {
  createSupportBundle(value: Record<string, unknown>): Record<string, unknown>;
  createWorkspaceBackup(value: Record<string, unknown>): Record<string, unknown>;
  parseWorkspaceBackup(value: unknown): Record<string, unknown>;
  sanitizeRendererStorage(value: unknown): Record<string, string>;
};

describe("workspace transfer boundary", () => {
  it("exports only allowlisted GloamCore storage", () => {
    expect(transfer.sanitizeRendererStorage({
      "gloamcore:preferences:v1": "prefs",
      "gloamcore:atlas-command-center:v1": "atlas",
      "gloamcore:unknown-secret": "no",
      token: "no",
    })).toEqual({
      "gloamcore:preferences:v1": "prefs",
      "gloamcore:atlas-command-center:v1": "atlas",
    });
  });

  it("round-trips the versioned workspace envelope and rejects lookalikes", () => {
    const backup = transfer.createWorkspaceBackup({
      appVersion: "3.4.0",
      createdAt: 42,
      renderer: { "gloamcore:preferences:v1": "{}" },
      native: { settings: { opacity: 1 } },
    });
    expect(transfer.parseWorkspaceBackup(backup)).toEqual(backup);
    expect(() => transfer.parseWorkspaceBackup({ version: 1 })).toThrow(/supported/);
  });

  it("creates a support bundle without accepting paths or user content", () => {
    const bundle = transfer.createSupportBundle({
      appVersion: "3.4.0",
      platform: "win32",
      arch: "x64",
      packaged: true,
      update: { status: "idle", channel: "preview", message: "C:\\secret" },
      context: {
        display: { theme: "gloam" },
        data: { gameVersion: "3.29.1", revision: "abc" },
        storage: { savedBuilds: 3 },
        capabilities: { pobEngine: true },
        path: "C:\\Users\\name",
        character: "PrivateName",
      },
    });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("C:\\secret");
    expect(serialized).not.toContain("PrivateName");
    expect(bundle).toMatchObject({
      update: { channel: "preview" },
      storage: { savedBuilds: 3 },
      privacy: { includesPaths: false, includesItemText: false },
    });
  });

  it("applies the same explicit support allowlist in browser and mobile bundles", () => {
    const bundle = browserSupportBundle("3.4.0", {
      display: { theme: "gloam", density: "compact", textScale: "normal", reducedMotion: false, colorVision: "standard" },
      data: { gameVersion: "3.29.1", revision: "abc", atlasNodes: 100, gems: 200 },
      storage: { preferences: 1, atlasPresets: 2, savedBuilds: 3, filterCheckpoints: 4, toolkitMacros: 5 },
      capabilities: { pobEngine: true, desktopUpdater: false, toolkitFiles: false, mappingJournal: false },
      path: "C:\\Users\\Private",
    } as never);
    expect(JSON.stringify(bundle)).not.toContain("Private");
    expect(bundle).toMatchObject({ data: { atlasNodes: 100 }, storage: { savedBuilds: 3 } });
  });
});
