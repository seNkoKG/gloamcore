import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoForbiddenText,
  assertPublicUpdateConfig,
  closeAsar,
  expectedAppUpdateYaml,
  githubUpdateConfiguration,
  readAsar,
} from "./verify-release-artifacts.mjs";

const windowsReleaseScript = readFileSync(
  join(process.cwd(), "scripts", "build-windows-release.ps1"),
  "utf8",
);

describe("Windows release publication boundary", () => {
  it("keeps electron-builder offline until verified artifacts reach the hardened publisher", () => {
    expect(windowsReleaseScript).toContain(
      "exec electron-builder --win nsis portable --publish never",
    );
    expect(windowsReleaseScript.indexOf("--publish never")).toBeLessThan(
      windowsReleaseScript.indexOf('"verify-release-artifacts.mjs"'),
    );
  });

  it("checks real source content instead of Windows stat-cache noise", () => {
    expect(windowsReleaseScript).toContain("git diff --quiet --exit-code -- .");
    expect(windowsReleaseScript).toContain("git diff --cached --quiet --exit-code -- .");
    expect(windowsReleaseScript).toContain("git ls-files --others --exclude-standard");
    expect(windowsReleaseScript).not.toContain("git status --porcelain --untracked-files=all");
  });
});

function minimalAsar(jsonText: string, extraPayloadBytes = 0) {
  const json = Buffer.from(jsonText, "utf8");
  const alignedJsonSize = Math.ceil(json.length / 4) * 4;
  const headerPayloadSize = 4 + alignedJsonSize + extraPayloadBytes;
  const headerSize = 4 + headerPayloadSize;
  const archive = Buffer.alloc(8 + headerSize);
  archive.writeUInt32LE(4, 0);
  archive.writeUInt32LE(headerSize, 4);
  archive.writeUInt32LE(headerPayloadSize, 8);
  archive.writeUInt32LE(json.length, 12);
  json.copy(archive, 16);
  return archive;
}

describe("desktop release Trade endpoint policy", () => {
  it("permits search and fetch only in the current price snapshot client", () => {
    for (const route of ["search", "fetch"]) {
      const payload = Buffer.from(["/api/trade", route, ""].join("/"));
      expect(() => assertNoForbiddenText(
        "price snapshot client",
        payload,
        "electron/trade-price-snapshot.cjs",
      )).not.toThrow();
      for (const relativePath of [
        "electron/main.cjs",
        "electron/official-trade-listings.cjs",
        "dist/assets/index.js",
      ]) {
        expect(() => assertNoForbiddenText(
          relativePath,
          payload,
          relativePath,
        )).toThrow(/outside the price snapshot client/i);
      }
    }
    for (const route of ["exchange", "data"]) {
      expect(() => assertNoForbiddenText(
        "price snapshot client",
        Buffer.from(["/api/trade", route, ""].join("/")),
        "electron/trade-price-snapshot.cjs",
      )).toThrow(/Trade/i);
    }
  });

  it("continues to reject legacy automation in every path", () => {
    expect(() => assertNoForbiddenText(
      "vetted client",
      Buffer.from("price-check:search-trade"),
      "electron/main.cjs",
    )).toThrow(/legacy Trade IPC/i);
  });
});

describe("desktop release poe.ninja proxy boundary", () => {
  it("rejects direct economy API clients but permits user-facing economy links", () => {
    expect(() => assertNoForbiddenText(
      "app.asar",
      Buffer.from("https://poe.ninja/poe1/api/economy/leagues"),
      "electron/main.cjs",
    )).toThrow(/direct end-user poe\.ninja API/i);
    expect(() => assertNoForbiddenText(
      "app.asar",
      Buffer.from("https://poe.ninja/poe1/economy/Allflame/currency"),
      "dist/assets/index.js",
    )).not.toThrow();
  });
});

describe("desktop release rejected PoE account boundary", () => {
  it.each([
    "oauth:connect",
    "stash:sync",
    "planner:list-characters",
    "poe-character-import.cjs",
    '"import-character"',
    "account:characters",
  ])("rejects %s from packaged application content", (forbidden) => {
    expect(() => assertNoForbiddenText(
      "app.asar",
      Buffer.from(forbidden),
      "electron/main.cjs",
    )).toThrow(/rejected PoE/i);
  });
});

