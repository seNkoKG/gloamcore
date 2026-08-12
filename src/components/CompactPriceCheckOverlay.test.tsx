import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import actualCatalog from "../../public/data/price-check/stats-v1.json";
import {
  advancedRareFixture,
  armourModifierParityFixture,
  currencyFixture,
  gemFixture,
  golemSpellKineticWandFixture,
  influencedStatusFixture,
  lethalPrideKaomAdvancedFixture,
  magebloodAdvancedFixture,
  malachaisLoopVestigialFixture,
  mapFixture,
  rareWeaponFixture,
  uniqueFixture,
} from "../lib/price-check/fixtures/parser-fixtures";
import { parsePoeItem } from "../lib/price-check/parser";
import { buildPriceCheckQueryPlan } from "../lib/price-check/query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "../lib/price-check/stat-catalog";
import type { PriceCheckSession } from "../lib/price-check/types";
import type { EconomyRow } from "../types";
import {
  COMPACT_PRICE_CHECK_WIDTH,
  CompactPriceCheckOverlay,
  compactPriceCheckPanelHeight,
  compactPriceCheckUsesConstrainedModifierRows,
  shortNumber,
} from "./CompactPriceCheckOverlay";
import { compactPriceCheckModifierRowsHeight } from "./CompactRareModifierEditor";

function renderCompact(session: PriceCheckSession, panelHeight?: number) {
  return renderToStaticMarkup(
    <CompactPriceCheckOverlay
      session={session}
      pinned={false}
      hotkey="CommandOrControl+D"
      panelHeight={panelHeight}
      onClose={() => undefined}
      onPinChange={() => undefined}
      onRetry={() => undefined}
      onOpenDashboard={() => undefined}
      availability="available"
      onModifierChange={() => undefined}
      onItemFilterChange={() => undefined}
      onAvailabilityChange={() => undefined}
      onOpenTrade={() => undefined}
    />,
  );
}

function marketRow(overrides: Partial<EconomyRow> = {}): EconomyRow {
  return {
    key: "mageblood-4-flask",
    id: "mageblood-4-flask",
    name: "Mageblood",
    categoryId: "unique-accessories",
    categoryLabel: "Unique Accessories",
    source: "stash-item",
    baseType: "Heavy Belt",
    variant: "4 Flask",
    chaosValue: 1_000,
    divineValue: 5,
    change: 0,
    sparkline: [],
    volume: null,
    listingCount: 42,
    observationCount: 42,
    implicitModifiers: [],
    explicitModifiers: [],
    mutatedModifiers: [],
    lowConfidence: false,
    ...overrides,
  };
}

function marketOnlyUnique() {
  return { ...parsePoeItem(uniqueFixture), modifiers: [] };
}

describe("compact price formatting", () => {
  it("keeps meaningful decimal listing prices", () => {
    expect(shortNumber(10.5)).toBe("10.5");
    expect(shortNumber(10.25)).toBe("10.25");
    expect(shortNumber(10_500)).toBe("10.5k");
  });

  it("still keeps integer and large values compact", () => {
    expect(shortNumber(10)).toBe("10");
    expect(shortNumber(1_250_000)).toBe("1.25m");
    expect(shortNumber(Number.NaN)).toBe("-");
  });
});

