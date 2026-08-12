import { deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  MAX_BUILD_BYTES,
  decodePobBuild,
  describePassiveTree,
  encodePobBuild,
  findTreeFile,
  loadPassiveTreeSnapshot,
  orbitAngles,
  parseLuaTable,
  sanitizeTree,
} = require("../electron/pob-planner.cjs");

describe("PoB planner desktop service", () => {
  it("parses generated Lua tables without executing Lua", () => {
    expect(parseLuaTable('return { ["a"] = 2, [3] = "x", list = { true, false, 4 } }')).toEqual({
      a: 2,
      3: "x",
      list: [true, false, 4],
    });
  });

  it("uses PoB's non-uniform 16 and 40 node orbit angles", () => {
    expect(orbitAngles(16).slice(0, 5)).toEqual([0, 30, 45, 60, 90]);
    expect(orbitAngles(40)).toContain(45);
    expect(orbitAngles(6)).toEqual([0, 60, 120, 180, 240, 300]);
  });

  it("selects requested Ruthless/alternate trees exactly and never substitutes latest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-pob-tree-"));
    try {
      for (const version of ["3_28", "3_29", "3_29_ruthless", "3_29_alternate", "3_29_ruthless_alternate"]) {
        const directory = path.join(root, "TreeData", version);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, "tree.lua"), "return {}", "utf8");
      }
      expect(findTreeFile({ pobRoot: root }).version).toBe("3_29");
      expect(findTreeFile({ pobRoot: root, treeVersion: "3.29", ruthless: true }).version).toBe("3_29_ruthless");
      expect(findTreeFile({ pobRoot: root, treeVersion: "3_29_alternate", ruthless: true }).version).toBe("3_29_ruthless_alternate");
      expect(findTreeFile({ pobRoot: root, alternate: true }).version).toBe("3_29_alternate");
      expect(() => findTreeFile({ pobRoot: root, treeVersion: "3_27_ruthless" })).toThrow(/will not display its hashes on a different tree/i);
      expect(() => findTreeFile({ pobRoot: root, treeVersion: "..\\evil" })).toThrow(/invalid/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("versions passive-tree snapshots by exact source file identity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-pob-identity-"));
    try {
      const directory = path.join(root, "TreeData", "3_29");
      fs.mkdirSync(directory, { recursive: true });
      const treePath = path.join(directory, "tree.lua");
      fs.writeFileSync(treePath, "return {}", "utf8");

      const first = describePassiveTree({ pobRoot: root, treeVersion: "3_29" });
      const snapshot = loadPassiveTreeSnapshot({ pobRoot: root, treeVersion: "3_29" });
      expect(snapshot).toMatchObject(first);

      const assetPath = path.join(directory, "skills.jpg");
      fs.writeFileSync(assetPath, "first", "utf8");
      const withAsset = describePassiveTree({ pobRoot: root, treeVersion: "3_29" });
      expect(withAsset.cacheKey).not.toBe(first.cacheKey);
      fs.writeFileSync(assetPath, "updated-sprite", "utf8");
      const updatedAsset = describePassiveTree({ pobRoot: root, treeVersion: "3_29" });
      expect(updatedAsset.cacheKey).not.toBe(withAsset.cacheKey);

      fs.writeFileSync(treePath, "return { points = { totalPoints = 124 } }", "utf8");
      const updated = describePassiveTree({ pobRoot: root, treeVersion: "3_29" });
      expect(updated.cacheKey).not.toBe(updatedAsset.cacheKey);
      expect(updated.version).toBe("3_29");
      expect(updated.sourcePath).toBe(treePath);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives exact Cartesian node positions and connections", () => {
    const tree = sanitizeTree({
      classes: [{ name: "Scion", ascendancies: [] }],
      groups: { 1: { x: 100, y: 200 } },
      nodes: { 10: { skill: 10, name: "Start", group: 1, orbit: 1, orbitIndex: 0, out: [11], stats: ["+10 Strength"], recipe: ["ClearOil", "AzureOil", "BlackOil"] } },
      constants: { skillsPerOrbit: [1, 6], orbitRadii: [0, 82] },
      points: { totalPoints: 123, ascendancyPoints: 8 },
    }, "3_29", "tree.lua");
    expect(tree.nodes[0]).toMatchObject({ id: 10, x: 100, y: 118, out: [11], recipe: ["ClearOil", "AzureOil", "BlackOil"] });
  });

  it("retains every mastery choice and its tooltip text from PoB tree data", () => {
    const effects = [
      { effect: 29161, stats: ["First effect"] },
      { effect: 47823, stats: ["Second effect"] },
      { effect: 18391, stats: ["Third effect"] },
      { effect: 21313, stats: ["Fourth effect"] },
      { effect: 533, stats: ["Fifth effect"] },
      { effect: 6510, stats: ["Sixth effect"], reminderText: ["Sixth reminder"] },
    ];
    const tree = sanitizeTree({
      classes: [{ name: "Scion", ascendancies: [] }],
      groups: { 1: { x: 0, y: 0 } },
      nodes: { 89: { skill: 89, name: "Mine Mastery", group: 1, orbit: 0, orbitIndex: 0, isMastery: true, masteryEffects: effects } },
    }, "3_29", "tree.lua");
    expect(Object.keys(tree.nodes[0].masteryEffects || {})).toHaveLength(effects.length);
    expect(tree.nodes[0].masteryEffectOrder).toEqual(effects.map((effect) => effect.effect));
    expect(tree.nodes[0].masteryEffects).toMatchObject({
      29161: { stats: ["First effect"] },
      6510: { stats: ["Sixth effect"], reminderText: ["Sixth reminder"] },
    });
  });

  it("removes retired Wildwood bloodlines at the authoritative data boundary", () => {
    const tree = sanitizeTree({
      alternate_ascendancies: [{ id: "Warden", name: "Warden" }, { id: "Abyssal", name: "Abyssal Bloodline" }],
      classes: [{ name: "Scion", ascendancies: [] }],
      groups: { 1: { x: 0, y: 0 }, 2: { x: 100, y: 0 } },
      nodes: {
        10: { skill: 10, name: "Old", group: 1, orbit: 0, orbitIndex: 0, isBloodline: true, ascendancyName: "Warden" },
        11: { skill: 11, name: "Current", group: 2, orbit: 0, orbitIndex: 0, isBloodline: true, ascendancyName: "Abyssal" },
      },
    }, "3_29", "tree.lua");
    expect(tree.alternateAscendancies).toEqual([{ id: 2, internalId: "Abyssal", name: "Abyssal Bloodline" }]);
    expect(tree.nodes.map((node: { id: number }) => node.id)).toEqual([11]);
  });

  it("excludes PoB cluster proxy templates and exposes generated sprite metadata", () => {
    const tree = sanitizeTree({
      min_x: -100,
      max_x: 100,
      min_y: -200,
      max_y: 200,
      classes: [{ name: "Scion", ascendancies: [] }],
      groups: {
        1: { x: 0, y: 0, orbits: [1], background: { image: "PSGroupBackground1" } },
        2: { x: 50, y: 50, orbits: [1], isProxy: true },
      },
      nodes: {
        10: { skill: 10, name: "Real", icon: "real.png", group: 1, orbit: 1, orbitIndex: 0, out: [] },
        11: { skill: 11, name: "Position Proxy", icon: "proxy.png", group: 2, orbit: 1, orbitIndex: 0, isProxy: true, out: [] },
      },
      constants: { skillsPerOrbit: [1, 6], orbitRadii: [0, 82] },
    }, "3_29", "C:/missing/tree.lua", {
      sprites: {
        normalActive: { filename: "https://example.test/skills.jpg", w: 64, h: 64, coords: { "real.png": { x: 1, y: 2, w: 26, h: 26 } } },
        normalInactive: { filename: "https://example.test/skills-disabled.jpg", w: 64, h: 64, coords: { "real.png": { x: 3, y: 4, w: 26, h: 26 } } },
      },
    });
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]).toMatchObject({ groupId: 1, orbit: 1, spriteActive: { sheet: "skills.jpg", x: 1 } });
    expect(tree.groups).toHaveLength(1);
    expect(tree.size).toBeCloseTo(220);
  });

  it("exports the exact PoB cluster templates, rules, and tattoo text without rendering proxy nodes", () => {
    const tree = sanitizeTree({
      classes: [{ name: "Scion", ascendancies: [] }],
      groups: {
        1: { x: 0, y: 0 },
        2: { x: 400, y: 500, isProxy: true },
      },
      nodes: {
        10: { skill: 10, name: "Large Jewel Socket", group: 1, orbit: 1, orbitIndex: 0, expansionJewel: { size: 2, index: 0, proxy: 20 } },
        20: { skill: 20, name: "Position Proxy", group: 2, orbit: 3, orbitIndex: 7, isProxy: true },
        21: { skill: 21, name: "Medium Jewel Socket", group: 2, orbit: 3, orbitIndex: 12, expansionJewel: { size: 1, index: 0, proxy: 30, parent: 10 } },
        99: { skill: 99, name: "Feed the Fury", isNotable: true, icon: "notable.png", stats: ["30% increased Damage while Leeching"] },
      },
      constants: { skillsPerOrbit: [1, 6, 16, 16], orbitRadii: [0, 82, 162, 335] },
    }, "3_29", "C:/missing/tree.lua", null, {
      jewels: {
        "Large Cluster Jewel": {
          size: "Large", sizeIndex: 2, minNodes: 8, maxNodes: 12,
          smallIndicies: [0, 4], notableIndicies: [6], socketIndicies: [4], totalIndicies: 12,
          skills: { attack: { name: "Attack Damage", icon: "attack.png", stats: ["10% increased Attack Damage"], enchant: ["Added Small Passive Skills grant: 10% increased Attack Damage"] } },
        },
      },
      notableSortOrder: { "Feed the Fury": 1 },
      keystones: [],
      orbitOffsets: { 20: { 2: 5 } },
    }, {
      nodes: { "Tattoo of the Kitava Warrior": { dn: "Tattoo of the Kitava Warrior", sd: ["5% increased maximum Life"], not: false, ks: false, m: false } },
    });
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]).toMatchObject({ id: 10, expansionJewel: { size: 2, index: 0, proxy: 20 } });
    expect(tree.cluster).toMatchObject({
      jewels: { "Large Cluster Jewel": { sizeIndex: 2, smallIndices: [0, 4], skills: { attack: { name: "Attack Damage" } } } },
      proxies: { 20: { x: 400, y: 500, groupId: 2 } },
      socketTemplates: [{ id: 21, expansionJewel: { size: 1, index: 0, proxy: 30, parent: 10 } }],
      definitions: { "Feed the Fury": { notable: true, stats: ["30% increased Damage while Leeching"] } },
      tattoos: { "Tattoo of the Kitava Warrior": { stats: ["5% increased maximum Life"] } },
    });
  });

  it("decodes Path of Building's URL-safe deflate format", () => {
    const xml = '<PathOfBuilding><Build level="92" /></PathOfBuilding>';
    const code = deflateSync(xml).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    expect(decodePobBuild(code)).toBe(xml);
    expect(decodePobBuild(xml)).toBe(xml);
    expect(decodePobBuild(encodePobBuild(xml))).toBe(xml);
  });

  it("round-trips the exact XML limit when its encoded code remains importable", () => {
    const prefix = '<PathOfBuilding><Build level="100" /><Notes>';
    const suffix = "</Notes></PathOfBuilding>";
    const xml = `${prefix}${"a".repeat(MAX_BUILD_BYTES - Buffer.byteLength(prefix + suffix))}${suffix}`;
    const code = encodePobBuild(xml);

    expect(Buffer.byteLength(xml)).toBe(MAX_BUILD_BYTES);
    expect(Buffer.byteLength(code)).toBeLessThanOrEqual(MAX_BUILD_BYTES);
    expect(decodePobBuild(code)).toBe(xml);
  });

  it("never emits a code larger than its paired decoder accepts", () => {
    const prefix = '<PathOfBuilding><Build level="100" /><Notes>';
    const suffix = "</Notes></PathOfBuilding>";
    const payloadBytes = MAX_BUILD_BYTES - Buffer.byteLength(prefix + suffix);
    const payload = randomBytes(Math.ceil(payloadBytes * 0.75))
      .toString("base64")
      .slice(0, payloadBytes);
    const xml = `${prefix}${payload}${suffix}`;

    expect(Buffer.byteLength(xml)).toBe(MAX_BUILD_BYTES);
    expect(() => encodePobBuild(xml)).toThrow(/encoded Path of Building code is too large to import safely/i);
  });
});
