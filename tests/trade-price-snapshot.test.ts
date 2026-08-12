import { describe, expect, it, vi } from "vitest";

const {
  createTradePriceSnapshotService,
  sanitizeListing,
  validateRequest,
} = require("../electron/trade-price-snapshot.cjs");

function response(
  value: unknown,
  url: string,
  status = 200,
  headers: Record<string, string> = {},
) {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ "content-length": String(bytes.length), ...headers }),
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
      minimumIntervalMs: 0,
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

  it("honours Retry-After locally without repeating a restricted request", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(async (url: string) => response(
      { error: { code: 3, message: "Rate limit exceeded" } },
      url,
      429,
      { "retry-after": "10" },
    ));
    const service = createTradePriceSnapshotService({
      fetchImpl,
      userAgent: "GloamCore/3.4.3",
      minimumIntervalMs: 0,
      nowImpl: () => now,
    });
    const request = {
      league: "Allflame",
      tradeQuery: { query: { status: { option: "securable" } } },
    };

    await expect(service(request)).rejects.toThrow(/Retry in 10s/);
    await expect(service({
      ...request,
      tradeQuery: { query: { status: { option: "available" } } },
    })).rejects.toThrow(/Retry in 10s/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 10_001;
    fetchImpl.mockImplementationOnce(async (url: string) => response(
      { id: "search_after_cooldown", total: 0, result: [] },
      url,
    ));
    await expect(service(request)).resolves.toMatchObject({
      searchId: "search_after_cooldown",
      listings: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request for identical filter state", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    const fetchImpl = vi.fn((url: string) => new Promise((resolve) => {
      finish = resolve;
    }));
    const service = createTradePriceSnapshotService({
      fetchImpl,
      userAgent: "GloamCore/3.4.3",
      minimumIntervalMs: 0,
    });
    const request = {
      league: "Allflame",
      tradeQuery: { query: { type: "Kinetic Wand" } },
    };

    const first = service(request);
    const second = service(request);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    finish(response({ id: "shared_search", total: 0, result: [] }, fetchImpl.mock.calls[0][0]));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ searchId: "shared_search" }),
      expect.objectContaining({ searchId: "shared_search" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("drops superseded queued filter searches and runs only the latest selection", async () => {
    let finishFirst!: (value: ReturnType<typeof response>) => void;
    const fetchImpl = vi.fn((url: string) => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Promise<ReturnType<typeof response>>((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve(response({
        id: "latest_search",
        total: 0,
        result: [],
      }, url));
    });
    const service = createTradePriceSnapshotService({
      fetchImpl,
      userAgent: "GloamCore/3.4.3",
      minimumIntervalMs: 0,
    });
    const request = (minimum: number) => ({
      league: "Allflame",
      tradeQuery: {
        query: {
          type: "Kinetic Wand",
          filters: { weapon_filters: { filters: { aps: { min: minimum } } } },
        },
      },
    });

    const first = service(request(1.8)).catch((error: Error) => error);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const stale = service(request(1.85)).catch((error: Error) => error);
    const latest = service(request(1.9));
    finishFirst(response({ id: "stale_search", total: 0, result: [] }, fetchImpl.mock.calls[0][0]));

    await expect(first).resolves.toMatchObject({
      message: expect.stringMatching(/superseded/i),
    });
    await expect(stale).resolves.toMatchObject({
      message: expect.stringMatching(/superseded/i),
    });
    await expect(latest).resolves.toMatchObject({ searchId: "latest_search" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("follows dynamic rate-limit state before another request is sent", async () => {
    const fetchImpl = vi.fn(async (url: string) => response(
      { id: "search_at_limit", total: 0, result: [] },
      url,
      200,
      {
        "x-rate-limit-rules": "ip",
        "x-rate-limit-ip": "2:5:10",
        "x-rate-limit-ip-state": "3:5:5",
      },
    ));
    const service = createTradePriceSnapshotService({
      fetchImpl,
      userAgent: "GloamCore/3.4.3",
      minimumIntervalMs: 0,
      nowImpl: () => 1_000,
    });

    await expect(service({
      league: "Allflame",
      tradeQuery: { query: { type: "Kinetic Wand" } },
    })).resolves.toMatchObject({ searchId: "search_at_limit" });
    await expect(service({
      league: "Allflame",
      tradeQuery: { query: { type: "Prophecy Wand" } },
    })).rejects.toThrow(/Retry in 5s/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not turn an unrestricted rate window into a hidden per-request delay", async () => {
    let now = 1_000;
    const waits: number[] = [];
    const fetchImpl = vi.fn(async (url: string) => response(
      { id: `search_${fetchImpl.mock.calls.length}`, total: 0, result: [] },
      url,
      200,
      {
        "x-rate-limit-rules": "ip",
        "x-rate-limit-ip": "10:60:120",
        "x-rate-limit-ip-state": "1:60:0",
      },
    ));
    const service = createTradePriceSnapshotService({
      fetchImpl,
      userAgent: "GloamCore/3.4.3",
      minimumIntervalMs: 0,
      nowImpl: () => now,
      waitImpl: async (milliseconds: number) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });

    await service({
      league: "Allflame",
      tradeQuery: { query: { type: "Kinetic Wand" } },
    });
    await service({
      league: "Allflame",
      tradeQuery: { query: { type: "Prophecy Wand" } },
    });

    expect(waits).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops locally when an official rate window reaches its hit ceiling", async () => {
    const fetchImpl = vi.fn(async (url: string) => response(
      { id: "search_at_ceiling", total: 0, result: [] },
      url,
      200,
      {
        "x-rate-limit-rules": "ip",
        "x-rate-limit-ip": "10:60:120",
        "x-rate-limit-ip-state": "10:60:0",
      },
    ));
    const service = createTradePriceSnapshotService({
      fetchImpl,
      userAgent: "GloamCore/3.4.3",
      minimumIntervalMs: 0,
      nowImpl: () => 1_000,
    });

    await expect(service({
      league: "Allflame",
      tradeQuery: { query: { type: "Kinetic Wand" } },
    })).resolves.toMatchObject({ searchId: "search_at_ceiling" });
    await expect(service({
      league: "Allflame",
      tradeQuery: { query: { type: "Prophecy Wand" } },
    })).rejects.toThrow(/Retry in 1m/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
