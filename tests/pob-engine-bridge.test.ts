import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  CONTRACT_VERSION,
  MAX_BUILD_BYTES,
  analyzePobNodes,
  calculatePobBuild,
  diagnosePobEngine,
  huntPobTimeless,
  inspectInstallation,
  previewPobTimeless,
  _internals,
} = require("../electron/pob-engine-bridge.cjs");

function minimalBuild(level: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="${level}" targetVersion="3_0" bandit="None" className="Scion" ascendClassName="None" mainSocketGroup="1" viewMode="CALCS" pantheonMajorGod="None" pantheonMinorGod="None" />
  <Import />
  <Calcs />
  <Skills activeSkillSet="1" sortGemsByDPS="false"><SkillSet id="1" /></Skills>
  <Tree activeSpec="1"><Spec title="Default" treeVersion="3_29" classId="0" ascendClassId="0" nodes="" /></Tree>
  <Items activeItemSet="1"><ItemSet id="1" /></Items>
  <Config activeConfigSet="1"><ConfigSet id="1" /></Config>
  <Notes />
</PathOfBuilding>`;
}

function mainSkillBuild(mainActiveSkill: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Scion" ascendClassName="None" mainSocketGroup="1" viewMode="CALCS" />
  <Import />
  <Calcs />
  <Skills activeSkillSet="1"><SkillSet id="1"><Skill slot="Weapon 1" enabled="true" includeInFullDPS="false" mainActiveSkill="${mainActiveSkill}" mainActiveSkillCalcs="${mainActiveSkill}"><Gem nameSpec="Blood Rage" skillId="BloodRage" gemId="Metadata/Items/Gems/SkillGemBloodRage" level="20" quality="0" enabled="true"/><Gem nameSpec="Kinetic Blast" skillId="KineticBlast" gemId="Metadata/Items/Gems/SkillGemKineticBlast" level="20" quality="0" enabled="true"/></Skill></SkillSet></Skills>
  <Tree activeSpec="1"><Spec title="Default" treeVersion="3_29" classId="0" ascendClassId="0" nodes="" /></Tree>
  <Items activeItemSet="1"><Item id="1">Rarity: NORMAL\nDriftwood Wand</Item><ItemSet id="1"><Slot name="Weapon 1" itemId="1"/></ItemSet></Items>
  <Config activeConfigSet="1"><ConfigSet id="1" /></Config>
  <Notes />
</PathOfBuilding>`;
}

