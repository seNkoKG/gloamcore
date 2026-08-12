import { describe, expect, it } from "vitest";
import type {
  PassiveTreeClusterData,
  PassiveTreeData,
  PassiveTreeNodeData,
} from "../../types";
import type { ImportedPassiveSpec, ImportedPobBuild, ImportedPobItem } from "./pob-build";
import {
  applyImportedSkillOverrides,
  materializeImportedPassiveSpec,
  materializeImportedPassiveTree,
  passiveSpecMatchesTree,
  parseClusterJewelDescriptor,
} from "./cluster-jewel-graph";
import { emptyPobBuild, parsePobXml, serializePobXml } from "./pob-build";
import { shortestAllocationPath } from "./passive-graph";

const angles = (count: number) => Array.from({ length: count }, (_, index) => count === 16
  ? [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330][index]
  : (360 * index) / count);

const cluster: PassiveTreeClusterData = {
  skillsPerOrbit: [1, 6, 16, 16],
  orbitRadii: [0, 82, 162, 335],
  orbitAngles: [angles(1), angles(6), angles(16), angles(16)],
  jewels: {
    "Small Cluster Jewel": {
      baseType: "Small Cluster Jewel", size: "Small", sizeIndex: 0, minNodes: 2, maxNodes: 3,
      smallIndices: [0, 4, 2], notableIndices: [4], socketIndices: [4], totalIndices: 6,
      skills: { life: { id: "life", name: "Life", stats: ["4% increased maximum Life"], enchant: ["Added Small Passive Skills grant: 4% increased maximum Life"] } },
    },
    "Medium Cluster Jewel": {
      baseType: "Medium Cluster Jewel", size: "Medium", sizeIndex: 1, minNodes: 4, maxNodes: 6,
      smallIndices: [0, 6, 8, 4, 10, 2], notableIndices: [6, 10, 2, 0], socketIndices: [6], totalIndices: 12,
      skills: { aura: { id: "aura", name: "Aura Effect", stats: ["6% increased effect of Non-Curse Auras"], enchant: ["Added Small Passive Skills grant: 6% increased effect of Non-Curse Auras"] } },
    },
    "Large Cluster Jewel": {
      baseType: "Large Cluster Jewel", size: "Large", sizeIndex: 2, minNodes: 8, maxNodes: 12,
      smallIndices: [0, 4, 6, 8, 10, 2, 7, 5, 9, 3, 11, 1], notableIndices: [6, 4, 8, 10, 2], socketIndices: [4, 8, 6], totalIndices: 12,
      skills: { attack: { id: "attack", name: "Attack Damage", stats: ["10% increased Attack Damage"], enchant: ["Added Small Passive Skills grant: 10% increased Attack Damage"], mastery: true } },
    },
  },
  notableSortOrder: { "Martial Prowess": 1, "Feed the Fury": 2, "Replenishing Presence": 3 },
  keystones: ["Secrets of Suffering"],
  orbitOffsets: {
    43989: { 0: 3, 1: 5, 2: 5 },
    55706: { 0: 2, 1: 3 },
  },
  definitions: {
    "Martial Prowess": { name: "Martial Prowess", stats: ["20% increased Attack Damage"], notable: true },
    "Feed the Fury": { name: "Feed the Fury", stats: ["30% increased Damage while Leeching"], notable: true },
    "Replenishing Presence": { name: "Replenishing Presence", stats: ["Regenerate Life"] , notable: true },
    "Secrets of Suffering": { name: "Secrets of Suffering", stats: ["Cannot Ignite, Chill, Freeze or Shock"], keystone: true },
  },
  proxies: {
    43989: { id: 43989, groupId: 241, x: 1000, y: 2000, orbit: 3, orbitIndex: 7 },
    55706: { id: 55706, groupId: 202, x: 500, y: 900, orbit: 2, orbitIndex: 4 },
  },
  socketTemplates: [
    { id: 29712, name: "Medium Jewel Socket", groupId: 241, expansionJewel: { size: 1, index: 0, proxy: 55706, parent: 7960 } },
    { id: 48679, name: "Medium Jewel Socket", groupId: 241, expansionJewel: { size: 1, index: 1, proxy: 26661, parent: 7960 } },
    { id: 9408, name: "Medium Jewel Socket", groupId: 241, expansionJewel: { size: 1, index: 2, proxy: 13201, parent: 7960 } },
    { id: 12613, name: "Small Jewel Socket", groupId: 202, expansionJewel: { size: 0, index: 0, proxy: 40114, parent: 29712 } },
  ],
  tattoos: {
    "Tattoo of the Kitava Warrior": { name: "Tattoo of the Kitava Warrior", stats: ["5% increased maximum Life"] },
  },
};

