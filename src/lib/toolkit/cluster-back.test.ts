import { describe, expect, it } from "vitest";
import {
  buildClusterBackTradeQuery,
  eligibleClusterBackNotables,
  inspectCopiedClusterBack,
  type ClusterBackData,
} from "./cluster-back";
import currentData from "../../../public/data/toolkit/cluster-back-v1.json";

const data: ClusterBackData = {
  schema: 1,
  passiveCountTradeId: "enchant.passives",
  largeJewelIcon: "data/toolkit/cluster-icons/large-cluster-jewel.png",
  bases: [{ tag: "damage", name: "Damage", enchant: ["Damage enchant"], enchantTradeId: "enchant.damage|4" }],
  notables: [
    { name: "Front A", sortOrder: 10, tradeId: "explicit.a", legacyOnly: false, variants: [{ baseTag: "damage", generationType: 1, groups: ["a"], weight: 100, modId: "a" }] },
    { name: "Back", sortOrder: 20, tradeId: "explicit.back", legacyOnly: false, variants: [{ baseTag: "damage", generationType: 2, groups: ["back"], weight: 100, modId: "back" }] },
    { name: "Blocked prefix", sortOrder: 25, tradeId: "explicit.blocked", legacyOnly: false, variants: [{ baseTag: "damage", generationType: 1, groups: ["blocked"], weight: 100, modId: "blocked" }] },
    { name: "Front B", sortOrder: 30, tradeId: "explicit.b", legacyOnly: false, variants: [{ baseTag: "damage", generationType: 1, groups: ["b"], weight: 100, modId: "b" }] },
    { name: "Outside", sortOrder: 40, tradeId: "explicit.outside", legacyOnly: false, variants: [{ baseTag: "damage", generationType: 2, groups: ["outside"], weight: 100, modId: "outside" }] },
  ],
};

describe("cluster back", () => {
  it("uses strict PoB order and PoE's two-prefix/two-suffix limit", () => {
    const candidates = eligibleClusterBackNotables(data, "Front A", "Front B");
    expect(candidates.map((candidate) => candidate.notable.name)).toEqual(["Back"]);
  });

  it("builds an exact 8-passive official trade query without losing the base discriminator", () => {
    const candidates = eligibleClusterBackNotables(data, "Front A", "Front B", "damage");
    const result = buildClusterBackTradeQuery(data, "Front A", "Front B", candidates, "damage") as any;
    expect(result.query.status.option).toBe("onlineleague");
    expect(result.query.type).toBe("Large Cluster Jewel");
    expect(result.query.stats[0].filters).toContainEqual({ id: "enchant.passives", value: { min: 8, max: 8 } });
    expect(result.query.stats[0].filters).toContainEqual({ id: "enchant.damage|4", value: {} });
    expect(result.query.stats[1]).toEqual({
      type: "count",
      value: { min: 1 },
      filters: [{ id: "explicit.back", value: { min: 1 } }],
    });
  });

  it("identifies the middle PoB sort order on a copied jewel", () => {
    const result = inspectCopiedClusterBack(data, [
      "Item Class: Jewels",
      "Rarity: Rare",
      "Large Cluster Jewel",
      "--------",
      "Adds 8 Passive Skills (enchant)",
      "Damage enchant (enchant)",
      "--------",
      "1 Added Passive Skill is Front B",
      "1 Added Passive Skill is Front A",
      "1 Added Passive Skill is Back",
    ].join("\n"));
    expect(result.valid).toBe(true);
    expect(result.back?.name).toBe("Back");
    expect(result.base?.tag).toBe("damage");
  });

  it("matches the known shield-cluster ordering fixture from the reference implementation", () => {
    const candidates = eligibleClusterBackNotables(
      currentData as ClusterBackData,
      "Prodigious Defence",
      "Feed the Fury",
      "affliction_attack_damage_while_holding_a_shield",
    );
    expect(candidates.map((candidate) => candidate.notable.name)).toEqual([
      "Smite the Weak",
      "Heavy Hitter",
      "Martial Prowess",
    ]);
  });

  it("accepts a magic Large Cluster Jewel display name", () => {
    const result = inspectCopiedClusterBack(data, [
      "Item Class: Jewels",
      "Rarity: Magic",
      "Sparking Large Cluster Jewel of the Fighter",
      "--------",
      "Adds 8 Passive Skills (enchant)",
      "Damage enchant (enchant)",
      "--------",
      "1 Added Passive Skill is Front A",
      "1 Added Passive Skill is Back",
      "1 Added Passive Skill is Front B",
    ].join("\n"));
    expect(result.valid).toBe(true);
    expect(result.back?.name).toBe("Back");
  });
});
