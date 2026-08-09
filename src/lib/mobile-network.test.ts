import { describe, expect, it, vi } from "vitest";
import {
  assertMobileResponseMetadata,
  decodedBase64ByteLength,
  faustusRequestCacheKey,
  isExactMobileResponseUrl,
  isValidMobileStoredResponse,
  mobileOverviewUrl,
  mobileWikiTooltipUrl,
  parseLimitedMobileJson,
  responseMaxAge,
  responseSourceTime,
  trustedExternalUrl,
  withMobileHttpDeadline,
} from "./mobile-network";

describe("mobile network helpers", () => {
  it("reads cache lifetime case-insensitively and falls back safely", () => {
    expect(responseMaxAge({ "Cache-Control": "public, max-age=90" }, 5_000)).toBe(
      90_000,
    );
    expect(responseMaxAge({ "cache-control": "max-age=0" }, 5_000)).toBe(5_000);
    expect(responseMaxAge(undefined, 5_000)).toBe(5_000);
    expect(responseMaxAge({ Age: "90" }, 5_000)).toBe(5_000);
    expect(
      responseMaxAge(
        { "cache-control": "public, max-age=1800", Age: "1659" },
        5_000,
      ),
    ).toBe(141_000);
    expect(
      responseMaxAge({ "cache-control": "max-age=30", age: "90" }, 5_000),
    ).toBe(1_000);
  });

  it("reports the source snapshot time instead of the local download time", () => {
    const now = Date.parse("2026-08-01T06:50:00Z");
    expect(
      responseSourceTime(
        { Date: "Sat, 01 Aug 2026 06:50:00 GMT", Age: "120" },
        now,
      ),
    ).toBe(Date.parse("2026-08-01T06:48:00Z"));
    expect(
      responseSourceTime(
        { Date: "Sat, 01 Aug 2026 06:55:00 GMT" },
        now,
      ),
    ).toBe(now);
  });

  it("builds each poe.ninja mobile endpoint with encoded parameters", () => {
    const request = { league: "Test League", type: "Skill Gem" };
    expect(mobileOverviewUrl({ ...request, source: "exchange" })).toContain(
      "/exchange/current/overview?league=Test+League&type=Skill+Gem",
    );
    expect(mobileOverviewUrl({ ...request, source: "stash-currency" })).toContain(
      "/stash/current/currency/overview?league=Test+League&type=Skill+Gem",
    );
    expect(mobileOverviewUrl({ ...request, source: "stash-item" })).toContain(
      "/stash/current/item/overview?league=Test+League&type=Skill+Gem",
    );
  });

  it("escapes wiki Cargo names without changing the requested fields", () => {
    const url = new URL(
      mobileWikiTooltipUrl({ name: 'A \\ "quoted" item' }, "name,description"),
    );
    expect(url.searchParams.get("where")).toBe('name="A \\\\ \\"quoted\\" item"');
    expect(url.searchParams.get("fields")).toBe("name,description");
  });

  it("uses an order-independent Faustus cache identity", () => {
    const first = faustusRequestCacheKey({
      league: "Allflame",
      items: [
        { id: "b", name: "B" },
        { id: "a", name: "A" },
      ],
    });
    const second = faustusRequestCacheKey({
      league: "Allflame",
      items: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    });
    expect(first).toBe(second);
  });

  it("only accepts HTTPS links on the explicit market/wiki allowlist", () => {
    expect(trustedExternalUrl("https://www.pathofexile.com/trade/exchange/Allflame"))
      .not.toBeNull();
    expect(trustedExternalUrl("https://poe.ninja/poe1/economy/Allflame/currency"))
      .not.toBeNull();
    expect(trustedExternalUrl("http://poe.ninja/poe1/economy/Allflame/currency"))
      .toBeNull();
    expect(trustedExternalUrl("https://poe.ninja.example.com/steal")).toBeNull();
    expect(trustedExternalUrl("https://poe.ninja:444/poe1/economy")).toBeNull();
    expect(trustedExternalUrl("https://www.craftofexile.com/en/"))
      .not.toBeNull();
    expect(trustedExternalUrl("https://craftofexile.com.evil.example/en/"))
      .toBeNull();
    expect(trustedExternalUrl("https://poedb.tw/us/Divine_Orb")).not.toBeNull();
    expect(trustedExternalUrl("not a URL")).toBeNull();
  });

  it("rejects redirects and oversized or malformed response metadata", () => {
    const requested = "https://poe.ninja/poe1/api/economy/leagues";
    expect(isExactMobileResponseUrl(requested, requested)).toBe(true);
    expect(
      isExactMobileResponseUrl(requested, "https://127.0.0.1/private"),
    ).toBe(false);
    expect(() =>
      assertMobileResponseMetadata(
        requested,
        "https://www.poewiki.net/w/api.php",
        {},
        100,
      ),
    ).toThrow("redirected");
    expect(() =>
      assertMobileResponseMetadata(requested, requested, { "Content-Length": "101" }, 100),
    ).toThrow("size limit");
    expect(() =>
      assertMobileResponseMetadata(requested, requested, { "Content-Length": "chunked" }, 100),
    ).toThrow("invalid size");
  });

  it("bounds JSON and base64 payloads after native materialization", () => {
    expect(parseLimitedMobileJson<{ ok: boolean }>('{"ok":true}', 16)).toEqual({
      ok: true,
    });
    expect(() => parseLimitedMobileJson('"😀"', 5)).toThrow("size limit");
    expect(decodedBase64ByteLength("AQIDBA==")).toBe(4);
    expect(decodedBase64ByteLength("not-base64")).toBeNull();
  });

  it("discards malformed and future-dated stored envelopes", () => {
    const now = 10_000;
    const valid = {
      envelope: {
        data: { lines: [] },
        fetchedAt: now - 1_000,
        expiresAt: now + 1_000,
        stale: false,
        cache: "mobile",
      },
      etag: "one",
    };
    const validate = (data: unknown): data is { lines: unknown[] } =>
      Boolean(data && typeof data === "object" && Array.isArray((data as { lines?: unknown }).lines));
    expect(isValidMobileStoredResponse(valid, validate, now)).toBe(true);
    expect(
      isValidMobileStoredResponse(
        { ...valid, envelope: { ...valid.envelope, fetchedAt: now + 1 } },
        validate,
        now,
      ),
    ).toBe(false);
    expect(
      isValidMobileStoredResponse(
        { ...valid, envelope: { ...valid.envelope, fetchedAt: String(now - 1) } },
        validate,
        now,
      ),
    ).toBe(false);
    expect(
      isValidMobileStoredResponse(
        { envelope: { ...valid.envelope, data: { lines: [null] } } },
        (data): data is { lines: Record<string, unknown>[] } =>
          Boolean(
            data &&
              typeof data === "object" &&
              Array.isArray((data as { lines?: unknown }).lines) &&
              (data as { lines: unknown[] }).lines.every(
                (line) => line != null && typeof line === "object" && !Array.isArray(line),
              ),
          ),
        now,
      ),
    ).toBe(false);
  });

  it("enforces a wall-clock deadline even when bytes could keep arriving", async () => {
    vi.useFakeTimers();
    try {
      const pending = withMobileHttpDeadline(new Promise<never>(() => undefined), 25);
      const rejected = expect(pending).rejects.toThrow("wall-clock deadline");
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
