import { describe, expect, it } from "vitest";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  clusterJewelPolicyFixture,
  forbiddenFlameFixture,
  foulbornWatcherEyeAdvancedFixture,
  impossibleEscapeFixture,
  magebloodAdvancedFixture,
  megalomaniacFixture,
  splitPersonalityFixture,
  threadOfHopeFixture,
  unidentifiedWatcherEyeFixture,
  watcherEyeAdvancedFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import {
  buildPriceCheckQueryPlan,
  planModifierFilters,
} from "./query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import type { ParsedPoeItem, PriceCheckQueryPlan } from "./types";

const catalog = actualCatalog as TradeStatCatalogPack;

function hydrate(text: string) {
  return applyTradeStatCatalog(parsePoeItem(text), catalog);
}

function pipeline(text: string) {
  const parsed = parsePoeItem(text);
  const item = applyTradeStatCatalog(parsed, catalog);
  const filters = planModifierFilters(item, 10);
  const plan = buildPriceCheckQueryPlan(item, "Allflame", { filters });
  return { parsed, item, filters, plan };
}

function payload(plan: PriceCheckQueryPlan) {
  return (plan.tradeQuery as any).query;
}

type SerializedStat = {
  id: string;
  value?: unknown;
  disabled?: boolean;
};

function activeStats(filters: SerializedStat[]) {
  return filters.filter((filter) => !filter.disabled);
}

function filterForText(
  item: ParsedPoeItem,
  filters: ReturnType<typeof planModifierFilters>,
  pattern: RegExp,
) {
  const modifier = item.modifiers.find((entry) => pattern.test(entry.text));
  expect(modifier, String(pattern)).toBeDefined();
  return filters.find((filter) => filter.modifierId === modifier!.id)!;
}

