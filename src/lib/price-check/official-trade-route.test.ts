import { describe, expect, it } from "vitest";
import {
  buildOfficialTradeBrowserUrl,
  buildOfficialTradeExchangeQuery,
  defaultOfficialTradeStatusFromPinnedItem,
  officialTradeApiToSatisfySearch,
} from "./official-trade-route";

const item = (name: string, baseType = name) => ({ name, baseType });

describe("Awakened official Trade route parity", () => {
  it("opens an ordinary search by the server-issued id", () => {
    expect(buildOfficialTradeBrowserUrl({
      league: "Curse of the Allflame",
      tradeQuery: { query: { name: "Ghoul Mantle" } },
      searchId: "AbC_123-xYz",
    })).toBe(
      "https://www.pathofexile.com/trade/search/Curse%20of%20the%20Allflame/AbC_123-xYz",
    );
  });

  it("uses Awakened's Exchange browser payload instead of the API body", () => {
    const url = new URL(buildOfficialTradeBrowserUrl({
      league: "Allflame",
      api: "exchange",
      tradeQuery: {
        engine: "new",
        query: { status: { option: "online" }, have: ["chaos"], want: ["divine"] },
        sort: { have: "asc" },
      },
      searchId: "ignored-for-exchange",
    }));
    expect(url.pathname).toBe("/trade/exchange/Allflame");
    expect(JSON.parse(url.searchParams.get("q") || "null")).toEqual({
      exchange: {
        status: { option: "online" },
        have: ["chaos"],
        want: ["divine"],
      },
    });
  });

  it.each(["divine", "chaos"])(
    "opens only the selected %s Exchange market without mutating the API query",
    (selectedExchangeHave) => {
      const tradeQuery = {
        engine: "new",
        query: {
          status: { option: "online" },
          have: ["divine", "chaos"],
          want: ["aberrant-fossil"],
        },
        sort: { have: "asc" },
      };
      const original = structuredClone(tradeQuery);
      const url = new URL(buildOfficialTradeBrowserUrl({
        league: "Allflame",
        api: "exchange",
        tradeQuery,
        selectedExchangeHave,
      }));

      expect(JSON.parse(url.searchParams.get("q") || "null")).toEqual({
        exchange: {
          status: { option: "online" },
          have: [selectedExchangeHave],
          want: ["aberrant-fossil"],
        },
      });
      expect(tradeQuery).toEqual(original);
    },
  );

  it("keeps the optimistic Exchange query when no selected listing exists", () => {
    const tradeQuery = {
      engine: "new",
      query: {
        status: { option: "online" },
        have: ["divine", "chaos"],
        want: ["aberrant-fossil"],
      },
      sort: { have: "asc" },
    };
    const url = new URL(buildOfficialTradeBrowserUrl({
      league: "Allflame",
      api: "exchange",
      tradeQuery,
    }));

    expect(JSON.parse(url.searchParams.get("q") || "null")).toEqual({
      exchange: tradeQuery.query,
    });
  });

  it("rejects an unsafe search id and falls back to a prefilled query", () => {
    const url = new URL(buildOfficialTradeBrowserUrl({
      league: "Allflame",
      tradeQuery: { query: { type: "Heavy Belt" } },
      searchId: "../../bad",
    }));
    expect(url.pathname).toBe("/trade/search/Allflame");
    expect(JSON.parse(url.searchParams.get("q") || "null")).toEqual({
      query: { type: "Heavy Belt" },
    });
  });

  it("never discards a long edited query when no server search id exists", () => {
    const tradeQuery = {
      query: {
        stats: [{
          type: "and",
          filters: Array.from({ length: 96 }, (_, index) => ({
            id: `explicit.stat_${String(index).padStart(3, "0")}_${"x".repeat(80)}`,
            value: { min: index, max: index + 1 },
          })),
        }],
      },
      sort: { price: "asc" },
    };
    const url = buildOfficialTradeBrowserUrl({
      league: "Allflame",
      tradeQuery,
    });

    expect(url.length).toBeGreaterThan(8_192);
    expect(JSON.parse(new URL(url).searchParams.get("q") || "null"))
      .toEqual(tradeQuery);
  });

  it("uses bulk only when every stat is disabled and a pinned trade tag exists", () => {
    expect(officialTradeApiToSatisfySearch(item("Divine Orb"), [])).toBe("exchange");
    expect(officialTradeApiToSatisfySearch(
      item("Divine Orb"),
      [{ enabled: true }],
    )).toBe("trade");
    expect(officialTradeApiToSatisfySearch(item("A Chilling Wind"), [])).toBe("trade");
  });

  it("uses available only for exchangeable items missing a legacy bulk tag", () => {
    expect(defaultOfficialTradeStatusFromPinnedItem(item("Divine Orb"))).toBe("securable");
    expect(defaultOfficialTradeStatusFromPinnedItem(item("A Chilling Wind"))).toBe("available");
    expect(defaultOfficialTradeStatusFromPinnedItem(item("Heavy Belt"))).toBe("securable");
    expect(defaultOfficialTradeStatusFromPinnedItem(item("Heavy Belt"), false)).toBe("any");
  });

  it("builds Awakened's fixed legacy bulk request shape", () => {
    expect(buildOfficialTradeExchangeQuery(
      { ...item("Aberrant Fossil"), stackSize: 3 },
      "securable",
    )).toEqual({
      engine: "new",
      query: {
        status: { option: "online" },
        have: ["divine", "chaos"],
        want: ["aberrant-fossil"],
      },
      sort: { have: "asc" },
    });
    expect(buildOfficialTradeExchangeQuery(
      { ...item("Chaos Orb"), stackSize: 1 },
      "any",
      10,
    )?.query).toMatchObject({
      status: { option: "any" },
      have: ["divine"],
      want: ["chaos"],
      minimum: 10,
    });
  });
});