describe("authoritative local Path of Building bridge", () => {
  it("reports a missing installation without inventing calculations", async () => {
    const missing = path.join(os.tmpdir(), `gloamcore-missing-pob-${process.pid}-${Date.now()}`);
    const diagnostic = diagnosePobEngine({ pobRoot: missing });
    expect(diagnostic).toMatchObject({
      ok: false,
      authoritative: false,
      available: false,
      code: "POB_NOT_INSTALLED",
      contractVersion: CONTRACT_VERSION,
    });

    const result = await calculatePobBuild({ xml: minimalBuild(1) }, { pobRoot: missing });
    expect(result).toMatchObject({ ok: false, authoritative: false, code: "POB_NOT_INSTALLED" });
    expect(result).not.toHaveProperty("calculation");
  });

  it("fails closed for a Path of Building version this app has not proven", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-pob-version-"));
    try {
      fs.writeFileSync(path.join(root, "manifest.xml"), '<PoBVersion><Version branch="master" number="99.99.99" platform="win32" /></PoBVersion>', "utf8");
      expect(inspectInstallation({ pobRoot: root })).toMatchObject({
        ok: false,
        authoritative: false,
        code: "POB_VERSION_UNVERIFIED",
        supportedVersions: ["2.67.2"],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a claimed supported release does not match official source/runtime", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-pob-source-"));
    try {
      fs.writeFileSync(path.join(root, "manifest.xml"), '<PoBVersion><Version branch="master" number="2.67.2" platform="win32" /></PoBVersion>', "utf8");
      const result = inspectInstallation({ pobRoot: root });
      expect(result).toMatchObject({ ok: false, authoritative: false, code: "POB_SOURCE_UNVERIFIED" });
      expect(result.mismatches.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats official LF and updater-installed CRLF Lua as the same verified source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-pob-line-endings-"));
    try {
      const lf = path.join(root, "lf.lua");
      const crlf = path.join(root, "crlf.lua");
      fs.writeFileSync(lf, "local value = 1\nreturn value\n", "utf8");
      fs.writeFileSync(crlf, "local value = 1\r\nreturn value\r\n", "utf8");
      expect(_internals.canonicalSourceSha1(crlf)).toBe(_internals.canonicalSourceSha1(lf));
      fs.writeFileSync(crlf, "local value = 2\r\nreturn value\r\n", "utf8");
      expect(_internals.canonicalSourceSha1(crlf)).not.toBe(_internals.canonicalSourceSha1(lf));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed and oversized XML before starting an engine", async () => {
    await expect(calculatePobBuild({ xml: "not a build" })).resolves.toMatchObject({
      ok: false,
      authoritative: false,
      code: "POB_XML_INVALID",
    });
    await expect(calculatePobBuild({ xml: `<PathOfBuilding>${"x".repeat(MAX_BUILD_BYTES)}</PathOfBuilding>` })).resolves.toMatchObject({
      ok: false,
      authoritative: false,
      code: "POB_XML_INVALID",
    });
  });

  it("rejects malformed passive-analysis and Timeless Jewel requests before starting an engine", async () => {
    await expect(analyzePobNodes({ xml: "not a build", maxPoints: 5 })).resolves.toMatchObject({ code: "POB_XML_INVALID", authoritative: false });
    await expect(previewPobTimeless({ xml: minimalBuild(1), jewelType: 2, socketId: "not-a-socket", seed: 10000 })).resolves.toMatchObject({ code: "POB_TIMELESS_REQUEST_INVALID", authoritative: false });
    await expect(huntPobTimeless({ xml: minimalBuild(1), jewelType: null, socketId: null, targets: [] })).resolves.toMatchObject({ code: "POB_TIMELESS_REQUEST_INVALID", authoritative: false });
  });

  it("rejects malformed exact-analysis result envelopes", () => {
    const installation = { engine: { number: "2.67.2", branch: "master", platform: "win32" } };
    const authority = { ok: true, authoritative: true, readOnly: true, freshProcess: true, engineVersion: "2.67.2", engineBranch: "master", enginePlatform: "win32" };
    expect(_internals.validateNodeAnalysisWorkerPayload({ ...authority, operation: "analyze-nodes", nodePowers: [{ id: 1, distance: 1, offence: Number.NaN, defence: 0, singleStat: 0 }] }, installation)).toMatchObject({ code: "POB_NODE_ANALYSIS_INVALID" });
    expect(_internals.validateTimelessPreviewWorkerPayload({ ...authority, operation: "preview-timeless", socketId: 2491, seed: 10000, jewelType: 2, affectedNodes: [{ id: 1, name: "Node", transformedName: "Result", stats: [null] }] }, installation)).toMatchObject({ code: "POB_TIMELESS_PREVIEW_INVALID" });
    expect(_internals.validateTimelessHuntWorkerPayload({ ...authority, operation: "hunt-timeless", socketId: 2491, jewelType: 2, catalog: [], results: [{ seed: 10000, score: Infinity, hits: [] }] }, installation)).toMatchObject({ code: "POB_TIMELESS_HUNT_INVALID" });
  });

  it("kills an active host process when its worker operation is cancelled", async () => {
    const controller = new AbortController();
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let killCount = 0;
    child.kill = () => {
      killCount += 1;
      return true;
    };

    const resultPromise = _internals.runWorker(
      { path: "fixture-host.exe" },
      {
        paths: {
          "pob-headless-wrapper.lua": "fixture-wrapper.lua",
          "pob-engine-worker.lua": "fixture-worker.lua",
        },
      },
      { root: "C:\\fixture-pob" },
      { xml: minimalBuild(1) },
      {
        signal: controller.signal,
        spawnImpl: () => child,
        timeoutMilliseconds: 5_000,
      },
    );

    controller.abort();
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      authoritative: false,
      code: "POB_CANCELLED",
    });
    expect(killCount).toBe(1);
  });

  it("rejects a result from a different engine identity", () => {
    const validation = _internals.validateWorkerPayload({
      ok: true,
      authoritative: true,
      readOnly: true,
      freshProcess: true,
      engineVersion: "2.67.1",
      engineBranch: "master",
      enginePlatform: "win32",
      scalarCount: 1,
      stats: { Life: 60 },
    }, {
      engine: { number: "2.67.2", branch: "master", platform: "win32" },
    });
    expect(validation).toMatchObject({ ok: false, authoritative: false, code: "POB_ENGINE_CHANGED" });
  });

  const capability = diagnosePobEngine();
  it.runIf(capability.available)("calculates the selected Kinetic Blast instead of stale Blood Rage output", async () => {
    const bloodRage = await calculatePobBuild({ xml: mainSkillBuild(1), name: "Blood Rage selection" });
    const kineticBlast = await calculatePobBuild({ xml: mainSkillBuild(2), name: "Kinetic Blast selection" });

    expect(bloodRage).toMatchObject({ ok: true, calculation: { mainSkillName: "Blood Rage", stats: { CombinedDPS: 0 } } });
    expect(kineticBlast).toMatchObject({ ok: true, calculation: { mainSkillName: "Kinetic Blast" } });
    expect(kineticBlast.calculation.stats.CombinedDPS).toBeGreaterThan(0);
    expect(kineticBlast.calculation.stats.TotalDPS).toBeGreaterThan(0);
  }, 20_000);

  it.runIf(capability.available)("uses PoB's exact passive power and official Timeless Jewel lookup tables", async () => {
    const analysis = await analyzePobNodes({ xml: minimalBuild(1), maxPoints: 2 });
    expect(analysis).toMatchObject({ ok: true, authoritative: true, engine: { version: "2.67.2" }, analysis: { maxPoints: 2 } });
    expect(analysis.analysis.nodePowers.length).toBeGreaterThan(0);
    expect(analysis.analysis.nodePowers.every((node: { offence: number; defence: number }) => Number.isFinite(node.offence) && Number.isFinite(node.defence))).toBe(true);

    const preview = await previewPobTimeless({ xml: minimalBuild(1), jewelType: 2, conquerorId: 1, socketId: 2491, seed: 10000 });
    expect(preview).toMatchObject({ ok: true, authoritative: true, preview: { jewelName: "Lethal Pride", seed: 10000, socketId: 2491, minimumSeed: 10000, maximumSeed: 18000, seedStep: 1 } });
    expect(preview.preview.affectedNodes.length).toBeGreaterThan(0);

    const catalog = await huntPobTimeless({ xml: minimalBuild(1), jewelType: 2, socketId: 2491, targets: [], scope: "radius", maxResults: 5 });
    expect(catalog).toMatchObject({ ok: true, authoritative: true, hunt: { jewelName: "Lethal Pride", searchedSeeds: 0 } });
    expect(catalog.hunt.catalog.length).toBeGreaterThan(20);
    expect(catalog.hunt.catalog.some((entry: { id: string }) => entry.id === "karui_notable_add_armour")).toBe(true);

    const hunt = await huntPobTimeless({
      xml: minimalBuild(1), jewelType: 2, socketIds: [2491, 61834], scope: "radius", maxResults: 5,
      targets: [{ id: "karui_notable_add_armour", weight: 1, minimum: 1 }],
    });
    expect(hunt).toMatchObject({ ok: true, authoritative: true, hunt: { searchedSeeds: 16002, socketCount: 2, socketIds: [2491, 61834] } });
    expect(hunt.hunt.results.length).toBeGreaterThan(0);
    expect([2491, 61834]).toContain(hunt.hunt.results[0].socketId);
    expect(hunt.hunt.results[0].hits[0]).toMatchObject({ id: "karui_notable_add_armour", weightedValue: expect.any(Number) });

    const heroic = await previewPobTimeless({ xml: minimalBuild(1), jewelType: 6, conquerorId: 1, socketId: 2491, seed: 100 });
    expect(heroic).toMatchObject({ ok: true, authoritative: true, preview: { jewelName: "Heroic Tragedy", seed: 100, minimumSeed: 100, maximumSeed: 8000, seedStep: 1 } });
    expect(heroic.preview.affectedNodes.some((node: { stats: string[] }) => node.stats.some((stat) => stat.includes("Ward")))).toBe(true);
  }, 45_000);

  it.runIf(capability.available)("calculates A to B to A in isolated official PoB processes", async () => {
    const firstA = await calculatePobBuild({ xml: minimalBuild(1), name: "fresh-process A1" });
    const middleB = await calculatePobBuild({ xml: minimalBuild(80), name: "fresh-process B" });
    const secondA = await calculatePobBuild({ xml: minimalBuild(1), name: "fresh-process A2" });

    for (const result of [firstA, middleB, secondA]) {
      expect(result).toMatchObject({
        ok: true,
        authoritative: true,
        contractVersion: CONTRACT_VERSION,
        engine: { version: "2.67.2" },
        isolation: { freshProcess: true, installedPobReadOnly: true, noGuiLaunch: true },
      });
      expect(result.calculation.scalarCount).toBeGreaterThan(100);
      expect(Number.isFinite(result.calculation.stats.Life)).toBe(true);
    }
    expect(firstA.calculation.stats.Life).toBe(secondA.calculation.stats.Life);
    expect(middleB.calculation.stats.Life).not.toBe(firstA.calculation.stats.Life);
    expect(firstA.engine.sourceFingerprint).toBe(secondA.engine.sourceFingerprint);
  }, 30_000);
});
