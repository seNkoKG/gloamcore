import { describe, expect, it } from "vitest";
import {
  advancedRareFixture,
  currencyFixture,
  divinationCardFixture,
  expeditionLogbookFixture,
  gemFixture,
  golemSpellKineticWandFixture,
  mapFixture,
  uniqueFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import { buildPriceCheckQueryPlan } from "./query-plan";
import { buildOfficialTradeBrowserUrl } from "./official-trade-route";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  defaultOfficialTradeStatusForItem,
  defaultPriceCheckModeForItem,
  isBulkMapPriceCheckMode,
  officialTradeFailureResult,
  officialTradeNeedsExplicitSearch,
  priceCheckModesForItem,
} from "./official-trade-workflow";

describe("Awakened-style price-check workflow", () => {
  it("uses only the fixed Exact preset for currency and gems", () => {
    for (const fixture of [currencyFixture, gemFixture]) {
      const item = parsePoeItem(fixture);
      expect(priceCheckModesForItem(item)).toEqual(["exact"]);
      expect(defaultPriceCheckModeForItem(item)).toBe("exact");
    }
  });

  it.each(["Utility Flasks", "Life Flasks", "Tinctures"])(
    "uses Exact for every non-unique %s category family",
    (itemClass) => {
      const parsed = parsePoeItem(advancedRareFixture);
      expect(priceCheckModesForItem({
        ...parsed,
        itemClass,
        rarity: "magic",
        name: "Category Base",
        baseType: "Category Base",
      })).toEqual(["exact"]);
    },
  );

  it("gives an ordinary identified rare map APT's active property and Bulk presets", () => {
    const rareMap = parsePoeItem(mapFixture);
    expect(priceCheckModesForItem(rareMap)).toEqual(["exact", "bulk"]);
    expect(defaultPriceCheckModeForItem(rareMap)).toBe("exact");
    expect(isBulkMapPriceCheckMode(rareMap, "exact")).toBe(false);
    expect(isBulkMapPriceCheckMode(rareMap, "bulk")).toBe(true);
  });

  it("keeps Valdo/unique maps Exact and labels normal/magic maps with their sole Bulk preset", () => {
    const rareMap = parsePoeItem(mapFixture);
    for (const item of [
      { ...rareMap, mapCompletionReward: "The Squire" },
      { ...rareMap, rarity: "unique" as const },
    ]) {
      expect(priceCheckModesForItem(item)).toEqual(["exact"]);
      expect(defaultPriceCheckModeForItem(item)).toBe("exact");
      expect(isBulkMapPriceCheckMode(item, "bulk")).toBe(false);
    }
    for (const item of [
      { ...rareMap, rarity: "normal" as const },
      { ...rareMap, rarity: "magic" as const },
      { ...rareMap, identified: false },
    ]) {
      expect(priceCheckModesForItem(item)).toEqual(["bulk"]);
      expect(defaultPriceCheckModeForItem(item)).toBe("bulk");
      expect(isBulkMapPriceCheckMode(item, "bulk")).toBe(true);
      // Old saved `exact` sessions still rebuild with Bulk query semantics.
      expect(isBulkMapPriceCheckMode(item, "exact")).toBe(true);
    }
    expect(isBulkMapPriceCheckMode({
      ...rareMap,
      mapCompletionReward: "The Squire",
    }, "exact")).toBe(false);
  });

  it("creates one Roman-numeral preset per copied Expedition Logbook area", () => {
    const item = parsePoeItem(expeditionLogbookFixture);
    expect(priceCheckModesForItem(item)).toEqual(["I", "II"]);
    expect(defaultPriceCheckModeForItem(item)).toBe("I");
  });

  it("uses one Similar preset for a finished unique", () => {
    expect(priceCheckModesForItem(parsePoeItem(uniqueFixture))).toEqual(["similar"]);
  });

  it("forces every non-unique non-craftable base to Exact without forcing the unique exception", () => {
    const parsed = parsePoeItem(advancedRareFixture);
    const uncatalogued = {
      ...parsed,
      itemClass: "Uncatalogued Samples",
      name: "Uncatalogued Sample",
      baseType: "Uncatalogued Sample",
      quality: undefined,
      itemLevel: 90,
      modifiers: [],
    };

    expect(priceCheckModesForItem(uncatalogued)).toEqual(["exact"]);
    expect(priceCheckModesForItem({
      ...uncatalogued,
      rarity: "unique" as const,
    })).toEqual(["similar"]);
  });

  it("adds Base only for unfinished equipment with crafting value", () => {
    const parsed = parsePoeItem(advancedRareFixture);
    const item = {
      ...parsed,
      rawText: parsed.rawText
        .split(/\r?\n/)
        .filter((line) => !/\bcrafted\b/i.test(line))
        .join("\n"),
      quality: 30,
      fractured: false,
      influences: [],
      modifiers: parsed.modifiers.filter((modifier) => modifier.kind !== "crafted"),
    };
    expect(priceCheckModesForItem(item)).toEqual(["similar", "base"]);
    expect(priceCheckModesForItem({ ...item, itemLevel: 70 })).toEqual(["similar"]);
    expect(priceCheckModesForItem({ ...item, quality: 20 })).toEqual(["similar"]);
    expect(priceCheckModesForItem({
      ...item,
      quality: 20,
      properties: { ...item.properties, "Memory Strands": "10" },
    })).toEqual(["similar", "base"]);
  });

  it("keeps the recovered crafted wand finished after pseudo hydration and preserves edited Trade values", () => {
    const parsed = parsePoeItem(golemSpellKineticWandFixture);
    const item = applyTradeStatCatalog(
      parsed,
      actualCatalog as TradeStatCatalogPack,
    );

    expect(item).toMatchObject({
      valid: true,
      itemClass: "Wands",
      rarity: "rare",
      name: "Golem Spell",
      baseType: "Kinetic Wand",
      quality: 28,
      links: 3,
      itemLevel: 99,
    });
    expect(item.modifiers.some(
      (modifier) => modifier.id === "pseudo-global-crit-multi",
    )).toBe(true);
    expect(item.modifiers.some(
      (modifier) => modifier.kind === "crafted",
    )).toBe(false);
    expect(priceCheckModesForItem(item)).toEqual(["similar"]);

    const initial = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "similar",
      rollTolerance: 10,
    });
    expect(initial.filters.filter((filter) => filter.enabled)).toEqual([]);
    expect(initial.filters.find(
      (filter) => filter.modifierId === "property:weapon-physical-dps",
    )).toMatchObject({ enabled: false });
    expect(initial.filters.find(
      (filter) => filter.tradeId === "enchant.stat_1335369947",
    )).toMatchObject({
      enabled: false,
      tradeId: "enchant.stat_1335369947",
    });
    expect(initial.filters.find(
      (filter) => filter.modifierId === "pseudo-global-crit-multi",
    )).toMatchObject({
      enabled: false,
      tradeId: "pseudo.pseudo_global_critical_strike_multiplier",
    });
    const filters = initial.filters.map((filter) => {
      if (filter.modifierId === "property:weapon-physical-dps") {
        return { ...filter, enabled: true, min: 700, max: 800 };
      }
      if (filter.modifierId === "pseudo-global-crit-multi") {
        return { ...filter, enabled: true, min: 27, max: 29 };
      }
      return { ...filter, enabled: false };
    });
    const edited = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "similar",
      rollTolerance: 10,
      filters,
      itemFilters: { links: 3, quality: 28, corrupted: false },
    });
    const url = buildOfficialTradeBrowserUrl({
      league: edited.league,
      tradeQuery: edited.tradeQuery,
      api: edited.tradeApi,
    });
    const encoded = new URL(url).searchParams.get("q");

    expect(encoded).not.toBeNull();
    const browserQuery = JSON.parse(encoded || "null") as typeof edited.tradeQuery;
    expect(browserQuery).toEqual(edited.tradeQuery);
    expect(browserQuery).toMatchObject({
      query: {
        filters: {
          weapon_filters: { filters: { pdps: { min: 700, max: 800 } } },
          socket_filters: { filters: { links: { min: 3 } } },
          misc_filters: { filters: { corrupted: { option: "false" } } },
        },
      },
    });
    expect((browserQuery as any).query.stats[0]).toMatchObject({ type: "and" });
    expect((browserQuery as any).query.stats[0].filters.filter(
      (filter: { disabled?: boolean }) => !filter.disabled,
    )).toEqual([{
      id: "pseudo.pseudo_global_critical_strike_multiplier",
      value: { min: 27, max: 29 },
    }]);
  });

  it("starts ordinary equipment at instant-buyout-only availability", () => {
    const item = parsePoeItem(advancedRareFixture);
    expect(defaultOfficialTradeStatusForItem(item)).toBe("securable");
    expect(defaultOfficialTradeStatusForItem(item, false)).toBe("any");
    expect(defaultOfficialTradeStatusForItem(parsePoeItem(currencyFixture))).toBe("securable");
    expect(defaultOfficialTradeStatusForItem(parsePoeItem(divinationCardFixture)))
      .toBe("available");
  });

  it("marks every edited query as waiting even for an auto-search item", () => {
    const item = parsePoeItem(uniqueFixture);
    const query = buildPriceCheckQueryPlan(item, "Allflame");
    const base = {
      id: "workflow",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready" as const,
      item,
      matches: [],
      estimate: null,
      query,
      sourceStale: false,
    };

    expect(officialTradeNeedsExplicitSearch(base)).toBe(false);
    expect(officialTradeNeedsExplicitSearch({
      ...base,
      officialTradeNeedsSearch: true,
    })).toBe(true);
  });

  it("distinguishes an empty first failure from stale cached evidence", () => {
    const firstFailure = officialTradeFailureResult(
      new Error("Error invoking remote method 'trade:listings': offline"),
    );
    expect(firstFailure).toMatchObject({
      listings: [],
      stale: false,
      error: "offline",
    });

    const cachedFailure = officialTradeFailureResult(new Error("offline"), {
      api: "trade",
      listings: [{
        id: "listing-1",
        price: { amount: 1, currency: "divine" },
        indexed: "2026-08-02T12:34:56Z",
        seller: { account: "Seller", character: "Mapper" },
        item: { name: "Mageblood", baseType: "Heavy Belt", icon: "" },
        whisper: "",
      }],
      total: 1,
      searchId: "search-1",
      fetchedAt: 123,
      stale: false,
      error: "",
    });
    expect(cachedFailure).toMatchObject({
      api: "trade",
      stale: true,
      total: 1,
      searchId: "search-1",
      fetchedAt: 123,
      error: "offline",
    });

    expect(officialTradeFailureResult(new Error("offline"), {
      api: "exchange",
      listings: [],
      total: 0,
      searchId: "empty-search",
      fetchedAt: 321,
      stale: false,
      error: "",
    })).toMatchObject({
      api: "exchange",
      listings: [],
      stale: true,
      searchId: "empty-search",
    });

    expect(officialTradeFailureResult(new Error("ipc failed"), {
      api: "trade",
      listings: [],
      total: 12,
      searchId: "partial-search",
      fetchedAt: 456,
      stale: false,
      error: "listing fetch failed",
    })).toMatchObject({
      stale: false,
      searchId: "partial-search",
      error: "ipc failed",
    });
  });
});
