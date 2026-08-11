import { describe, expect, it } from "vitest";
import type { CacheEnvelope } from "../types";
import {
  faustusRefreshDelayMs,
  marketFailureDisposition,
  marketRefreshDelayMs,
  marketRetryDelayMs,
  MAX_ACTIONABLE_MARKET_AGE_MS,
} from "./market-freshness";

function envelope(fetchedAt: number): CacheEnvelope<{ lines: unknown[] }> {
  return {
    data: { lines: [] },
    fetchedAt,
    expiresAt: fetchedAt + 15 * 60 * 1000,
    stale: false,
    cache: "network",
  };
}

describe("main market failure freshness", () => {
  it("keeps an under-cap snapshot but marks it stale", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    const current = envelope(now - MAX_ACTIONABLE_MARKET_AGE_MS);

    const result = marketFailureDisposition(current, now);

    expect(result.clear).toBe(false);
    expect(result.envelope).toMatchObject({ stale: true, cache: "stale" });
    expect(result.envelope?.data).toBe(current.data);
  });

  it("clears a snapshot once it exceeds the two-hour cap", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    const current = envelope(now - MAX_ACTIONABLE_MARKET_AGE_MS - 1);

    expect(marketFailureDisposition(current, now)).toEqual({
      envelope: null,
      clear: true,
    });
  });

  it("rejects future-dated snapshots instead of treating negative age as fresh", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    expect(marketFailureDisposition(envelope(now + 1), now)).toEqual({
      envelope: null,
      clear: true,
    });
  });

  it("bounds automatic retry delays", () => {
    expect(marketRetryDelayMs(Number.NaN)).toBe(5 * 60_000);
    expect(marketRetryDelayMs(1)).toBe(5 * 60_000);
    expect(marketRetryDelayMs(15)).toBe(15 * 60_000);
    expect(marketRetryDelayMs(999)).toBe(30 * 60_000);
  });

  it("retries a stale snapshot no later than its actionable-age deadline", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    const current = {
      ...envelope(now - MAX_ACTIONABLE_MARKET_AGE_MS + 10_000),
      stale: true,
    };

    expect(marketRefreshDelayMs(current, 30, now)).toBe(10_250);
    expect(marketRefreshDelayMs(null, 999, now)).toBe(30 * 60_000);
  });

  it("polls official Faustus data every five minutes and catches up every minute", () => {
    const now = Date.parse("2026-08-11T20:32:00Z");
    const current = {
      fetchedAt: Date.parse("2026-08-11T19:00:00Z"),
      stale: false,
    };
    const delayed = {
      fetchedAt: Date.parse("2026-08-11T18:00:00Z"),
      stale: false,
    };

    expect(faustusRefreshDelayMs(current, now)).toBe(5 * 60_000);
    expect(faustusRefreshDelayMs(delayed, now)).toBe(60_000);
    expect(faustusRefreshDelayMs({ ...current, stale: true }, now)).toBe(60_000);
    expect(faustusRefreshDelayMs(null, now)).toBe(60_000);
  });
});
