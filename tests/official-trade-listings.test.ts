import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  MAX_FETCH_IDS,
  assertOfficialTradeUrl,
  createOfficialTradeListingService,
  sanitizeListingRow,
  validateLookupRequest,
} = require("../electron/official-trade-listings.cjs") as {
  MAX_FETCH_IDS: number;
  assertOfficialTradeUrl(
    value: string,
    kind: "search" | "exchange" | "fetch",
    searchId?: string,
  ): string;
  createOfficialTradeListingService(options?: Record<string, unknown>): {
    lookup(request: unknown): Promise<TradeListingResult>;
  };
  sanitizeListingRow(value: unknown): TradeListingRow | null;
  validateLookupRequest(value: unknown): unknown;
};

interface TradeListingRow {
  id: string;
  price: { amount: number; currency: string } | null;
  indexed: string;
  seller: { account: string; character: string };
  item: { name: string; baseType: string; icon: string };
  whisper: string;
  groupedCount?: number;
  stock?: number;
  exchange?: {
    haveAmount: number;
    haveCurrency: string;
    itemAmount: number;
    itemCurrency: string;
    stock: number;
  };
}

interface TradeListingResult {
  api?: "trade" | "exchange";
  listings: TradeListingRow[];
  total: number;
  searchId: string;
  fetchedAt: number;
  stale: boolean;
  error: string;
}

const request = (suffix = "") => ({
  league: "Standard",
  tradeQuery: {
    query: {
      status: { option: "online" },
      type: `Heavy Belt${suffix}`,
      stats: [{ type: "and", filters: [] }],
    },
    sort: { price: "asc" },
  },
});

const exchangeRequest = () => ({
  api: "exchange",
  league: "Standard",
  tradeQuery: {
    engine: "new",
    query: {
      status: { option: "online" },
      have: ["divine", "chaos"],
      want: ["aberrant-fossil"],
    },
    sort: { have: "asc" },
  },
});

function jsonResponse(
  payload: unknown,
  {
    status = 200,
    headers = {},
    url = "",
  }: { status?: number; headers?: Record<string, string>; url?: string } = {},
) {
  const response = new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
}

function namedRateLimitHeaders(
  name: string,
  policy: string,
  state: string,
): Record<string, string> {
  return {
    "x-rate-limit-rules": name,
    [`x-rate-limit-${name}`]: policy,
    [`x-rate-limit-${name}-state`]: state,
  };
}

function officialRow(id = "result_1") {
  return {
    id,
    listing: {
      indexed: "2026-08-02T12:34:56Z",
      price: { amount: 4.5, currency: "divine" },
      whisper: "@Seller Hi, I would like to buy your Mageblood",
      account: {
        name: "Seller",
        lastCharacterName: "Mapper",
        email: "must-not-leak@example.invalid",
      },
      stash: { name: "private stash", x: 4, y: 2 },
    },
    item: {
      name: "<<set:MS>><<set:M>><<set:S>>Mageblood",
      baseType: "Heavy Belt",
      icon: "https://web.poecdn.com/image/Art/2DItems/Belts/AtlasBelt3.png?scale=1",
      explicitMods: ["raw modifier must not cross IPC"],
    },
  };
}

