import { describe, expect, it } from "vitest";
import { buildAtlasPack, buildNavigatorPack } from "./build-game-data-packs.mjs";

describe("game data pack builder", () => {
  it("materializes Atlas orbit geometry and symmetric graph links", () => {
    const pack = buildAtlasPack({
      tree: "Atlas",
      constants: { skillsPerOrbit: [1, 4], orbitRadii: [0, 100] },
      points: { totalPoints: 132 },
      min_x: -100,
      min_y: -100,
      max_x: 100,
      max_y: 100,
      groups: { 1: { x: 0, y: 0 } },
      nodes: {
        root: { group: 1, orbit: 0, orbitIndex: 0, out: ["1"], in: [] },
        1: { name: "", stats: [], group: 1, orbit: 0, orbitIndex: 0, out: ["2", "3"], in: [] },
        2: { name: "Left", stats: ["1% test"], group: 1, orbit: 1, orbitIndex: 1, out: [], in: ["1"] },
        3: { name: "Right", stats: ["2% test"], group: 1, orbit: 1, orbitIndex: 3, out: [], in: ["1"] },
      },
    });
    expect(pack.rootId).toBe(1);
    expect(pack.totalPoints).toBe(132);
    expect(pack.nodes.find((node) => node.id === 2)).toMatchObject({ x: 100, y: 0, neighbors: [1] });
    expect(pack.nodes.find((node) => node.id === 1)?.neighbors).toEqual([2, 3]);
  });

  it("keeps the league-start route and exact quest gem availability", () => {
    const pack = buildNavigatorPack({
      areas: { town: { id: "town", name: "Town", act: 1, level: 1, has_waypoint: true, is_town_area: true } },
      gems: { gem: { name: "Test Gem", primary_attribute: "strength", required_level: 1, is_support: false } },
      quests: { quest: { name: "Test Quest", act: "1", reward_offers: { reward: { quest_npc: "NPC", quest: { gem: { classes: ["Marauder"] } }, vendor: { gem: { classes: ["Scion"], npc: "Vendor" } } } } } },
      routes: [
        "#section Act 1\n#ifdef LEAGUE_START\n➞ {enter|town}\n#endif\n#ifndef LEAGUE_START\nHidden\n#endif\nHand in {quest|quest}",
        ...Array.from({ length: 9 }, (_, index) => `#section Act ${index + 2}\nContinue`),
      ],
    });
    expect(pack.acts[0].steps.map((step) => step.label)).toEqual(["➞ Town", "Hand in Test Quest"]);
    expect(pack.gems[0].acquisitions).toEqual([
      expect.objectContaining({ kind: "quest", npc: "NPC", classes: ["Marauder"] }),
      expect.objectContaining({ kind: "vendor", npc: "Vendor", classes: ["Scion"] }),
    ]);
  });
});
