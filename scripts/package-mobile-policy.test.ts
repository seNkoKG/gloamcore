/// <reference types="node" />

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  androidReleasePolicy,
  mobilePolicyReleaseStateIsConsistent,
  verifyMobilePolicy,
} from "./verify-release-artifacts.mjs";

const root = process.cwd();
const script = readFileSync(join(root, "scripts", "package-mobile.ps1"), "utf8");

describe("mobile release content boundary", () => {
  it("records the intentionally unbuilt native version against current package source", () => {
    expect(verifyMobilePolicy(root)).toMatchObject({
      releaseState: "unbuilt",
      packageSourceVersion: "3.4.8",
      versionName: "3.4.6",
      versionCode: 54,
    });
  });

  it("does not accept unbuilt metadata as an artifact release policy", () => {
    expect(() => androidReleasePolicy(root, "3.4.8")).toThrow(/release-ready/);
    expect(script).toContain("Requested version $Version does not match package.json");
  });

  it("allows version drift only while the native package is explicitly unbuilt", () => {
    expect(mobilePolicyReleaseStateIsConsistent({
      releaseState: "unbuilt",
      packageSourceVersion: "3.4.8",
      versionName: "3.4.6",
    })).toBe(true);
    expect(mobilePolicyReleaseStateIsConsistent({
      releaseState: "release-ready",
      packageSourceVersion: "3.4.8",
      versionName: "3.4.6",
    })).toBe(false);
    expect(mobilePolicyReleaseStateIsConsistent({
      releaseState: "release-ready",
      packageSourceVersion: "3.4.8",
      versionName: "3.4.8",
    })).toBe(true);
  });

  it.each([
    ["undocumented Trade search", "('/api/trade/' + 'search')"],
    ["undocumented Trade fetch", "('/api/trade/' + 'fetch')"],
    ["undocumented Trade exchange", "('/api/trade/' + 'exchange')"],
    ["undocumented Trade data", "/api/trade/" + "data"],
    ["direct end-user poe.ninja API", "poe\\.ninja/poe1/api/economy"],
    ["rejected PoE account OAuth IPC", "oauth:(?:connect|status|disconnect)"],
    ["rejected PoE stash IPC", "stash:(?:get-leagues|list-tabs|get-tab|sync|progress)"],
    ["rejected PoE character IPC", "planner:(?:list-characters|get-character|import-character-pob)"],
    ["rejected PoE account service", "poe-(?:oauth|stash-sync|character-import)"],
    ["rejected PoE character OAuth scope", "account:characters"],
    ["unsupported second-game", "path\\s+of\\s+exile"],
    ["unsupported second-game", "(?:2(?![.\\d])|ii|two)"],
  ])("scans APK text assets for %s", (label, pattern) => {
    expect(script).toContain(`Label = "${label}"`);
    expect(script).toContain(pattern);
  });

  it("scans bounded APK assets before signing provenance is accepted", () => {
    expect(script).toContain("foreach ($entry in $apkArchive.Entries)");
    expect(script).toContain("$entry.Length -gt 64MB");
    expect(script).toContain("contains forbidden $($forbidden.Label) content");
  });
});
