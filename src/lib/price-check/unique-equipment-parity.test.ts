import { describe, expect, it } from "vitest";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  magebloodAdvancedFixture,
  malachaisLoopVestigialFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import { buildPriceCheckQueryPlan } from "./query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";

const catalog = actualCatalog as unknown as TradeStatCatalogPack;

function decodedBrowserPayload(plan: ReturnType<typeof buildPriceCheckQueryPlan>) {
  const encoded = new URL(plan.tradeUrl).searchParams.get("q");
  expect(encoded).not.toBeNull();
  if (!encoded) throw new Error("Expected an official Trade browser payload");
  return JSON.parse(encoded) as Record<string, unknown>;
}

describe("Awakened unique equipment filter parity", () => {
  it("ports Mageblood through Awakened's generic pseudo and invariant-stat passes", () => {
    const parsed = parsePoeItem(magebloodAdvancedFixture);
    expect(parsed).toMatchObject({
      valid: true,
      itemClass: "Belts",
      rarity: "unique",
      name: "Mageblood",
      baseType: "Heavy Belt",
      itemLevel: 86,
      corrupted: false,
    });

    const item = applyTradeStatCatalog(parsed, catalog);
    expect(item.modifiers.map((modifier) => modifier.text)).toEqual([
      "+39% total Elemental Resistance",
      "+20% total to Fire Resistance",
      "+31 total to Strength",
      "+31 total to Dexterity",
      "Magic Utility Flasks cannot be Used",
      "Leftmost 4(2-4) Magic Utility Flasks constantly apply their Flask Effects to you",
      "Magic Utility Flask Effects cannot be removed",
    ]);
    expect(item.modifiers.map((modifier) => modifier.tradeLabel)).toEqual([
      "+39% total Elemental Resistance",
      "+20% total to Fire Resistance",
      "+31 total to Strength",
      "+31 total to Dexterity",
      "Magic Utility Flasks cannot be Used",
      "Leftmost 4 Magic Utility Flask constantly applies its Flask Effect to you",
      "Magic Utility Flask Effects cannot be removed",
    ]);
    expect(item.modifiers.every((modifier) => modifier.tradeId)).toBe(true);

    const plan = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "similar",
      rollTolerance: 10,
      status: "onlineleague",
    });
    const visible = plan.filters.filter((filter) => !filter.advancedOnly);
    const hidden = plan.filters.filter((filter) => filter.advancedOnly);

    expect(plan.filters).toHaveLength(7);
    expect(visible).toHaveLength(4);
    expect(visible.filter((filter) => filter.enabled).map((filter) => filter.tradeId))
      .toEqual(["pseudo.pseudo_total_elemental_resistance"]);
    expect(visible.map((filter) => filter.tradeId)).toEqual([
      "pseudo.pseudo_total_elemental_resistance",
      "pseudo.pseudo_total_strength",
      "pseudo.pseudo_total_dexterity",
      "explicit.stat_2388347909",
    ]);
    expect(visible.map((filter) => filter.label)).toEqual([
      "39% total Elemental Resistance",
      "31 total to Strength",
      "31 total to Dexterity",
      "Leftmost 4 Magic Utility Flask constantly applies its Flask Effect to you",
    ]);
    expect(visible.map((filter) => ({
      tradeId: filter.tradeId,
      bounds: filter.bounds,
      min: filter.min,
      max: filter.max,
    }))).toEqual([
      {
        tradeId: "pseudo.pseudo_total_elemental_resistance",
        bounds: { min: 30, max: 50 },
        min: 37,
        max: undefined,
      },
      {
        tradeId: "pseudo.pseudo_total_strength",
        bounds: { min: 25, max: 35 },
        min: 30,
        max: undefined,
      },
      {
        tradeId: "pseudo.pseudo_total_dexterity",
        bounds: { min: 30, max: 50 },
        min: 30,
        max: undefined,
      },
      {
        tradeId: "explicit.stat_2388347909",
        bounds: { min: 2, max: 4 },
        min: 4,
        max: undefined,
      },
    ]);

    expect(hidden).toHaveLength(3);
    expect(hidden.every((filter) => !filter.enabled)).toBe(true);
    expect(hidden.map((filter) => filter.tradeId)).toEqual([
      "pseudo.pseudo_total_fire_resistance",
      "explicit.stat_3986704288",
      "explicit.stat_344389721",
    ]);
    expect(hidden[0]).toMatchObject({
      bounds: { min: 15, max: 25 },
      min: 19,
    });
    expect(hidden[0].max).toBeUndefined();

    const apiQuery = (plan.tradeQuery as any).query;
    expect(apiQuery.filters.misc_filters.filters.corrupted).toEqual({
      option: "false",
    });
    const serializedStats = apiQuery.stats[0].filters as Array<{
      id: string;
      disabled?: boolean;
      value?: { min?: number; max?: number };
    }>;
    expect(serializedStats).toHaveLength(7);
    expect(serializedStats.filter((filter) => !filter.disabled).map((filter) => filter.id))
      .toEqual(["pseudo.pseudo_total_elemental_resistance"]);
    expect(serializedStats.filter((filter) => filter.disabled).map((filter) => filter.id).sort())
      .toEqual([
        "pseudo.pseudo_total_strength",
        "pseudo.pseudo_total_dexterity",
        "pseudo.pseudo_total_fire_resistance",
        "explicit.stat_2388347909",
        "explicit.stat_3986704288",
        "explicit.stat_344389721",
      ].sort());
    expect(serializedStats.map((filter) => filter.id)).toEqual([
      "pseudo.pseudo_total_elemental_resistance",
      "pseudo.pseudo_total_fire_resistance",
      "pseudo.pseudo_total_strength",
      "pseudo.pseudo_total_dexterity",
      "explicit.stat_3986704288",
      "explicit.stat_2388347909",
      "explicit.stat_344389721",
    ]);
    expect(decodedBrowserPayload(plan)).toEqual(plan.tradeQuery);
  });

  it("keeps Malachai's Loop at 3 of 8 with five invariant rows hidden", () => {
    const parsed = parsePoeItem(malachaisLoopVestigialFixture);
    expect(parsed).toMatchObject({
      valid: true,
      itemClass: "Shields",
      rarity: "unique",
      name: "Malachai's Loop",
      baseType: "Harmonic Spirit Shield",
      quality: 20,
      itemLevel: 70,
      vestigial: true,
      properties: {
        "Chance to Block": "23%",
        "Energy Shield": "240",
      },
    });

    const item = applyTradeStatCatalog(parsed, catalog);
    expect(item.modifiers).toHaveLength(7);
    expect(item.modifiers.every((modifier) => modifier.tradeId)).toBe(true);
    expect(item.modifiers.find(
      (modifier) => modifier.tradeId === "implicit.stat_250553316",
    )).toMatchObject({
      kind: "implicit",
      generation: "vestigial",
      values: [1],
      sourceValues: [1, 25],
      tradeDirection: 1,
    });

    const plan = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "similar",
      rollTolerance: 10,
      status: "onlineleague",
    });
    const visible = plan.filters.filter((filter) => !filter.advancedOnly);
    const hidden = plan.filters.filter((filter) => filter.advancedOnly);

    expect(plan.filters).toHaveLength(8);
    expect(visible).toHaveLength(3);
    expect(visible.every((filter) => filter.enabled)).toBe(true);
    expect(visible.map((filter) => ({
      property: filter.equipmentProperty?.key,
      tradeId: filter.tradeId,
    }))).toEqual([
      { property: "es", tradeId: undefined },
      { property: undefined, tradeId: "implicit.stat_250553316" },
      { property: undefined, tradeId: "explicit.stat_827329571" },
    ]);
    expect(visible.find(
      (filter) => filter.tradeId === "implicit.stat_250553316",
    )).toMatchObject({
      enabled: true,
      mode: "range",
      min: 1,
      direction: 1,
    });
    expect(visible.find(
      (filter) => filter.tradeId === "implicit.stat_250553316",
    )?.max).toBeUndefined();

    expect(hidden).toHaveLength(5);
    expect(hidden.every((filter) => !filter.enabled)).toBe(true);
    expect(hidden.map((filter) =>
      filter.equipmentProperty?.key || filter.tradeId
    )).toEqual([
      "block",
      "explicit.stat_227523295",
      "explicit.stat_1453197917",
      "explicit.stat_2135899247",
      "explicit.stat_4256314560",
    ]);

    const apiQuery = (plan.tradeQuery as any).query;
    expect(apiQuery.filters.armour_filters.filters).toEqual({
      es: expect.objectContaining({ min: expect.any(Number) }),
    });
    const serializedStats = apiQuery.stats[0].filters as Array<{
      id: string;
      disabled?: boolean;
    }>;
    expect(serializedStats.filter((filter) => !filter.disabled).map((filter) => filter.id))
      .toEqual([
        "implicit.stat_250553316",
        "explicit.stat_827329571",
      ]);
    expect(serializedStats).toContainEqual({
      id: "implicit.stat_250553316",
      value: { min: 1 },
    });
    expect(serializedStats.filter((filter) => filter.disabled).map((filter) => filter.id).sort())
      .toEqual([
        "explicit.stat_1453197917",
        "explicit.stat_2135899247",
        "explicit.stat_227523295",
        "explicit.stat_4256314560",
      ].sort());
    // APT omits disabled internal calculated properties rather than inventing
    // a `disabled` field inside official armour_filters.
    expect(apiQuery.filters.armour_filters.filters.block).toBeUndefined();

    expect(decodedBrowserPayload(plan)).toEqual(plan.tradeQuery);
  });
});
