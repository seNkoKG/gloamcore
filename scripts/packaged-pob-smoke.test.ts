import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { _internals } = require("./packaged-pob-smoke.cjs");

describe("packaged PoB release smoke", () => {
  it("accepts only the resources directory beside the executable under test", () => {
    const executable = path.join(process.cwd(), "release-smoke", "PoE Economy Widget.exe");
    const resources = path.join(path.dirname(executable), "resources");
    const realpath = (value: string) => path.resolve(value);

    expect(_internals.resolvePackagedLayout(executable, resources, realpath)).toEqual({
      resourcesPath: path.resolve(resources),
      appAsar: path.join(path.resolve(resources), "app.asar"),
      bundledHost: path.join(path.resolve(resources), "pob-engine", "NinjaLensPobHost-x64.exe"),
    });
    expect(() => _internals.resolvePackagedLayout(
      executable,
      path.join(process.cwd(), "other-release", "resources"),
      realpath,
    )).toThrow(/does not belong to the executable/);
  });

  it("keeps the source smoke and exact resources argument in the release gate", () => {
    const releaseScript = fs.readFileSync(
      path.join(process.cwd(), "scripts", "build-windows-release.ps1"),
      "utf8",
    );
    expect(releaseScript).toContain('$packagedPobSmoke = Join-Path $PSScriptRoot "packaged-pob-smoke.cjs"');
    expect(releaseScript).toContain('$packagedResources = Join-Path $winUnpacked "resources"');
    expect(releaseScript).toContain('-ArgumentList @("`"$packagedPobSmoke`"", "`"$packagedResources`"")');
  });

  it("uses the verified minimal PoE 1 tree contract", () => {
    const xml = _internals.minimalBuild(1);
    expect(xml).toContain('<PathOfBuilding>');
    expect(xml).toContain('level="1"');
    expect(xml).toContain('treeVersion="3_29"');
  });
});
