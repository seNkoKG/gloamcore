import { describe, expect, it } from "vitest";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  advancedRareFixture,
  lethalPrideKaomAdvancedFixture,
  megalomaniacFixture,
} from "./fixtures/parser-fixtures";
import {
  dashboardSnapshotForCapture,
  dashboardSnapshotFromSession,
  filtersFromDashboardSnapshot,
  handoffLeague,
  onlineOnlyAfterSettings,
  plannedRangeModePatch,
  sameCaptureDelivery,
} from "./dashboard-handoff";
import { parsePoeItem } from "./parser";
import {
  buildPriceCheckQueryPlan,
  planModifierFilters,
  planPriceCheckFilters,
} from "./query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import type {
  ClipboardItemCapture,
  PriceCheckDashboardSnapshot,
  PriceCheckSession,
} from "./types";

function snapshot(
  patch: Partial<PriceCheckDashboardSnapshot> = {},
): PriceCheckDashboardSnapshot {
  return {
    captureId: 7,
    capturedAt: 42,
    league: "Keepers",
    mode: "similar",
    identity: "exact",
    status: "online",
    rollTolerance: 10,
    filters: [],
    itemFilters: {},
    ...patch,
  };
}

describe("price-check dashboard query handoff", () => {
  it("accepts a snapshot only for its exact raw capture", () => {
    const current = snapshot({ handoffId: 3 });
    const capture: ClipboardItemCapture = {
      text: advancedRareFixture,
      capturedAt: 42,
      captureId: 7,
      validPrefix: true,
      dashboardSnapshot: current,
    };

    expect(dashboardSnapshotForCapture(capture)).toBe(current);
    expect(dashboardSnapshotForCapture(capture, true)).toBeNull();
    expect(
      dashboardSnapshotForCapture({
        ...capture,
        captureId: 8,
      }),
    ).toBeNull();
    expect(
      dashboardSnapshotForCapture({
        ...capture,
        capturedAt: 43,
      }),
    ).toBeNull();
  });

  it("distinguishes a new edit handoff from duplicate event/pending delivery", () => {
    const original: ClipboardItemCapture = {
      text: advancedRareFixture,
      capturedAt: 42,
      captureId: 7,
      validPrefix: true,
      dashboardSnapshot: snapshot({ handoffId: 3 }),
    };

    expect(sameCaptureDelivery(original, { ...original })).toBe(true);
    expect(
      sameCaptureDelivery(original, {
        ...original,
        dashboardSnapshot: snapshot({ handoffId: 4 }),
      }),
    ).toBe(false);
    expect(
      sameCaptureDelivery(
        {
          ...original,
          dashboardSnapshot: snapshot({ handoffId: 4 }),
        },
        original,
      ),
    ).toBe(true);
    expect(
      sameCaptureDelivery(
        {
          ...original,
          dashboardSnapshot: snapshot({ handoffId: 4 }),
        },
        { ...original, dashboardSnapshot: undefined },
      ),
    ).toBe(true);
  });

  it("rebuilds trusted modifier metadata and reapplies only user controls", () => {
    const item = parsePoeItem(advancedRareFixture);
    const planned = planPriceCheckFilters(item, 10);
    const editableModifiers = planned.filter(
      (filter) => !filter.equipmentProperty,
    );
    expect(editableModifiers.length).toBeGreaterThan(1);
    const first = editableModifiers[0];
    const second = editableModifiers[1];
    const trustedIds = new Set(planned.map((filter) => filter.modifierId));
    const consumedLocalDefence = planModifierFilters(item, 10).find(
      (filter) => !trustedIds.has(filter.modifierId),
    );
    expect(consumedLocalDefence).toBeDefined();
    const restored = filtersFromDashboardSnapshot(
      item,
      snapshot({
        filters: [
          {
            modifierId: first.modifierId,
            enabled: true,
            mode: "range",
            min: 19.25,
            max: 20,
          },
          {
            modifierId: second.modifierId,
            enabled: false,
            mode: "presence",
            min: 999,
            max: 999,
          },
          {
            modifierId: consumedLocalDefence!.modifierId,
            enabled: true,
            mode: "exact",
            min: 999,
            max: 999,
          },
        ],
      }),
    );

    const restoredFirst = restored.find(
      (filter) => filter.modifierId === first.modifierId,
    );
    const restoredSecond = restored.find(
      (filter) => filter.modifierId === second.modifierId,
    );
    expect(restoredFirst).toMatchObject({
      modifierId: first.modifierId,
      tradeId: first.tradeId,
      explanation: first.explanation,
      enabled: true,
      mode: "range",
      min: 19.25,
      max: 20,
    });
    expect(restoredSecond).toMatchObject({
      modifierId: second.modifierId,
      enabled: false,
      mode: "presence",
    });
    expect(restoredSecond).not.toHaveProperty("min");
    expect(restoredSecond).not.toHaveProperty("max");
    expect(restored.some(
      (filter) => filter.modifierId === consumedLocalDefence!.modifierId,
    )).toBe(false);
  });

  it("rehydrates only the filters belonging to the selected exact-style preset", () => {
    const item = parsePoeItem(advancedRareFixture);
    const expected = buildPriceCheckQueryPlan(item, "Keepers", {
      mode: "base",
      rollTolerance: 10,
      status: "available",
    });
    const restored = filtersFromDashboardSnapshot(
      item,
      snapshot({
        mode: "base",
        status: "available",
        filters: expected.filters.map((filter) => ({
          modifierId: filter.modifierId,
          enabled: filter.enabled,
          mode: filter.mode,
          min: filter.min,
          max: filter.max,
        })),
      }),
    );
    const rebuilt = buildPriceCheckQueryPlan(item, "Keepers", {
      mode: "base",
      rollTolerance: 10,
      status: "available",
      filters: restored,
    });

    expect(restored.map((filter) => filter.modifierId)).toEqual(
      expected.filters.map((filter) => filter.modifierId),
    );
    expect(rebuilt.tradeQuery).toEqual(expected.tradeQuery);
  });

  it("round-trips the exact 12476 Timeless seed and ignores stale split-row edits", () => {
    const item = applyTradeStatCatalog(
      parsePoeItem(lethalPrideKaomAdvancedFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const seed = item.modifiers.find((modifier) =>
      modifier.tags.includes("seed"),
    )!;
    const query = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "similar",
    });
    const session: PriceCheckSession = {
      id: "timeless-dashboard-handoff",
      capturedAt: 42,
      captureId: 7,
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query,
      sourceStale: false,
    };
    const outbound = dashboardSnapshotFromSession(session, "similar")!;
    const outboundSeed = outbound.filters.find(
      (filter) => filter.modifierId === seed.id,
    );
    expect(outboundSeed).toEqual({
      modifierId: seed.id,
      enabled: true,
      mode: "exact",
      min: 12476,
      max: 12476,
    });

    const restored = filtersFromDashboardSnapshot(item, outbound);
    expect(restored.find((filter) => filter.modifierId === seed.id))
      .toMatchObject({
        tradeId: "explicit.pseudo_timeless_jewel_kaom",
        enabled: true,
        mode: "exact",
        min: 12476,
        max: 12476,
      });
    const rebuilt = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "similar",
      filters: restored,
    });
    expect((rebuilt.tradeQuery as any).query.stats[0].filters).toContainEqual({
      id: "explicit.pseudo_timeless_jewel_kaom",
      value: { min: 12476, max: 12476 },
    });

    const stale = filtersFromDashboardSnapshot(item, {
      ...outbound,
      filters: [{
        modifierId: "old-unmapped-seed-row",
        enabled: false,
        mode: "presence",
      }],
    });
    expect(stale.find((filter) => filter.modifierId === seed.id))
      .toMatchObject({
        enabled: true,
        mode: "exact",
        min: 12476,
        max: 12476,
      });
  });

  it("removes fabricated numeric state from value-less notable handoffs", () => {
    const item = applyTradeStatCatalog(
      parsePoeItem(megalomaniacFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const modifier = item.modifiers.find((candidate) =>
      /Blanketed Snow/i.test(candidate.text),
    )!;
    const planned = planModifierFilters(item, 10).find(
      (filter) => filter.modifierId === modifier.id,
    )!;
    const restored = filtersFromDashboardSnapshot(
      item,
      snapshot({
        filters: [{
          modifierId: modifier.id,
          enabled: true,
          mode: "exact",
          min: 999,
          max: 999,
        }],
      }),
    ).find((filter) => filter.modifierId === modifier.id)!;

    expect(restored).toMatchObject({
      tradeId: planned.tradeId,
      enabled: true,
      mode: "presence",
    });
    expect(restored).not.toHaveProperty("min");
    expect(restored).not.toHaveProperty("max");

    const query = buildPriceCheckQueryPlan(item, "Keepers");
    query.filters = [{ ...planned, mode: "range", min: 998, max: 999 }];
    const outbound = dashboardSnapshotFromSession({
      id: "adversarial-notable",
      capturedAt: 42,
      captureId: 7,
      league: "Keepers",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query,
      sourceStale: false,
    }, "similar");
    expect(outbound?.filters[0]).toEqual({
      modifierId: modifier.id,
      enabled: planned.enabled,
      mode: "presence",
    });
  });

  it("serializes no raw text, trade query, or trusted stat metadata", () => {
    const item = parsePoeItem(advancedRareFixture);
    const filters = planModifierFilters(item, 10).map((filter, index) => ({
      ...filter,
      enabled: index === 0,
    }));
    const query = buildPriceCheckQueryPlan(item, "Keepers", {
      status: "any",
      filters,
      itemFilters: { itemLevel: 85, corrupted: false },
    });
    const session: PriceCheckSession = {
      id: "ready",
      capturedAt: 42,
      captureId: 7,
      league: "Keepers",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query,
      sourceStale: false,
    };

    const value = dashboardSnapshotFromSession(session, "similar");
    expect(value).toMatchObject({
      captureId: 7,
      capturedAt: 42,
      league: "Keepers",
      status: "any",
      itemFilters: { itemLevel: 85, corrupted: false },
    });
    expect(value?.filters[0]).toEqual({
      modifierId: query.filters[0].modifierId,
      enabled: query.filters[0].enabled,
      mode: query.filters[0].mode,
      min: query.filters[0].min,
      max: query.filters[0].max,
    });
    expect(value).not.toHaveProperty("rawText");
    expect(value).not.toHaveProperty("tradeQuery");
    expect(value?.filters[0]).not.toHaveProperty("tradeId");
    expect(value?.filters[0]).not.toHaveProperty("explanation");

    expect(handoffLeague(null, session)).toBe("Keepers");
    expect(handoffLeague(snapshot({ league: "Settlers" }), session)).toBe(
      "Settlers",
    );
    expect(onlineOnlyAfterSettings(true, session)).toBe(false);

    expect(
      dashboardSnapshotFromSession(session, "similar", {
        captureId: 7,
        capturedAt: 21,
      })?.capturedAt,
    ).toBe(21);
  });

  it("uses planned unique roll spans and keeps known slider bounds", () => {
    const parsed = parsePoeItem(advancedRareFixture);
    const target = parsed.modifiers.find((modifier) =>
      /Chaos Resistance/i.test(modifier.text)
    )!;
    const unique = {
      ...parsed,
      rarity: "unique" as const,
      modifiers: parsed.modifiers.map((modifier) =>
        modifier.id === target.id
          ? { ...modifier, tradeDirection: 1 as const }
          : modifier,
      ),
    };
    const patch = plannedRangeModePatch(
      unique,
      10,
      target.id,
      { min: 1, max: 999 },
    );

    expect(patch).toEqual({
      mode: "range",
      min: 35,
      max: undefined,
      bounds: { min: 31, max: 35 },
    });
  });
});