describe("desktop release single-game boundary", () => {
  it.each([
    ["PoE", String(1 + 1)].join(" "),
    ["Path of Exile", "I".repeat(2)].join(" "),
    ["PoB", ["t", "w", "o"].join("")].join(" "),
  ])("rejects unsupported game marker %s from packaged application content", (marker) => {
    expect(() => assertNoForbiddenText(
      "app.asar",
      Buffer.from(marker),
      "electron/main.cjs",
    )).toThrow(/unsupported second-game/i);
  });

  it("does not confuse pinned PoB release versions with a game marker", () => {
    expect(() => assertNoForbiddenText(
      "app.asar",
      Buffer.from("Path of Building 2.67.2; PoB 2.67.2"),
      "electron/main.cjs",
    )).not.toThrow();
  });
});

describe("desktop release GitHub update policy", () => {
  const packageMetadata = {
    name: "gloamcore",
    build: {
      publish: [{
        provider: "github",
        owner: "seNkoKG",
        repo: "gloamcore",
      }],
    },
  };

  it("pins the public token-free repository in package and packaged YAML metadata", () => {
    expect(githubUpdateConfiguration(packageMetadata)).toEqual({
      provider: "github",
      owner: "seNkoKG",
      repo: "gloamcore",
    });
    expect(expectedAppUpdateYaml(packageMetadata)).toBe([
      "owner: seNkoKG",
      "repo: gloamcore",
      "provider: github",
      "updaterCacheDirName: gloamcore-updater",
    ].join("\n"));
    expect(() => assertPublicUpdateConfig({
      enabled: true,
      provider: "github",
      owner: "seNkoKG",
      repo: "gloamcore",
    }, packageMetadata)).not.toThrow();
  });

  it("rejects generic, private, authenticated, disabled, and mismatched channels", () => {
    for (const publish of [
      { provider: "generic", url: "https://example.test" },
      { provider: "github", owner: "someone-else", repo: "gloamcore" },
      { provider: "github", owner: "seNkoKG", repo: "gloamcore", private: true },
      { provider: "github", owner: "seNkoKG", repo: "gloamcore", token: "secret" },
    ]) {
      expect(() => githubUpdateConfiguration({
        ...packageMetadata,
        build: { publish: [publish] },
      })).toThrow(/public GitHub update configuration/i);
    }

    for (const updateConfig of [
      { enabled: false, provider: "github", owner: "seNkoKG", repo: "gloamcore" },
      { enabled: true, provider: "github", owner: "seNkoKG", repo: "elsewhere" },
      { enabled: true, provider: "github", owner: "seNkoKG", repo: "gloamcore", token: "secret" },
    ]) {
      expect(() => assertPublicUpdateConfig(updateConfig, packageMetadata))
        .toThrow(/token-free public GitHub release channel/i);
    }
  });
});

describe("desktop release ASAR header validation", () => {
  it("accepts a current Electron string pickle with zero alignment padding", () => {
    let header = JSON.stringify({ files: {} });
    while (Buffer.byteLength(header, "utf8") % 4 !== 0) header += " ";
    const directory = mkdtempSync(join(tmpdir(), "gloamcore-asar-"));
    const archivePath = join(directory, "app.asar");
    writeFileSync(archivePath, minimalAsar(header));
    try {
      const archive = readAsar(archivePath);
      expect(archive.entries.size).toBe(0);
      closeAsar(archive);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects payload bytes beyond the pickle's maximum alignment padding", () => {
    const directory = mkdtempSync(join(tmpdir(), "gloamcore-asar-invalid-"));
    const archivePath = join(directory, "app.asar");
    writeFileSync(
      archivePath,
      minimalAsar(JSON.stringify({ files: {} }), 4),
    );
    try {
      expect(() => readAsar(archivePath)).toThrow(/header lengths are invalid/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