const passive = (id: number, extra: Partial<PassiveTreeNodeData> = {}): PassiveTreeNodeData => ({
  id, name: `Node ${id}`, stats: [], x: 0, y: 0, out: [], in: [], classStartIndex: null,
  classStartIds: [], ascendancyName: null, notable: false, keystone: false, mastery: false,
  jewelSocket: false, multipleChoice: false, bloodline: false, ...extra,
});

const tree: PassiveTreeData = {
  game: "poe1",
  version: "3_29",
  sourcePath: "tree.lua",
  bounds: { minX: -1000, minY: -1000, maxX: 3000, maxY: 3000 },
  classes: [{ id: 0, name: "Scion", ascendancies: [] }],
  points: { total: 123, ascendancy: 8 },
  groups: [{ id: 1, x: 0, y: 0, orbits: [0, 1], background: null, ascendancyName: null, isAscendancyStart: false }],
  cluster,
  nodes: [
    passive(1, { name: "Scion", classStartIndex: 0, classStartIds: [0], out: [7960] }),
    passive(7960, { name: "Large Jewel Socket", jewelSocket: true, out: [1], expansionJewel: { size: 2, index: 0, proxy: 43989 } }),
  ],
};

const item = (id: number, baseType: string, text: string): ImportedPobItem => ({
  id, baseType, name: baseType, text: `Rarity: RARE\n${baseType}\n--------\n${text}`, slot: "", equipped: true,
});

