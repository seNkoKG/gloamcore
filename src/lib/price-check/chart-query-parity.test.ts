import { describe, expect, it } from "vitest";
import { dashboardSnapshotFromSession, filtersFromDashboardSnapshot } from "./dashboard-handoff";
import { chartFixture, unidentifiedChartFixture } from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import { buildPriceCheckQueryPlan } from "./query-plan";
import type { PriceCheckSession } from "./types";

function browserPayload(tradeUrl: string) {
  const encoded = new URL(tradeUrl).searchParams.get("q");
  return encoded ? JSON.parse(encoded) : null;
}

describe("Awakened Chart query parity", () => {
  it("serializes identified Rare Pseudo properties in APT order and tolerance", () => {
    const item = parsePoeItem(chartFixture.replace(
      "Item Quantity: +64% (augmented)",
      "Item Quantity: +64% (augmented)\nItem Rarity: +30% (augmented)\nMonster Pack Size: +20% (augmented)",
    ));
    const plan = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    });
    const query = plan.tradeQuery.query as any;

    expect(plan.filters.map((filter) => filter.modifierId)).toEqual([
      "chart:quantity",
      "chart:rarity",
      "chart:pack-size",
      "chart:sulphur",
    ]);
    expect(plan.filters.every((filter) => filter.enabled)).toBe(true);
    expect(query.type).toEqual({
      discriminator: "chart",
      option: "UnderseaGroves",
    });
    expect(query.filters.type_filters?.filters?.category).toBeUndefined();
    expect(query.filters.map_filters.filters).toMatchObject({
      area_level: { min: 69 },
      map_iiq: { min: 57 },
      map_iir: { min: 27 },
      map_packsize: { min: 18 },
      chart_sulphur: { min: 54 },
    });
    expect(query.stats[0].filters).toEqual([]);
    expect(plan.tradeApi).toBe("trade");
    expect(new URL(plan.tradeUrl).pathname).toBe("/trade/search/Allflame");
    expect(browserPayload(plan.tradeUrl)).toEqual(plan.tradeQuery);
  });

  it("keeps Bulk on the same Chart identity and area while omitting Pseudo rows", () => {
    for (const item of [
      parsePoeItem(chartFixture),
      parsePoeItem(unidentifiedChartFixture),
    ]) {
      const plan = buildPriceCheckQueryPlan(item, "Allflame", {
        mode: "bulk",
        rollTolerance: 10,
      });
      const query = plan.tradeQuery.query as any;

      expect(plan.filters).toEqual([]);
      expect(query.type).toEqual({
        discriminator: "chart",
        option: "UnderseaGroves",
      });
      expect(query.filters.type_filters?.filters?.category).toBeUndefined();
      expect(query.filters.map_filters.filters.area_level).toEqual({
        min: item.areaLevel,
      });
      expect(query.filters.map_filters.filters).not.toHaveProperty("map_iiq");
      expect(query.filters.map_filters.filters).not.toHaveProperty("chart_sulphur");
      expect(query.stats[0].filters).toEqual([]);
    }
  });

  it("round-trips Chart Pseudo edits and area state through dashboard handoff", () => {
    const item = parsePoeItem(chartFixture);
    const query = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    });
    const session: PriceCheckSession = {
      id: "chart-handoff",
      captureId: 7,
      capturedAt: 42,
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query,
      sourceStale: false,
    };
    const snapshot = dashboardSnapshotFromSession(session, "exact")!;
    const restored = filtersFromDashboardSnapshot(item, snapshot);
    const rebuilt = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "exact",
      rollTolerance: snapshot.rollTolerance,
      status: snapshot.status,
      filters: restored,
      itemFilters: snapshot.itemFilters,
    });

    expect(snapshot.itemFilters).toMatchObject({
      areaLevel: 69,
      tradeCurrency: "chaos_divine",
    });
    expect(snapshot.filters.map((filter) => filter.modifierId)).toEqual([
      "chart:quantity",
      "chart:sulphur",
    ]);
    expect(rebuilt.tradeQuery).toEqual(query.tradeQuery);
  });
});
