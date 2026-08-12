import { describe, expect, it, vi } from "vitest";

const {
  createTradePriceSnapshotService,
  sanitizeListing,
  validateRequest,
} = require("../electron/trade-price-snapshot.cjs");

function response(value: unknown, url: string) {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-length": String(bytes.length) }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

describe("Trade price snapshot", () => {
  it("validates a bounded current query and rejects unexpected input", () => {
    expect(validateRequest({
      league: "Allflame",
      tradeQuery: { query: { status: { option: "securable" } }, sort: { price: "asc" } },
    }).league).toBe("Allflame");
    expect(() => validateRequest({ league: "../Allflame", tradeQuery: { query: {} } }))
      .toThrow(/invalid/i);
    expect(() => validateRequest({ league: "Allflame", tradeQuery: { nope: true } }))
      .toThrow(/query object/i);
    expect(() => validateRequest({ league: "Allflame", tradeQuery: { query: {} }, url: "https://evil.test" }))
      .toThrow(/invalid/i);
  });

  it("searches only the fixed PoE host and returns sanitized prices", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.method === "POST") {
        return response({ id: "search_1", total: 17, result: ["item_a", "item_b"] }, url);
      }
      return response({ result: [{
        id: "item_a",
        item: { name: "<b>Golem Spell</b>" },
        listing: {
          indexed: "2026-08-12T03:00:00.000Z",
          account: { name: "Seller\u0000Name" },
          price: { amount: 8, currency: "divine" },
        },
      }] }, url);
    });
    const service = createTradePriceSnapshotService({
      fetchImpl,
      userAgent: "GloamCore/2.9.3",
    });
    const result = await service({
      league: "Allflame",
      tradeQuery: { query: { status: { option: "securable" } }, sort: { price: "asc" } },
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://www.pathofexile.com/api/trade/search/Allflame",
      "https://www.pathofexile.com/api/trade/fetch/item_a,item_b?query=search_1",
    ]);
    expect(calls[0].init.redirect).toBe("error");
    expect(result).toMatchObject({
      total: 17,
      searchId: "search_1",
      listings: [{
        id: "item_a",
        amount: 8,
        currency: "divine",
        seller: "Seller Name",
        itemName: "Golem Spell",
      }],
    });
  });

  it("drops malformed listing prices", () => {
    expect(sanitizeListing({
      id: "item_a",
      listing: { price: { amount: -1, currency: "divine" } },
    })).toBeNull();
    expect(sanitizeListing({
      id: "item_a",
      listing: { price: { amount: 1, currency: "../../evil" } },
    })).toBeNull();
  });
});
