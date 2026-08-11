import { describe, expect, it } from "vitest";
import {
  buildPriceCheckQueryPlan,
  defaultActivePriceCheckItemFilters,
  defaultPriceCheckItemFilters,
  orderedPriceCheckItemFilterEntries,
  planModifierFilters,
  planPriceCheckFilters,
  priceCheckItemFilterControls,
  supportsCompactModifierEditor,
} from "./query-plan";
import type {
  ParsedPoeItem,
  ParsedPoeModifier,
  PriceCheckModifierFilter,
  PriceCheckQueryPlan,
} from "./types";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  chronicleFixture,
  doubleCorruptedFledglingFixture,
  influencedStatusFixture,
  mapFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import { defaultPriceCheckModeForItem } from "./official-trade-workflow";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";

function modifier(patch: Partial<ParsedPoeModifier> = {}): ParsedPoeModifier {
  return {
    id: "explicit.stat_3299347043",
    kind: "explicit",
    text: "+100 to maximum Life",
    normalizedText: "+# to maximum life",
    values: [100],
    selectedByDefault: true,
    tier: "1",
    tags: ["life"],
    advanced: true,
    ...patch,
  };
}

function item(patch: Partial<ParsedPoeItem> = {}): ParsedPoeItem {
  return {
    rawText: "Rarity: Rare\nDoom Needle\nImbued Wand",
    language: "en",
    valid: true,
    itemClass: "Wands",
    rarity: "rare",
    name: "Doom Needle",
    baseType: "Imbued Wand",
    itemLevel: 86,
    quality: 20,
    sockets: [{ colors: ["B", "B", "B"], links: 3 }],
    links: 3,
    influences: ["Shaper"],
    corrupted: false,
    mirrored: false,
    split: false,
    identified: true,
    fractured: false,
    synthesised: false,
    veiled: false,
    foil: false,
    foulborn: false,
    vestigial: false,
    replica: false,
    scourged: false,
    properties: {},
    requirements: {},
    modifiers: [modifier()],
    flavourText: [],
    reminderText: [],
    unknownSections: [],
    warnings: [],
    errors: [],
    ...patch,
  };
}

function decodedQuery(plan: PriceCheckQueryPlan) {
  const url = new URL(plan.tradeUrl);
  const encoded = url.searchParams.get("q");
  const browserQuery = encoded ? JSON.parse(encoded) : plan.tradeQuery;
  const query = plan.tradeApi === "exchange" && encoded
    ? { ...plan.tradeQuery, query: browserQuery.exchange }
    : browserQuery;
  if (encoded) {
    if (plan.tradeApi === "exchange") {
      expect(browserQuery).toEqual({ exchange: plan.tradeQuery.query });
    } else {
      expect(query).toEqual(plan.tradeQuery);
    }
  }
  return {
    url,
    query: query as any,
  };
}

function activeStatFilters<T extends { disabled?: boolean }>(filters: T[]) {
  return filters.filter((filter) => !filter.disabled);
}

