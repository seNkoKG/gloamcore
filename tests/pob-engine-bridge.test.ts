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
  MAX_CHARACTER_BYTES,
  analyzePobNodes,
  calculatePobBuild,
  diagnosePobEngine,
  huntPobTimeless,
  importPobCharacter,
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
        supportedVersions: ["2.66.1"],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a claimed supported release does not match official source/runtime", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-pob-source-"));
    try {
      fs.writeFileSync(path.join(root, "manifest.xml"), '<PoBVersion><Version branch="master" number="2.66.1" platform="win32" /></PoBVersion>', "utf8");
      const result = inspectInstallation({ pobRoot: root });
      expect(result).toMatchObject({ ok: false, authoritative: false, code: "POB_SOURCE_UNVERIFIED" });
      expect(result.mismatches.length).toBeGreaterThan(0);
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
    const installation = { engine: { number: "2.66.1", branch: "master", platform: "win32" } };
    const authority = { ok: true, authoritative: true, readOnly: true, freshProcess: true, engineVersion: "2.66.1", engineBranch: "master", enginePlatform: "win32" };
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

  it("rejects malformed and oversized character payloads before starting an engine", async () => {
    await expect(importPobCharacter({ character: null })).resolves.toMatchObject({
      ok: false,
      authoritative: false,
      code: "POB_CHARACTER_INVALID",
    });
    await expect(importPobCharacter({ character: { padding: "x".repeat(MAX_CHARACTER_BYTES) } })).resolves.toMatchObject({
      ok: false,
      authoritative: false,
      code: "POB_CHARACTER_INVALID",
    });
  });

  it("rejects a result from a different engine identity", () => {
    const validation = _internals.validateWorkerPayload({
      ok: true,
      authoritative: true,
      readOnly: true,
      freshProcess: true,
      engineVersion: "2.66.2",
      engineBranch: "master",
      enginePlatform: "win32",
      scalarCount: 1,
      stats: { Life: 60 },
    }, {
      engine: { number: "2.66.1", branch: "master", platform: "win32" },
    });
    expect(validation).toMatchObject({ ok: false, authoritative: false, code: "POB_ENGINE_CHANGED" });
  });

  const capability = diagnosePobEngine();
  it.runIf(capability.available)("uses PoB's exact passive power and official Timeless Jewel lookup tables", async () => {
    const analysis = await analyzePobNodes({ xml: minimalBuild(1), maxPoints: 2 });
    expect(analysis).toMatchObject({ ok: true, authoritative: true, engine: { version: "2.66.1" }, analysis: { maxPoints: 2 } });
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

  it.runIf(capability.available)("imports official characters through PoB's exact item, socket, gem, and jewel logic", async () => {
    const imported = await importPobCharacter({
      character: {
        name: "GloamCore parity fixture",
        class: "Scion",
        level: 90,
        league: "Standard",
        equipment: [
          {
            id: "helmet-fixture",
            frameType: 2,
            name: "Storm Crown",
            typeLine: "Hubris Circlet",
            inventoryId: "Helm",
            ilvl: 84,
            properties: [
              { name: "Quality", values: [["+20%", 1]] },
              { name: "Energy Shield", values: [["100", 0]] },
            ],
            sockets: [
              { group: 1, sColour: "G" },
              { group: 2, sColour: "B" },
              { group: 2, sColour: "B" },
              { group: 3, sColour: "B" },
            ],
            socketedItems: [
              { id: "grace-fixture", frameType: 4, typeLine: "Grace", socket: 0, properties: [{ name: "Level", values: [["20", 0]] }] },
              { id: "arc-fixture", frameType: 4, typeLine: "Arc", socket: 1, properties: [{ name: "Level", values: [["20", 0]] }, { name: "Quality", values: [["20%", 0]] }] },
              { id: "added-lightning-fixture", frameType: 4, typeLine: "Added Lightning Damage Support", support: true, socket: 2, properties: [{ name: "Level", values: [["20", 0]] }] },
              {
                id: "firestorm-pelting-fixture",
                frameType: 4,
                typeLine: "Firestorm of Pelting",
                socket: 3,
                hybrid: { baseTypeName: "Firestorm of Pelting", isVaalGem: false },
                properties: [{ name: "Level", values: [["20", 0]] }, { name: "Quality", values: [["20%", 0]] }],
              },
            ],
          },
          { id: "flask-fixture", frameType: 0, name: "", typeLine: "Small Life Flask", inventoryId: "Flask", x: 0, ilvl: 1, properties: [] },
          {
            id: "belt-fixture",
            frameType: 0,
            name: "",
            typeLine: "Stygian Vise",
            inventoryId: "Belt",
            ilvl: 84,
            properties: [],
            implicitMods: ["Has 1 Abyssal Socket"],
            sockets: [{ group: 0, sColour: "A" }],
            socketedItems: [{
              id: "abyss-fixture",
              frameType: 2,
              name: "Doom Gaze",
              typeLine: "Ghastly Eye Jewel",
              abyssJewel: true,
              socket: 0,
              ilvl: 84,
              properties: [],
              explicitMods: ["+30 to maximum Life"],
            }],
          },
        ],
        jewels: [{
          id: "jewel-fixture",
          frameType: 2,
          name: "Storm Ornament",
          typeLine: "Cobalt Jewel",
          inventoryId: "PassiveJewels",
          x: 0,
          ilvl: 80,
          properties: [],
          explicitMods: ["+10 to Intelligence"],
        }],
        passives: {
          hashes: [26725],
          hashes_ex: [],
          mastery_effects: {},
          skill_overrides: {},
          jewel_data: {},
          bandit_choice: "Eramir",
        },
      },
    });

    expect(imported).toMatchObject({
      ok: true,
      authoritative: true,
      engine: { version: "2.66.1" },
      calculation: {
        mainSocketGroup: 2,
        scalarCount: expect.any(Number),
        stats: { Life: expect.any(Number) },
        skillGroups: expect.any(Array),
      },
      isolation: { freshProcess: true, installedPobReadOnly: true, noGuiLaunch: true },
    });
    if (!imported.ok) throw new Error(imported.message);
    expect(imported.calculation.skillGroups[1].activeSkills.map((skill) => skill.name)).toContain("Arc");
    expect(imported.xml).toMatch(/<Slot\b(?=[^>]*name="Helmet")(?=[^>]*itemId="1")[^>]*\/>/);
    expect(imported.xml).toMatch(/<Slot\b(?=[^>]*name="Flask 1")(?=[^>]*itemId="2")[^>]*\/>/);
    expect(imported.xml).toMatch(/<Slot\b(?=[^>]*name="Belt Abyssal Socket 1")(?=[^>]*itemId="3")[^>]*\/>/);
    expect(imported.xml).toMatch(/<Slot\b(?=[^>]*name="Belt")(?=[^>]*itemId="4")[^>]*\/>/);
    expect(imported.xml).toMatch(/<Socket\b(?=[^>]*nodeId="26725")(?=[^>]*itemId="5")[^>]*\/>/);
    expect(imported.xml).toContain("Doom Gaze");
    expect(imported.xml).toContain('gemId="Metadata/Items/Gems/SkillGemGrace"');
    expect(imported.xml).toContain('gemId="Metadata/Items/Gems/SkillGemArc"');
    expect(imported.xml).toContain('variantId="SupportAddedLightningDamage"');
    expect(imported.xml).toContain('skillId="SupportAddedLightningDamage"');
    expect(imported.xml).toMatch(/<Gem\b(?=[^>]*nameSpec="Firestorm of Pelting")(?=[^>]*gemId="Metadata\/Items\/Gems\/SkillGemFirestorm")(?=[^>]*variantId="FirestormAltY")(?=[^>]*skillId="FirestormAltY")[^>]*\/>/);
    expect(imported.xml).not.toContain('nameSpec="Doom Gaze"');
    expect(imported.xml.match(/<Skill\b/g)).toHaveLength(3);
    expect(imported.xml).toMatch(/<Build\b(?=[^>]*mainSocketGroup="2")(?=[^>]*bandit="None")[^>]*>/);
    const savedEnergyShield = Number(/<PlayerStat\b(?=[^>]*stat="EnergyShield")(?=[^>]*value="([^"]+)")[^>]*\/>/.exec(imported.xml)?.[1]);
    const recalculated = await calculatePobBuild({ xml: imported.xml, name: "official import parity fixture" });
    expect(recalculated).toMatchObject({ ok: true, authoritative: true });
    if (!recalculated.ok) throw new Error(recalculated.message);
    expect(savedEnergyShield).toBe(recalculated.calculation.stats.EnergyShield);
  }, 30_000);

  it.runIf(capability.available)("calculates A to B to A in isolated official PoB processes", async () => {
    const firstA = await calculatePobBuild({ xml: minimalBuild(1), name: "fresh-process A1" });
    const middleB = await calculatePobBuild({ xml: minimalBuild(80), name: "fresh-process B" });
    const secondA = await calculatePobBuild({ xml: minimalBuild(1), name: "fresh-process A2" });

    for (const result of [firstA, middleB, secondA]) {
      expect(result).toMatchObject({
        ok: true,
        authoritative: true,
        contractVersion: CONTRACT_VERSION,
        engine: { version: "2.66.1" },
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