describe("Awakened-parity unique jewel pipeline", () => {
  it("preserves and resolves Impossible Escape's complete three-line selector", () => {
    const { parsed, item, filters, plan } = pipeline(impossibleEscapeFixture);

    expect(parsed.modifiers.map((modifier) => modifier.text)).toEqual([
      "Passive Skills in Radius of Chaos Inoculation can be Allocated",
      "without being connected to your tree",
      "Passage",
    ]);
    expect(parsed.flavourText).toContain(
      '"There is no freedom without consequence."',
    );
    expect(parsed.modifiers.some((modifier) =>
      /socketed into an allocated Jewel Socket/i.test(modifier.text)
    )).toBe(false);
    expect(item.modifiers).toHaveLength(1);
    expect(item.modifiers[0]).toMatchObject({
      tradeId: "explicit.stat_2422708892|11455",
      values: [],
    });
    expect(filters[0]).toMatchObject({ enabled: true, mode: "presence" });
    expect(payload(plan).stats[0].filters).toEqual([
      { id: "explicit.stat_2422708892|11455" },
    ]);
  });

  it("longest-matches Split Personality's fixed multi-line effect, then keeps both rolls", () => {
    const { parsed, item, filters, plan } = pipeline(splitPersonalityFixture);

    expect(parsed.modifiers).toHaveLength(4);
    expect(item.modifiers).toHaveLength(3);
    expect(item.modifiers[0]).toMatchObject({
      tradeId: "explicit.stat_372478711",
      values: [25],
    });
    expect(filters[0].enabled).toBe(false);
    expect(filters.slice(1).every((filter) => filter.enabled)).toBe(true);
    const tradeFilters = payload(plan).stats[0].filters;
    expect(activeStats(tradeFilters)).toHaveLength(2);
    expect(activeStats(tradeFilters).map((filter: { id: string }) => filter.id))
      .not.toContain("explicit.stat_372478711");
  });

  it("enables mapped value-less Megalomaniac notables but not fixed boilerplate", () => {
    const { item, filters, plan } = pipeline(megalomaniacFixture);
    const fixed = filters.slice(0, 2);
    const notables = filters.slice(2);

    expect(item.modifiers).toHaveLength(5);
    expect(fixed.every((filter) => !filter.enabled)).toBe(true);
    expect(notables).toHaveLength(3);
    expect(notables.every((filter) => filter.enabled && filter.mode === "presence"))
      .toBe(true);
    expect(payload(plan).stats[0].filters).toEqual(expect.arrayContaining([
      { id: "explicit.stat_1085167979" },
      { id: "explicit.stat_2342448236" },
      { id: "explicit.stat_1678643716" },
    ]));
  });

  it("strips adversarial numeric state from value-less Megalomaniac notables", () => {
    const item = hydrate(megalomaniacFixture);
    const poisoned = planModifierFilters(item, 10).map((filter) =>
      filter.enabled
        ? {
            ...filter,
            mode: "exact" as const,
            min: 9_999,
            max: 9_999,
            copiedValue: 9_999,
            bounds: { min: 9_999, max: 9_999 },
          }
        : filter
    );
    const plan = buildPriceCheckQueryPlan(item, "Allflame", {
      filters: poisoned,
    });
    const notables = plan.filters.filter((filter) => filter.enabled);

    expect(notables).toHaveLength(3);
    expect(notables.every(
      (filter) =>
        filter.mode === "presence" &&
        filter.min == null &&
        filter.max == null &&
        filter.copiedValue == null &&
        filter.bounds == null,
    )).toBe(true);
    expect(payload(plan).stats[0].filters).toEqual(expect.arrayContaining([
      { id: "explicit.stat_1085167979" },
      { id: "explicit.stat_2342448236" },
      { id: "explicit.stat_1678643716" },
    ]));
    expect(activeStats(payload(plan).stats[0].filters).every(
      (filter: { value?: unknown }) => filter.value == null,
    )).toBe(true);
  });

  it("enables Foulborn fixed explicits while ordinary fixed explicits and base implicits stay off", () => {
    const ordinary = pipeline(watcherEyeAdvancedFixture);
    const foulborn = pipeline(foulbornWatcherEyeAdvancedFixture);

    for (const text of [
      /increased maximum Life/i,
      /increased maximum Mana/i,
    ]) {
      expect(filterForText(ordinary.item, ordinary.filters, text).enabled).toBe(false);
      const fixedFoulborn = filterForText(foulborn.item, foulborn.filters, text);
      expect(fixedFoulborn).toMatchObject({
        enabled: true,
        mode: "presence",
        tag: "explicit",
      });
      expect(fixedFoulborn.copiedValue).toBeUndefined();
      expect(fixedFoulborn.min).toBeUndefined();
      expect(fixedFoulborn.max).toBeUndefined();
      expect(fixedFoulborn.bounds).toBeUndefined();
    }
    expect(filterForText(
      foulborn.item,
      foulborn.filters,
      /total increased maximum Energy Shield/i,
    )).toMatchObject({ enabled: false, mode: "range" });
    expect(filterForText(foulborn.item, foulborn.filters, /all Attributes/i).enabled)
      .toBe(false);
    expect(payload(foulborn.plan).filters.misc_filters.filters)
      .not.toHaveProperty("foulborn_item");
    expect(activeStats(payload(foulborn.plan).stats[0].filters)).toHaveLength(2);
    expect(activeStats(payload(foulborn.plan).stats[0].filters).every(
      (filter: { value?: unknown }) => filter.value == null,
    )).toBe(true);
  });

  it("keeps Foulborn fixed explicits numeric when advanced roll bounds prove variability", () => {
    const bounded = pipeline(
      foulbornWatcherEyeAdvancedFixture
        .replace("6% increased maximum Energy Shield", "6(4-6)% increased maximum Energy Shield")
        .replace("6% increased maximum Life", "6(4-6)% increased maximum Life")
        .replace("6% increased maximum Mana", "6(4-6)% increased maximum Mana"),
    );

    for (const text of [
      /increased maximum Life/i,
      /increased maximum Mana/i,
    ]) {
      expect(filterForText(bounded.item, bounded.filters, text)).toMatchObject({
        enabled: true,
        mode: "range",
        min: 6,
        bounds: { min: 4, max: 6 },
      });
      expect(filterForText(bounded.item, bounded.filters, text).max).toBeUndefined();
    }
    expect(filterForText(
      bounded.item,
      bounded.filters,
      /total increased maximum Energy Shield/i,
    )).toMatchObject({ enabled: false, mode: "range" });
    expect(activeStats(payload(bounded.plan).stats[0].filters).every(
      (filter: { value?: unknown }) =>
        JSON.stringify(filter.value) === JSON.stringify({ min: 6 }),
    )).toBe(true);
  });

  it("does not infer Watcher's Eye from an unresolved Prismatic Jewel base", () => {
    const { parsed, plan } = pipeline(unidentifiedWatcherEyeFixture);

    expect(parsed).toMatchObject({ identified: false, itemLevel: 86 });
    expect(plan.itemFilters).toMatchObject({ identified: false });
    expect(plan.itemFilters).not.toHaveProperty("itemLevel");
    expect(payload(plan).type).toBe("Prismatic Jewel");
    expect(payload(plan).filters.misc_filters.filters).not.toHaveProperty("ilvl");
  });

  it("adds the item-level discriminator only after Watcher's Eye is resolved", () => {
    const unresolved = hydrate(unidentifiedWatcherEyeFixture);
    const watcher = buildPriceCheckQueryPlan({
      ...unresolved,
      name: "Watcher's Eye",
    }, "Allflame");
    const otherPrismatic = buildPriceCheckQueryPlan({
      ...unresolved,
      name: "The Light of Meaning",
    }, "Allflame");

    expect(watcher.itemFilters).toMatchObject({ identified: false, itemLevel: 86 });
    expect(payload(watcher).filters.misc_filters.filters.ilvl).toEqual({ min: 86 });
    expect(otherPrismatic.itemFilters).not.toHaveProperty("itemLevel");
    expect(payload(otherPrismatic).filters.misc_filters.filters)
      .not.toHaveProperty("ilvl");
  });

  it("serializes real Thread of Hope and Forbidden Flame selectors as presence", () => {
    const thread = pipeline(threadOfHopeFixture);
    const forbidden = pipeline(forbiddenFlameFixture);
    const threadSelector = payload(thread.plan).stats[0].filters.find(
      (filter: { id: string }) => filter.id === "explicit.stat_3642528642|5",
    );

    expect(threadSelector).toEqual({ id: "explicit.stat_3642528642|5" });
    expect(filterForText(thread.item, thread.filters, /total Elemental Resistance/i).enabled)
      .toBe(true);
    expect(filterForText(
      thread.item,
      thread.filters,
      /Passives in Radius can be Allocated/i,
    ).enabled).toBe(false);
    expect(payload(thread.plan).stats[0].filters).toHaveLength(2);
    expect(payload(forbidden.plan).stats[0].filters).toContainEqual({
      id: "explicit.stat_1190333629|38999",
    });
  });

  it("keeps real Mageblood invariant boilerplate out of conservative defaults", () => {
    const mageblood = pipeline(magebloodAdvancedFixture);

    expect(filterForText(
      mageblood.item,
      mageblood.filters,
      /^Magic Utility Flasks cannot be Used$/i,
    ).enabled).toBe(false);
    expect(filterForText(
      mageblood.item,
      mageblood.filters,
      /^Magic Utility Flask Effects cannot be removed$/i,
    ).enabled).toBe(false);
    expect(payload(mageblood.plan).stats[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: filterForText(
          mageblood.item,
          mageblood.filters,
          /^Magic Utility Flasks cannot be Used$/i,
        ).tradeId,
        disabled: true,
      }),
    ]));
  });
});