describe("modifier filter planner", () => {
  it("ports Awakened's hidden empty-or-crafted prefix query", () => {
    const source = item({
      influences: [],
      modifiers: [
        modifier({
          id: "p1",
          source: "First",
          generation: "prefix",
          tradeId: "explicit.stat_3299347043",
          tradeIds: [
            "explicit.stat_3299347043",
            "explicit.stat_7000000099",
          ],
        }),
        modifier({ id: "p2", source: "Second", generation: "prefix" }),
        modifier({ id: "s1", source: "Third", generation: "suffix" }),
        modifier({ id: "s2", source: "Fourth", generation: "suffix" }),
        modifier({ id: "s3", source: "Fifth", generation: "suffix" }),
      ],
    });
    const planned = planPriceCheckFilters(source, 10);
    const empty = planned.find(
      (filter) => filter.modifierId === "special:empty-or-crafted-modifier",
    );
    expect(empty).toMatchObject({
      tradeId: "item.has_empty_modifier",
      tradeOption: 1,
      statRef: "1 Empty or Crafted Modifier",
      tag: "pseudo",
      label: "1 Empty or Crafted Modifier",
      enabled: false,
      emptyModifier: 1,
      advancedOnly: true,
    });

    const plan = buildPriceCheckQueryPlan(source, "Allflame", {
      mode: "similar",
      filters: planned.map((filter) =>
        filter.modifierId === empty!.modifierId
          ? { ...filter, enabled: true }
          : filter
      ),
    });
    expect((plan.tradeQuery as any).query.stats.slice(1, 3)).toEqual([
      {
        type: "count",
        value: { min: 1, max: 1 },
        filters: [
          {
            id: "pseudo.pseudo_number_of_empty_prefix_mods",
            value: { min: 1, max: 1 },
          },
          {
            id: "pseudo.pseudo_number_of_crafted_prefix_mods",
            value: { min: 1 },
          },
        ],
      },
      {
        type: "count",
        value: { min: 1, max: 1 },
        filters: [
          {
            id: "pseudo.pseudo_number_of_empty_prefix_mods",
            value: { min: 1, max: 1 },
          },
          {
            id: "pseudo.pseudo_number_of_affix_mods",
            value: { min: 6 },
          },
        ],
      },
    ]);
    expect((plan.tradeQuery as any).query.stats[3]).toMatchObject({
      type: "count",
      value: { min: 1 },
      filters: [
        { id: "explicit.stat_3299347043", disabled: true },
        { id: "explicit.stat_7000000099", disabled: true },
      ],
    });
  });

  it("marks price-defining modifiers and explains its roll tolerance", () => {
    const filters = planModifierFilters(item(), 10);
    expect(filters[0]).toMatchObject({
      enabled: false,
      mode: "range",
      min: 90,
      max: 110,
      importance: "key",
    });
    expect(filters[0].explanation).toContain("±10%");
    expect(filters[0].explanation).toContain("Price-defining");
  });

  it("handles negative rolls without inverted bounds", () => {
    const filters = planModifierFilters(
      item({ modifiers: [modifier({ text: "-20% to Fire Resistance", normalizedText: "-#% to fire resistance", values: [-20] })] }),
      25,
    );
    expect(filters[0]).toMatchObject({ min: -25, max: -15 });
  });

  it("rounds integer ranges outward while preserving decimal and inverted semantics", () => {
    const planned = planModifierFilters(item({
      modifiers: [
        modifier({ id: "explicit.stat_41", values: [41] }),
        modifier({ id: "explicit.stat_decimal", values: [2.75] }),
        modifier({
          id: "explicit.stat_inverted",
          values: [-19],
          tradeDirection: -1,
          tradeInverted: true,
        }),
      ],
    }), 10);

    expect(planned[0]).toMatchObject({ min: 36, max: 46 });
    // APT keeps one decimal place for dp stats whose absolute roll is >= 2.3.
    expect(planned[1]).toMatchObject({ min: 2.4, max: 3.1 });
    expect(planned[2]).toMatchObject({ max: 21, tradeInverted: true });
    expect(planned[2].min).toBeUndefined();
  });

  it("keeps zero-tolerance comparable rolls as directional/range filters", () => {
    const filters = planModifierFilters(
      item({ modifiers: [modifier({ values: [42] }), modifier({ id: "implicit.stat_1", values: [] })] }),
      0,
    );
    expect(filters[0]).toMatchObject({ mode: "range", min: 42, max: 42 });
    expect(filters[1].mode).toBe("presence");
  });

  it("keeps optional unselected details disabled", () => {
    const filters = planModifierFilters(item({ modifiers: [modifier({ id: "crafted.stat_1", kind: "crafted", text: "8% increased Stun Duration", normalizedText: "#% increased stun duration", tags: [], values: [8], selectedByDefault: false })] }));
    expect(filters[0]).toMatchObject({ enabled: false, importance: "optional" });
  });

  it("keeps ordinary comparable source kinds off while preserving Awakened variants and pseudos", () => {
    const sourceKinds = ["explicit", "enchant", "fractured", "implicit", "crafted"] as const;
    const ordinary = sourceKinds.map((kind, index) => modifier({
      id: `${kind}.stat_${1000 + index}`,
      tradeId: `${kind}.stat_${1000 + index}`,
      kind,
      text: `+${20 + index}% to a comparable ${kind} roll`,
      normalizedText: `+#% to a comparable ${kind} roll`,
      values: [20 + index],
      tradeDirection: 1,
      selectedByDefault: true,
      tags: [],
    }));
    const selectedPseudo = modifier({
      id: "pseudo.pseudo_total_elemental_resistance",
      tradeId: "pseudo.pseudo_total_elemental_resistance",
      kind: "pseudo",
      selectedByDefault: true,
      tradeDirection: 1,
    });
    const optionVariant = modifier({
      id: "enchant.stat_option",
      tradeId: "enchant.stat_option",
      kind: "enchant",
      tradeOption: 7,
      selectedByDefault: false,
    });
    const nonComparable = modifier({
      id: "enchant.stat_seed",
      tradeId: "enchant.stat_seed",
      kind: "enchant",
      tradeDirection: 0,
      selectedByDefault: false,
    });

    const planned = planModifierFilters(item({
      modifiers: [...ordinary, selectedPseudo, optionVariant, nonComparable],
    }));
    expect(planned.slice(0, ordinary.length).map((filter) => filter.enabled))
      .toEqual([false, false, false, false, false]);
    expect(planned.slice(ordinary.length).map((filter) => filter.enabled))
      .toEqual([true, true, true]);
  });

  it("keeps ordinary explicit tier metadata visible without auto-enabling it", () => {
    const modifiers = [
      modifier({ id: "explicit.stat_101", tier: "1" }),
      modifier({ id: "explicit.stat_102", tier: "2" }),
      modifier({ id: "explicit.stat_103", tier: "3" }),
      modifier({ id: "explicit.stat_104", tier: undefined, advanced: false }),
      modifier({ id: "local-unmapped-t1", tier: "1" }),
    ];
    const planned = planModifierFilters(item({ modifiers }), 10);

    expect(planned).toHaveLength(modifiers.length);
    expect(planned.map((filter) => filter.enabled)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(modifiers.slice(0, 3).map((entry) => entry.tier)).toEqual(["1", "2", "3"]);
    expect(planned[2].importance).toBe("key");
  });

  it("uses known unique roll spans and keeps perfect rolls as one-sided thresholds", () => {
    const unique = item({
      rarity: "unique",
      name: "Test Unique",
      baseType: "Test Base",
      modifiers: [modifier({
        text: "+19(18-20)% to Fire Resistance",
        normalizedText: "+#% to fire resistance",
        values: [19],
        tradeDirection: 1,
      })],
    });
    const ranged = planPriceCheckFilters(unique, 10)[0];
    expect(ranged).toMatchObject({
      enabled: true,
      mode: "range",
      min: 18,
      bounds: { min: 18, max: 20 },
      direction: 1,
    });
    expect(ranged.max).toBeUndefined();
    const perfect = {
      ...unique,
      modifiers: [{ ...unique.modifiers[0], text: "+20(18-20)% to Fire Resistance", values: [20] }],
    };
    expect(planPriceCheckFilters(perfect, 10)[0]).toMatchObject({
      mode: "range",
      min: 20,
      bounds: { min: 18, max: 20 },
    });
    expect(planPriceCheckFilters(perfect, 10)[0].max).toBeUndefined();

    const lowEndpoint = {
      ...unique,
      modifiers: [{ ...unique.modifiers[0], text: "+18(18-20)% to Fire Resistance", values: [18] }],
    };
    expect(planPriceCheckFilters(lowEndpoint, 10)[0]).toMatchObject({
      mode: "range",
      min: 18,
      bounds: { min: 18, max: 20 },
    });
  });

  it("pins visible unique rolls without Advanced bounds to their copied thresholds", () => {
    const planned = planModifierFilters(item({
      rarity: "unique",
      itemClass: "Jewels",
      name: "That Which Was Taken",
      baseType: "Crimson Jewel",
      modifiers: [
        modifier({
          id: "explicit.stat_decimal_positive",
          text: "2.75% increased Effect",
          normalizedText: "#% increased effect",
          values: [2.75],
          tradeDirection: 1,
        }),
        modifier({
          id: "explicit.stat_decimal_negative",
          text: "-1.25 to a lower-is-better value",
          normalizedText: "# to a lower-is-better value",
          values: [-1.25],
          tradeDirection: -1,
        }),
      ],
    }), 10);

    expect(planned[0]).toMatchObject({
      enabled: true,
      mode: "range",
      min: 2.7,
      direction: 1,
    });
    expect(planned[0].max).toBeUndefined();
    expect(planned[1]).toMatchObject({
      enabled: true,
      mode: "range",
      max: -1.24,
      direction: -1,
    });
    expect(planned[1].min).toBeUndefined();
  });

  it("keeps large roll sets conservative when a known unique has no fixed-stat metadata", () => {
    const modifiers = Array.from({ length: 5 }, (_, index) => modifier({
      id: `explicit.stat_${700 + index}`,
      text: `+${11 + index}(10-20)% to Fire Resistance`,
      normalizedText: `variable mageblood roll ${index}`,
      values: [11 + index],
      tradeDirection: 1,
    }));
    const planned = planModifierFilters(item({
      rarity: "unique",
      itemClass: "Belts",
      name: "Mageblood",
      baseType: "Heavy Belt",
      modifiers,
    }), 10);

    expect(planned).toHaveLength(5);
    expect(planned.every((filter) => !filter.enabled)).toBe(true);
    expect(planned.every((filter) => filter.min != null && filter.max == null)).toBe(true);
  });

  it.each([
    ["That Which Was Taken", "Crimson Jewel"],
    ["The Light of Meaning", "Prismatic Jewel"],
  ])("enables every declared variant for %s", (name, baseType) => {
    const modifiers = Array.from({ length: 5 }, (_, index) => modifier({
      id: `explicit.stat_${750 + index}`,
      text: `+${11 + index}(10-20)% to Fire Resistance`,
      normalizedText: `declared variant roll ${index}`,
      values: [11 + index],
      tradeDirection: 1,
    }));
    const planned = planModifierFilters(item({
      rarity: "unique",
      itemClass: "Jewels",
      name,
      baseType,
      modifiers,
    }), 10);

    expect(planned).toHaveLength(5);
    expect(planned.every((filter) => filter.enabled)).toBe(true);
  });

  it("keeps a many-roll Ventor's Gamble conservative even with source bounds", () => {
    const modifiers = Array.from({ length: 6 }, (_, index) => modifier({
      id: `explicit.stat_${780 + index}`,
      text: `${11 + index}(10-20)% increased Item Rarity`,
      normalizedText: `ventor variable roll ${index}`,
      values: [11 + index],
      tradeDirection: 1,
    }));
    const planned = planModifierFilters(item({
      rarity: "unique",
      itemClass: "Rings",
      name: "Ventor's Gamble",
      baseType: "Gold Ring",
      modifiers,
    }), 10);

    expect(planned).toHaveLength(6);
    expect(planned.every((filter) => !filter.enabled)).toBe(true);
    expect(planned.every((filter) => filter.bounds != null)).toBe(true);
  });

  it.each([
    ["corrupted", { corrupted: true }, "Corrupted Implicit Modifier"],
    ["synthesised", { synthesised: true }, "Synthesised Implicit Modifier"],
    ["vestigial", { vestigial: true }, "Vestigial Implicit Modifier"],
  ] as const)("selects only the provenance-matched %s implicit", (_label, state, source) => {
    const baseImplicit = modifier({
      id: "implicit.stat_790",
      kind: "implicit",
      text: "+35 to Strength",
      normalizedText: "+# to strength",
      values: [35],
      tradeDirection: 1,
    });
    const specialImplicit = modifier({
      ...baseImplicit,
      id: "implicit.stat_791",
      text: "+8% to all Elemental Resistances",
      normalizedText: "+#% to all elemental resistances",
      values: [8],
      source,
    });
    const mageblood = item({
      ...state,
      rarity: "unique",
      itemClass: "Belts",
      name: "Mageblood",
      baseType: "Heavy Belt",
      modifiers: [baseImplicit, specialImplicit],
    });

    expect(planModifierFilters(mageblood, 10)).toMatchObject([
      { enabled: false },
      { enabled: true, importance: "key" },
    ]);
  });

  it("selects both generation-tagged implicits on a double-corrupted unique", () => {
    const fledgling = applyTradeStatCatalog(
      parsePoeItem(doubleCorruptedFledglingFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const plan = buildPriceCheckQueryPlan(fledgling, "Allflame", {
      mode: "similar",
      rollTolerance: 10,
    });
    const corruptionImplicits = plan.filters.filter((filter) =>
      fledgling.modifiers.some((modifier) =>
        modifier.id === filter.modifierId &&
        modifier.generation === "corrupted"
      )
    );

    expect(corruptionImplicits).toHaveLength(2);
    expect(corruptionImplicits).toMatchObject([
      {
        enabled: true,
        mode: "range",
        min: 1,
        importance: "key",
      },
      {
        enabled: true,
        mode: "range",
        min: 26,
        importance: "key",
      },
    ]);
    expect(corruptionImplicits.every((filter) => !filter.advancedOnly)).toBe(true);
    const activeStats = decodedQuery(plan).query.query.stats[0].filters
      .filter((filter: { disabled?: boolean }) => !filter.disabled);
    expect(activeStats).toHaveLength(2);
  });

  it("disables fixed Watcher's Eye boilerplate but enables its variable aura effects", () => {
    const planned = planModifierFilters(item({
      rarity: "unique",
      itemClass: "Jewels",
      name: "Watcher's Eye",
      baseType: "Prismatic Jewel",
      modifiers: [
        modifier({
          id: "explicit.stat_701",
          text: "6(4-6)% increased maximum Life",
          normalizedText: "#% increased maximum life",
          tradeStatRef: "#% increased maximum Life",
          values: [6],
          tradeDirection: 1,
        }),
        modifier({
          id: "explicit.stat_702",
          text: "+40(30-50)% to Critical Strike Multiplier while affected by Precision",
          normalizedText: "+#% to critical strike multiplier while affected by precision",
          tradeStatRef: "+#% to Critical Strike Multiplier while affected by Precision",
          values: [40],
          tradeDirection: 1,
        }),
      ],
    }), 10);

    expect(planned[0].enabled).toBe(false);
    expect(planned[1]).toMatchObject({
      enabled: true,
      importance: "key",
      mode: "range",
      min: 38,
      direction: 1,
    });
  });

  it("uses the lower endpoint as perfect for lower-is-better unique rolls", () => {
    const repentance = item({
      rarity: "unique",
      itemClass: "Gloves",
      name: "Repentance",
      baseType: "Crusader Gloves",
      modifiers: [modifier({
        id: "explicit.stat_703",
        text: "500(400-500)% increased Attribute Requirements",
        normalizedText: "#% increased attribute requirements",
        values: [500],
        tradeDirection: -1,
      })],
    });
    const nonPerfect = planPriceCheckFilters(repentance, 10)[0];
    expect(nonPerfect).toMatchObject({
      enabled: true,
      mode: "range",
      max: 500,
      bounds: { min: 400, max: 500 },
      direction: -1,
    });
    expect(nonPerfect.min).toBeUndefined();

    const perfect = {
      ...repentance,
      modifiers: [{
        ...repentance.modifiers[0],
        text: "400(400-500)% increased Attribute Requirements",
        values: [400],
      }],
    };
    expect(planPriceCheckFilters(perfect, 10)[0]).toMatchObject({
      mode: "range",
      max: 400,
    });
    expect(planPriceCheckFilters(perfect, 10)[0].min).toBeUndefined();
  });

  it("keeps Timeless Jewel seeds exact while disabling fixed identity text", () => {
    const planned = planModifierFilters(item({
      rarity: "unique",
      itemClass: "Jewels",
      name: "Glorious Vanity",
      baseType: "Timeless Jewel",
      modifiers: [
        modifier({
          id: "explicit.stat_704",
          text: "Historic",
          normalizedText: "historic",
          tradeStatRef: "Historic",
          values: [],
          selectedByDefault: false,
          tags: [],
        }),
        modifier({
          id: "local-timeless-seed",
          tradeId: "explicit.pseudo_timeless_jewel_seed",
          text: "Bathed in the blood of 1234 sacrificed in the name of Doryani",
          normalizedText: "bathed in the blood of # sacrificed in the name of doryani",
          values: [1234],
          tags: ["seed"],
          tradeDirection: 0,
        }),
      ],
    }), 10);

    expect(planned[0].enabled).toBe(false);
    expect(planned[0].advancedOnly).toBe(true);
    expect(planned[1]).toMatchObject({
      enabled: true,
      importance: "key",
      mode: "exact",
      min: 1234,
      max: 1234,
      direction: 0,
    });
  });

  it.each([
    ["Brutal Restraint", "Denoted service of 1234 dekhara in the akhara of Nasima"],
    ["Elegant Hubris", "Commissioned 1234 coins to commemorate Victario"],
    ["Glorious Vanity", "Bathed in the blood of 1234 sacrificed in the name of Doryani"],
    ["Heroic Tragedy", "Remembrancing 1234 songworthy deeds by the line of Vorana"],
    ["Lethal Pride", "Commanded leadership over 1234 warriors under Rakiata"],
    ["Militant Faith", "Carved to glorify 1234 new faithful converted by High Templar Dominus"],
  ])("keeps the current %s seed exact", (name, text) => {
    const planned = planModifierFilters(item({
      rarity: "unique",
      itemClass: "Jewels",
      name,
      baseType: "Timeless Jewel",
      modifiers: [
        modifier({
          id: "explicit.stat_historic",
          text: "Historic",
          normalizedText: "historic",
          tradeStatRef: "Historic",
          values: [],
        }),
        modifier({
          id: "local-timeless-seed",
          tradeId: "explicit.pseudo_timeless_jewel_seed",
          text,
          normalizedText: text.replace("1234", "#").toLowerCase(),
          values: [1234],
          tags: ["timeless-jewel", "seed"],
          tradeDirection: 0,
        }),
      ],
    }), 10);

    expect(planned).toMatchObject([
      { enabled: false },
      {
        enabled: true,
        mode: "exact",
        min: 1234,
        max: 1234,
        direction: 0,
      },
    ]);
  });
});

describe("official Trade browser query planner", () => {
  it("applies Awakened's Chronicle pruning and explosives-room state relaxation", () => {
    const chronicle = applyTradeStatCatalog(
      parsePoeItem(chronicleFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const planned = planModifierFilters(chronicle, 10);
    expect(planned).toHaveLength(6);
    expect(planned.filter((filter) => filter.enabled).map((filter) =>
      chronicle.modifiers.find((modifier) => modifier.id === filter.modifierId)?.text
    )).toEqual([
      "Apex of Atzoatl",
      "Locus of Corruption (Tier 3)",
      "Doryani's Institute (Tier 3)",
      "Apex of Ascension (Tier 3)",
      "Wealth of the Vaal (Tier 3)",
    ]);
    expect(planned[0]).toMatchObject({
      enabled: true,
      mode: "presence",
      tradeOption: 1,
    });
    expect(planned[5]).toMatchObject({ enabled: false, tradeOption: 1 });
    expect(supportsCompactModifierEditor(chronicle, planned)).toBe(true);

    const defaultMode = defaultPriceCheckModeForItem(chronicle);
    expect(defaultMode).toBe("exact");
    const defaultQuery = decodedQuery(buildPriceCheckQueryPlan(
      chronicle,
      "Allflame",
      { mode: defaultMode },
    )).query.query;
    expect(activeStatFilters(defaultQuery.stats[0].filters)).toHaveLength(5);
    expect(defaultQuery.stats[0].filters).not.toContainEqual({
      id: "pseudo.pseudo_temple_chests_3",
      value: { option: 1 },
    });

    const withExplosives = applyTradeStatCatalog(
      parsePoeItem(chronicleFixture.replace(
        "Open Rooms:\n",
        "Open Rooms:\nExplosives Room (Tier 1)\n",
      )),
      actualCatalog as TradeStatCatalogPack,
    );
    const relaxed = planModifierFilters(withExplosives, 10);
    expect(relaxed).toHaveLength(8);
    expect(relaxed[6]).toMatchObject({ enabled: false, mode: "presence" });
    expect(relaxed[6]).not.toHaveProperty("tradeOption");
    const withObstructed = relaxed.map((filter, index) => ({
      ...filter,
      enabled: filter.enabled || index === 6,
    }));
    const plan = buildPriceCheckQueryPlan(withExplosives, "Allflame", {
      filters: withObstructed,
    });
    const tradeFilters = decodedQuery(plan).query.query.stats[0].filters;
    expect(activeStatFilters(tradeFilters)).toHaveLength(6);
    expect(tradeFilters).toEqual(expect.arrayContaining([
      { id: "pseudo.pseudo_temple_apex", value: { option: 1 } },
      { id: "pseudo.pseudo_temple_corruption_room_3", value: { option: 1 } },
      { id: "pseudo.pseudo_temple_gem_room_3", value: { option: 1 } },
      { id: "pseudo.pseudo_temple_sacrifice_room_3", value: { option: 1 } },
      { id: "pseudo.pseudo_temple_currency_vault_3", value: { option: 1 } },
      { id: "pseudo.pseudo_temple_chests_3" },
    ]));
  });

  it("applies Awakened's Mirrored Tablet difficulty and default rules", () => {
    const tablet = applyTradeStatCatalog(item({
      rarity: "normal",
      itemClass: "Misc Map Items",
      name: "Mirrored Tablet",
      baseType: "Mirrored Tablet",
      influences: [],
      modifiers: [
        modifier({ kind: "pseudo", text: "Reflection of Kalandra (Difficulty 12)", normalizedText: "reflection of kalandra (difficulty #)", values: [12] }),
        modifier({ kind: "pseudo", text: "Reflection of the Sun (Difficulty 10)", normalizedText: "reflection of the sun (difficulty #)", values: [10] }),
        modifier({ kind: "pseudo", text: "Reflection of Delirium (Difficulty 3)", normalizedText: "reflection of delirium (difficulty #)", values: [3] }),
        modifier({ kind: "pseudo", text: "Reflection of Abyss (Difficulty 9)", normalizedText: "reflection of abyss (difficulty #)", values: [9] }),
        modifier({ kind: "pseudo", text: "Reflection of Abyss (Difficulty 7)", normalizedText: "reflection of abyss (difficulty #)", values: [7] }),
        modifier({ kind: "pseudo", text: "Reflection of the Breachlord (Difficulty 10)", normalizedText: "reflection of the breachlord (difficulty #)", values: [10] }),
      ],
    }), actualCatalog as TradeStatCatalogPack);
    const planned = planModifierFilters(tablet, 10);

    expect(planned).toHaveLength(5);
    expect(planned.filter((filter) => filter.enabled).map((filter) => filter.modifierId))
      .toEqual([tablet.modifiers[0].id, tablet.modifiers[1].id]);
    expect(planned[2]).toMatchObject({ mode: "presence", enabled: false });
    expect(planned[3]).toMatchObject({
      mode: "range",
      enabled: false,
      advancedOnly: true,
    });
    expect(planned[4]).toMatchObject({ mode: "range", enabled: false });

    const defaultMode = defaultPriceCheckModeForItem(tablet);
    expect(defaultMode).toBe("exact");
    const defaultQuery = decodedQuery(buildPriceCheckQueryPlan(
      tablet,
      "Allflame",
      { mode: defaultMode },
    )).query.query;
    expect(activeStatFilters(defaultQuery.stats[0].filters)).toEqual([
      expect.objectContaining({ id: tablet.modifiers[0].tradeId }),
      expect.objectContaining({ id: tablet.modifiers[1].tradeId }),
    ]);

    const query = buildPriceCheckQueryPlan(tablet, "Allflame", {
      filters: planned.map((filter, index) => ({
        ...filter,
        enabled: index === 2,
      })),
    }).tradeQuery as any;
    expect(activeStatFilters(query.query.stats[0].filters)).toEqual([
      { id: "pseudo.lake_22138" },
    ]);
  });

  it("applies Awakened's oil-aware anointment visibility and Talisman rule", () => {
    const enchant = modifier({
      kind: "enchant",
      text: "Your Chilling Towers have 25% increased effect of Chill",
      normalizedText: "your chilling towers have #% increased effect of chill",
      values: [25],
    });
    const ring = applyTradeStatCatalog(item({
      rarity: "rare",
      itemClass: "Rings",
      name: "Ghoul Loop",
      baseType: "Amethyst Ring",
      modifiers: [enchant],
    }), actualCatalog as TradeStatCatalogPack);
    expect(ring.modifiers[0].anointmentOils).toEqual(["Violet Oil", "Violet Oil"]);
    expect(planModifierFilters(ring)).toMatchObject([{
      enabled: false,
      advancedOnly: true,
      anointmentOils: ["Violet Oil", "Violet Oil"],
    }]);
    const ringQuery = decodedQuery(buildPriceCheckQueryPlan(
      ring,
      "Allflame",
      { mode: "similar" },
    )).query.query;
    expect(ringQuery.stats[0].filters).toContainEqual(expect.objectContaining({
      id: ring.modifiers[0].tradeId,
      disabled: true,
    }));

    const highOil = applyTradeStatCatalog(item({
      rarity: "unique",
      itemClass: "Rings",
      name: "Test Unique Ring",
      baseType: "Unset Ring",
      modifiers: [modifier({
        kind: "enchant",
        text: "All Towers in range of your Empowering Towers have 50% chance to deal Double Damage",
        normalizedText: "all towers in range of your empowering towers have #% chance to deal double damage",
        values: [50],
      })],
    }), actualCatalog as TradeStatCatalogPack);
    expect(planModifierFilters(highOil)[0]).toMatchObject({
      enabled: false,
      anointmentOils: ["Golden Oil", "Golden Oil"],
    });
    expect(planPriceCheckFilters(highOil)[0].enabled).toBe(true);

    const talisman = applyTradeStatCatalog({
      ...ring,
      itemClass: "Amulets",
      baseType: "Greatwolf Talisman",
      talismanTier: 2,
      modifiers: [enchant],
    }, actualCatalog as TradeStatCatalogPack);
    expect(planModifierFilters(talisman)[0].enabled).toBe(true);

    const exactTalisman = buildPriceCheckQueryPlan(talisman, "Allflame", {
      mode: "exact",
    });
    expect(decodedQuery(exactTalisman).query.query.stats[0].filters)
      .toContainEqual(expect.objectContaining({
        id: talisman.modifiers[0].tradeId,
      }));

    const highOilRare = applyTradeStatCatalog(item({
      rarity: "rare",
      itemClass: "Amulets",
      name: "Doom Locket",
      baseType: "Onyx Amulet",
      influences: [],
      modifiers: [modifier({
        kind: "enchant",
        text: "All Towers in range of your Empowering Towers have 50% chance to deal Double Damage",
        normalizedText: "all towers in range of your empowering towers have #% chance to deal double damage",
        values: [50],
      })],
    }), actualCatalog as TradeStatCatalogPack);
    expect(planModifierFilters(highOilRare)[0]).toMatchObject({
      enabled: false,
      anointmentOils: ["Golden Oil", "Golden Oil"],
    });
    expect(activeStatFilters(decodedQuery(buildPriceCheckQueryPlan(highOilRare, "Allflame", {
      mode: "exact",
    })).query.query.stats[0].filters)).toEqual([
      expect.objectContaining({ id: highOilRare.modifiers[0].tradeId }),
    ]);
  });

  it("keeps Cluster Jewel socket-count boilerplate disabled in Base mode", () => {
    const cluster = item({
      rarity: "rare",
      itemClass: "Cluster Jewels",
      name: "Vivid Large Cluster Jewel",
      baseType: "Large Cluster Jewel",
      influences: [],
      modifiers: [modifier({
        id: "enchant.stat_4079888060",
        tradeId: "enchant.stat_4079888060",
        kind: "enchant",
        text: "2 Added Passive Skills are Jewel Sockets",
        normalizedText: "# added passive skills are jewel sockets",
        values: [2],
        tradeDirection: 1,
        selectedByDefault: true,
      })],
    });
    expect(planModifierFilters(cluster)[0].enabled).toBe(false);
    const base = buildPriceCheckQueryPlan(cluster, "Allflame", { mode: "base" });
    expect(base.filters.find((filter) =>
      filter.modifierId === "enchant.stat_4079888060"
    )?.enabled).toBe(false);
    expect(activeStatFilters(decodedQuery(base).query.query.stats[0].filters)).toEqual([]);
  });

  it("uses a rare base identity plus selected official modifier stats", () => {
    const source = item();
    const plan = buildPriceCheckQueryPlan(source, "Allflame", {
      rollTolerance: 10,
      filters: planModifierFilters(source, 10).map((filter) => ({
        ...filter,
        enabled: true,
      })),
    });
    const { url, query } = decodedQuery(plan);
    expect(url.origin).toBe("https://www.pathofexile.com");
    expect(url.pathname).toBe("/trade/search/Allflame");
    expect(url.searchParams.has("q")).toBe(true);
    expect(url.hash).toBe("");
    expect(plan.warnings.join(" ")).toContain("filters prefilled");
    expect(plan.identity).toBe("base");
    expect(query.query).toMatchObject({
      status: { option: "available" },
      type: "Imbued Wand",
      stats: [{
        type: "and",
        filters: [
          { id: "explicit.stat_3299347043", value: { min: 90, max: 110 } },
          { id: "pseudo.pseudo_has_shaper_influence", disabled: true },
        ],
      }],
    });
  });

  it("routes statless tagged items through Awakened's exchange query", () => {
    const divine = item({
      rarity: "currency",
      itemClass: "Stackable Currency",
      name: "Divine Orb",
      baseType: "Divine Orb",
      stackSize: 7,
      itemLevel: undefined,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    });
    const plan = buildPriceCheckQueryPlan(divine, "Allflame", {
      mode: "exact",
      itemFilters: { stackSize: 7, tradeCurrency: "chaos_divine" },
    });
    expect(plan.tradeApi).toBe("exchange");
    expect(new URL(plan.tradeUrl).pathname).toBe("/trade/exchange/Allflame");
    expect(decodedQuery(plan).query).toEqual({
      engine: "new",
      query: {
        status: { option: "online" },
        have: ["chaos"],
        want: ["divine"],
        minimum: 7,
      },
      sort: { have: "asc" },
    });

    const withStat = buildPriceCheckQueryPlan({
      ...divine,
      modifiers: [modifier({ kind: "pseudo", selectedByDefault: true })],
    }, "Allflame", { mode: "exact" });
    expect(withStat.tradeApi).toBe("trade");
    expect(new URL(withStat.tradeUrl).pathname).toBe("/trade/search/Allflame");
  });

  it("serializes Awakened's price currency and listed-age trade filters", () => {
    const plan = buildPriceCheckQueryPlan(item({ influences: [] }), "Allflame", {
      mode: "similar",
      itemFilters: {
        corrupted: false,
        tradeCurrency: "divine",
        listed: "1week",
      },
    });
    expect(decodedQuery(plan).query.query.filters.trade_filters.filters)
      .toMatchObject({
        price: { option: "divine" },
        indexed: { option: "1week" },
        collapse: { option: "true" },
      });

    const map = buildPriceCheckQueryPlan(item({
      rarity: "normal",
      itemClass: "Maps",
      name: "Dunes Map",
      baseType: "Dunes Map",
      itemLevel: undefined,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    }), "Allflame", { mode: "exact" });
    expect(map.itemFilters.tradeCurrency).toBe("chaos_divine");
    expect(decodedQuery(map).query.query.filters.trade_filters.filters.price)
      .toEqual({ option: "chaos_divine" });
  });

  it("uses relaxed Awakened state defaults and enables exact base discriminators on demand", () => {
    const relaxed = buildPriceCheckQueryPlan(item(), "Allflame");
    const relaxedMisc = decodedQuery(relaxed).query.query.filters.misc_filters.filters;
    expect(relaxedMisc).toMatchObject({
      corrupted: { option: "false" },
      fractured_item: { option: "false" },
    });
    expect(relaxedMisc).not.toHaveProperty("ilvl");
    expect(relaxedMisc).not.toHaveProperty("quality");
    expect(relaxedMisc).not.toHaveProperty("shaper_item");
    expect(relaxed.itemFilters).toMatchObject({
      corrupted: false,
      fractured: false,
    });
    expect(relaxed.itemFilters).not.toHaveProperty("links");

    const plan = buildPriceCheckQueryPlan(item(), "Allflame", {
      rollTolerance: 0,
    });
    const { query } = decodedQuery(plan);
    expect(query.query.filters).toMatchObject({
      misc_filters: {
        filters: {
          corrupted: { option: "false" },
          ilvl: { min: 86 },
        },
      },
    });
    expect(query.query.stats[0].filters).toContainEqual({
      id: "pseudo.pseudo_has_shaper_influence",
    });
    expect(plan.itemFilters).toMatchObject({
      itemLevel: 86,
      corrupted: false,
      "influence:shaper": true,
    });
    expect(plan.itemFilters).not.toHaveProperty("links");
    expect(plan.itemFilters).not.toHaveProperty("quality");
  });

  it("does not invent legacy influence filters for Eldritch influence markers", () => {
    const influenced = item({
      influences: ["Searing Exarch", "Eater of Worlds"],
    });
    const relaxed = buildPriceCheckQueryPlan(influenced, "Allflame");
    expect(decodedQuery(relaxed).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("searing_item");

    const plan = buildPriceCheckQueryPlan(influenced, "Allflame", {
      rollTolerance: 0,
    });
    expect(decodedQuery(plan).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("searing_item");
    expect(activeStatFilters(decodedQuery(plan).query.query.stats[0].filters)).toEqual([]);
  });

  it("keeps the veiled control without emitting a nonexistent misc boolean", () => {
    const veiled = buildPriceCheckQueryPlan(item({ veiled: true }), "Allflame");
    expect(veiled.itemFilters.veiled).toBe(true);
    expect(decodedQuery(veiled).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("veiled");

    const ordinary = buildPriceCheckQueryPlan(item(), "Allflame");
    expect(ordinary.itemFilters).not.toHaveProperty("veiled");
    expect(decodedQuery(ordinary).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("veiled");
  });

  it("serializes one logical VEILED control and never duplicates its modifier row", () => {
    const parsed = applyTradeStatCatalog(
      parsePoeItem(influencedStatusFixture),
      actualCatalog as unknown as TradeStatCatalogPack,
    );
    const veil = parsed.modifiers.find((modifier) => modifier.kind === "veiled");
    expect(veil).toMatchObject({
      normalizedText: "veiled",
      tradeId: "veiled.mod_65000",
      selectedByDefault: true,
    });

    for (const mode of ["similar", "exact", "base"] as const) {
      const plan = buildPriceCheckQueryPlan(parsed, "Allflame", { mode });
      expect(plan.itemFilters.veiled).toBe(true);
      expect(plan.filters.find((filter) => filter.tradeId === "veiled.mod_65000"))
        .toBeUndefined();
      expect(decodedQuery(plan).query.query.stats[0].filters)
        .toContainEqual({ id: "veiled.mod_65000" });
    }

    const similar = buildPriceCheckQueryPlan(parsed, "Allflame", {
      mode: "similar",
    });
    expect(similar.filters.filter((filter) => filter.enabled)).toHaveLength(0);
    const disabled = buildPriceCheckQueryPlan(parsed, "Allflame", {
      mode: "similar",
      itemFilters: { veiled: false },
    });
    expect(decodedQuery(disabled).query.query.stats[0].filters)
      .toContainEqual({ id: "veiled.mod_65000", disabled: true });
  });

  it("encodes exact gem state and map tier", () => {
    const gemPlan = buildPriceCheckQueryPlan(item({ rarity: "gem", name: "Fireball", baseType: "Fireball", itemClass: "Skill Gems", gemLevel: 21, quality: 23, itemLevel: undefined, links: undefined, sockets: [], influences: [], modifiers: [], corrupted: true }), "Allflame");
    const gemQuery = decodedQuery(gemPlan).query;
    expect(gemQuery.query.filters.misc_filters.filters).toMatchObject({
      gem_level: { min: 21 },
      quality: { min: 23 },
      gem_imbued: { option: "false" },
    });
    expect(gemPlan.itemFilters.corrupted).toBe(true);
    expect(gemQuery.query.filters.misc_filters.filters)
      .not.toHaveProperty("corrupted");

    const mapPlan = buildPriceCheckQueryPlan(item({ rarity: "normal", name: "Dunes Map", baseType: "Dunes Map", itemClass: "Maps", mapTier: 16, itemLevel: undefined, quality: undefined, links: undefined, sockets: [], influences: [], modifiers: [] }), "Allflame");
    expect(decodedQuery(mapPlan).query.query.filters.map_filters.filters.map_tier).toEqual({ min: 16, max: 16 });
  });

  it("uses pinned gem max levels, quality thresholds and transfigured discriminators", () => {
    const gem = (name: string, gemLevel: number, quality: number) => item({
      rarity: "gem",
      itemClass: "Skill Gems",
      name,
      baseType: name,
      gemLevel,
      quality,
      itemLevel: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    });

    const ordinary = buildPriceCheckQueryPlan(
      gem("Fireball", 20, 16),
      "Allflame",
      { mode: "exact" },
    );
    expect(decodedQuery(ordinary).query.query).toMatchObject({
      type: "Fireball",
      filters: {
        misc_filters: {
          filters: {
            gem_level: { min: 20 },
            quality: { min: 16 },
          },
        },
      },
    });

    const belowThreshold = buildPriceCheckQueryPlan(
      gem("Fireball", 19, 15),
      "Allflame",
      { mode: "exact" },
    );
    expect(decodedQuery(belowThreshold).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("gem_level");
    expect(decodedQuery(belowThreshold).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("quality");

    const transfigured = buildPriceCheckQueryPlan(
      gem("Animate Weapon of Ranged Arms", 20, 20),
      "Allflame",
      { mode: "exact" },
    );
    expect(decodedQuery(transfigured).query.query.type).toEqual({
      discriminator: "alt_y",
      option: "Animate Weapon",
    });

    const levelOne = buildPriceCheckQueryPlan(
      gem("Portal", 1, 1),
      "Allflame",
      { mode: "exact" },
    );
    expect(decodedQuery(levelOne).query.query.filters.misc_filters.filters)
      .toMatchObject({ gem_level: { min: 1 }, quality: { min: 1 } });
  });

  it("omits positive corruption except for Awakened's exact magic Jewel cases", () => {
    const corruptedRare = item({ corrupted: true });
    for (const plan of [
      buildPriceCheckQueryPlan(corruptedRare, "Allflame"),
      buildPriceCheckQueryPlan(corruptedRare, "Allflame", { rollTolerance: 0 }),
    ]) {
      expect(plan.itemFilters.corrupted).toBe(true);
      expect(decodedQuery(plan).query.query.filters.misc_filters.filters)
        .not.toHaveProperty("corrupted");
    }

    for (const [itemClass, baseType] of [
      ["Jewels", "Cobalt Jewel"],
      ["Abyss Jewels", "Ghastly Eye Jewel"],
    ]) {
      const magicJewel = buildPriceCheckQueryPlan(item({
        rawText: `Item Class: ${itemClass}\nRarity: Magic\nGlimmering ${baseType}`,
        rarity: "magic",
        itemClass,
        name: `Glimmering ${baseType}`,
        baseType,
        itemLevel: 84,
        quality: undefined,
        links: undefined,
        sockets: [],
        influences: [],
        modifiers: [],
        corrupted: true,
      }), "Allflame");
      expect(magicJewel.itemFilters.corrupted).toBe(true);
      expect(decodedQuery(magicJewel).query.query.filters.misc_filters.filters.corrupted)
        .toEqual({ option: "true" });
      expect(decodedQuery(magicJewel).query.query.filters.type_filters.filters.rarity)
        .toEqual({ option: "magic" });
    }
  });

  it("labels corruption explicitly and serializes a user-selected clean state", () => {
    const corruptedRare = item({ corrupted: true });
    expect(priceCheckItemFilterControls(corruptedRare)).toContainEqual({
      key: "corrupted",
      label: "CORRUPTED",
      copiedValue: true,
      kind: "boolean",
    });

    const cleanOverride = buildPriceCheckQueryPlan(corruptedRare, "Allflame", {
      itemFilters: { corrupted: false },
    });
    expect(decodedQuery(cleanOverride).query.query.filters.misc_filters.filters.corrupted)
      .toEqual({ option: "false" });

    const cleanRare = item({ corrupted: false });
    expect(priceCheckItemFilterControls(cleanRare)).toContainEqual({
      key: "corrupted",
      label: "NOT CORRUPTED",
      copiedValue: false,
      kind: "boolean",
    });

    const cleanMagicJewel = item({
      rarity: "magic",
      itemClass: "Jewels",
      name: "Glimmering Cobalt Jewel",
      baseType: "Cobalt Jewel",
      corrupted: false,
      influences: [],
      quality: undefined,
      links: undefined,
      sockets: [],
      modifiers: [],
    });
    const corruptedOverride = buildPriceCheckQueryPlan(cleanMagicJewel, "Allflame", {
      itemFilters: { corrupted: true },
    });
    expect(decodedQuery(corruptedOverride).query.query.filters.misc_filters.filters.corrupted)
      .toEqual({ option: "true" });
  });

  it("warns visibly when selected stats lack official Trade IDs", () => {
    const source = item({
      influences: [],
      modifiers: [modifier({ id: "parsed-mod-1" })],
    });
    const plan = buildPriceCheckQueryPlan(
      source,
      "Allflame",
      {
        filters: planModifierFilters(source).map((filter) => ({
          ...filter,
          enabled: true,
        })),
      },
    );
    expect(plan.warnings.join(" ")).toContain("no official Trade stat ID");
    expect(decodedQuery(plan).query.query.stats).toEqual([{ type: "and", filters: [] }]);
  });

  it("keeps a stable local modifier id while using its resolved Trade id", () => {
    const source = item({
      modifiers: [
        modifier({
          id: "local-life-filter",
          tradeId: "explicit.stat_3299347043",
        }),
      ],
    });
    const plan = buildPriceCheckQueryPlan(
      source,
      "Allflame",
      {
        filters: planModifierFilters(source).map((filter) => ({
          ...filter,
          enabled: true,
        })),
      },
    );
    expect(plan.filters[0]).toMatchObject({
      modifierId: "local-life-filter",
      tradeId: "explicit.stat_3299347043",
    });
    expect(
      decodedQuery(plan).query.query.stats[0].filters[0].id,
    ).toBe("explicit.stat_3299347043");
  });

  it("preserves selector-qualified jewel IDs and never attaches a numeric value", () => {
    const selectedRing = modifier({
      id: "local-thread-ring",
      tradeId: "explicit.stat_3642528642|5",
      text: "Passives in Very Large Ring can be Allocated",
      normalizedText: "passives in very large ring can be allocated",
      values: [],
      selectedByDefault: false,
      tags: ["variant"],
      tradeDirection: 0,
    });
    const thread = item({
      rarity: "unique",
      itemClass: "Jewels",
      name: "Thread of Hope",
      baseType: "Crimson Jewel",
      modifiers: [selectedRing],
    });
    const planned = planModifierFilters(thread, 10);
    expect(planned[0]).toMatchObject({
      enabled: true,
      mode: "presence",
      importance: "key",
      tradeId: "explicit.stat_3642528642|5",
    });

    const queryFilter = decodedQuery(
      buildPriceCheckQueryPlan(thread, "Allflame"),
    ).query.query.stats[0].filters[0];
    expect(queryFilter).toEqual({ id: "explicit.stat_3642528642|5" });

    const forbidden = buildPriceCheckQueryPlan(item({
      rarity: "unique",
      itemClass: "Jewels",
      name: "Forbidden Flame",
      baseType: "Crimson Jewel",
      modifiers: [modifier({
        id: "local-forbidden-choice",
        tradeId: "explicit.stat_2460506030|38999",
        text: "Allocates an Ascendancy Passive Skill",
        normalizedText: "allocates an ascendancy passive skill",
        values: [],
        selectedByDefault: false,
        tags: [],
        tradeDirection: 0,
      })],
    }), "Allflame");
    expect(decodedQuery(forbidden).query.query.stats[0].filters[0]).toEqual({
      id: "explicit.stat_2460506030|38999",
    });
  });

  it("preserves numeric rolls on selector-qualified Trade IDs", () => {
    const supportedSkill = item({
      rarity: "unique",
      name: "The Untouched Soul",
      baseType: "Lapis Amulet",
      modifiers: [modifier({
        id: "local-supported-skill",
        tradeId: "explicit.stat_4089743927|4|126",
        text: "Skills granted by your Passive Tree are Supported by Level 20 Added Chaos Damage",
        normalizedText: "skills granted by your passive tree are supported by level # added chaos damage",
        values: [20],
        tradeDirection: 1,
      })],
    });
    const plan = buildPriceCheckQueryPlan(supportedSkill, "Allflame");

    expect(plan.filters[0]).toMatchObject({
      enabled: true,
      mode: "range",
      min: 20,
      tradeId: "explicit.stat_4089743927|4|126",
    });
    expect(decodedQuery(plan).query.query.stats[0].filters[0]).toEqual({
      id: "explicit.stat_4089743927|4|126",
      value: { min: 20 },
    });
  });

  it("honors edited modifier filters supplied by the UI", () => {
    const edited: PriceCheckModifierFilter[] = [{
      modifierId: "explicit.stat_3299347043",
      enabled: true,
      mode: "range",
      min: 95,
      max: 125,
      importance: "key",
      explanation: "User-adjusted comparable range.",
    }];
    const plan = buildPriceCheckQueryPlan(item(), "Allflame", {
      identity: "exact",
      filters: edited,
    });
    const queryFilter = decodedQuery(plan).query.query.stats[0].filters[0];
    expect(decodedQuery(plan).query.query.type).toBe("Imbued Wand");
    expect(queryFilter.value).toEqual({ min: 95, max: 125 });
    expect(plan.filters).toEqual([{ ...edited[0], copiedValue: 100 }]);
  });

  it("serializes Exact as one copied value even if stale range bounds are supplied", () => {
    const plan = buildPriceCheckQueryPlan(item(), "Allflame", {
      filters: [{
        modifierId: "explicit.stat_3299347043",
        enabled: true,
        mode: "exact",
        min: 95,
        max: 125,
        importance: "key",
        explanation: "Edited",
      }],
    });
    expect(decodedQuery(plan).query.query.stats[0].filters[0].value).toEqual({
      min: 95,
      max: 95,
    });
  });

  it("inverts and swaps only the official Trade payload bounds", () => {
    const range = buildPriceCheckQueryPlan(item(), "Allflame", {
      filters: [{
        modifierId: "explicit.stat_3299347043",
        enabled: true,
        mode: "range",
        max: -18,
        tradeInverted: true,
        importance: "key",
        explanation: "Canonical lower-is-better range.",
      }],
    });
    expect(range.filters[0]).toMatchObject({ max: -18, tradeInverted: true });
    expect(decodedQuery(range).query.query.stats[0].filters[0].value).toEqual({
      min: 18,
    });

    const exact = buildPriceCheckQueryPlan(item(), "Allflame", {
      filters: [{
        modifierId: "explicit.stat_3299347043",
        enabled: true,
        mode: "exact",
        min: -20,
        max: -19,
        tradeInverted: true,
        importance: "key",
        explanation: "Canonical exact roll.",
      }],
    });
    expect(decodedQuery(exact).query.query.stats[0].filters[0].value).toEqual({
      min: 20,
      max: 20,
    });
  });

  it("lets users loosen strict copied item-state filters", () => {
    const plan = buildPriceCheckQueryPlan(item(), "Allflame", {
      itemFilters: { itemLevel: 80, corrupted: false },
    });
    const filters = decodedQuery(plan).query.query.filters;
    expect(filters.misc_filters.filters).toEqual({
      corrupted: { option: "false" },
      ilvl: { min: 80 },
    });
    expect(filters).not.toHaveProperty("socket_filters");
    expect(plan.itemFilters).toEqual({
      identityRelaxed: true,
      itemLevel: 80,
      corrupted: false,
    });
  });

  it("supports explicit base mode and intentionally removes modifier stats", () => {
    const source = item();
    const plan = buildPriceCheckQueryPlan(source, "Allflame", {
      identity: "base",
      filters: planModifierFilters(source).map((filter) => ({
        ...filter,
        enabled: true,
      })),
    });
    const query = decodedQuery(plan).query;
    expect(plan.identity).toBe("base");
    expect(query.query.type).toBe("Imbued Wand");
    expect(query.query.stats).toEqual([{ type: "and", filters: [] }]);
    expect(plan.warnings.join(" ")).toContain("intentionally ignores modifier filters");
  });

  it("supports all-listings mode without changing the safe official host", () => {
    const plan = buildPriceCheckQueryPlan(item(), "Allflame / test", { onlineOnly: false });
    const { url, query } = decodedQuery(plan);
    expect(plan.status).toBe("any");
    expect(query.query.status.option).toBe("any");
    expect(query.query.filters.trade_filters.filters.collapse).toEqual({ option: "true" });
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("www.pathofexile.com");
    expect(url.pathname).toContain("Allflame%20%2F%20test");
    expect(url.searchParams.has("q")).toBe(true);
    expect(url.hash).toBe("");
  });

  it("uses current availability modes and upgrades legacy online statuses", () => {
    const available = buildPriceCheckQueryPlan(item(), "Allflame");
    const availableQuery = decodedQuery(available).query.query;
    expect(availableQuery.status).toEqual({ option: "available" });
    expect(availableQuery.filters.trade_filters.filters.collapse)
      .toEqual({ option: "true" });

    for (const status of ["securable", "any"] as const) {
      const plan = buildPriceCheckQueryPlan(item(), "Allflame", { status });
      expect(plan.status).toBe(status);
      expect(decodedQuery(plan).query.query.status).toEqual({ option: status });
    }
    const instant = decodedQuery(buildPriceCheckQueryPlan(item(), "Allflame", {
      status: "securable",
    })).query.query;
    expect(instant.filters).not.toHaveProperty("trade_filters");

    for (const legacy of ["online", "onlineleague"] as const) {
      const plan = buildPriceCheckQueryPlan(item(), "Allflame", { status: legacy });
      expect(plan.status).toBe("available");
      expect(decodedQuery(plan).query.query.status).toEqual({ option: "available" });
    }
  });

  it("preserves an oversized edited browser query instead of dropping its filters", () => {
    const hugeName = "X".repeat(9_000);
    const plan = buildPriceCheckQueryPlan(item({
      name: hugeName,
      baseType: hugeName,
      modifiers: [],
    }), "Allflame", { identity: "exact" });
    const url = new URL(plan.tradeUrl);
    expect(url.origin).toBe("https://www.pathofexile.com");
    expect(url.searchParams.has("q")).toBe(true);
    expect(decodedQuery(plan).query).toEqual(plan.tradeQuery);
    expect(plan.warnings.join(" ")).not.toContain("too large for a safe browser URL");
  });

  it("keeps every explicitly selected stat like Awakened", () => {
    const modifiers = Array.from({ length: 15 }, (_, index) =>
      modifier({ id: `explicit.stat_${100 + index}`, text: `+${index + 1} to maximum Life`, values: [index + 1] }),
    );
    const source = item({ influences: [], modifiers });
    const plan = buildPriceCheckQueryPlan(source, "Allflame", {
      identity: "exact",
      filters: planModifierFilters(source).map((filter) => ({
        ...filter,
        enabled: true,
      })),
    });
    const query = decodedQuery(plan).query;
    expect(query.query.stats[0].filters).toHaveLength(15);
    expect(plan.warnings.join(" ")).not.toContain("most important");
  });

  it("serializes compatible Trade IDs as one OR group", () => {
    const source = item({
      influences: [],
      modifiers: [modifier({
        id: "spell-block",
        tradeId: "explicit.stat_19803471",
        tradeIds: ["explicit.stat_19803471", "explicit.stat_561307714"],
        text: "+10% Chance to Block Spell Damage",
        values: [10],
      })],
    });
    const filter = { ...planModifierFilters(source)[0], enabled: true };
    const query = buildPriceCheckQueryPlan(source, "Allflame", {
      identity: "exact",
      filters: [filter],
    }).tradeQuery as any;

    expect(query.query.stats[0].filters).toEqual([]);
    expect(query.query.stats[1]).toEqual({
      type: "count",
      value: { min: 1 },
      filters: [
        { id: "explicit.stat_19803471", value: { min: 9, max: 11 } },
        { id: "explicit.stat_561307714", value: { min: 9, max: 11 } },
      ],
    });
  });

  it("carries every Valdo reward dynamically and excludes the Void mod", () => {
    const valdo = item({
      rawText: "Reward: Foil The Squire",
      itemClass: "Maps",
      rarity: "rare",
      name: "Dunes Map",
      baseType: "Dunes Map",
      mapTier: 16,
      mapCompletionReward: "The Squire",
      modifiers: [],
    });
    const plan = buildPriceCheckQueryPlan(valdo, "Allflame", { mode: "exact" });
    const query = plan.tradeQuery as any;

    expect(query.query.filters.map_filters.filters).toMatchObject({
      map_tier: { min: 16, max: 16 },
      map_completion_reward: { option: "The Squire" },
    });
    expect(query.query.stats).toContainEqual({
      type: "not",
      filters: [{ id: "explicit.stat_1095765106" }],
    });
  });

  it("adds Awakened's negative hybrid-Flask and plain-Blueprint filters", () => {
    const flask = item({
      rarity: "magic",
      itemClass: "Flasks",
      name: "Chemist's Diamond Flask",
      baseType: "Diamond Flask",
      modifiers: [
        modifier({
          id: "charge-recovery",
          tradeId: "explicit.stat_3196823591",
          tradeIds: ["explicit.stat_3196823591"],
          tradeStatRef: "#% increased Charge Recovery",
          kind: "explicit",
          text: "20% increased Charge Recovery",
          normalizedText: "#% increased charge recovery",
          values: [20],
        }),
        modifier({
          id: "later-row",
          tradeId: "explicit.stat_3299347043",
          tradeIds: ["explicit.stat_3299347043"],
          kind: "explicit",
          text: "+100 to maximum Life",
          normalizedText: "+# to maximum life",
          values: [100],
        }),
      ],
    });
    const flaskPlan = buildPriceCheckQueryPlan(flask, "Allflame", {
      mode: "exact",
    });
    expect(flaskPlan.filters.map((filter) => filter.modifierId)).toEqual([
      "charge-recovery",
      "special:not-increased-effect",
      "later-row",
    ]);
    const flaskQuery = flaskPlan.tradeQuery as any;
    expect(flaskQuery.query.stats).toContainEqual({
      type: "not",
      filters: [{ id: "explicit.stat_2448920197" }],
    });

    const blueprint = item({
      rarity: "rare",
      itemClass: "Heist Blueprints",
      name: "Blueprint: Bunker",
      baseType: "Blueprint: Bunker",
      modifiers: [],
    });
    const blueprintQuery = buildPriceCheckQueryPlan(blueprint, "Allflame", {
      mode: "exact",
    }).tradeQuery as any;
    expect(blueprintQuery.query.stats).toContainEqual({
      type: "not",
      filters: [{ id: "pseudo.pseudo_number_of_enchant_mods" }],
    });
  });

  it("does not enable an unproven constant roll on an ordinary unique", () => {
    const plan = buildPriceCheckQueryPlan(item({
      rawText: "Rarity: Unique\nMageblood\nHeavy Belt",
      rarity: "unique",
      itemClass: "Belts",
      name: "Mageblood",
      baseType: "Heavy Belt",
      itemLevel: 86,
      quality: 20,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [modifier()],
    }), "Allflame");
    const query = decodedQuery(plan).query.query;
    expect(query).toMatchObject({
      name: "Mageblood",
      type: "Heavy Belt",
      stats: [{
        type: "and",
        filters: [expect.objectContaining({
          id: "explicit.stat_3299347043",
          disabled: true,
        })],
      }],
      filters: {
        misc_filters: {
          filters: {
            corrupted: { option: "false" },
            foulborn_item: { option: "false" },
            vestigial: { option: "false" },
          },
        },
      },
    });
    expect(query.filters.misc_filters.filters).not.toHaveProperty("ilvl");
    expect(query.filters.misc_filters.filters).not.toHaveProperty("quality");
    expect(plan.filters[0].enabled).toBe(false);
    expect(plan.filters[0].advancedOnly).toBe(true);
  });

  it("strips the Foulborn prefix without emitting a positive state filter", () => {
    const plan = buildPriceCheckQueryPlan(item({
      rarity: "unique",
      itemClass: "Belts",
      name: "Foulborn Mageblood",
      baseType: "Heavy Belt",
      foulborn: true,
      itemLevel: undefined,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    }), "Allflame");
    const query = decodedQuery(plan).query.query;
    expect(query.name).toBe("Mageblood");
    expect(query.filters.misc_filters.filters).not.toHaveProperty("foulborn_item");
    expect(query.filters).not.toHaveProperty("type_filters");
  });

  it("uses the canonical Vestigial base without a positive state filter", () => {
    const vestigial = item({
      rarity: "unique",
      itemClass: "Boots",
      name: "Skyforth",
      baseType: "Vestigial Sorcerer Boots",
      vestigial: true,
      itemLevel: undefined,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [modifier({
        id: "implicit.stat_3299347043",
        tradeId: "implicit.stat_3299347043",
        kind: "implicit",
        source: "Vestigial Implicit",
        selectedByDefault: false,
      })],
    });
    const plan = buildPriceCheckQueryPlan(vestigial, "Allflame");
    const query = decodedQuery(plan).query.query;

    expect(query.name).toBe("Skyforth");
    expect(query.type).toBe("Sorcerer Boots");
    expect(query.filters.misc_filters.filters).not.toHaveProperty("vestigial");
    expect(query.filters.misc_filters.filters.foulborn_item).toEqual({ option: "false" });
    expect(query.filters).not.toHaveProperty("type_filters");
    expect(plan.filters[0]).toMatchObject({ enabled: true, importance: "key" });

    const relaxed = buildPriceCheckQueryPlan(vestigial, "Allflame", {
      itemFilters: { corrupted: false, foulborn: false },
    });
    expect(decodedQuery(relaxed).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("vestigial");
  });

  it("uses uniquefoil rarity for copied foils without an obsolete warning", () => {
    const foil = item({
      rarity: "unique",
      itemClass: "Boots",
      name: "Replica Alberon's Warpath",
      baseType: "Soldier Boots",
      replica: true,
      foil: true,
      itemLevel: undefined,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    });
    const plan = buildPriceCheckQueryPlan(foil, "Allflame");
    const query = decodedQuery(plan).query.query;

    expect(query.name).toBe("Replica Alberon's Warpath");
    expect(query.filters.type_filters.filters.rarity).toEqual({ option: "uniquefoil" });
    expect(query.filters.misc_filters.filters).not.toHaveProperty("replica");
    expect(plan.itemFilters.foil).toBe(true);
    expect(plan.warnings.join(" ")).not.toContain("Foil variation is not encoded");

    const relaxed = buildPriceCheckQueryPlan(foil, "Allflame", {
      itemFilters: { corrupted: false, foulborn: false, vestigial: false },
    });
    expect(decodedQuery(relaxed).query.query.filters).not.toHaveProperty("type_filters");
  });

  it("retains invariant unique rolls without serializing a hidden threshold", () => {
    const unique = item({
      rarity: "unique",
      itemClass: "Belts",
      name: "Mageblood",
      baseType: "Heavy Belt",
      modifiers: [modifier()],
    });
    const planned = planModifierFilters(unique, 0);
    expect(planned[0].enabled).toBe(false);
    const exact = buildPriceCheckQueryPlan(unique, "Allflame", {
      rollTolerance: 0,
      filters: planned.map((filter) => ({ ...filter, enabled: true })),
    });
    expect(decodedQuery(exact).query.query.stats[0].filters).toEqual(
      expect.arrayContaining([{ id: "explicit.stat_3299347043" }]),
    );
  });

  it("resolves a one-line affixed magic display name through the pinned base corpus", () => {
    const affixedName = "Subterranean Vaal Regalia of the Underground";
    const resolvedFromName = buildPriceCheckQueryPlan(item({
      rarity: "magic",
      itemClass: "Body Armours",
      name: affixedName,
      baseType: affixedName,
    }), "Allflame", { identity: "exact" });
    expect(decodedQuery(resolvedFromName).query.query.type).toBe("Vaal Regalia");
    expect(resolvedFromName.warnings.join(" ")).not.toContain("base type could not be isolated");

    const resolved = buildPriceCheckQueryPlan(item({
      rarity: "magic",
      itemClass: "Body Armours",
      name: affixedName,
      baseType: "Vaal Regalia",
    }), "Allflame", { identity: "exact" });
    expect(decodedQuery(resolved).query.query.type).toBe("Vaal Regalia");
  });

  it("searches an unidentified unique by base type and requires unidentified listings", () => {
    const plan = buildPriceCheckQueryPlan(item({
      rawText: "Rarity: Unique\nHeavy Belt\n--------\nUnidentified",
      rarity: "unique",
      itemClass: "Belts",
      name: "Heavy Belt",
      baseType: "Heavy Belt",
      identified: false,
      itemLevel: 86,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    }), "Allflame", { identity: "exact" });
    const query = decodedQuery(plan).query.query;

    expect(plan.identity).toBe("base");
    expect(query.type).toBe("Heavy Belt");
    expect(query).not.toHaveProperty("name");
    expect(query.filters.misc_filters.filters.identified).toEqual({ option: "false" });
    expect(query.filters).not.toHaveProperty("type_filters");
    expect(plan.itemFilters.identified).toBe(false);
  });

  it("maps Similar to Awakened's relaxed category search", () => {
    const plan = buildPriceCheckQueryPlan(item({
      influences: [],
      quality: 30,
    }), "Allflame", { mode: "similar", rollTolerance: 10 });
    const query = decodedQuery(plan).query.query;

    expect(query).not.toHaveProperty("type");
    expect(query.filters.type_filters.filters).toMatchObject({
      category: { option: "weapon.wand" },
      rarity: { option: "nonunique" },
    });
    expect(query.filters.misc_filters.filters).not.toHaveProperty("quality");
    expect(plan.rollTolerance).toBe(10);
  });

  it("preserves selected wand property/source/item filters in both API and browser payloads", () => {
    const source = item({
      quality: 28,
      influences: [],
      properties: {
        "Physical Damage": "283-513",
        "Critical Strike Chance": "11.05%",
        "Attacks per Second": "1.90",
      },
      modifiers: [modifier({
        id: "enchant.stat_1335369947",
        tradeId: "enchant.stat_1335369947",
        kind: "enchant",
        text: "8% increased Explicit Physical Modifier magnitudes",
        normalizedText: "#% increased explicit physical modifier magnitudes",
        values: [8],
        tradeDirection: 1,
        selectedByDefault: true,
        tags: [],
      })],
    });
    const selected = planPriceCheckFilters(source, 0).map((filter) => ({
      ...filter,
      enabled: filter.equipmentProperty?.key === "pdps" ||
        filter.modifierId === "enchant.stat_1335369947",
    }));
    const plan = buildPriceCheckQueryPlan(source, "Allflame", {
      mode: "similar",
      rollTolerance: 0,
      filters: selected,
      itemFilters: {
        corrupted: false,
        links: 3,
        listed: "1day",
        tradeCurrency: "chaos",
      },
    });
    const query = decodedQuery(plan).query.query;

    expect(query.filters.type_filters.filters.category).toEqual({ option: "weapon.wand" });
    expect(query.filters.weapon_filters.filters).toEqual({
      pdps: { min: 756 },
    });
    expect(query.filters.weapon_filters.filters).not.toHaveProperty("damage");
    expect(query.filters.weapon_filters.filters).not.toHaveProperty("dps");
    expect(query.stats[0].filters).toContainEqual({
      id: "enchant.stat_1335369947",
      value: { min: 8 },
    });
    expect(query.filters.misc_filters.filters.corrupted).toEqual({ option: "false" });
    expect(query.filters.socket_filters.filters.links).toEqual({ min: 3 });
    expect(query.filters.trade_filters.filters).toMatchObject({
      price: { option: "chaos" },
      indexed: { option: "1day" },
    });
  });

  it("maps Base to Awakened's capped exact-stat preset instead of dropping every stat", () => {
    const source = item({
      quality: 30,
      influences: [],
      modifiers: [modifier({
        kind: "fractured",
        tradeDirection: 1,
        source: "Fractured Prefix",
      })],
    });
    const plan = buildPriceCheckQueryPlan(source, "Allflame", {
      mode: "base",
      rollTolerance: 10,
    });
    const query = decodedQuery(plan).query.query;

    expect(plan.rollTolerance).toBe(2);
    expect(query.type).toBe("Imbued Wand");
    expect(query.stats[0].filters).toEqual([{
      id: "explicit.stat_3299347043",
      value: { min: 98 },
    }]);
    expect(query.filters.misc_filters.filters).toMatchObject({
      ilvl: { min: 86 },
      quality: { min: 30 },
    });
  });

  it("keeps full tolerance only for rare map properties and caps every exact-stat preset", () => {
    const normalMap = item({
      rarity: "normal",
      itemClass: "Maps",
      name: "Dunes Map",
      baseType: "Dunes Map",
      itemLevel: undefined,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    });
    const rareMap = {
      ...normalMap,
      rarity: "rare" as const,
      name: "Dire Core",
      identified: true,
    };
    expect(buildPriceCheckQueryPlan(rareMap, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    }).rollTolerance).toBe(10);
    expect(buildPriceCheckQueryPlan(normalMap, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    }).rollTolerance).toBe(2);
    expect(buildPriceCheckQueryPlan(rareMap, "Allflame", {
      mode: "bulk",
      rollTolerance: 10,
    }).rollTolerance).toBe(2);
    expect(buildPriceCheckQueryPlan({
      ...rareMap,
      mapCompletionReward: "The Squire",
    }, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    }).rollTolerance).toBe(2);
    expect(buildPriceCheckQueryPlan({
      ...rareMap,
      rarity: "unique",
      name: "Vaults of Atziri",
      baseType: "Vaal Pyramid Map",
    }, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    }).rollTolerance).toBe(2);
    expect(buildPriceCheckQueryPlan(item(), "Allflame", {
      mode: "base",
      rollTolerance: 10,
    }).rollTolerance).toBe(2);
  });

  it("uses category identity for Awakened's forced relaxed exact categories", () => {
    const contract = item({
      rarity: "rare",
      itemClass: "Heist Contracts",
      name: "Contract: Lockpicking",
      baseType: "Contract: Lockpicking",
      properties: { "Area Level": "83", "Wings Revealed": "3" },
      heistContract: {
        requiredJob: "Lockpicking",
        jobLevel: 5,
        targetValue: "Priceless",
      },
      itemLevel: 83,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    });
    const plan = buildPriceCheckQueryPlan(contract, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    });
    const query = decodedQuery(plan).query.query;

    expect(query).not.toHaveProperty("type");
    expect(query.filters.type_filters.filters.category).toEqual({
      option: "heistmission.contract",
    });
    expect(query.filters.map_filters.filters.area_level).toEqual({ min: 83 });
    expect(query.filters.heist_filters.filters.heist_wings).toEqual({ min: 3 });
    expect(query.filters.heist_filters.filters).toMatchObject({
      heist_lockpicking: { min: 5 },
      heist_objective_value: { option: "priceless" },
    });
  });

  it("keeps Heist Blueprints on exact base identity like pinned Awakened", () => {
    const blueprint = buildPriceCheckQueryPlan(item({
      rarity: "rare",
      itemClass: "Heist Blueprints",
      name: "Blueprint: Bunker",
      baseType: "Blueprint: Bunker",
      properties: { "Area Level": "83", "Wings Revealed": "3" },
      itemLevel: 83,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    }), "Allflame", { mode: "exact" });
    const query = decodedQuery(blueprint).query.query;
    expect(query.type).toBe("Blueprint: Bunker");
    expect(query.filters.type_filters?.filters || {})
      .not.toHaveProperty("category");
    expect(query.filters.heist_filters.filters.heist_wings).toEqual({ min: 3 });
  });

  it("applies Awakened's contextual quality, gem-level, and item-level defaults", () => {
    const highQuality = item({ quality: 30, itemLevel: 100, influences: [] });
    expect(priceCheckItemFilterControls(highQuality).map((control) => control.key))
      .not.toContain("quality");
    expect(priceCheckItemFilterControls(highQuality, { exact: true }))
      .toContainEqual({
        key: "quality",
        label: "QUALITY",
        copiedValue: 30,
        kind: "number",
        maximum: 30,
      });
    const similar = buildPriceCheckQueryPlan(highQuality, "Allflame", {
      mode: "similar",
    });
    expect(similar.itemFilters).not.toHaveProperty("quality");
    expect(similar.itemFilters).not.toHaveProperty("itemLevel");

    const base = buildPriceCheckQueryPlan(highQuality, "Allflame", {
      mode: "base",
    });
    expect(base.itemFilters).toMatchObject({ quality: 30, itemLevel: 86 });
    expect(decodedQuery(base).query.query.filters.misc_filters.filters.quality)
      .toEqual({ min: 30 });

    const flask = buildPriceCheckQueryPlan(item({
      rarity: "magic",
      itemClass: "Flasks",
      name: "Chemist's Divine Life Flask",
      baseType: "Divine Life Flask",
      quality: 21,
      itemLevel: 100,
      influences: [],
      links: undefined,
      sockets: [],
      modifiers: [],
    }), "Allflame", { mode: "exact" });
    expect(flask.itemFilters.quality).toBe(21);
    expect(flask.itemFilters).not.toHaveProperty("itemLevel");

    const lowGem = buildPriceCheckQueryPlan(item({
      rarity: "gem",
      itemClass: "Skill Gems",
      name: "Fireball",
      baseType: "Fireball",
      gemLevel: 19,
      quality: 20,
      itemLevel: undefined,
      influences: [],
      links: undefined,
      sockets: [],
      modifiers: [],
    }), "Allflame", { mode: "exact" });
    expect(lowGem.itemFilters).not.toHaveProperty("gemLevel");
    expect(lowGem.itemFilters.quality).toBe(20);

    const agnerod = buildPriceCheckQueryPlan(item({
      rarity: "unique",
      itemClass: "Staves",
      name: "Agnerod West",
      baseType: "Imperial Staff",
      itemLevel: 81,
      quality: undefined,
      influences: [],
      links: undefined,
      sockets: [],
      modifiers: [],
    }), "Allflame", { mode: "similar" });
    expect(agnerod.itemFilters.itemLevel).toBe(80);
    expect(decodedQuery(agnerod).query.query.filters.misc_filters.filters.ilvl)
      .toEqual({ min: 80 });
  });

  it("activates at most two legacy influences only in exact/base presets", () => {
    const dual = item({ influences: ["Shaper", "Elder"] });
    expect(buildPriceCheckQueryPlan(dual, "Allflame", { mode: "similar" }).itemFilters)
      .not.toHaveProperty("influence:shaper");
    const exact = buildPriceCheckQueryPlan(dual, "Allflame", { mode: "base" });
    expect(exact.itemFilters).toMatchObject({
      "influence:shaper": true,
      "influence:elder": true,
    });
    expect(decodedQuery(exact).query.query.stats[0].filters).toEqual([
      { id: "pseudo.pseudo_has_shaper_influence" },
      { id: "pseudo.pseudo_has_elder_influence" },
    ]);

    const impossible = buildPriceCheckQueryPlan(item({
      influences: ["Shaper", "Elder", "Hunter"],
    }), "Allflame", { mode: "base" });
    expect(Object.keys(impossible.itemFilters).some((key) => key.startsWith("influence:")))
      .toBe(false);
    expect(decodedQuery(impossible).query.query.stats[0].filters).toEqual([]);
  });

  it("uses area brackets and blighted-map state while ignoring sub-five links", () => {
    const chronicle = buildPriceCheckQueryPlan(item({
      rarity: "currency",
      itemClass: "Stackable Currency",
      name: "Chronicle of Atzoatl",
      baseType: "Chronicle of Atzoatl",
      properties: { "Area Level": "79" },
      itemLevel: undefined,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      modifiers: [],
    }), "Allflame", { mode: "exact" });
    expect(chronicle.itemFilters.areaLevel).toBe(78);

    const blighted = buildPriceCheckQueryPlan(item({
      rarity: "normal",
      itemClass: "Maps",
      name: "Blighted Dunes Map",
      baseType: "Blighted Dunes Map",
      itemLevel: undefined,
      quality: undefined,
      influences: [],
      modifiers: [],
    }), "Allflame", { mode: "exact" });
    const query = decodedQuery(blighted).query.query;
    expect(query.type).toBe("Dunes Map");
    expect(query.filters.map_filters.filters.map_blighted).toEqual({ option: "true" });
    expect(query.filters).not.toHaveProperty("socket_filters");
  });

  it("serializes Awakened's active rare-map property thresholds even before corruption", () => {
    const parsed = applyTradeStatCatalog(
      parsePoeItem(mapFixture),
      actualCatalog as unknown as TradeStatCatalogPack,
    );
    const plan = buildPriceCheckQueryPlan(parsed, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    });
    const modifierKinds = new Map(
      parsed.modifiers.map((modifier) => [modifier.id, modifier.kind] as const),
    );
    const enabledPseudoIds = (candidate: PriceCheckQueryPlan) =>
      candidate.filters.filter((filter) =>
        filter.enabled && (
          modifierKinds.get(filter.modifierId) === "pseudo" ||
          filter.modifierId.startsWith("map:pseudo.")
        )
      ).map((filter) => filter.tradeId || filter.modifierId);
    const query = decodedQuery(plan).query.query;
    expect(query.filters.map_filters.filters).toMatchObject({
      map_tier: { min: 16, max: 16 },
      map_iiq: { min: 100 },
      map_iir: { min: 52 },
      map_packsize: { min: 34 },
    });
    expect(plan.filters.filter((filter) =>
      filter.equipmentProperty?.group === "map_filters",
    )).toHaveLength(3);
    expect(enabledPseudoIds(plan)).toEqual([]);

    const ordinary = buildPriceCheckQueryPlan({
      ...parsed,
      corrupted: false,
    }, "Allflame", { mode: "exact" });
    expect(decodedQuery(ordinary).query.query.filters.map_filters.filters)
      .toMatchObject({
        map_iiq: { min: 100 },
        map_iir: { min: 52 },
        map_packsize: { min: 34 },
      });

    const bulk = buildPriceCheckQueryPlan(parsed, "Allflame", {
      mode: "bulk",
      rollTolerance: 10,
    });
    const bulkQuery = decodedQuery(bulk).query.query;
    expect(bulk.tradeApi).toBe("trade");
    expect(bulkQuery.type).toBe("Crater Map");
    expect(bulkQuery.filters.map_filters.filters).toMatchObject({
      map_tier: { min: 16, max: 16 },
    });
    expect(bulkQuery.filters.map_filters.filters).not.toHaveProperty("map_iiq");
    expect(bulkQuery.filters.map_filters.filters).not.toHaveProperty("map_iir");
    expect(bulkQuery.filters.map_filters.filters).not.toHaveProperty("map_packsize");
    expect(bulk.filters.filter((filter) => filter.enabled).map(
      (filter) => filter.tradeId || filter.modifierId,
    )).toEqual([]);
    expect(enabledPseudoIds(bulk)).toEqual([]);
    expect(bulkQuery.stats.flatMap((group: any) => group.filters || []))
      .toEqual([]);
    expect(bulk.filters).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        equipmentProperty: expect.objectContaining({ group: "map_filters" }),
      }),
    ]));

    const staleExactEdits = buildPriceCheckQueryPlan(parsed, "Allflame", {
      mode: "bulk",
      rollTolerance: 10,
      filters: plan.filters,
    });
    expect(staleExactEdits.filters).toEqual([]);
    expect((staleExactEdits.tradeQuery as any).query.stats[0].filters).toEqual([]);
  });

  it("keeps eligible exact-stat families in Bulk while dropping rolled map properties", () => {
    const exactFamilyMap = item({
      rawText: "Item Class: Maps\nRarity: Rare\nDire Core\nCrater Map\nMap Tier: 16",
      itemClass: "Maps",
      rarity: "rare",
      name: "Dire Core",
      baseType: "Crater Map",
      mapTier: 16,
      itemLevel: 83,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      corrupted: false,
      properties: {
        "Item Quantity": "+100%",
        "Item Rarity": "+60%",
        "Monster Pack Size": "+40%",
      },
      modifiers: [
        modifier({
          id: "implicit.stat_1000000001",
          tradeId: "implicit.stat_1000000001",
          kind: "implicit",
          text: "100% increased implicit map effect",
          normalizedText: "#% increased implicit map effect",
          values: [100],
          tradeDirection: 1,
          selectedByDefault: false,
          tags: [],
        }),
        modifier({
          id: "enchant.stat_1000000002",
          tradeId: "enchant.stat_1000000002",
          kind: "enchant",
          text: "50% increased enchanted map effect",
          normalizedText: "#% increased enchanted map effect",
          values: [50],
          tradeDirection: 1,
          selectedByDefault: false,
          tags: [],
        }),
        modifier({
          id: "pseudo.pseudo_map_selectable|123",
          tradeId: "pseudo.pseudo_map_selectable|123",
          kind: "pseudo",
          text: "Selectable map reward",
          normalizedText: "selectable map reward",
          values: [],
          tradeOption: "123",
          selectedByDefault: true,
          tags: [],
        }),
        modifier({
          id: "pseudo.pseudo_map_optional",
          tradeId: "pseudo.pseudo_map_optional",
          kind: "pseudo",
          text: "Optional map reward",
          normalizedText: "optional map reward",
          values: [],
          selectedByDefault: false,
          tags: [],
        }),
        modifier({
          id: "explicit.stat_1000000003",
          tradeId: "explicit.stat_1000000003",
          kind: "explicit",
          text: "100% increased rolled map effect",
          normalizedText: "#% increased rolled map effect",
          values: [100],
          tradeDirection: 1,
          selectedByDefault: true,
          tags: [],
        }),
      ],
    });
    const propertyPlan = buildPriceCheckQueryPlan(exactFamilyMap, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    });
    const bulkPlan = buildPriceCheckQueryPlan(exactFamilyMap, "Allflame", {
      mode: "bulk",
      rollTolerance: 10,
    });
    const bulkQuery = decodedQuery(bulkPlan).query.query;

    expect(propertyPlan.rollTolerance).toBe(10);
    expect(bulkPlan.rollTolerance).toBe(2);
    expect(bulkPlan.tradeApi).toBe("trade");
    expect(bulkQuery.filters.map_filters.filters).not.toHaveProperty("map_iiq");
    expect(bulkQuery.filters.map_filters.filters).not.toHaveProperty("map_iir");
    expect(bulkQuery.filters.map_filters.filters).not.toHaveProperty("map_packsize");
    expect(bulkPlan.filters.map((filter) => filter.modifierId)).toEqual([
      "implicit.stat_1000000001",
      "enchant.stat_1000000002",
      "pseudo.pseudo_map_selectable|123",
      "pseudo.pseudo_map_optional",
    ]);
    expect(bulkPlan.filters.map((filter) => [filter.modifierId, filter.enabled]))
      .toEqual([
        ["implicit.stat_1000000001", true],
        ["enchant.stat_1000000002", true],
        ["pseudo.pseudo_map_selectable|123", true],
        ["pseudo.pseudo_map_optional", false],
      ]);
    expect(activeStatFilters(bulkQuery.stats[0].filters)).toHaveLength(3);
    expect(bulkQuery.stats[0].filters).toEqual(expect.arrayContaining([
      { id: "implicit.stat_1000000001", value: { min: 98 } },
      { id: "enchant.stat_1000000002", value: { min: 49 } },
      {
        id: "pseudo.pseudo_map_selectable|123",
        value: { option: "123" },
      },
    ]));
  });

  it("uses map reward pseudos and disables rarity when special drops are copied", () => {
    const special = item({
      rarity: "rare",
      itemClass: "Maps",
      name: "Dire Core",
      baseType: "Crater Map",
      mapTier: 16,
      itemLevel: 83,
      quality: undefined,
      links: undefined,
      sockets: [],
      influences: [],
      corrupted: false,
      properties: {
        "Item Quantity": "+100%",
        "Item Rarity": "+60%",
        "Monster Pack Size": "+40%",
        "More Maps": "150%",
        "More Scarabs": "120%",
      },
      modifiers: [],
    });
    const plan = buildPriceCheckQueryPlan(special, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    });
    const query = decodedQuery(plan).query.query;
    expect(query.filters.map_filters.filters).toMatchObject({
      map_iiq: { min: 90 },
      map_packsize: { min: 36 },
    });
    expect(query.filters.map_filters.filters).not.toHaveProperty("map_iir");
    expect(query.stats[0].filters).toContainEqual(
      { id: "pseudo.pseudo_map_more_scarab_drops", value: { min: 108 } },
    );
    expect(query.stats[0].filters).not.toContainEqual(
      { id: "pseudo.pseudo_map_more_map_drops", value: { min: 135 } },
    );
    expect(plan.filters.find((filter) =>
      filter.tradeId === "pseudo.pseudo_map_more_map_drops"
    )).toMatchObject({ enabled: false, min: 135 });
  });

  it("keeps the exact eight-mod discriminator in both rare-map presets", () => {
    const affixes = Array.from({ length: 8 }, (_, index) => modifier({
      id: `map-mod-${index}`,
      text: `Map modifier ${index + 1}`,
      normalizedText: "map modifier #",
      values: [index + 1],
      advanced: true,
      generation: index < 4 ? "prefix" : "suffix",
      source: `Map affix ${index + 1}`,
      tier: "1",
    }));
    const eightModMap = item({
      itemClass: "Maps",
      rarity: "rare",
      name: "Dire Core",
      baseType: "Crater Map",
      mapTier: 16,
      // The first affix has two copied Trade-stat lines: nine rendered rows,
      // but exactly eight source affixes like APT's `newMods` model.
      modifiers: [
        affixes[0],
        { ...affixes[0], id: "map-mod-0-second-line", text: "Second line" },
        ...affixes.slice(1),
      ],
    });
    for (const mode of ["exact", "bulk"] as const) {
      const plan = buildPriceCheckQueryPlan(eightModMap, "Allflame", { mode });
      expect(plan.tradeApi).toBe("trade");
      expect(plan.filters.filter((filter) => filter.enabled).map(
        (filter) => filter.tradeId || filter.modifierId,
      )).toEqual(["pseudo.pseudo_number_of_affix_mods"]);
      expect(decodedQuery(plan).query.query.stats[0].filters).toContainEqual({
        id: "pseudo.pseudo_number_of_affix_mods",
        value: { min: 8 },
      });
    }

    const sevenAffixMap = {
      ...eightModMap,
      // Eight rendered rows but only seven source affixes must not trigger it.
      modifiers: [
        affixes[0],
        { ...affixes[0], id: "map-mod-0-second-line", text: "Second line" },
        ...affixes.slice(1, 7),
      ],
    };
    for (const mode of ["exact", "bulk"] as const) {
      expect(buildPriceCheckQueryPlan(
        sevenAffixMap,
        "Allflame",
        { mode },
      ).filters.some((filter) =>
        filter.tradeId === "pseudo.pseudo_number_of_affix_mods"
      )).toBe(false);
    }
  });

  it("keeps crafting-state baselines hidden and only serializes their false state", () => {
    const source = item({ influences: [], quality: undefined });
    const challenge = buildPriceCheckQueryPlan(source, "Allflame", {
      mode: "similar",
    });
    expect(challenge.itemFilters).toMatchObject({
      mirrored: false,
      split: false,
      fractured: false,
    });
    expect(decodedQuery(challenge).query.query.filters.misc_filters.filters)
      .toMatchObject({
        mirrored: { option: "false" },
        split: { option: "false" },
        fractured_item: { option: "false" },
      });

    const standard = buildPriceCheckQueryPlan(source, "Standard", {
      mode: "similar",
    });
    expect(standard.itemFilters).not.toHaveProperty("split");

    const positive = buildPriceCheckQueryPlan({
      ...source,
      mirrored: true,
      split: true,
      fractured: true,
    }, "Allflame", { mode: "similar" });
    expect(decodedQuery(positive).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("mirrored");
    expect(decodedQuery(positive).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("split");
    expect(decodedQuery(positive).query.query.filters.misc_filters.filters)
      .not.toHaveProperty("fractured_item");

    const fracturedSynthInfluenced = buildPriceCheckQueryPlan(item({
      fractured: true,
      synthesised: true,
      influences: ["Shaper"],
      quality: undefined,
    }), "Allflame", { mode: "similar" });
    expect(fracturedSynthInfluenced.itemFilters.mirrored).toBe(false);
    expect(fracturedSynthInfluenced.itemFilters).not.toHaveProperty("fractured");
    expect(fracturedSynthInfluenced.itemFilters).not.toHaveProperty("split");
    expect(decodedQuery(fracturedSynthInfluenced).query.query.filters.misc_filters.filters)
      .toMatchObject({ mirrored: { option: "false" } });
  });

  it.each(["rare", "unique"] as const)(
    "preserves %s modifier creation order across API and browser payloads",
    (rarity) => {
      const ids = [
        "explicit.stat_3000000003",
        "explicit.stat_1000000001",
        "explicit.stat_2000000002",
      ];
      const source = item({
        rarity,
        name: rarity === "unique" ? "Parity Relic" : "Doom Needle",
        baseType: rarity === "unique" ? "Heavy Belt" : "Imbued Wand",
        influences: [],
        modifiers: ids.map((id, index) => modifier({
          id,
          tradeId: id,
          text: `Parity modifier ${index + 1}`,
          normalizedText: `parity modifier ${index + 1}`,
          values: [],
          selectedByDefault: index === 1,
          tags: [],
        })),
      });
      const requested: PriceCheckModifierFilter[] = ids.map((id, index) => ({
        modifierId: id,
        tradeId: id,
        enabled: index === 1,
        mode: "presence",
        importance: (["optional", "key", "useful"] as const)[index],
        explanation: "Creation-order regression",
      }));
      const plan = buildPriceCheckQueryPlan(source, "Allflame", {
        mode: "similar",
        filters: requested,
      });
      const query = decodedQuery(plan).query.query;

      expect(plan.filters.map((filter) => filter.modifierId)).toEqual(ids);
      expect(query.stats[0].filters.map((filter: { id: string }) => filter.id))
        .toEqual(ids);
      expect(query.stats[0].filters.map(
        (filter: { disabled?: boolean }) => filter.disabled,
      )).toEqual([true, undefined, true]);
    },
  );

  it("maps generic upstream-hidden provenance to advanced-only presentation", () => {
    const [planned] = planModifierFilters(item({
      rarity: "unique",
      name: "Parity Relic",
      baseType: "Heavy Belt",
      influences: [],
      modifiers: [modifier({
        id: "pseudo.pseudo_total_fire_resistance",
        tradeId: "pseudo.pseudo_total_fire_resistance",
        kind: "pseudo",
        text: "+40% total Fire Resistance",
        normalizedText: "+#% total fire resistance",
        values: [40],
        selectedByDefault: false,
        tags: ["upstream-hidden"],
      })],
    }));

    expect(planned).toMatchObject({
      modifierId: "pseudo.pseudo_total_fire_resistance",
      enabled: false,
      advancedOnly: true,
    });
  });
});

describe("systemic Awakened 3.29.104 parity regressions", () => {
  const explicit = (
    id: string,
    text: string,
    value: number,
    bounds?: { min: number; max: number },
  ) => modifier({
    id,
    tradeId: id,
    tradeIds: [id],
    tradeStatRef: text.replace(String(value), "#"),
    text,
    normalizedText: text.replace(/[-+]?\d+(?:\.\d+)?/g, "#").toLowerCase(),
    values: [value],
    tradeBounds: bounds,
    tradeDirection: 1,
    selectedByDefault: false,
    tags: [],
  });

  it("classifies fixed uniques by canonical stat.ref while rendering copied values", () => {
    const hydrated = applyTradeStatCatalog(item({
      rarity: "unique",
      itemClass: "Flasks",
      name: "Cinderswallow Urn",
      baseType: "Silver Flask",
      influences: [],
      modifiers: [modifier({
        id: "cinders-fixed",
        kind: "explicit",
        text: "+20(15-20) to Maximum Charges",
        normalizedText: "# to maximum charges",
        values: [20],
        tradeBounds: { min: 15, max: 20 },
        tags: [],
      })],
    }), actualCatalog as TradeStatCatalogPack);
    const fixed = hydrated.modifiers[0];
    expect(fixed).toMatchObject({
      tradeId: "explicit.stat_1437957544",
      tradeStatRef: "+# to Maximum Charges",
      tradeLabel: "+20 to Maximum Charges",
    });

    const variants = [
      explicit("explicit.stat_3000000001", "31% increased Flask Effect Duration", 31, { min: 20, max: 40 }),
      explicit("explicit.stat_3000000002", "22% reduced Charges per use", 22, { min: 15, max: 25 }),
      explicit("explicit.stat_3000000003", "18% increased effect", 18, { min: 10, max: 20 }),
    ];
    const source = { ...hydrated, modifiers: [fixed, ...variants] };
    const filters = planPriceCheckFilters(source);
    expect(filters[0]).toMatchObject({
      modifierId: "cinders-fixed",
      label: "20 to Maximum Charges",
      enabled: false,
    });
    expect(filters[0].advancedOnly).not.toBe(true);
    expect(filters.slice(1).every((filter) => filter.enabled)).toBe(true);

    const query = decodedQuery(buildPriceCheckQueryPlan(source, "Allflame", {
      mode: "similar",
    })).query.query;
    expect(query.stats[0].filters[0]).toMatchObject({
      id: "explicit.stat_1437957544",
      disabled: true,
    });

    const foulborn = planPriceCheckFilters({ ...source, foulborn: true });
    expect(foulborn.every((filter) => filter.enabled)).toBe(true);
    expect(foulborn[0].advancedOnly).not.toBe(true);
  });

  it("enables every surviving Foulborn explicit without changing pseudo defaults", () => {
    const explicits = [
      explicit("explicit.stat_4000000001", "10% increased Damage", 10),
      explicit("explicit.stat_4000000002", "20% increased Speed", 20, { min: 10, max: 30 }),
      explicit("explicit.stat_4000000003", "+30 to Strength", 30, { min: 20, max: 40 }),
      explicit("explicit.stat_4000000004", "+40 to Dexterity", 40, { min: 30, max: 50 }),
    ];
    const pseudo = modifier({
      id: "pseudo.pseudo_total_mana",
      tradeId: "pseudo.pseudo_total_mana",
      tradeIds: ["pseudo.pseudo_total_mana"],
      kind: "pseudo",
      text: "+50 to maximum Mana",
      normalizedText: "+# to maximum mana",
      values: [50],
      tradeBounds: { min: 40, max: 60 },
      tradeDirection: 1,
      selectedByDefault: false,
      tags: [],
    });
    const filters = planPriceCheckFilters(item({
      rarity: "unique",
      name: "Foulborn Parity Relic",
      baseType: "Heavy Belt",
      foulborn: true,
      influences: [],
      modifiers: [...explicits, pseudo],
    }));

    expect(filters.slice(0, 4).every((filter) =>
      filter.enabled && !filter.advancedOnly
    )).toBe(true);
    expect(filters[0]).toMatchObject({ mode: "presence", enabled: true });
    expect(filters[4]).toMatchObject({
      modifierId: pseudo.id,
      enabled: false,
    });
    expect(filters[4].advancedOnly).not.toBe(true);
  });

  it("applies unique <=3 defaults only after properties and consumed sources settle", () => {
    const hybridDefence = modifier({
      id: "hybrid-defence-source",
      tradeId: "explicit.stat_5000000001",
      kind: "explicit",
      text: "100(80-100)% increased Armour, Evasion and Energy Shield",
      normalizedText: "#% increased armour, evasion and energy shield",
      values: [100],
      tradeBounds: { min: 80, max: 100 },
      tradeDirection: 1,
      selectedByDefault: false,
      tags: [],
      advanced: true,
    });
    const life = explicit(
      "explicit.stat_3299347043",
      "+100 to maximum Life",
      100,
      { min: 90, max: 110 },
    );
    const hybrid = planPriceCheckFilters(item({
      rarity: "unique",
      itemClass: "Body Armours",
      name: "Parity Carapace",
      baseType: "Full Dragonscale",
      quality: 20,
      influences: [],
      properties: {
        Armour: "1,200 (augmented)",
        "Evasion Rating": "700 (augmented)",
        "Energy Shield": "300 (augmented)",
      },
      modifiers: [hybridDefence, life],
    }));
    expect(hybrid.map((filter) => filter.modifierId)).toEqual([
      "property:armour",
      "property:evasion",
      "property:energy-shield",
      life.id,
    ]);
    expect(hybrid.find((filter) => filter.modifierId === life.id)?.enabled)
      .toBe(false);

    const weapon = planPriceCheckFilters(item({
      rarity: "unique",
      itemClass: "Wands",
      name: "Parity Wand",
      baseType: "Imbued Wand",
      quality: 20,
      influences: [],
      properties: {
        "Physical Damage": "100-200 (augmented)",
        "Attacks per Second": "1.50 (augmented)",
      },
      modifiers: [
        modifier({
          id: "local-flat",
          kind: "explicit",
          text: "Adds 10(8-12) to 20(18-22) Physical Damage",
          normalizedText: "adds # to # physical damage",
          values: [10, 20],
          tags: [],
          advanced: true,
        }),
        modifier({
          id: "local-inc-1",
          kind: "explicit",
          text: "50(40-60)% increased Physical Damage",
          normalizedText: "#% increased physical damage",
          values: [50],
          tags: [],
          advanced: true,
        }),
        modifier({
          id: "local-inc-2",
          kind: "explicit",
          text: "20(10-30)% increased Physical Damage and Accuracy Rating",
          normalizedText: "#% increased physical damage and accuracy rating",
          values: [20],
          tags: [],
          advanced: true,
        }),
        modifier({
          id: "local-aps",
          kind: "explicit",
          text: "20(10-30)% increased Attack Speed",
          normalizedText: "#% increased attack speed",
          values: [20],
          tags: [],
          advanced: true,
        }),
      ],
    }));
    expect(weapon.map((filter) => filter.equipmentProperty?.key)).toEqual([
      "pdps",
      "aps",
    ]);
    expect(weapon.every((filter) => filter.enabled && !filter.advancedOnly))
      .toBe(true);
  });

  it("retains Instilling enchants hidden until Enkindling is proven", () => {
    const instilling = modifier({
      id: "instilling",
      tradeId: "enchant.stat_3287581721",
      tradeIds: ["enchant.stat_3287581721"],
      tradeStatRef: "Used when Charges reach full",
      kind: "enchant",
      text: "Used when Charges reach full",
      normalizedText: "used when charges reach full",
      values: [],
      tradeDirection: 0,
      selectedByDefault: false,
      tags: [],
    });
    const marker = modifier({
      id: "enkindling-marker",
      tradeId: "enchant.stat_4123533923",
      tradeIds: ["enchant.stat_4123533923"],
      tradeStatRef: "Gains no Charges during Flask Effect",
      kind: "enchant",
      text: "Gains no Charges during Flask Effect",
      normalizedText: "gains no charges during flask effect",
      values: [],
      tradeDirection: 0,
      selectedByDefault: false,
      tags: [],
    });
    const flask = (modifiers: ParsedPoeModifier[]) => item({
      rarity: "magic",
      itemClass: "Flasks",
      name: "Chemist's Diamond Flask",
      baseType: "Diamond Flask",
      influences: [],
      modifiers,
    });

    expect(planPriceCheckFilters(flask([instilling]))).toMatchObject([{
      modifierId: "instilling",
      enabled: false,
      advancedOnly: true,
    }]);
    const exactInstilling = buildPriceCheckQueryPlan(flask([instilling]), "Allflame", {
      mode: "exact",
    });
    expect(exactInstilling.filters[0]).toMatchObject({
      enabled: false,
      advancedOnly: true,
    });
    expect(decodedQuery(exactInstilling).query.query.stats[0].filters[0])
      .toMatchObject({ id: "enchant.stat_3287581721", disabled: true });

    expect(planPriceCheckFilters(flask([marker]))[0]).toMatchObject({
      enabled: true,
    });
    expect(planPriceCheckFilters(flask([marker]))[0].advancedOnly).not.toBe(true);
    const both = buildPriceCheckQueryPlan(flask([marker, instilling]), "Allflame", {
      mode: "exact",
    });
    expect(both.filters.map((filter) => [filter.modifierId, filter.enabled])).toEqual([
      ["enkindling-marker", true],
      ["instilling", true],
    ]);

    const shortenedMarker = {
      ...marker,
      tradeStatRef: "Gains no Charges during Effect",
      text: "Gains no Charges during Effect",
      normalizedText: "gains no charges during effect",
    };
    expect(planPriceCheckFilters(flask([shortenedMarker, instilling])))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          modifierId: "enkindling-marker",
          enabled: false,
          advancedOnly: true,
        }),
        expect.objectContaining({
          modifierId: "instilling",
          enabled: false,
          advancedOnly: true,
        }),
      ]));
  });

  it("applies exact family defaults, Idol goodness, and exact uses remaining", () => {
    for (const itemClass of ["Memory Lines", "Sanctum Relics", "Charms"]) {
      const source = item({
        rarity: "magic",
        itemClass,
        name: `Parity ${itemClass}`,
        baseType: `Parity ${itemClass}`,
        influences: [],
        modifiers: [modifier({
          id: "explicit.stat_6000000001",
          tradeId: "explicit.stat_6000000001",
          tradeIds: ["explicit.stat_6000000001"],
          tradeStatRef: "+# to maximum Life",
          tier: "3",
          values: [80],
          tradeBounds: { min: 70, max: 100 },
          tradeDirection: 1,
          selectedByDefault: false,
          tags: [],
        })],
      });
      expect(buildPriceCheckQueryPlan(source, "Allflame", { mode: "exact" })
        .filters[0].enabled, itemClass).toBe(true);
    }

    const idol = item({
      rarity: "rare",
      itemClass: "Idols",
      name: "Parity Idol",
      baseType: "Minor Idol",
      influences: [],
      modifiers: [
        {
          ...explicit("explicit.stat_6000000002", "80% increased Damage", 80, { min: 0, max: 100 }),
          tier: "3",
        },
        {
          ...explicit("explicit.stat_6000000003", "50% increased Speed", 50, { min: 0, max: 100 }),
          tier: "3",
        },
        modifier({
          id: "explicit.stat_6000000004",
          tradeId: "explicit.stat_6000000004",
          tradeIds: ["explicit.stat_6000000004"],
          tradeStatRef: "Has parity effect",
          kind: "explicit",
          text: "Has parity effect",
          normalizedText: "has parity effect",
          values: [],
          tradeDirection: 0,
          selectedByDefault: false,
          tags: [],
        }),
      ],
    });
    expect(buildPriceCheckQueryPlan(idol, "Allflame", { mode: "exact" })
      .filters.map((filter) => filter.enabled)).toEqual([true, false, true]);

    const uses = item({
      rarity: "magic",
      itemClass: "Sanctum Relics",
      name: "Parity Relic",
      baseType: "Censer Relic",
      influences: [],
      modifiers: [modifier({
        id: "explicit.stat_6000000005",
        tradeId: "explicit.stat_6000000005",
        tradeIds: ["explicit.stat_6000000005"],
        tradeStatRef: "# uses remaining",
        kind: "explicit",
        text: "7(1-10) uses remaining",
        normalizedText: "# uses remaining",
        values: [7],
        tradeBounds: { min: 1, max: 10 },
        tradeDirection: 1,
        selectedByDefault: false,
        tags: [],
      })],
    });
    const usesPlan = buildPriceCheckQueryPlan(uses, "Allflame", { mode: "exact" });
    expect(usesPlan.filters[0]).toMatchObject({
      mode: "exact",
      min: 7,
      max: 7,
      enabled: true,
    });
    expect(decodedQuery(usesPlan).query.query.stats[0].filters[0]).toMatchObject({
      id: "explicit.stat_6000000005",
      value: { min: 7, max: 7 },
    });
  });

  it("keeps influence rows disabled in Similar and enables them in Exact", () => {
    const source = item({
      influences: ["Shaper", "Elder"],
      modifiers: [],
    });
    const similar = buildPriceCheckQueryPlan(source, "Allflame", { mode: "similar" });
    expect(decodedQuery(similar).query.query.stats[0].filters).toEqual([
      { id: "pseudo.pseudo_has_shaper_influence", disabled: true },
      { id: "pseudo.pseudo_has_elder_influence", disabled: true },
    ]);
    const exact = buildPriceCheckQueryPlan(source, "Allflame", { mode: "exact" });
    expect(decodedQuery(exact).query.query.stats[0].filters).toEqual([
      { id: "pseudo.pseudo_has_shaper_influence" },
      { id: "pseudo.pseudo_has_elder_influence" },
    ]);
  });

  it.each([
    ["magic", "Flasks", "Diamond Flask"],
    ["unique", "Flasks", "Silver Flask"],
    ["magic", "Tinctures", "Ashbark Tincture"],
    ["unique", "Tinctures", "Ashbark Tincture"],
  ] as const)(
    "keeps %s %s quality visible at 20 and active only above 20",
    (rarity, itemClass, baseType) => {
      const at20 = item({
        rarity,
        itemClass,
        name: rarity === "unique" ? `Parity ${baseType}` : baseType,
        baseType,
        quality: 20,
        influences: [],
        modifiers: [],
      });
      expect(defaultPriceCheckItemFilters(at20).quality).toBe(20);
      expect(priceCheckItemFilterControls(at20).some((control) =>
        control.key === "quality"
      )).toBe(true);
      expect(defaultActivePriceCheckItemFilters(at20)).not.toHaveProperty("quality");

      const above20 = { ...at20, quality: 21 };
      expect(defaultActivePriceCheckItemFilters(above20).quality).toBe(21);
      expect(decodedQuery(buildPriceCheckQueryPlan(
        above20,
        "Allflame",
        { mode: "similar" },
      )).query.query.filters.misc_filters.filters.quality).toEqual({ min: 21 });
    },
  );

  it("keeps greedy Chronicle rooms hidden and serializable", () => {
    const chronicle = applyTradeStatCatalog(
      parsePoeItem(chronicleFixture.replace(
        "Open Rooms:\n",
        "Open Rooms:\nVault (Tier 1)\n",
      )),
      actualCatalog as TradeStatCatalogPack,
    );
    const vaultModifier = chronicle.modifiers.find((entry) =>
      entry.text === "Vault (Tier 1)"
    );
    const vault = planModifierFilters(chronicle).find((filter) =>
      filter.modifierId === vaultModifier?.id
    );
    expect(vault).toMatchObject({ enabled: false, advancedOnly: true });
    const query = decodedQuery(buildPriceCheckQueryPlan(chronicle, "Allflame", {
      mode: "exact",
    })).query.query;
    expect(query.stats[0].filters).toContainEqual(expect.objectContaining({
      id: vaultModifier?.tradeId,
      disabled: true,
    }));
  });

  it("places Blueprint NO ENCHANT after retained exact stats", () => {
    const blueprint = item({
      rarity: "rare",
      itemClass: "Heist Blueprints",
      name: "Blueprint: Bunker",
      baseType: "Blueprint: Bunker",
      influences: [],
      modifiers: [modifier({
        id: "fractured-row",
        tradeId: "fractured.stat_7000000001",
        tradeIds: ["fractured.stat_7000000001"],
        kind: "fractured",
        text: "+100 to maximum Life",
        normalizedText: "+# to maximum life",
        values: [100],
        tradeBounds: { min: 90, max: 110 },
        tradeDirection: 1,
        selectedByDefault: false,
        tags: [],
      })],
    });
    const plan = buildPriceCheckQueryPlan(blueprint, "Allflame", { mode: "exact" });
    expect(plan.filters.map((filter) => filter.modifierId)).toEqual([
      "fractured-row",
      "special:blueprint-no-enchant",
    ]);
    expect(decodedQuery(plan).query.query.stats).toMatchObject([
      { type: "and", filters: [expect.objectContaining({ id: "fractured.stat_7000000001" })] },
      { type: "not", filters: [{ id: "pseudo.pseudo_number_of_enchant_mods" }] },
    ]);
  });

  it.each([
    ["Sanctum Relics", "sanctum.relic"],
    ["Charms", "azmeri.charm"],
    ["Heist Contracts", "heistmission.contract"],
  ] as const)(
    "keeps unidentified nonunique %s on its forced exact category",
    (itemClass, category) => {
      const source = item({
        rarity: "magic",
        itemClass,
        name: `Unidentified ${itemClass}`,
        baseType: `Unidentified ${itemClass}`,
        identified: false,
        influences: [],
        modifiers: [],
      });
      const query = decodedQuery(buildPriceCheckQueryPlan(source, "Allflame", {
        mode: "exact",
      })).query.query;
      expect(query).not.toHaveProperty("type");
      expect(query.filters.type_filters.filters.category).toEqual({ option: category });
    },
  );

  it("does not invent crafting baselines for a noncraftable nonunique item", () => {
    const source = item({
      rarity: "rare",
      itemClass: "Metamorph Samples",
      name: "Parity Metamorph Sample",
      baseType: "Parity Metamorph Sample",
      influences: [],
      modifiers: [],
      quality: undefined,
    });
    const active = defaultActivePriceCheckItemFilters(source, {
      exact: true,
      league: "Allflame",
    });
    expect(active).not.toHaveProperty("mirrored");
    expect(active).not.toHaveProperty("split");
    expect(active).not.toHaveProperty("fractured");
    expect(decodedQuery(buildPriceCheckQueryPlan(source, "Allflame", {
      mode: "exact",
    })).query.query.filters.misc_filters.filters).not.toMatchObject({
      mirrored: expect.anything(),
      split: expect.anything(),
      fractured_item: expect.anything(),
    });
  });

  it("duplicates clean Fractured stats into an Explicit comparable and hidden crafting row", () => {
    const fractured = modifier({
      id: "fractured-life",
      kind: "fractured",
      text: "+100(90-110) to maximum Life",
      normalizedText: "+# to maximum life",
      values: [100],
      tier: "1",
      tradeId: "fractured.stat_3299347043",
      tradeIds: ["fractured.stat_3299347043"],
      tradeIdCandidates: [
        "fractured.stat_3299347043",
        "explicit.stat_3299347043",
      ],
      tradeStatRef: "+# to maximum Life",
      tradeBounds: { min: 90, max: 110 },
      tradeDirection: 1,
      selectedByDefault: false,
      tags: [],
    });
    const source = item({
      influences: [],
      quality: undefined,
      fractured: true,
      modifiers: [fractured],
    });
    const similar = buildPriceCheckQueryPlan(source, "Allflame", {
      mode: "similar",
      rollTolerance: 10,
    });
    expect(similar.filters).toMatchObject([
      {
        modifierId: "fractured-life:explicit-counterpart",
        tradeId: "explicit.stat_3299347043",
        enabled: false,
        min: 100,
        copiedValue: 100,
      },
      {
        modifierId: "fractured-life",
        tradeId: "fractured.stat_3299347043",
        enabled: false,
        advancedOnly: true,
      },
    ]);
    expect(decodedQuery(similar).query.query.stats[0].filters).toEqual([
      {
        id: "explicit.stat_3299347043",
        value: { min: 100 },
        disabled: true,
      },
      {
        id: "fractured.stat_3299347043",
        value: { min: 90 },
        disabled: true,
      },
    ]);

    for (const mode of ["exact", "base"] as const) {
      const exact = buildPriceCheckQueryPlan(source, "Allflame", { mode });
      expect(exact.filters).toMatchObject([{
        modifierId: "fractured-life",
        tradeId: "fractured.stat_3299347043",
        enabled: true,
      }]);
      expect(exact.filters).toHaveLength(1);
      expect(decodedQuery(exact).query.query.stats[0].filters).toEqual([{
        id: "fractured.stat_3299347043",
        value: { min: 98 },
      }]);
    }

    const corrupted = buildPriceCheckQueryPlan({
      ...source,
      corrupted: true,
    }, "Allflame", { mode: "similar" });
    expect(corrupted.filters.map((filter) => filter.modifierId)).toEqual([
      "fractured-life",
    ]);
  });

  it("mounts compact filters from controls or non-hidden rows without category allowlists", () => {
    const gem = item({
      rarity: "gem",
      itemClass: "Skill Gems",
      name: "Fireball",
      baseType: "Fireball",
      gemLevel: 20,
      quality: 0,
      itemLevel: undefined,
      sockets: [],
      links: undefined,
      influences: [],
      modifiers: [],
    });
    expect(supportsCompactModifierEditor(gem, [], true)).toBe(true);

    const tablet = item({
      rarity: "currency",
      itemClass: "Mirrored Tablets",
      name: "Mirrored Tablet",
      baseType: "Mirrored Tablet",
      itemLevel: undefined,
      quality: undefined,
      sockets: [],
      links: undefined,
      influences: [],
      modifiers: [],
    });
    expect(supportsCompactModifierEditor(tablet, [{
      modifierId: "reflection",
      tradeId: "explicit.stat_7000000002",
      enabled: false,
      mode: "range",
      min: 8,
      importance: "useful",
      explanation: "Reflection",
    }])).toBe(true);
    expect(supportsCompactModifierEditor(tablet, [{
      modifierId: "hidden-reflection",
      tradeId: "explicit.stat_7000000003",
      enabled: false,
      mode: "range",
      min: 8,
      advancedOnly: true,
      importance: "useful",
      explanation: "Hidden reflection",
    }])).toBe(false);
  });

  it.each([
    [59, false, 57],
    [60, true, 58],
    [75, true, 73],
  ] as const)(
    "models %i Memory Strands as a hidden Similar row and %s Exact threshold",
    (memoryStrands, active, exactMinimum) => {
      const memory = item({
        itemClass: "Memory Lines",
        name: "Parity Memory",
        baseType: "Parity Memory",
        memoryStrands,
        influences: [],
        modifiers: [],
      });
      const similar = buildPriceCheckQueryPlan(memory, "Allflame", {
        mode: "similar",
      });
      expect(similar.itemFilters).not.toHaveProperty("memoryStrands");
      expect(similar.filters).toContainEqual(expect.objectContaining({
        tradeId: "item.memory_strands",
        enabled: false,
        advancedOnly: true,
      }));
      expect(decodedQuery(similar).query.query.filters.misc_filters.filters)
        .not.toHaveProperty("memory_level");

      const exact = buildPriceCheckQueryPlan(memory, "Allflame", {
        mode: "exact",
        rollTolerance: 10,
      });
      expect(exact.filters).toContainEqual(expect.objectContaining({
        tradeId: "item.memory_strands",
        enabled: active,
        min: exactMinimum,
      }));
      const misc = decodedQuery(exact).query.query.filters.misc_filters.filters;
      if (active) expect(misc.memory_level).toEqual({ min: exactMinimum });
      else expect(misc).not.toHaveProperty("memory_level");
    },
  );

  it("collapses securable consumable and noncraftable searches independently of status", () => {
    for (const [itemClass, name] of [
      ["Maps", "Dunes Map"],
      ["Charts", "Coral Forest Chart"],
      ["Heist Contracts", "Contract: Lockpicking"],
      ["Invitations", "Incandescent Invitation"],
      ["Memory Lines", "Al-Hezmin's Memory"],
      ["Expedition Logbooks", "Expedition Logbook"],
      ["Captured Beasts", "Farric Tiger Alpha"],
    ] as const) {
      const source = item({
        rarity: "rare",
        itemClass,
        name,
        baseType: name,
        influences: [],
        modifiers: [],
      });
      const query = decodedQuery(buildPriceCheckQueryPlan(source, "Allflame", {
        mode: "exact",
        status: "securable",
      })).query.query;
      expect(query.filters.trade_filters.filters.collapse, itemClass)
        .toEqual({ option: "true" });
    }
  });

  it("uses APT category early-return state for Beasts, Invitations, and Metamorph", () => {
    const beast = item({
      rarity: "normal",
      itemClass: "Captured Beasts",
      name: "Farric Tiger Alpha",
      baseType: "Farric Tiger Alpha",
      itemLevel: 88,
      corrupted: false,
      stackSize: 3,
      influences: [],
      modifiers: [],
    });
    expect(defaultPriceCheckItemFilters(beast)).toEqual({
      tradeCurrency: "chaos_divine",
    });
    const invitation = { ...beast, itemClass: "Invitations", stackSize: 2 };
    expect(defaultPriceCheckItemFilters(invitation)).toEqual({
      stackSize: 2,
      tradeCurrency: "chaos_divine",
    });
    const metamorph = {
      ...beast,
      itemClass: "Metamorph Samples",
      itemLevel: 100,
      stackSize: undefined,
    };
    expect(defaultPriceCheckItemFilters(metamorph)).toEqual({
      itemLevel: 100,
      tradeCurrency: "chaos_divine",
    });
  });

  it("uses the Imbued selector and only emits the negative baseline for ordinary gems", () => {
    const imbued = applyTradeStatCatalog(parsePoeItem(`Item Class: Skill Gems
Rarity: Gem
Fireball
--------
Level: 20
Quality: +20%
--------
Supported by Level 1 Faster Casting
--------
Corrupted`), actualCatalog as TradeStatCatalogPack);
    expect(imbued.modifiers[0]).toMatchObject({
      kind: "imbued",
      tradeId: "imbued.pseudo_built_in_support|1255849548",
    });
    const imbuedPlan = buildPriceCheckQueryPlan(imbued, "Allflame", {
      mode: "exact",
    });
    expect(imbuedPlan.itemFilters).not.toHaveProperty("imbuedGem");
    expect(imbuedPlan.filters).toContainEqual(expect.objectContaining({
      tradeId: "imbued.pseudo_built_in_support|1255849548",
      enabled: true,
      mode: "presence",
    }));
    const imbuedQuery = decodedQuery(imbuedPlan).query.query;
    expect(imbuedQuery.stats[0].filters).toContainEqual({
      id: "imbued.pseudo_built_in_support|1255849548",
    });
    expect(imbuedQuery.filters.misc_filters.filters)
      .not.toHaveProperty("gem_imbued");

    const ordinary = item({
      rarity: "gem",
      itemClass: "Skill Gems",
      name: "Fireball",
      baseType: "Fireball",
      gemLevel: 20,
      corrupted: true,
      itemLevel: undefined,
      sockets: [],
      links: undefined,
      influences: [],
      modifiers: [],
    });
    expect(decodedQuery(buildPriceCheckQueryPlan(
      ordinary,
      "Allflame",
      { mode: "exact" },
    )).query.query.filters.misc_filters.filters.gem_imbued).toEqual({
      option: "false",
    });
  });

  it("keeps APT's cross-family item-control order independent of assembly order", () => {
    const source = item({
      itemLevel: 86,
      quality: 30,
      gemLevel: 21,
      links: 6,
      mapTier: 16,
      mapCompletionReward: "The Squire",
      sentinelCharge: 100,
      properties: { "Area Level": "83", "Wings Revealed": "4" },
      heistContract: {
        requiredJob: "Lockpicking",
        jobLevel: 5,
        targetValue: "Priceless",
      },
      stackSize: 20,
      mapBlighted: "Blighted",
      corrupted: true,
      identified: false,
      veiled: true,
      mirrored: true,
      split: true,
      influences: ["Shaper", "Elder"],
    });

    expect(orderedPriceCheckItemFilterEntries(
      defaultPriceCheckItemFilters(source),
    ).map(([key]) => key)).toEqual([
      "links",
      "mapTier",
      "mapCompletionReward",
      "areaLevel",
      "heistWings",
      "sentinelCharge",
      "mapBlighted",
      "itemLevel",
      "stackSize",
      "gemLevel",
      "quality",
      "influence:shaper",
      "influence:elder",
      "corrupted",
      "identified",
      "veiled",
      "mirrored",
      "split",
    ]);
  });
});
