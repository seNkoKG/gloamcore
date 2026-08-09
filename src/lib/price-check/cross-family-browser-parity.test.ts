import { describe, expect, it } from "vitest";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  advancedRareFixture,
  chronicleFixture,
  clusterJewelFixture,
  currencyFixture,
  expeditionLogbookFixture,
  gemFixture,
  golemSpellKineticWandFixture,
  influencedStatusFixture,
  mapFixture,
  timelessJewelFixture,
  uniqueFixture,
  watcherEyeAdvancedFixture,
} from "./fixtures/parser-fixtures";
import {
  buildOfficialTradeBrowserUrl,
  type OfficialTradeApi,
} from "./official-trade-route";
import {
  defaultOfficialTradeStatusForItem,
  defaultPriceCheckModeForItem,
  priceCheckItemForMode,
  priceCheckModesForItem,
} from "./official-trade-workflow";
import { parsePoeItem } from "./parser";
import { buildPriceCheckQueryPlan } from "./query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import type {
  ParsedPoeItem,
  PriceCheckDashboardMode,
  PriceCheckQueryPlan,
} from "./types";

const LEAGUE = "Allflame";
const catalog = actualCatalog as unknown as TradeStatCatalogPack;
const timelessJewelAdvancedFixture = timelessJewelFixture.replace(
  "Bathed in the blood of 5123 sacrificed in the name of Doryani",
  "{ Unique Modifier — Jewel }\n" +
    "Bathed in the blood of 5123 sacrificed in the name of Doryani",
);

function hydrate(rawText: string): ParsedPoeItem {
  const parsed = parsePoeItem(rawText);
  const standard = applyTradeStatCatalog(parsed, catalog);
  if (!parsed.logbookAreas?.length) return standard;

  return {
    ...standard,
    logbookAreas: parsed.logbookAreas.map((modifiers) =>
      applyTradeStatCatalog(
        { ...parsed, modifiers, warnings: [] },
        catalog,
      ).modifiers
    ),
  };
}

function defaultPlan(
  item: ParsedPoeItem,
  mode: PriceCheckDashboardMode = defaultPriceCheckModeForItem(item),
) {
  return buildPriceCheckQueryPlan(item, LEAGUE, {
    mode,
    status: defaultOfficialTradeStatusForItem(item),
  });
}

function decodedBrowserPayload(plan: PriceCheckQueryPlan) {
  const api: OfficialTradeApi = plan.tradeApi || "trade";
  const browserUrl = buildOfficialTradeBrowserUrl({
    league: plan.league,
    tradeQuery: plan.tradeQuery,
    api,
  });
  expect(browserUrl).toBe(plan.tradeUrl);

  const encoded = new URL(browserUrl).searchParams.get("q");
  expect(encoded).not.toBeNull();
  if (!encoded) throw new Error("Expected an official Trade browser payload");

  const decoded = JSON.parse(encoded) as Record<string, unknown>;
  const expected = api === "exchange"
    ? { exchange: (plan.tradeQuery as any).query }
    : plan.tradeQuery;
  expect(decoded).toEqual(expected);
  return decoded as any;
}

const items = {
  currency: hydrate(currencyFixture),
  wand: hydrate(golemSpellKineticWandFixture),
  armour: hydrate(advancedRareFixture),
  jewellery: hydrate(influencedStatusFixture),
  unique: hydrate(uniqueFixture),
  watchersEye: hydrate(watcherEyeAdvancedFixture),
  timeless: hydrate(timelessJewelAdvancedFixture),
  cluster: hydrate(clusterJewelFixture),
  gem: hydrate(gemFixture),
  valdoMap: hydrate(mapFixture.replace(
    "Map Tier: 16\n",
    "Map Tier: 16\nReward: Foil The Squire\n",
  )),
  chronicle: hydrate(chronicleFixture),
  logbook: hydrate(expeditionLogbookFixture),
};