function exchangePayload(
  total: number,
  divine: number,
  chaos: number,
) {
  const result = Object.fromEntries(
    (["divine", "chaos"] as const).flatMap((currency) =>
      Array.from({ length: currency === "divine" ? divine : chaos }, (_, index) => {
        const id = `${currency}_${index}`;
        return [id, {
          id,
          listing: {
            indexed: "2026-08-02T12:34:56+00:00",
            account: {
              name: `${currency}Seller${index}`,
              lastCharacterName: `${currency}Trader${index}`,
            },
            offers: [{
              exchange: { currency, amount: currency === "divine" ? 2 : 3 },
              item: { currency: "aberrant-fossil", amount: 1, stock: 100 },
            }],
          },
        }];
      })
    ),
  );
  return { id: `exchange_${total}_${divine}_${chaos}`, total, result };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("official trade listing request validation", () => {
  it("accepts only league plus a bounded official query object", () => {
    expect(validateLookupRequest(request())).toMatchObject({ league: "Standard" });
    expect(validateLookupRequest({ ...request(), force: true })).toMatchObject({ force: true });
    expect(() => validateLookupRequest({ ...request(), force: "yes" })).toThrow(/unexpected fields/i);
    expect(() => validateLookupRequest({ ...request(), extra: true })).toThrow(/unexpected fields/i);
    expect(() => validateLookupRequest({ ...request(), league: "../Standard" })).toThrow(/valid Path/i);
    expect(() => validateLookupRequest({ league: "Standard", tradeQuery: { sort: {} } })).toThrow(/valid official/i);
    expect(() => validateLookupRequest({
      league: "Standard",
      tradeQuery: { query: { text: "x".repeat(4_097) } },
    })).toThrow(/invalid string/i);
  });

  it("rejects non-JSON and prototype-pollution query data", () => {
    const polluted = JSON.parse(
      '{"league":"Standard","tradeQuery":{"query":{"__proto__":{"polluted":true}}}}',
    );
    expect(() => validateLookupRequest(polluted)).toThrow(/invalid field/i);
    expect(() => validateLookupRequest({
      league: "Standard",
      tradeQuery: { query: { value: Number.POSITIVE_INFINITY } },
    })).toThrow(/invalid number/i);
  });

  it("accepts only the bounded legacy exchange request shape", () => {
    expect(validateLookupRequest(exchangeRequest())).toMatchObject({
      api: "exchange",
      league: "Standard",
    });
    expect(() => validateLookupRequest({
      ...exchangeRequest(),
      tradeQuery: {
        ...exchangeRequest().tradeQuery,
        query: {
          ...exchangeRequest().tradeQuery.query,
          have: ["chaos", "divine", "mirror"],
        },
      },
    })).toThrow(/valid official exchange/i);
    expect(() => validateLookupRequest({
      ...exchangeRequest(),
      tradeQuery: {
        ...exchangeRequest().tradeQuery,
        query: {
          ...exchangeRequest().tradeQuery.query,
          secret: "unexpected",
        },
      },
    })).toThrow(/valid official exchange/i);
  });

  it("allows only the two fixed official HTTPS route shapes", () => {
    expect(assertOfficialTradeUrl(
      "https://www.pathofexile.com/api/trade/exchange/Standard",
      "exchange",
    )).toContain("/exchange/");
    expect(assertOfficialTradeUrl(
      "https://www.pathofexile.com/api/trade/search/Standard",
      "search",
    )).toContain("pathofexile.com");
    expect(assertOfficialTradeUrl(
      "https://www.pathofexile.com/api/trade/fetch/a,b?query=search_1",
      "fetch",
      "search_1",
    )).toContain("/fetch/");
    expect(() => assertOfficialTradeUrl(
      "https://pathofexile.com/api/trade/search/Standard",
      "search",
    )).toThrow(/untrusted/i);
    expect(() => assertOfficialTradeUrl(
      "https://www.pathofexile.com/api/trade/search/Standard/extra",
      "search",
    )).toThrow(/untrusted/i);
    expect(() => assertOfficialTradeUrl(
      "https://www.pathofexile.com/api/trade/fetch/a?query=wrong&x=1",
      "fetch",
      "search_1",
    )).toThrow(/untrusted/i);
  });
});

describe("official trade listing service", () => {
  it("starts two ten-ID fetch batches and returns grouped sanitized fields", async () => {
    const resultIds = Array.from({ length: 20 }, (_, index) => `result_${index + 1}`);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "search_1", total: 20, result: resultIds }))
      .mockImplementation(async (url: string, options: RequestInit) => {
        const parsed = new URL(url);
        const ids = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1).split(",");
        expect(ids).toHaveLength(MAX_FETCH_IDS);
        expect(parsed.searchParams.get("query")).toBe("search_1");
        expect(options.method).toBe("GET");
        return jsonResponse({ result: ids.map((id) => officialRow(id)) });
      });
    let clock = 1_000;
    const slept: number[] = [];
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => {
        slept.push(milliseconds);
        clock += milliseconds;
      },
      paceMs: 400,
    });

    const result = await service.lookup(request());

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [searchUrl, searchOptions] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(searchUrl).toBe("https://www.pathofexile.com/api/trade/search/Standard");
    expect(searchOptions).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse(String(searchOptions.body))).toEqual(request().tradeQuery);
    // SEARCH and FETCH stay independent; with no local fixed cadence, the first
    // lookup only waits for route-level admission with no artificial delay.
    expect(slept).toEqual([]);
    expect(result).toMatchObject({ total: 20, searchId: "search_1", stale: false, error: "" });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toEqual({
      id: "result_1",
      price: { amount: 4.5, currency: "divine" },
      indexed: "2026-08-02T12:34:56Z",
      seller: { account: "Seller", character: "Mapper" },
      item: {
        name: "Mageblood",
        baseType: "Heavy Belt",
        icon: "https://web.poecdn.com/image/Art/2DItems/Belts/AtlasBelt3.png?scale=1",
      },
      whisper: "",
      groupedCount: 20,
      stock: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(/private stash|must-not-leak|raw modifier/i);
  });

  it("loads normal Trade batches on demand up to 100 while seller grouping is sparse", async () => {
    const resultIds = Array.from({ length: 100 }, (_, index) => `result_${index + 1}`);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "search_1", total: 100, result: resultIds }))
      .mockImplementation(async (url: string) => {
        const parsed = new URL(url);
        const ids = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1).split(",");
        return jsonResponse({ result: ids.map((id) => officialRow(id)) });
      });
    let clock = 1_000;
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
    });

    const result = await service.lookup(request());

    expect(fetchImpl).toHaveBeenCalledTimes(11);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({ groupedCount: 100 });
  });

  it("posts a fixed-host exchange request and returns only sanitized ratios", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      id: "exchange_1",
      total: 1,
      result: {
        opaque_result_key_1: {
          id: "bulk_1",
          listing: {
            indexed: "2026-08-02T12:34:56+00:00",
            account: {
              name: "BulkSeller",
              lastCharacterName: "FossilTrader",
              email: "must-not-leak@example.invalid",
            },
            offers: [{
              exchange: { currency: "chaos", amount: 9 },
              item: { currency: "aberrant-fossil", amount: 3, stock: 120 },
            }],
          },
          hidden: "must not cross IPC",
        },
      },
    }));
    const service = createOfficialTradeListingService({ fetchImpl });

    const result = await service.lookup(exchangeRequest());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://www.pathofexile.com/api/trade/exchange/Standard",
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
    });
    expect(result).toMatchObject({
      api: "exchange",
      searchId: "exchange_1",
      total: 1,
      error: "",
    });
    expect(result.listings[0]).toMatchObject({
      id: "bulk_1",
      price: { amount: 3, currency: "chaos" },
      indexed: "2026-08-02T12:34:56+00:00",
      seller: { account: "BulkSeller", character: "FossilTrader" },
      exchange: {
        haveAmount: 9,
        haveCurrency: "chaos",
        itemAmount: 3,
        itemCurrency: "aberrant-fossil",
        stock: 120,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|hidden/i);
  });

  it.each([
    ["defers a sparse chaos side", 1_000, 10, 10, "divine", 990, 10],
    ["loads both sides at the 100-result boundary", 100, 10, 10, "chaos", 90, 10],
    ["uses chaos once twenty rows are present", 1_000, 10, 20, "chaos", 990, 20],
    ["keeps divine while chaos remains sparse", 1_000, 20, 10, "divine", 990, 20],
  ])(
    "%s like Awakened's optimistic bulk search",
    async (_label, total, divine, chaos, expectedCurrency, expectedTotal, expectedRows) => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse(exchangePayload(total, divine, chaos)),
      );
      const service = createOfficialTradeListingService({ fetchImpl });

      const result = await service.lookup(exchangeRequest());

      expect(result.total).toBe(expectedTotal);
      expect(result.listings).toHaveLength(expectedRows);
      expect(result.listings.every(
        (listing) => listing.exchange?.haveCurrency === expectedCurrency,
      )).toBe(true);
    },
  );

  it("does not invent a SEARCH/EXCHANGE cooldown before a policy is advertised", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "search_1", total: 0, result: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "exchange_1", total: 0, result: {} }));
    const service = createOfficialTradeListingService({ fetchImpl });

    const trade = await service.lookup(request());
    const exchange = await service.lookup(exchangeRequest());

    expect(trade.error).toBe("");
    expect(exchange.error).toBe("");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares the advertised SEARCH policy with EXCHANGE while FETCH stays separate", async () => {
    let clock = 1_000;
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(
      { id: "search_1", total: 0, result: [] },
      {
        headers: namedRateLimitHeaders(
          "trade-search-request-limit",
          "1:10:60",
          "1:10:0",
        ),
      },
    ));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
    });

    const trade = await service.lookup(request());
    const blockedExchange = await service.lookup(exchangeRequest());

    expect(trade.error).toBe("");
    expect(blockedExchange.error).toMatch(/retry after 12 seconds/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preflights both SEARCH and FETCH before starting another normal search", async () => {
    let clock = 1_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "search_1", total: 1, result: ["result_1"] }))
      .mockResolvedValueOnce(jsonResponse(
        { result: [officialRow()] },
        {
          headers: namedRateLimitHeaders(
            "trade-fetch-request-limit",
            "1:10:60",
            "1:10:0",
          ),
        },
      ));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
    });
    const first = await service.lookup(request(" A"));
    clock = 7_000;
    const blocked = await service.lookup(request(" B"));

    expect(first.error).toBe("");
    expect(blocked.error).toMatch(/retry after 6 seconds/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("coalesces equal queries and keeps the Awakened-style cache for exactly 300 seconds", async () => {
    let clock = 1_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "search_1", total: 1, result: ["result_1"] }))
      .mockResolvedValueOnce(jsonResponse({ result: [officialRow()] }))
      .mockResolvedValueOnce(jsonResponse({ id: "search_2", total: 0, result: [] }));
    const service = createOfficialTradeListingService({ fetchImpl, now: () => clock });

    const [first, second] = await Promise.all([
      service.lookup(request()),
      service.lookup(request()),
    ]);
    first.listings[0].seller.account = "mutated by renderer";
    const cached = await service.lookup(request());
    clock = 301_000;
    const atBoundary = await service.lookup(request());
    clock = 301_001;
    const refreshed = await service.lookup(request());

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(second.listings).toHaveLength(1);
    expect(cached.listings[0].seller.account).toBe("Seller");
    expect(atBoundary.searchId).toBe("search_1");
    expect(refreshed.searchId).toBe("search_2");
  });

  it("supports an explicit refresh while ordinary reads stay in the fresh cache", async () => {
    const policy = namedRateLimitHeaders(
      "trade-search-request-limit",
      "2:10:60",
      "1:10:0",
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(
        { id: "search_1", total: 0, result: [] },
        { headers: policy },
      ))
      .mockResolvedValueOnce(jsonResponse(
        { id: "search_2", total: 0, result: [] },
        { headers: { ...policy, "x-rate-limit-trade-search-request-limit-state": "2:10:0" } },
      ));
    const service = createOfficialTradeListingService({ fetchImpl });

    const first = await service.lookup(request());
    const cached = await service.lookup(request());
    const refreshed = await service.lookup({ ...request(), force: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.searchId).toBe("search_1");
    expect(cached.searchId).toBe("search_1");
    expect(refreshed.searchId).toBe("search_2");
  });

  it("honors Retry-After by failing later queries closed until the cooldown expires", async () => {
    let clock = 10_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(
        { error: "rate limited" },
        { status: 429, headers: { "retry-after": "30" } },
      ));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
    });

    const limited = await service.lookup(request(" A"));
    const blocked = await service.lookup(request(" B"));

    expect(limited.error).toMatch(/rate-limit/i);
    expect(blocked.error).toMatch(/try again in 30s/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses named sliding-window burst slots and rejects new search queues at 1500ms", async () => {
    let clock = 5_000;
    const slept: number[] = [];
    const headersForHits = (hits: number) => namedRateLimitHeaders(
      "trade-search-request-limit",
      "3:10:60",
      `${hits}:10:0`,
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(
        { id: "search_1", total: 0, result: [] },
        { headers: headersForHits(1) },
      ))
      .mockResolvedValueOnce(jsonResponse(
        { id: "search_2", total: 0, result: [] },
        { headers: headersForHits(2) },
      ))
      .mockResolvedValueOnce(jsonResponse(
        { id: "search_3", total: 0, result: [] },
        { headers: headersForHits(3) },
      ))
      .mockResolvedValueOnce(jsonResponse(
        { id: "search_4", total: 0, result: [] },
        { headers: headersForHits(1) },
      ));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => {
        slept.push(milliseconds);
        clock += milliseconds;
      },
    });

    await service.lookup(request(" A"));
    await service.lookup(request(" B"));
    await service.lookup(request(" C"));
    expect(slept).toEqual([]);

    // The advertised ten-second window gets Awakened's two-second latency
    // safety. Bursts are allowed, but a new search is not allowed to build a
    // user-visible queue when the estimated delay is 1500ms or more.
    clock = 15_500;
    const rejected = await service.lookup(request(" D"));
    clock = 15_501;
    const admitted = await service.lookup(request(" E"));

    expect(rejected.error).toMatch(/retry after 2 seconds/i);
    expect(admitted.error).toBe("");
    expect(slept).toEqual([1_499]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("applies a safe policy cooldown when a 429 omits Retry-After", async () => {
    let clock = 10_000;
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(
      { error: "rate limited" },
      {
        status: 429,
        headers: {
          ...namedRateLimitHeaders(
            "trade-search-ip-limit",
            "5:10:60",
            "5:10:0",
          ),
        },
      },
    ));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
    });

    await service.lookup(request(" A"));
    const blocked = await service.lookup(request(" B"));

    expect(blocked.error).toMatch(/try again in 60s/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reconciles every named server window without inventing a reserve", async () => {
    let clock = 20_000;
    const headers = {
      "x-rate-limit-rules": "trade-search-request-limit,trade-search-ip-limit",
      "x-rate-limit-trade-search-request-limit": "5:10:60",
      "x-rate-limit-trade-search-request-limit-state": "1:10:0",
      "x-rate-limit-trade-search-ip-limit": "600:21600:3600",
      "x-rate-limit-trade-search-ip-limit-state": "590:21600:0",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(
        { id: "search_1", total: 0, result: [] },
        { headers },
      ))
      .mockResolvedValueOnce(jsonResponse(
        { id: "search_2", total: 0, result: [] },
        {
          headers: {
            ...headers,
            "x-rate-limit-trade-search-request-limit-state": "2:10:0",
            "x-rate-limit-trade-search-ip-limit-state": "591:21600:0",
          },
        },
      ));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
    });

    await service.lookup(request(" A"));
    const allowed = await service.lookup(request(" B"));

    expect(allowed.error).toBe("");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("adds two seconds of safety and reconciles server hits made outside this process", async () => {
    let clock = 20_000;
    const headers = {
      "x-rate-limit-rules": "trade-search-request-limit,trade-search-ip-limit",
      "x-rate-limit-trade-search-request-limit": "5:10:60",
      "x-rate-limit-trade-search-request-limit-state": "1:10:0",
      "x-rate-limit-trade-search-ip-limit": "2:21600:3600",
      "x-rate-limit-trade-search-ip-limit-state": "2:21600:0",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(
      { id: "search_1", total: 0, result: [] },
      { headers },
    ));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
    });

    await service.lookup(request(" A"));
    const blocked = await service.lookup(request(" B"));

    expect(blocked.error).toMatch(/retry after 21602 seconds/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves official long penalties instead of truncating them to two minutes", async () => {
    let clock = 30_000;
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(
      { error: "rate limited" },
      {
        status: 429,
        headers: {
          ...namedRateLimitHeaders(
            "trade-search-ip-limit",
            "600:21600:3600",
            "600:21600:3600",
          ),
        },
      },
    ));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
    });

    await service.lookup(request(" A"));
    const blocked = await service.lookup(request(" B"));

    expect(blocked.error).toMatch(/try again in 3600s/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not enforce a fixed cooldown when another search is already in flight", async () => {
    const releases: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn(async () => new Promise<Response>((resolve) => {
      releases.push(resolve);
    }));
    const service = createOfficialTradeListingService({ fetchImpl });
    const firstPending = service.lookup(request(" A"));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const secondPending = service.lookup(request(" B"));
    releases.shift()?.(jsonResponse({ id: "search_1", total: 0, result: [] }));
    const first = await firstPending;
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.(jsonResponse({ id: "search_2", total: 0, result: [] }));
    const second = await secondPending;

    expect(first.error).toBe("");
    expect(second.error).toBe("");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to a recent sanitized result when refresh fails", async () => {
    let clock = 1_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "search_1", total: 1, result: ["result_1"] }))
      .mockResolvedValueOnce(jsonResponse({ result: [officialRow()] }))
      .mockRejectedValueOnce(new Error("network private detail"));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      cacheTtlMs: 1_000,
      maxStaleMs: 60_000,
      paceMs: 100,
    });
    const fresh = await service.lookup(request());
    clock += 6_000;
    const stale = await service.lookup(request());

    expect(fresh.stale).toBe(false);
    expect(stale).toMatchObject({ stale: true, total: 1, searchId: "search_1" });
    expect(stale.listings).toHaveLength(1);
    expect(stale.error).toContain("network private detail");
  });

  it("treats maxStaleMs as grace after freshness and rejects older cache", async () => {
    let clock = 1_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "search_1", total: 1, result: ["result_1"] }))
      .mockResolvedValueOnce(jsonResponse({ result: [officialRow()] }))
      .mockRejectedValue(new Error("offline"));
    const service = createOfficialTradeListingService({
      fetchImpl,
      now: () => clock,
      cacheTtlMs: 300_000,
      maxStaleMs: 120_000,
    });

    await service.lookup(request());
    clock = 301_001;
    const withinGrace = await service.lookup(request());
    clock = 421_001;
    const beyondGrace = await service.lookup(request());

    expect(withinGrace).toMatchObject({
      stale: true,
      searchId: "search_1",
      error: "offline",
    });
    expect(withinGrace.listings).toHaveLength(1);
    expect(beyondGrace).toMatchObject({ stale: false, listings: [], error: "offline" });
  });

  it("rejects oversized, malformed, non-JSON, and unexpected-final-URL responses", async () => {
    const cases = [
      jsonResponse({}, { headers: { "content-length": String(3 * 1024 * 1024) } }),
      jsonResponse({ id: "bad/id", total: 1, result: [] }),
      new Response("<html>not JSON</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      jsonResponse(
        { id: "search_1", total: 0, result: [] },
        { url: "https://www.pathofexile.com/api/trade/search/Hardcore" },
      ),
    ];
    for (const response of cases) {
      const service = createOfficialTradeListingService({
        fetchImpl: vi.fn(async () => response),
      });
      const result = await service.lookup(request());
      expect(result.listings).toEqual([]);
      expect(result.error).not.toBe("");
    }
  });

  it("returns search metadata but no raw payload when the listing batch is malformed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "search_1", total: 4, result: ["result_1"] }))
      .mockResolvedValueOnce(jsonResponse({ result: [{ id: "foreign_id", secret: "do not leak" }] }));
    const service = createOfficialTradeListingService({ fetchImpl, paceMs: 100 });
    const result = await service.lookup(request());

    expect(result).toMatchObject({ listings: [], total: 4, searchId: "search_1" });
    expect(result.error).toMatch(/malformed listing/i);
    expect(JSON.stringify(result)).not.toContain("do not leak");
  });

  it("skips listings that disappear between search and fetch", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "search_1",
        total: 2,
        result: ["result_1", "result_2"],
      }))
      .mockResolvedValueOnce(jsonResponse({ result: [officialRow("result_1"), null] }));
    const service = createOfficialTradeListingService({ fetchImpl, paceMs: 100 });

    const result = await service.lookup(request());

    expect(result.error).toBe("");
    expect(result.total).toBe(2);
    expect(result.listings.map((row) => row.id)).toEqual(["result_1"]);
  });

  it("drops unsafe icons, whispers, timestamps, and invalid prices", () => {
    const value = officialRow();
    value.item.icon = "https://attacker.invalid/icon.png";
    value.listing.whisper = "@Seller hello\n/cmd";
    value.listing.indexed = "not-a-date";
    value.listing.price = { amount: Number.POSITIVE_INFINITY, currency: "divine" };

    expect(sanitizeListingRow(value)).toMatchObject({
      price: null,
      indexed: "",
      item: { icon: "" },
      whisper: "",
    });
  });

  it("aborts a request that does not return headers before the deadline", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(options.signal?.reason));
      }),
    );
    const service = createOfficialTradeListingService({ fetchImpl, timeoutMs: 250 });
    const pending = service.lookup(request());
    await vi.advanceTimersByTimeAsync(251);
    const result = await pending;

    expect(result.error).toMatch(/timed out/i);
  });
});