describe("PoB cluster jewel subgraphs", () => {
  it("parses regular, PoB-lossless, and Voices structural modifiers", () => {
    const regular = parseClusterJewelDescriptor(item(1, "Large Cluster Jewel", [
      "Adds 8 Passive Skills",
      "Added Small Passive Skills grant: 10% increased Attack Damage",
      "2 Added Passive Skills are Jewel Sockets",
      "1 Added Passive Skill is Feed the Fury",
      "Added Small Passive Skills also grant: +3 to Strength",
    ].join("\n")), cluster);
    expect(regular).toMatchObject({ skillId: "attack", nodeCount: 8, socketCount: 2, notables: ["Feed the Fury"], addedSmallStats: ["+3 to Strength"] });

    const lossless = parseClusterJewelDescriptor(item(2, "Medium Cluster Jewel", "Cluster Jewel Skill: aura\nCluster Jewel Node Count: 5"), cluster);
    expect(lossless).toMatchObject({ skillId: "aura", nodeCount: 5 });

    const voices = parseClusterJewelDescriptor(item(3, "Large Cluster Jewel", "Adds 3 Jewel Socket Passive Skills\nAdds 7 Small Passive Skills which grant nothing"), cluster);
    expect(voices).toMatchObject({ nodeCount: 10, socketCount: 3, nothingness: true, skillId: null });
  });

  it("uses PoB's encoded IDs, notable/socket placement, orbit transform, recursion, and hashes_ex mapping", () => {
    const large = item(1, "Large Cluster Jewel", [
      "Adds 8 Passive Skills",
      "Added Small Passive Skills grant: 10% increased Attack Damage",
      "2 Added Passive Skills are Jewel Sockets",
      "1 Added Passive Skill is Feed the Fury",
      "1 Added Passive Skill is Martial Prowess",
      "Added Small Passive Skills also grant: +3 to Strength",
    ].join("\n"));
    const medium = item(2, "Medium Cluster Jewel", [
      "Adds 5 Passive Skills",
      "Added Small Passive Skills grant: 6% increased effect of Non-Curse Auras",
      "1 Added Passive Skill is a Jewel Socket",
      "1 Added Passive Skill is Replenishing Presence",
    ].join("\n"));
    const spec: ImportedPassiveSpec = {
      id: "tree", title: "Tree", treeVersion: "3_29", classId: 0, ascendClassId: 0, secondaryAscendClassId: 0,
      nodes: [1, 7960], masteryEffects: {}, sockets: { 7960: 1, 29712: 2 }, extendedHashes: [9001],
      jewelData: {
        7960: {
          subgraph: {
            groups: { 900: { proxy: 43989, nodes: [9001] } },
            nodes: { 9001: { group: 900, orbitIndex: 7 } },
          },
        },
      },
    };
    const materialized = materializeImportedPassiveTree(tree, spec, [large, medium]);
    const nodes = new Map(materialized.tree.nodes.map((node) => [node.id, node]));

    // Large index 0 => 0x10000, Large size index => +0x20.
    expect(nodes.get(65568)).toMatchObject({ name: "Attack Damage", groupId: -65568, orbit: 3, orbitIndex: 7, stats: ["10% increased Attack Damage", "+3 to Strength"] });
    expect(nodes.get(65574)).toMatchObject({ name: "Martial Prowess", notable: true });
    expect(nodes.get(65578)).toMatchObject({ name: "Feed the Fury", notable: true });
    expect(nodes.get(29712)).toMatchObject({ jewelSocket: true, expansionJewel: { size: 1, index: 0, proxy: 55706 } });
    expect(nodes.get(9408)).toMatchObject({ jewelSocket: true, expansionJewel: { size: 1, index: 2, proxy: 13201 } });
    expect(nodes.get(65568)?.x).toBeCloseTo(1167.5);
    expect(nodes.get(65568)?.y).toBeCloseTo(2290.12, 1);
    expect(nodes.get(65568)?.out).toContain(7960);
    expect(shortestAllocationPath(materialized.tree, new Set([1, 7960]), 65574, 0)).toEqual([65568, 65578, 9408, 65575, 65574]);

    // Nested Medium index 0 retains the inherited large branch bits: 0x10010.
    expect(nodes.get(65552)).toMatchObject({ name: "Aura Effect", groupId: -65552, orbit: 2 });
    expect(nodes.get(12613)).toMatchObject({ jewelSocket: true, expansionJewel: { size: 0, index: 0 } });
    expect(materialized.mappedExtendedAllocations).toContain(65568);
  });

  it("treats the passive spec socket map as authoritative across inactive item sets", () => {
    const large = {
      ...item(1, "Large Cluster Jewel", "Adds 8 Passive Skills\nAdded Small Passive Skills grant: 10% increased Attack Damage"),
      equipped: false,
    };
    const spec: ImportedPassiveSpec = {
      id: "inactive-spec",
      title: "Inactive spec",
      treeVersion: "3_29",
      classId: 0,
      ascendClassId: 0,
      secondaryAscendClassId: 0,
      nodes: [1, 7960],
      masteryEffects: {},
      sockets: { 7960: 1 },
    };

    expect(materializeImportedPassiveTree(tree, spec, [large]).tree.nodes.some((entry) => entry.id >= 65536)).toBe(true);
  });

  it("round-trips opaque nested cluster allocations through PoB XML", () => {
    const official: ImportedPobBuild = {
      ...emptyPobBuild("Scion"),
      level: 100,
      specs: [{
        id: "cluster-roundtrip",
        title: "Roundtrip",
        treeVersion: "3_29",
        classId: 0,
        ascendClassId: 0,
        secondaryAscendClassId: 0,
        nodes: [1, 7960],
        masteryEffects: {},
        sockets: { 7960: 1, 29712: 2 },
        extendedHashes: [9001, 9002],
        skillOverrides: {},
        jewelData: {
          7960: {
            subgraph: {
              groups: {
                900: { proxy: 43989, nodes: [9001] },
                901: { proxy: 55706, nodes: [9002] },
              },
              nodes: {
                9001: { group: 900, orbitIndex: 7 },
                9002: { group: 901, orbitIndex: 4 },
              },
            },
          },
        },
      }],
      items: [
        item(1, "Large Cluster Jewel", [
          "Adds 8 Passive Skills",
          "Added Small Passive Skills grant: 10% increased Attack Damage",
          "2 Added Passive Skills are Jewel Sockets",
          "1 Added Passive Skill is Feed the Fury",
          "1 Added Passive Skill is Martial Prowess",
        ].join("\n")),
        item(2, "Medium Cluster Jewel", [
          "Adds 5 Passive Skills",
          "Added Small Passive Skills grant: 6% increased effect of Non-Curse Auras",
          "1 Added Passive Skill is a Jewel Socket",
          "1 Added Passive Skill is Replenishing Presence",
        ].join("\n")),
      ],
    };
    expect(official.xml).toBe("");

    const importedSpec = official.specs[0];
    const materialized = materializeImportedPassiveSpec(tree, importedSpec, official.items);
    expect(materialized.mappedExtendedAllocations).toEqual(expect.arrayContaining([65568, 65552]));
    expect(materialized.spec.nodes).toEqual(expect.arrayContaining([1, 7960, 65568, 65552]));

    // This is the exact path used by immediate Copy PoB: export the promoted
    // spec without requiring an allocation edit first.
    const xml = serializePobXml(official, [materialized.spec], materialized.spec.id);
    expect(xml).toContain('nodes="1,7960,65568,65552"');
    expect(xml).toContain('<Socket nodeId="7960" itemId="1"/>');
    expect(xml).toContain('<Socket nodeId="29712" itemId="2"/>');
    expect(xml).toContain("Large Cluster Jewel");
    expect(xml).toContain("Medium Cluster Jewel");

    const reparsed = parsePobXml(xml);
    expect(reparsed.specs[0].sockets).toEqual({ 7960: 1, 29712: 2 });
    expect(reparsed.items.map((entry) => entry.baseType)).toEqual(["Large Cluster Jewel", "Medium Cluster Jewel"]);
    const rematerialized = materializeImportedPassiveSpec(tree, reparsed.specs[0], reparsed.items);
    const generatedIds = new Set(rematerialized.tree.nodes.map((node) => node.id));
    expect(generatedIds.has(65568)).toBe(true);
    expect(generatedIds.has(65552)).toBe(true);
    expect(new Set(rematerialized.spec.nodes)).toEqual(new Set(materialized.spec.nodes));
  });

  it("ports PoB v1 cluster hashes to v2 orbit identities without changing explicit v2 specs", () => {
    const conversionTree: PassiveTreeData = {
      ...tree,
      cluster: {
        ...cluster,
        orbitOffsets: {
          ...cluster.orbitOffsets,
          43989: { ...cluster.orbitOffsets[43989], 2: 0 },
        },
      },
    };
    const large = item(1, "Large Cluster Jewel", [
      "Adds 8 Passive Skills",
      "Added Small Passive Skills grant: 10% increased Attack Damage",
      "2 Added Passive Skills are Jewel Sockets",
    ].join("\n"));
    const base: ImportedPassiveSpec = {
      id: "legacy-cluster",
      title: "Legacy cluster",
      treeVersion: "3_29",
      classId: 0,
      ascendClassId: 0,
      secondaryAscendClassId: 0,
      nodes: [1, 7960, 65568, 65570],
      masteryEffects: {},
      sockets: { 7960: 1 },
    };

    const legacy = materializeImportedPassiveSpec(conversionTree, { ...base, clusterHashFormatVersion: 1 }, [large]);
    expect([...legacy.legacyClusterNodeMap || []]).toEqual(expect.arrayContaining([
      [65568, 65573],
      [65570, 65575],
      [65573, 65578],
      [65575, 65568],
    ]));
    expect(legacy.spec.clusterHashFormatVersion).toBe(2);
    expect(legacy.spec.nodes).toEqual([1, 7960, 65573, 65575]);

    const current = materializeImportedPassiveSpec(conversionTree, { ...base, clusterHashFormatVersion: 2 }, [large]);
    expect(current.legacyClusterNodeMap).toBeUndefined();
    expect(current.spec.clusterHashFormatVersion).toBe(2);
    expect(current.spec.nodes).toEqual(base.nodes);
    expect(serializePobXml({ ...emptyPobBuild(), specs: [legacy.spec] }, [legacy.spec], legacy.spec.id)).toContain('clusterHashFormatVersion="2"');
  });

  it("never maps a mixed-version spec against the currently loaded tree", () => {
    const wrongVersion = { ...tree, version: "3_28" };
    const spec: ImportedPassiveSpec = {
      id: "newer", title: "Newer tree", treeVersion: "3_29_alternate_ruthless", classId: 0,
      ascendClassId: 0, secondaryAscendClassId: 0, nodes: [1, 7960], masteryEffects: {},
      sockets: { 7960: 1 }, extendedHashes: [9001],
      jewelData: {
        7960: {
          subgraph: {
            groups: { 900: { proxy: 43989, nodes: [9001] } },
            nodes: { 9001: { group: 900, orbitIndex: 7 } },
          },
        },
      },
    };
    const large = item(1, "Large Cluster Jewel", "Adds 8 Passive Skills\nAdded Small Passive Skills grant: 10% increased Attack Damage");
    const result = materializeImportedPassiveSpec(wrongVersion, spec, [large]);
    expect(passiveSpecMatchesTree({ ...tree, version: "3_29_ruthless_alternate" }, spec)).toBe(true);
    expect(passiveSpecMatchesTree(wrongVersion, spec)).toBe(false);
    expect(result.spec).toBe(spec);
    expect(result.mappedExtendedAllocations).toEqual([]);
    expect(result.tree.nodes.some((node) => node.id >= 65536)).toBe(false);
  });

  it("allows a smaller cluster in a larger expansion socket, as PoB does for Voices", () => {
    const voices = item(1, "Large Cluster Jewel", "Adds 3 Jewel Socket Passive Skills\nAdds 7 Small Passive Skills which grant nothing");
    const small = item(2, "Small Cluster Jewel", "Adds 3 Passive Skills\nAdded Small Passive Skills grant: 4% increased maximum Life");
    const spec: ImportedPassiveSpec = {
      id: "voices", title: "Voices", treeVersion: "3_29", classId: 0, ascendClassId: 0, secondaryAscendClassId: 0,
      nodes: [1, 7960], masteryEffects: {}, sockets: { 7960: 1, 29712: 2 },
    };
    const nodes = new Map(materializeImportedPassiveTree(tree, spec, [voices, small]).tree.nodes.map((node) => [node.id, node]));
    expect(nodes.get(29712)).toMatchObject({ jewelSocket: true, expansionJewel: { size: 1, index: 0 } });
    expect(nodes.get(65536)).toMatchObject({ name: "Life", groupId: -65536, orbit: 1 });
    expect(nodes.get(65538)).toMatchObject({ name: "Life" });
    expect(nodes.get(65540)).toMatchObject({ name: "Life" });
  });

  it("replaces imported tattoo text/art metadata without losing node identity or allocation topology", () => {
    const result = applyImportedSkillOverrides(tree, {
      id: "tattoo", title: "Tattoo", treeVersion: "3_29", classId: 0, ascendClassId: 0, secondaryAscendClassId: 0,
      nodes: [1], masteryEffects: {}, skillOverrides: { 1: { name: "Tattoo of the Kitava Warrior" } },
    });
    expect(result.nodes[0]).toMatchObject({
      id: 1,
      name: "Tattoo of the Kitava Warrior",
      stats: ["5% increased maximum Life"],
      out: [7960],
      classStartIds: [0],
    });
  });
});
