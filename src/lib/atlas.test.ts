import { describe, expect, it } from "vitest";
import type { AtlasDataNode, AtlasDataPack } from "./game-data";
import {
  allocateAtlasPath,
  atlasAllocationAnalysis,
  compareAtlasLoadouts,
  decodeAtlasUrl,
  encodeAtlasUrl,
  parseAtlasWorkspace,
  refundAtlasNode,
  validateAtlasAllocation,
  type AtlasLoadout,
} from "./atlas";

function node(id: number, neighbors: number[], patch: Partial<AtlasDataNode> = {}): AtlasDataNode {
  return {
    id,
    groupId: 0,
    orbit: 0,
    orbitIndex: 0,
    name: id === 1 ? "" : `Node ${id}`,
    icon: "Art/2DArt/SkillIcons/passives/AtlasTrees/Mapnode.png",
    stats: [],
    reminderText: [],
    flavourText: [],
    x: id * 10,
    y: 0,
    neighbors,
    notable: false,
    keystone: false,
    mastery: false,
    gateway: false,
    grantedPoints: 0,
    ...patch,
  };
}

const pack = {
  schemaVersion: 1,
  game: "poe1",
  gameVersion: "3.29.1",
  source: { name: "GGG", url: "https://example.com", revision: "abc", releasedAt: "2026-01-01T00:00:00Z" },
  rootId: 1,
  totalPoints: 2,
  linkFormat: { version: 6, url: "https://web.poecdn.com/main.js", sha256: "a".repeat(64) },
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  sprites: {},
  nodes: [
    node(1, [2, 5]),
    node(2, [1, 3]),
    node(3, [2, 4], { name: "Point grant", grantedPoints: 20, keystone: true }),
    node(4, [3]),
    node(5, [1, 6], { gateway: true }),
    node(6, [5, 7], { gateway: true }),
    node(7, [6]),
    node(8, [], { mastery: true }),
  ],
} as unknown as AtlasDataPack;

describe("Atlas Command Center logic", () => {
  it("requires a point before allocating a point-granting node", () => {
    expect(validateAtlasAllocation(pack, [2, 3, 4], 2).ok).toBe(true);
    expect(validateAtlasAllocation(pack, [2, 3, 4], 1)).toMatchObject({ ok: false });
    expect(allocateAtlasPath(pack, [], 4, 1)).toMatchObject({ ok: false, nodeIds: [] });
    expect(allocateAtlasPath(pack, [], 4, 2)).toMatchObject({ ok: true, nodeIds: [2, 3, 4] });
    expect(atlasAllocationAnalysis(pack, [2, 3, 4], 2)).toEqual({ spent: 3, granted: 20, total: 22, remaining: 19 });
  });

  it("uses the official graph for shortest paths and gateway traversal", () => {
    expect(allocateAtlasPath(pack, [], 6, 2)).toMatchObject({ ok: true, added: [5, 6] });
    expect(validateAtlasAllocation(pack, [4], 2)).toMatchObject({ ok: false });
    expect(validateAtlasAllocation(pack, [8], 2)).toMatchObject({ ok: false });
  });

  it("removes disconnected dependants and refuses refunds that strand spent grant points", () => {
    expect(refundAtlasNode(pack, [2, 3, 4], 2, 2)).toMatchObject({
      ok: true,
      nodeIds: [],
      removed: [2, 3, 4],
    });
    expect(refundAtlasNode(pack, [2, 3, 5, 6, 7], 3, 2)).toMatchObject({ ok: false });
  });

  it("matches GGG's current version-6 big-endian Atlas URL format", () => {
    const url = encodeAtlasUrl(pack, [4, 2, 3]);
    expect(url).toBe("https://www.pathofexile.com/atlas-skill-tree/AAAABgAAAwACAAMABAAA");
    expect(decodeAtlasUrl(pack, url)).toEqual([2, 3, 4]);
    expect(() => decodeAtlasUrl(pack, url.replace("AAAABg", "AAAABQ"))).toThrow("version 5");
    expect(() => decodeAtlasUrl(pack, "https://example.com/atlas-skill-tree/AAAABgAAAwACAAMABAAA")).toThrow("Only official");
  });

  it("migrates saved allocations by current node identity, connectivity, and budget", () => {
    const migrated = parseAtlasWorkspace(pack, JSON.stringify({
      version: 1,
      gameVersion: "3.28.0",
      basePoints: 2,
      nodeIds: [2, 3, 4, 9999],
      loadouts: [{ id: "old", name: "Old tree", gameVersion: "3.28.0", basePoints: 2, nodeIds: [4, 9999] }],
    }));
    expect(migrated.changedVersion).toBe(true);
    expect(migrated.workspace.nodeIds).toEqual([2, 3, 4]);
    expect(migrated.droppedNodeIds).toEqual([9999]);
    expect(migrated.workspace.loadouts[0].nodeIds).toEqual([]);
  });

  it("compares named loadouts without inventing a build score", () => {
    const left = { id: "a", name: "A", nodeIds: [2, 3], gameVersion: "3.29.1", basePoints: 2, updatedAt: 1 } satisfies AtlasLoadout;
    const right = { ...left, id: "b", name: "B", nodeIds: [3, 4] };
    expect(compareAtlasLoadouts(left, right)).toEqual({ shared: [3], onlyLeft: [2], onlyRight: [4] });
  });
});