describe("cross-family official Trade browser parity", () => {
  it.each([
    ["currency/bulk", items.currency],
    ["rare crafted weapon", items.wand],
    ["rare armour", items.armour],
    ["rare jewellery", items.jewellery],
    ["ordinary unique", items.unique],
    ["Watcher's Eye", items.watchersEye],
    ["Timeless Jewel", items.timeless],
    ["Cluster Jewel", items.cluster],
    ["gem", items.gem],
    ["Valdo-style map", items.valdoMap],
    ["Chronicle", items.chronicle],
  ])("round-trips the real default %s query byte-for-byte", (_label, item) => {
    const mode = defaultPriceCheckModeForItem(item);
    expect(priceCheckModesForItem(item)).toContain(mode);
    decodedBrowserPayload(defaultPlan(item, mode));
  });

  it("keeps family-specific defaults semantic rather than merely JSON-valid", () => {
    const currency = defaultPlan(items.currency);
    expect(defaultPriceCheckModeForItem(items.currency)).toBe("exact");
    expect(currency.tradeApi).toBe("exchange");
    expect((currency.tradeQuery as any).query).toMatchObject({
      status: { option: "online" },
      have: ["chaos"],
      want: ["divine"],
    });

    const wand = defaultPlan(items.wand);
    const wandQuery = (wand.tradeQuery as any).query;
    expect(defaultPriceCheckModeForItem(items.wand)).toBe("similar");
    expect(wandQuery.filters.type_filters.filters.category)
      .toEqual({ option: "weapon.wand" });
    expect(wand.filters.find((filter) => filter.equipmentProperty?.key === "pdps"))
      .toMatchObject({ copiedValue: 756, enabled: false });
    expect(wand.filters.some((filter) => filter.equipmentProperty?.key === "damage"))
      .toBe(false);
    expect(wand.filters.some((filter) => filter.equipmentProperty?.key === "dps"))
      .toBe(false);

    const armour = defaultPlan(items.armour);
    const armourQuery = (armour.tradeQuery as any).query;
    expect(defaultPriceCheckModeForItem(items.armour)).toBe("similar");
    expect(armourQuery.filters.type_filters.filters.category)
      .toEqual({ option: "armour.chest" });
    expect(armourQuery.filters.armour_filters.filters.es).toBeDefined();

    const jewellery = defaultPlan(items.jewellery);
    const jewelleryQuery = (jewellery.tradeQuery as any).query;
    expect(defaultPriceCheckModeForItem(items.jewellery)).toBe("similar");
    expect(jewelleryQuery.filters.type_filters.filters.category)
      .toEqual({ option: "accessory.ring" });
    expect(jewelleryQuery.stats[0].filters)
      .toContainEqual({ id: "veiled.mod_65000" });

    const unique = defaultPlan(items.unique);
    const uniqueQuery = (unique.tradeQuery as any).query;
    expect(defaultPriceCheckModeForItem(items.unique)).toBe("similar");
    expect(uniqueQuery).toMatchObject({ name: "Mageblood", type: "Heavy Belt" });
    expect(uniqueQuery.filters.misc_filters.filters).not.toHaveProperty("ilvl");
    expect(uniqueQuery.filters.misc_filters.filters).not.toHaveProperty("quality");

    const watchersEye = defaultPlan(items.watchersEye);
    const watchersStats = (watchersEye.tradeQuery as any).query.stats[0].filters;
    const auraTradeIds = items.watchersEye.modifiers
      .filter((modifier) => /while affected by/i.test(modifier.text))
      .map((modifier) => modifier.tradeId);
    expect(auraTradeIds).toHaveLength(2);
    for (const tradeId of auraTradeIds) {
      expect(tradeId).toBeTruthy();
      expect(watchersStats).toContainEqual(expect.objectContaining({ id: tradeId }));
    }

    const timeless = defaultPlan(items.timeless);
    const timelessStats = (timeless.tradeQuery as any).query.stats[0].filters;
    expect(timelessStats).toContainEqual({
      id: "explicit.pseudo_timeless_jewel_doryani",
      value: { min: 5123, max: 5123 },
    });

    const cluster = defaultPlan(items.cluster);
    const clusterQuery = (cluster.tradeQuery as any).query;
    const passiveCount = items.cluster.modifiers.find((modifier) =>
      /^adds 8 passive skills$/i.test(modifier.text)
    );
    expect(clusterQuery.type).toBe("Large Cluster Jewel");
    expect(passiveCount?.tradeId).toBeTruthy();
    expect(clusterQuery.stats[0].filters)
      .toContainEqual(expect.objectContaining({ id: passiveCount?.tradeId }));

    const gem = defaultPlan(items.gem);
    const gemMisc = (gem.tradeQuery as any).query.filters.misc_filters.filters;
    expect(defaultPriceCheckModeForItem(items.gem)).toBe("exact");
    expect(gemMisc).toMatchObject({
      gem_level: { min: 5 },
      quality: { min: 20 },
    });
    expect(gemMisc).not.toHaveProperty("gem_imbued");

    const valdoMap = defaultPlan(items.valdoMap);
    const valdoQuery = (valdoMap.tradeQuery as any).query;
    expect(items.valdoMap.mapCompletionReward).toBe("The Squire");
    expect(valdoQuery.filters.map_filters.filters).toMatchObject({
      map_tier: { min: 16, max: 16 },
      map_completion_reward: { option: "The Squire" },
    });
    expect(valdoQuery.stats).toContainEqual({
      type: "not",
      filters: [{ id: "explicit.stat_1095765106" }],
    });

    const chronicle = defaultPlan(items.chronicle);
    const chronicleQuery = (chronicle.tradeQuery as any).query;
    expect(defaultPriceCheckModeForItem(items.chronicle)).toBe("exact");
    expect(chronicleQuery.filters.map_filters.filters.area_level)
      .toEqual({ min: 80 });
    const enabledRoomTradeIds = items.chronicle.modifiers
      .filter((modifier) =>
        modifier.roomState === 1 &&
        modifier.tradeId &&
        !/^atlas of worlds/i.test(modifier.text)
      )
      .map((modifier) => modifier.tradeId);
    const atlasTradeId = items.chronicle.modifiers.find((modifier) =>
      /^atlas of worlds/i.test(modifier.text)
    )?.tradeId;
    const submittedRooms = chronicleQuery.stats[0].filters
      .filter((filter: { disabled?: boolean }) => !filter.disabled)
      .map((filter: { id: string }) => filter.id);
    expect(enabledRoomTradeIds).toHaveLength(5);
    expect(submittedRooms).toEqual(expect.arrayContaining(enabledRoomTradeIds));
    expect(atlasTradeId).toBeTruthy();
    expect(submittedRooms).not.toContain(atlasTradeId);
  });

  it("round-trips every parsed Logbook area as its isolated I-V query", () => {
    const modes = priceCheckModesForItem(items.logbook);
    expect(modes).toEqual(["I", "II"]);
    expect(items.logbook.logbookAreas).toHaveLength(modes.length);

    const factionIds = new Set<string>();
    modes.forEach((mode, index) => {
      const selectedArea = priceCheckItemForMode(items.logbook, mode);
      const plan = defaultPlan(items.logbook, mode);
      const browserPayload = decodedBrowserPayload(plan);
      const apiStats = (plan.tradeQuery as any).query.stats[0].filters;
      const browserStats = browserPayload.query.stats[0].filters;
      const enabledTradeIds = plan.filters
        .filter((filter) => filter.enabled)
        .flatMap((filter) => filter.tradeIds?.length
          ? filter.tradeIds
          : filter.tradeId
            ? [filter.tradeId]
            : []);

      expect(selectedArea.modifiers).toEqual(items.logbook.logbookAreas?.[index]);
      expect(enabledTradeIds).toHaveLength(2);
      for (const tradeId of enabledTradeIds) {
        expect(apiStats).toContainEqual(expect.objectContaining({ id: tradeId }));
        expect(browserStats).toContainEqual(expect.objectContaining({ id: tradeId }));
      }
      expect((plan.tradeQuery as any).query.filters.map_filters.filters.area_level)
        .toEqual({ min: 83 });

      const factionId = enabledTradeIds.find((id) => id.startsWith("pseudo.pseudo_logbook_faction_"));
      expect(factionId).toBeTruthy();
      factionIds.add(factionId!);
    });
    expect(factionIds.size).toBe(modes.length);
  });

  it("preserves an edited wand pDPS range and mapped modifier in API and browser state", () => {
    const mode = defaultPriceCheckModeForItem(items.wand);
    const baseline = defaultPlan(items.wand, mode);
    const pdps = baseline.filters.find(
      (filter) => filter.equipmentProperty?.key === "pdps",
    );
    const mappedModifier = baseline.filters.find(
      (filter) => filter.tradeId === "enchant.stat_1335369947",
    );
    expect(pdps).toBeDefined();
    expect(mappedModifier).toBeDefined();

    const filters = baseline.filters.map((filter) => {
      if (filter.modifierId === pdps?.modifierId) {
        return { ...filter, enabled: true, mode: "range" as const, min: 700, max: 810 };
      }
      if (filter.modifierId === mappedModifier?.modifierId) {
        return { ...filter, enabled: true, mode: "range" as const, min: 7, max: 8 };
      }
      return { ...filter, enabled: false };
    });
    const edited = buildPriceCheckQueryPlan(items.wand, LEAGUE, {
      mode,
      status: baseline.status,
      filters,
      itemFilters: baseline.itemFilters,
    });
    const apiQuery = (edited.tradeQuery as any).query;

    expect(edited.filters.find((filter) => filter.modifierId === pdps?.modifierId))
      .toMatchObject({ enabled: true, mode: "range", min: 700, max: 810 });
    expect(edited.filters.find(
      (filter) => filter.modifierId === mappedModifier?.modifierId,
    )).toMatchObject({ enabled: true, mode: "range", min: 7, max: 8 });
    expect(apiQuery.filters.weapon_filters.filters.pdps)
      .toEqual({ min: 700, max: 810 });
    expect(apiQuery.stats[0].filters).toContainEqual({
      id: "enchant.stat_1335369947",
      value: { min: 7, max: 8 },
    });

    const browserQuery = decodedBrowserPayload(edited).query;
    expect(browserQuery.filters.weapon_filters.filters.pdps)
      .toEqual({ min: 700, max: 810 });
    expect(browserQuery.stats[0].filters).toContainEqual({
      id: "enchant.stat_1335369947",
      value: { min: 7, max: 8 },
    });
  });
});