describe("compact overlay sizing", () => {
  it("uses Awakened's default desktop width contract", () => {
    expect(COMPACT_PRICE_CHECK_WIDTH).toBe(460);
  });

  it("reveals parsed item identity inside the stable shell while resolving", () => {
    const item = parsePoeItem(armourModifierParityFixture);
    const markup = renderCompact({
      id: "resolving-item",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "resolving",
      item,
      matches: [],
      estimate: null,
      query: null,
      sourceStale: false,
    });

    expect(compactPriceCheckPanelHeight({
      id: "resolving-item",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "resolving",
      item,
      matches: [],
      estimate: null,
      query: null,
      sourceStale: false,
    })).toBe(72);
    expect(markup).toContain("Damnation Pelt");
    expect(markup).toContain("Twilight Regalia");
    expect(markup).toContain("pco-loader");
    expect(markup).not.toContain("CHECKING");
  });

  it("shrinks one result and reserves complete space for eight results", () => {
    const item = marketOnlyUnique();
    const base: PriceCheckSession = {
      id: "sizing",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame"),
      sourceStale: false,
    };
    expect(compactPriceCheckPanelHeight(base)).toBe(226);
    expect(compactPriceCheckPanelHeight({
      ...base,
      matches: [{ row: marketRow(), kind: "exact", score: 1, reasons: [] }],
    })).toBe(226);
    expect(compactPriceCheckPanelHeight({
      ...base,
      matches: Array.from({ length: 20 }, (_value, index) => ({
        row: marketRow({ key: `sizing-${index}`, id: `sizing-${index}` }),
        kind: "variant" as const,
        score: 1,
        reasons: [],
      })),
    })).toBe(226);
    expect(compactPriceCheckPanelHeight({ ...base, status: "resolving" })).toBe(72);
  });

  it("opens every non-hidden stat across representative item families", () => {
    const families = {
      "rare weapon": rareWeaponFixture,
      "rare armour": advancedRareFixture,
      "rare jewellery": influencedStatusFixture,
      unique: uniqueFixture,
      jewel: lethalPrideKaomAdvancedFixture,
      gem: gemFixture,
      map: mapFixture,
      bulk: currencyFixture,
    };

    for (const [family, fixture] of Object.entries(families)) {
      const item = applyTradeStatCatalog(
        parsePoeItem(fixture),
        actualCatalog as TradeStatCatalogPack,
      );
      const query = buildPriceCheckQueryPlan(item, "Allflame");
      const session: PriceCheckSession = {
        id: family,
        capturedAt: Date.now(),
        league: "Allflame",
        status: "ready",
        item,
        matches: [],
        estimate: null,
        query,
        sourceStale: false,
      };
      const markup = renderCompact(session);
      const renderedRows = markup.match(/class="crme-row/g)?.length || 0;
      const visibleRows = query.filters.filter(
        (filter) => !filter.advancedOnly,
      ).length;

      expect(renderedRows, family).toBe(visibleRows);
      expect(compactPriceCheckPanelHeight(session), family).toBeLessThanOrEqual(1_400);
      expect(markup, family).not.toContain("SHOW ");
      expect(markup, family).not.toContain("HIDE ");
      expect(markup, family).not.toContain('aria-label="Match mode for');
      expect(markup, family).not.toContain("CALCULATED PROPERTY");
    }
  });

  it("sizes an ordinary rare map's property and Bulk presets to their real rows", () => {
    const item = applyTradeStatCatalog(
      parsePoeItem(mapFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const session = (mode: "exact" | "bulk"): PriceCheckSession => ({
      id: `map-${mode}`,
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame", { mode }),
      sourceStale: false,
    });
    const propertySession = session("exact");
    const bulkSession = session("bulk");
    const propertyRows = compactPriceCheckModifierRowsHeight(
      item,
      propertySession.query!.filters,
    );
    const bulkRows = compactPriceCheckModifierRowsHeight(
      item,
      bulkSession.query!.filters,
    );

    expect(propertyRows).toBeGreaterThan(0);
    expect(bulkRows).toBe(0);
    expect(compactPriceCheckPanelHeight(propertySession, "exact"))
      .toBeGreaterThan(compactPriceCheckPanelHeight(bulkSession, "bulk"));
  });

  it("keeps normal and unique zero-stat map state inside the truthful Trade editor", () => {
    const parsed = applyTradeStatCatalog(
      parsePoeItem(mapFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const cases = [
      {
        label: "normal",
        mode: "bulk" as const,
        item: {
          ...parsed,
          rarity: "normal" as const,
          name: "Crater Map",
          baseType: "Crater Map",
          quality: undefined,
          corrupted: false,
          modifiers: [],
        },
      },
      {
        label: "unique",
        mode: "exact" as const,
        item: {
          ...parsed,
          rarity: "unique" as const,
          name: "Vaults of Atziri",
          baseType: "Vaal Pyramid Map",
          quality: undefined,
          corrupted: false,
          properties: {},
          modifiers: [],
        },
      },
    ];

    for (const mapCase of cases) {
      const session: PriceCheckSession = {
        id: `zero-stat-${mapCase.label}-map`,
        capturedAt: Date.now(),
        league: "Allflame",
        status: "ready",
        item: mapCase.item,
        matches: [],
        estimate: null,
        query: buildPriceCheckQueryPlan(mapCase.item, "Allflame", {
          mode: mapCase.mode,
        }),
        sourceStale: false,
      };
      const markup = renderCompact(session);

      expect(session.query!.filters, mapCase.label).toEqual([]);
      expect(markup, mapCase.label).toContain("TRADE FILTERS");
      expect(markup, mapCase.label).not.toContain("POE.NINJA");
      expect(markup, mapCase.label).toContain("0 STATS");
      expect(markup, mapCase.label).toContain('aria-label="Item modifier filters"');
      expect(markup, mapCase.label).toContain('aria-label="Item state filters"');
      expect(markup, mapCase.label).toContain(">TIER<");
      expect(markup, mapCase.label).toContain(">NOT CORRUPTED<");
      expect(markup, mapCase.label).not.toContain('class="crme-list"');
      expect(markup, mapCase.label).toContain('aria-label="Refresh market data"');
      expect(markup, mapCase.label).toContain(">TRADE</button>");
      expect(markup, mapCase.label).not.toContain(">LOADING<");
      expect(compactPriceCheckPanelHeight(session, mapCase.mode), mapCase.label)
        .toBeLessThan(720);
    }
  });

  it("renders the recovered Malachai and Golem captures through the current planner", () => {
    const planned = (rawText: string): PriceCheckSession => {
      const item = applyTradeStatCatalog(
        parsePoeItem(rawText),
        actualCatalog as unknown as TradeStatCatalogPack,
      );
      return {
        id: `recovered-${item.name}`,
        capturedAt: Date.now(),
        league: "Allflame",
        status: "ready",
        item,
        matches: [],
        estimate: null,
        query: buildPriceCheckQueryPlan(item, "Allflame"),
        sourceStale: false,
      };
    };
    const malachaiMarkup = renderCompact(planned(malachaisLoopVestigialFixture));
    const golemSession = planned(golemSpellKineticWandFixture);
    const golemMarkup = renderCompact(golemSession);

    expect(malachaiMarkup).toContain("3/8 STATS");
    expect(malachaiMarkup.match(/class="crme-row/g)).toHaveLength(3);
    expect(malachaiMarkup).not.toContain("Lose all Power Charges");
    expect(golemSession.query?.filters).toContainEqual(expect.objectContaining({
      modifierId: "special:empty-or-crafted-modifier",
      enabled: false,
      advancedOnly: true,
    }));
    expect(golemMarkup).toContain("0/10 STATS");
    expect(golemMarkup.match(/class="crme-row/g)).toHaveLength(9);
    expect(golemMarkup).toContain("Attacks per Second: 1.9");
    expect(golemMarkup).toContain("Critical Strike Chance: 11%");
    expect(golemMarkup).toContain("Physical DPS: 756");
    expect(golemMarkup).not.toContain("Weapon Damage");
    expect(golemMarkup).not.toContain("Total DPS");
  });

  it("renders the full Awakened Mageblood stat model without exposing hidden invariants", () => {
    const item = applyTradeStatCatalog(
      parsePoeItem(magebloodAdvancedFixture),
      actualCatalog as unknown as TradeStatCatalogPack,
    );
    const query = buildPriceCheckQueryPlan(item, "Allflame");
    const session: PriceCheckSession = {
      id: "mageblood-advanced",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query,
      sourceStale: false,
    };

    const markup = renderCompact(session);
    expect(query.filters).toHaveLength(7);
    expect(query.filters.filter((filter) => !filter.advancedOnly)).toHaveLength(4);
    expect(query.filters.filter((filter) => filter.enabled)).toHaveLength(1);
    expect(markup).toContain("1/7 STATS");
    expect(markup.match(/class="crme-row/g)).toHaveLength(4);
    expect(markup).toContain("39% total Elemental Resistance");
    expect(markup).toContain("31 total to Strength");
    expect(markup).toContain("31 total to Dexterity");
    expect(markup).toContain(
      "Leftmost 4 Magic Utility Flask constantly applies its Flask Effect to you",
    );
    expect(markup).not.toContain("+20% total to Fire Resistance");
    expect(markup).not.toContain("Magic Utility Flasks cannot be Used");
    expect(markup).not.toContain("Magic Utility Flask Effects cannot be removed");
    expect(markup).not.toContain("(2-4)");
    expect(markup).toContain(">NOT CORRUPTED<");
    expect(markup.match(/type="range"/g)).toHaveLength(8);
    expect(markup.match(/aria-label="Range slider for/g)).toHaveLength(4);
    expect(compactPriceCheckModifierRowsHeight(item, query.filters)).toBe(224);
  });

  it("keeps an eleven-row stress fixture fully open on a short work area", () => {
    const parsed = parsePoeItem(rareWeaponFixture);
    const item = {
      ...parsed,
      rawText: "Item Class: Wands\nRarity: Rare\nGolem Spell\nKinetic Wand",
      itemClass: "Wands",
      name: "Golem Spell",
      baseType: "Kinetic Wand",
      quality: 28,
      itemLevel: 99,
      links: 3,
      sockets: [{ colors: ["B", "B", "B"], links: 3 }],
      properties: {},
      modifiers: [],
    };
    const property = (
      label: string,
      key: "aps" | "crit" | "damage" | "dps" | "pdps",
      copiedValue: number,
    ) => ({
      modifierId: `property:${key}`,
      label,
      copiedValue,
      equipmentProperty: { group: "weapon_filters" as const, key },
      enabled: false,
      mode: "range" as const,
      min: copiedValue * 0.9,
      importance: "optional" as const,
      explanation: "Calculated weapon property",
    });
    const filters = [
      property("Attacks per Second: 1.9", "aps", 1.9),
      property("Critical Strike Chance: 11.05", "crit", 11.05),
      property("Weapon Damage: 398", "damage", 398),
      property("Total DPS: 756.2", "dps", 756.2),
      property("Physical DPS: 756.2", "pdps", 756.2),
      {
        modifierId: "enchant-magnitude",
        tradeId: "enchant.stat_1",
        label: "8% increased Explicit Physical Modifier magnitudes",
        copiedValue: 8,
        enabled: true,
        mode: "range" as const,
        min: 7,
        importance: "key" as const,
        explanation: "Selected enchant",
      },
      {
        modifierId: "cannot-caster",
        tradeId: "explicit.stat_2",
        label: "Cannot roll Caster Modifiers",
        enabled: false,
        mode: "presence" as const,
        importance: "optional" as const,
        explanation: "Presence stat",
      },
      ...[
        "+196 to Accuracy Rating",
        "+27 to Strength",
        "+27 to Intelligence",
      ].map((label, index) => ({
        modifierId: `optional-${index}`,
        tradeId: `explicit.stat_${index + 3}`,
        label,
        copiedValue: [196, 27, 27][index],
        enabled: false,
        mode: "range" as const,
        min: 1,
        importance: "optional" as const,
        explanation: "Optional copied stat",
      })),
      {
        modifierId: "critical-multiplier",
        tradeId: "explicit.stat_9",
        label: "+28% to Global Critical Strike Multiplier",
        copiedValue: 28,
        enabled: true,
        mode: "range" as const,
        min: 25,
        importance: "key" as const,
        explanation: "Selected copied stat",
      },
      {
        modifierId: "advanced-only",
        tradeId: "explicit.stat_10",
        label: "Advanced-only crafting filter",
        enabled: true,
        mode: "presence" as const,
        advancedOnly: true,
        importance: "optional" as const,
        explanation: "Detailed editor only",
      },
    ];
    const session: PriceCheckSession = {
      id: "golem-spell",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query: {
        identity: "base",
        identityState: {
          exact: { label: "Golem Spell", query: { type: "Golem Spell" } },
          relaxed: {
            label: "Wand",
            query: { category: "weapon.wand" },
            disabled: false,
          },
          active: "base",
        },
        league: "Allflame",
        status: "available",
        rollTolerance: 10,
        filters,
        itemFilters: { links: 3, corrupted: false },
        tradeQuery: {},
        tradeUrl: "https://www.pathofexile.com/trade/search/Allflame?q={}",
        warnings: [],
        tradeApi: "trade",
      },
      sourceStale: false,
    };
    const markup = renderCompact(session);

    expect(markup).toContain("3/12 STATS");
    expect(markup).not.toContain("SHOW ");
    expect(markup).not.toContain("HIDE ");
    expect(markup.match(/class="crme-row/g)).toHaveLength(11);
    expect(markup).toContain("8% increased Explicit Physical Modifier magnitudes");
    expect(markup).toContain("+28% to Global Critical Strike Multiplier");
    expect(markup).toContain("Attacks per Second: 1.9");
    expect(markup).not.toContain("Advanced-only crafting filter");
    expect(markup).not.toContain('aria-label="Match mode for');
    expect(markup).not.toContain("CALCULATED PROPERTY");
    expect(compactPriceCheckPanelHeight(session)).toBe(
      281 + compactPriceCheckModifierRowsHeight(item, filters),
    );

    const constrainedMarkup = renderCompact(session, 752);
    expect(constrainedMarkup.match(/class="crme-row/g)).toHaveLength(11);
    expect(compactPriceCheckUsesConstrainedModifierRows(session, 752)).toBe(true);
    expect(compactPriceCheckUsesConstrainedModifierRows(session, 1_064)).toBe(false);
    expect(constrainedMarkup).not.toContain('aria-label="Range slider for');
    expect(constrainedMarkup).toContain(
      'aria-label="Minimum value for Attacks per Second: 1.9"',
    );
  });
});

describe("compact empty market state", () => {
  it("renders the projected armour and pseudo minima used by official Trade", () => {
    const item = applyTradeStatCatalog(
      parsePoeItem(armourModifierParityFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const session: PriceCheckSession = {
      id: "armour-parity",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame"),
      sourceStale: false,
    };

    const markup = renderCompact(session);
    expect(session.query?.filters).toHaveLength(9);
    expect(markup).toContain("2/9 STATS");
    expect(markup).toMatch(
      /aria-label="Minimum value for Energy Shield: 753"[^>]*value="677"/,
    );
    expect(markup).not.toContain(
      'aria-label="Minimum slider for Energy Shield: 753"',
    );
    expect(markup).toMatch(
      /aria-label="Minimum value for 41% total Elemental Resistance"[^>]*value="41"/,
    );
    expect(markup).not.toContain("100(81-100)% increased Energy Shield");
    expect(markup).not.toContain("UNMAPPED");
  });

  it("uses the compact editable stat surface for rares instead of base-price rows", () => {
    const parsed = parsePoeItem(advancedRareFixture);
    const item = {
      ...parsed,
      modifiers: parsed.modifiers.map((modifier, index) => ({
        ...modifier,
        tradeId: `explicit.stat_${1000 + index}`,
      })),
    };
    const session: PriceCheckSession = {
      id: "rare-editor",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [{ row: marketRow({ name: "Vaal Regalia", baseType: "Vaal Regalia" }), kind: "base", score: 1, reasons: [] }],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame", { identity: "exact" }),
      sourceStale: false,
    };

    const markup = renderCompact(session);
    expect(markup).toContain("data-overlay-drag-handle");
    const filterHeight = compactPriceCheckModifierRowsHeight(
      item,
      session.query!.filters,
    );
    expect(compactPriceCheckPanelHeight(session)).toBe(272 + filterHeight);
    expect(markup).toContain('data-rows="2"');
    expect(markup).toContain("TRADE FILTERS");
    expect(markup).toContain('aria-label="Refresh market data"');
    expect(markup).toContain('aria-label="Item modifier filters"');
    expect(markup).toContain('aria-label="Include Energy Shield: 812"');
    expect(markup).not.toContain("CALCULATED PROPERTY");
    expect(markup).toMatch(/aria-label="\d+ official Trade filters selected"/);
    expect(markup).not.toContain("UNMAPPED");
    expect(markup).not.toContain('aria-label="Minimum slider for Energy Shield: 812"');
    expect(markup).not.toContain("+20(18-20)% increased Energy Shield");
    expect(markup).toContain(">ILVL<");
    expect(markup).toContain(">LINKS<");
    expect(markup).toContain(">HUNTER<");
    expect(markup).not.toContain(">FRACTURED<");
    expect(markup).toContain(">NOT CORRUPTED<");
    expect(markup).toContain(">AVAILABLE<");
    expect(markup).toContain("STATS");
    expect(markup).not.toContain('aria-label="Match mode for');
    expect(markup).not.toContain("CALCULATED PROPERTY");
    expect(markup).toContain('aria-label="Live Trade prices"');
    expect(markup).toContain("NO LIVE LISTINGS");
    expect(markup).not.toContain("5 DIVINE");
  });

  it("shows refreshed seller prices below selected rare modifiers", () => {
    const parsed = parsePoeItem(advancedRareFixture);
    const item = {
      ...parsed,
      modifiers: parsed.modifiers.map((modifier, index) => ({
        ...modifier,
        tradeId: `explicit.stat_${1000 + index}`,
      })),
    };
    const session: PriceCheckSession = {
      id: "rare-live-prices",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame", { identity: "exact" }),
      sourceStale: false,
      tradePriceSnapshot: {
        listings: [
          {
            id: "listing-1",
            amount: 8,
            currency: "divine",
            seller: "WandSeller",
            indexed: new Date().toISOString(),
            itemName: "Golem Spell",
          },
          {
            id: "listing-2",
            amount: 1_250,
            currency: "chaos",
            seller: "ChaosSeller",
            indexed: new Date().toISOString(),
            itemName: "Golem Spell",
          },
        ],
        total: 34,
        searchId: "search-1",
        fetchedAt: Date.now(),
        cached: false,
      },
    };

    const markup = renderCompact(session);
    expect(markup).toContain('aria-label="Item modifier filters"');
    expect(markup).toContain('aria-label="Live Trade prices"');
    expect(markup).toContain("8 DIVINE");
    expect(markup).toContain("1.25k CHAOS");
    expect(markup).toContain("WandSeller");
    expect(markup).toContain("ChaosSeller");

    const cooldownMarkup = renderCompact({
      ...session,
      tradePriceSnapshot: {
        listings: [],
        total: 0,
        searchId: "",
        fetchedAt: Date.now(),
        cached: false,
        error: "Official Trade cooldown active. Retry in 10s.",
      },
    });
    expect(cooldownMarkup).toContain("TRADE COOLDOWN · 10S");

    const loadingMarkup = renderCompact({
      ...session,
      tradePriceSnapshot: undefined,
      tradePriceLoading: true,
    });
    expect(loadingMarkup).toContain("CHECKING 1 SELECTED STAT");

    const timeoutMarkup = renderCompact({
      ...session,
      tradePriceSnapshot: {
        listings: [],
        total: 0,
        searchId: "",
        fetchedAt: Date.now(),
        cached: false,
        error: "Official Trade price request timed out.",
      },
    });
    expect(timeoutMarkup).toContain("TRADE TIMED OUT · RETRY");
  });

  it("uses the trade-first editor for a unique state filter while hiding invariant fixed rolls", () => {
    const parsed = parsePoeItem(uniqueFixture);
    const item = {
      ...parsed,
      modifiers: parsed.modifiers.map((modifier, index) => ({
        ...modifier,
        tradeId: `explicit.stat_${2000 + index}`,
      })),
    };
    const session: PriceCheckSession = {
      id: "unique-editor",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [{ row: marketRow(), kind: "exact", score: 1, reasons: [] }],
      estimate: {
        chaosValue: 1_000,
        divineValue: 5,
        lowChaos: 900,
        highChaos: 1_100,
        confidence: "high",
        confidenceScore: 95,
        label: "market estimate",
        reasons: [],
        warnings: [],
        evidence: [],
      },
      query: buildPriceCheckQueryPlan(item, "Allflame"),
      sourceFetchedAt: Date.now(),
      sourceStale: false,
    };

    const markup = renderCompact(session);
    const filterHeight = compactPriceCheckModifierRowsHeight(
      item,
      session.query!.filters,
    );
    expect(filterHeight).toBe(0);
    expect(compactPriceCheckPanelHeight(session)).toBe(226);
    expect(markup).toContain("TRADE FILTERS");
    expect(markup).toContain('aria-label="Refresh market data"');
    expect(markup).not.toContain("5 DIVINE");
    expect(markup).toContain('aria-label="Item modifier filters"');
    expect(markup).toContain("0 STATS");
    expect(markup).not.toContain('class="crme-heading"');
    expect(markup).not.toContain('class="crme-list"');
    expect(markup).not.toContain("+39 to Dexterity");
    expect(markup).not.toContain("Magic Utility Flasks cannot be Used");
    expect(markup).not.toContain("SHOW");
    expect(markup).not.toContain(">LOADING<");
    expect(markup).toContain(">AVAILABLE<");
    expect(markup).not.toContain('class="pco-row"');
  });

  it("keeps market refresh separate from the official Trade handoff", () => {
    const item = marketOnlyUnique();
    const session: PriceCheckSession = {
      id: "unique-dirty-query",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame", { mode: "similar" }),
      sourceStale: false,
    };

    const markup = renderCompact(session);
    expect(markup).toContain('aria-label="Refresh market data"');
    expect(markup).toContain(">TRADE</button>");
    expect(markup).not.toContain("SEARCH");
  });

  it("does not offer clipboard refresh after an invalid native capture", () => {
    const session: PriceCheckSession = {
      id: "invalid",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "invalid",
      item: null,
      matches: [],
      estimate: null,
      query: null,
      sourceStale: false,
    };

    const markup = renderCompact(session);
    expect(markup).toContain("NO ITEM");
    expect(markup).not.toContain('aria-label="Refresh market data"');
    expect(markup).toContain('aria-label="Close price check"');
  });

  it("shows a finished no-match state and readable item badges", () => {
    const item = {
      ...marketOnlyUnique(),
      corrupted: true,
      foulborn: true,
      links: 6,
    };
    const session: PriceCheckSession = {
      id: "test",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame"),
      sourceStale: false,
    };
    const markup = renderCompact(session);

    expect(markup).toContain("TRADE FILTERS");
    expect(markup).not.toContain("NO PRICE");
    expect(markup).not.toContain("is-loading");
    expect(markup).toContain(">CORRUPTED<");
    expect(markup).toContain(">FOULBORN<");
    expect(markup).toContain(">6 LINKS<");
    expect(markup).toContain(">DETAILS<");
    expect(markup).toContain(">TRADE<");
    expect(markup).toContain('aria-label="Refresh market data"');
    expect(markup).toContain('aria-label="Pin overlay"');
    expect(markup).toContain('aria-label="Close price check"');
    expect(markup).not.toContain("·");
  });

  it("never renders numeric market rows from a stale source", () => {
    const item = marketOnlyUnique();
    const session: PriceCheckSession = {
      id: "stale",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [{ row: marketRow(), kind: "exact", score: 1, reasons: [] }],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame"),
      sourceFetchedAt: Date.now() - 3 * 60 * 60 * 1_000,
      sourceStale: true,
    };

    const markup = renderCompact(session);

    expect(markup).toContain("TRADE FILTERS");
    expect(markup).not.toContain("POE.NINJA STALE");
    expect(markup).not.toContain(">STALE<");
    expect(markup).not.toContain("5 DIVINE");
    expect(markup).not.toContain("4 Flask");
  });

  it("shows pricing-critical gem and map facts in readable words", () => {
    const item = {
      ...parsePoeItem(uniqueFixture),
      rarity: "gem" as const,
      gemLevel: 21,
      quality: 23,
      mapTier: 17,
    };
    const session: PriceCheckSession = {
      id: "facts",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [{ row: marketRow(), kind: "exact", score: 1, reasons: [] }],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame"),
      sourceStale: false,
    };

    const markup = renderCompact(session);
    expect(markup).toContain(">LVL 21<");
    expect(markup).toContain(">Q 23%<");
    expect(markup).toContain(">TIER 17<");
  });

  it("bounds visible facts by pricing priority without losing full state text", () => {
    const item = {
      ...parsePoeItem(uniqueFixture),
      quality: 30,
      itemLevel: 100,
      links: 6,
      corrupted: true,
      foulborn: true,
    };
    const session: PriceCheckSession = {
      id: "dense-facts",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches: [{ row: marketRow(), kind: "exact", score: 100, reasons: [] }],
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame"),
      sourceStale: false,
    };

    const markup = renderCompact(session);
    const facts = markup.match(/<div class="pco-facts"[^>]*>(.*?)<\/div>/)?.[1] || "";
    expect(facts.match(/<b /g)).toHaveLength(3);
    expect(facts).toContain(">FOULBORN<");
    expect(facts).toContain(">CORRUPTED<");
    expect(facts).toContain(">6 LINKS<");
    expect(facts).not.toContain(">ILVL 100<");
    expect(facts).not.toContain(">Q 30%<");
    expect(markup).toContain('data-total-facts="5"');
    expect(markup).toContain(
      'aria-label="Foulborn, Corrupted, 6 linked sockets, Item level 100, Quality 30%"',
    );
  });

  it("keeps the direct-match fallback bounded behind the Trade filter editor", () => {
    const item = marketOnlyUnique();
    const matches = Array.from({ length: 10 }, (_value, index) => ({
      row: marketRow({
        key: `mageblood-${index}`,
        id: `mageblood-${index}`,
        variant: `${index + 1} Flask`,
      }),
      kind: "variant" as const,
      score: 1,
      reasons: [],
    }));
    const session: PriceCheckSession = {
      id: "many",
      capturedAt: Date.now(),
      league: "Allflame",
      status: "ready",
      item,
      matches,
      estimate: null,
      query: buildPriceCheckQueryPlan(item, "Allflame"),
      sourceStale: false,
    };

    const markup = renderCompact(session);
    expect(markup).not.toContain('class="pco-row"');
    expect(markup).toContain('aria-label="Item modifier filters"');
    expect(markup).toContain('aria-label="Refresh market data"');
  });
});
