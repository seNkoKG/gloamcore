import type { CacheEnvelope } from "../types";

export const MAX_ACTIONABLE_MARKET_AGE_MS = 2 * 60 * 60 * 1000;
const MIN_MARKET_RETRY_MINUTES = 5;
const MAX_MARKET_RETRY_MINUTES = 30;
const FAUSTUS_POLL_MS = 5 * 60 * 1000;
const FAUSTUS_CATCH_UP_POLL_MS = 60 * 1000;

export function isMarketSnapshotActionable(
  envelope: Pick<CacheEnvelope<unknown>, "fetchedAt"> | null | undefined,
  now = Date.now(),
) {
  const age = envelope ? now - envelope.fetchedAt : Number.NaN;
  return Boolean(
    envelope &&
      Number.isFinite(envelope.fetchedAt) &&
      Number.isFinite(now) &&
      age >= 0 &&
      age <= MAX_ACTIONABLE_MARKET_AGE_MS,
  );
}

export function marketFailureDisposition<T>(
  envelope: CacheEnvelope<T> | null | undefined,
  now = Date.now(),
): { envelope: CacheEnvelope<T> | null; clear: boolean } {
  if (!envelope || !isMarketSnapshotActionable(envelope, now)) {
    return { envelope: null, clear: true };
  }
  return {
    envelope: {
      ...envelope,
      stale: true,
      cache: "stale",
    },
    clear: false,
  };
}

export function marketRetryDelayMs(refreshMinutes: number) {
  const requested = Number.isFinite(refreshMinutes)
    ? refreshMinutes
    : MIN_MARKET_RETRY_MINUTES;
  return (
    Math.min(
      MAX_MARKET_RETRY_MINUTES,
      Math.max(MIN_MARKET_RETRY_MINUTES, requested),
    ) * 60_000
  );
}

export function marketRefreshDelayMs(
  envelope: Pick<
    CacheEnvelope<unknown>,
    "expiresAt" | "fetchedAt" | "stale"
  > | null | undefined,
  refreshMinutes: number,
  now = Date.now(),
) {
  const fallback = marketRetryDelayMs(refreshMinutes);
  if (!envelope) return fallback;
  if (!envelope.stale) {
    return Math.max(1_000, envelope.expiresAt - now + 250);
  }
  const untilRejected =
    envelope.fetchedAt + MAX_ACTIONABLE_MARKET_AGE_MS - now + 250;
  return Math.max(1_000, Math.min(fallback, untilRejected));
}

export function faustusRefreshDelayMs(
  envelope: Pick<CacheEnvelope<unknown>, "fetchedAt" | "stale"> | null | undefined,
  now = Date.now(),
) {
  if (!envelope || envelope.stale) return FAUSTUS_CATCH_UP_POLL_MS;
  const currentHour = Math.floor(now / 3_600_000) * 3_600_000;
  const latestCompletedHour = currentHour - 3_600_000;
  if (envelope.fetchedAt < latestCompletedHour) {
    // The newly completed digest may take a few minutes to appear. Retry
    // promptly without entering a per-second request loop.
    return FAUSTUS_CATCH_UP_POLL_MS;
  }
  return FAUSTUS_POLL_MS;
}
