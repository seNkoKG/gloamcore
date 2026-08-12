import { describe, expect, it } from "vitest";
import {
  buildOfficialTradeBrowserUrl,
  buildOfficialTradeExchangeQuery,
  defaultOfficialTradeStatusFromPinnedItem,
  officialTradeApiToSatisfySearch,
} from "./official-trade-route";

const item = (name: string, baseType = name) => ({ name, baseType });

describe("Awakened official Trade route parity", () => {
  it("embeds an ordinary query in the official browser URL", () => {
    const url = new URL(buildOfficialTradeBrowserUrl({
      league: "Curse of the Allflame",
      tradeQuery: { query: { name: "Ghoul Mantle" } },
    }));
    expect(url.pathname).toBe("/trade/search/Curse%20of%20the%20Allflame");
    expect(JSON.parse(url.searchParams.get("q") || "null")).toEqual({
      query: { name: "Ghoul Mantle" },
    });
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

  it("keeps the complete Exchange query without mutating it", () => {
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
    expect(tradeQuery.query.have).toEqual(["divine", "chaos"]);
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