describe("Awakened-parity Cluster Jewel policy", () => {
  it("keeps only the marked type/passive-count enchant rows", () => {
    const { item, filters, plan } = pipeline(clusterJewelPolicyFixture);

    expect(filterForText(item, filters, /^Adds 8 Passive Skills$/i)).toMatchObject({
      enabled: true,
      mode: "range",
      max: 8,
    });
    expect(filterForText(item, filters, /grant: 12% increased Lightning Damage/i))
      .toMatchObject({ enabled: true });
    expect(item.modifiers).toHaveLength(2);
    expect(item.modifiers.some((modifier) => /Jewel Sockets/i.test(modifier.text)))
      .toBe(false);
    expect(item.modifiers.some((modifier) => /Doryani's Lesson/i.test(modifier.text)))
      .toBe(false);
    expect(item.modifiers.some((modifier) => /Storm Drinker/i.test(modifier.text)))
      .toBe(false);
    expect(item.modifiers.some((modifier) => /All Attributes/i.test(modifier.text)))
      .toBe(false);
    expect(plan.itemFilters).not.toHaveProperty("itemLevel");
    expect(payload(plan).filters.misc_filters.filters).not.toHaveProperty("ilvl");
    const basePlan = buildPriceCheckQueryPlan(item, "Allflame", { mode: "base" });
    expect(basePlan.itemFilters).toMatchObject({ itemLevel: 75, itemLevelMax: 100 });
    expect(payload(basePlan).filters.misc_filters.filters.ilvl)
      .toEqual({ min: 75, max: 100 });
    expect(activeStats(payload(plan).stats[0].filters)).toHaveLength(2);
  });

  it.each([
    [2, true, "range", undefined, 2],
    [3, true, "range", 3, undefined],
    [4, true, "range", undefined, 5],
    [5, true, "exact", 5, 5],
    [6, true, "range", 6, undefined],
    [7, false, "exact", 7, 7],
    [8, true, "range", undefined, 8],
    [9, true, "range", undefined, 9],
    [10, true, "range", 10, undefined],
    [11, true, "range", 11, undefined],
    [12, true, "range", 12, undefined],
  ] as const)(
    "uses the proven passive-count bucket for %i",
    (count, enabled, mode, min, max) => {
      const text = clusterJewelPolicyFixture.replace(
        "Adds 8 Passive Skills",
        `Adds ${count} Passive Skills`,
      );
      const item = hydrate(text);
      const filter = filterForText(
        item,
        planModifierFilters(item, 10),
        new RegExp(`^Adds ${count} Passive Skills$`, "i"),
      );
      expect(filter).toMatchObject({ enabled, mode });
      expect(filter.min).toBe(min);
      expect(filter.max).toBe(max);
    },
  );

  it.each([
    [40, 1, 49],
    [50, 50, 67],
    [67, 50, 67],
    [68, 68, 74],
    [74, 68, 74],
    [75, 75, 100],
    [83, 75, 100],
    [84, 84, 100],
  ])("brackets copied item level %i to %i-%i", (level, min, max) => {
    const plan = buildPriceCheckQueryPlan(
      hydrate(clusterJewelPolicyFixture.replace("Item Level: 83", `Item Level: ${level}`)),
      "Allflame",
      { mode: "base" },
    );
    expect(payload(plan).filters.misc_filters.filters.ilvl).toEqual({ min, max });
  });
});
