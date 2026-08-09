import type {
  CacheEnvelope,
  FaustusOverviewRequest,
  ItemTooltipRequest,
  OverviewRequest,
} from "../types";

export const MOBILE_HTTP_DEADLINE_MS = 35_000;
export const MAX_MOBILE_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_MOBILE_ARTWORK_BYTES = 2_000_000;

const CACHE_KINDS = new Set<CacheEnvelope<unknown>["cache"]>([
  "fresh",
  "network",
  "revalidated",
  "stale",
  "browser",
  "mobile",
]);

export interface MobileStoredResponse<T> {
  envelope: CacheEnvelope<T>;
  etag?: string;
}

const TRUSTED_EXTERNAL_HOSTS = new Set([
  "poe.ninja",
  "www.poewiki.net",
  "poewiki.net",
  "www.pathofexile.com",
  "pathofexile.com",
  "www.craftofexile.com",
  "craftofexile.com",
  "poedb.tw",
  "www.poedb.tw",
]);

export function responseHeader(
  headers: Record<string, string> | undefined,
  wanted: string,
) {
  if (!headers) return undefined;
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === wanted.toLowerCase(),
  );
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function isValidMobileStoredResponse<T>(
  value: unknown,
  validate: (data: unknown) => data is T,
  now = Date.now(),
): value is MobileStoredResponse<T> {
  if (!isRecord(value) || !isRecord(value.envelope)) return false;
  const { envelope } = value;
  if (
    typeof envelope.fetchedAt !== "number" ||
    typeof envelope.expiresAt !== "number"
  ) {
    return false;
  }
  const fetchedAt = envelope.fetchedAt;
  const expiresAt = envelope.expiresAt;
  return (
    Number.isFinite(now) &&
    Number.isFinite(fetchedAt) &&
    fetchedAt >= 0 &&
    fetchedAt <= now &&
    Number.isFinite(expiresAt) &&
    expiresAt >= fetchedAt &&
    typeof envelope.stale === "boolean" &&
    typeof envelope.cache === "string" &&
    CACHE_KINDS.has(envelope.cache as CacheEnvelope<unknown>["cache"]) &&
    (envelope.error == null || typeof envelope.error === "string") &&
    (value.etag == null || typeof value.etag === "string") &&
    validate(envelope.data)
  );
}

export function isExactMobileResponseUrl(requestedValue: string, responseValue: string) {
  try {
    const requested = new URL(requestedValue);
    const response = new URL(responseValue);
    const isSafeHttps = (url: URL) =>
      url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      !url.username &&
      !url.password;
    return (
      isSafeHttps(requested) &&
      isSafeHttps(response) &&
      requested.toString() === response.toString()
    );
  } catch {
    return false;
  }
}

export function assertMobileResponseMetadata(
  requestedUrl: string,
  responseUrl: string,
  headers: Record<string, string> | undefined,
  maximumBytes: number,
) {
  if (!isExactMobileResponseUrl(requestedUrl, responseUrl)) {
    throw new Error("The mobile request was redirected to an untrusted URL.");
  }
  const rawLength = responseHeader(headers, "content-length");
  if (rawLength == null) return;
  if (!/^\d+$/.test(rawLength.trim())) {
    throw new Error("The mobile response declared an invalid size.");
  }
  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength) || contentLength > maximumBytes) {
    throw new Error("The mobile response exceeded the safe size limit.");
  }
}

function utf8ByteLengthExceeds(value: string, maximumBytes: number) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
    if (bytes > maximumBytes) return true;
  }
  return false;
}

export function parseLimitedMobileJson<T>(data: unknown, maximumBytes: number): T {
  let serialized: string;
  try {
    serialized = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    throw new Error("The mobile response was not valid JSON.");
  }
  if (
    typeof serialized !== "string" ||
    utf8ByteLengthExceeds(serialized, maximumBytes)
  ) {
    throw new Error("The mobile response exceeded the safe size limit.");
  }
  try {
    return (typeof data === "string" ? JSON.parse(serialized) : data) as T;
  } catch {
    throw new Error("The mobile response was not valid JSON.");
  }
}

export function decodedBase64ByteLength(value: string) {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function withMobileHttpDeadline<T>(
  operation: Promise<T>,
  timeoutMs = MOBILE_HTTP_DEADLINE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("The mobile request exceeded its wall-clock deadline.")),
      Math.max(1, timeoutMs),
    );
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function responseMaxAge(
  headers: Record<string, string> | undefined,
  fallback: number,
) {
  const cacheControl = responseHeader(headers, "cache-control") || "";
  const maxAgeMatch = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
  const seconds = Number(maxAgeMatch?.[1]);
  const hasSourceLifetime = Boolean(maxAgeMatch) && Number.isFinite(seconds) && seconds > 0;
  const lifetime = hasSourceLifetime ? seconds * 1000 : fallback;
  const ageSeconds = Number(responseHeader(headers, "age"));
  const age =
    hasSourceLifetime && Number.isFinite(ageSeconds) && ageSeconds > 0
      ? ageSeconds * 1000
      : 0;
  return Math.max(1_000, lifetime - age);
}

export function responseSourceTime(
  headers: Record<string, string> | undefined,
  now = Date.now(),
) {
  const ageSeconds = Number(responseHeader(headers, "age"));
  const age = Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds * 1000 : 0;
  const responseDate = Date.parse(responseHeader(headers, "date") || "");
  const responseTime =
    Number.isFinite(responseDate) && Math.abs(responseDate - now) < 10 * 60 * 1000
      ? responseDate
      : now;
  return Math.min(now, Math.max(0, responseTime - age));
}

export function mobileOverviewUrl(request: OverviewRequest) {
  const search = new URLSearchParams({
    league: request.league,
    type: request.type,
  });
  const path =
    request.source === "exchange"
      ? "exchange/current/overview"
      : request.source === "stash-currency"
        ? "stash/current/currency/overview"
        : "stash/current/item/overview";
  return `https://poe.ninja/poe1/api/economy/${path}?${search}`;
}

export function mobileWikiTooltipUrl(
  request: ItemTooltipRequest,
  fields: string,
) {
  const escaped = request.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const search = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    limit: "10",
    tables: "items",
    fields,
    where: `name="${escaped}"`,
  });
  return `https://www.poewiki.net/w/api.php?${search}`;
}

export function faustusRequestCacheKey(request: FaustusOverviewRequest) {
  return `faustus:${request.league}:${request.items
    .map((item) => item.id)
    .sort()
    .join("|")}`;
}

export function trustedExternalUrl(value: string) {
  try {
    const parsed = new URL(value);
    const standardPort = parsed.port === "" || parsed.port === "443";
    return parsed.protocol === "https:" &&
      standardPort &&
      !parsed.username &&
      !parsed.password &&
      TRUSTED_EXTERNAL_HOSTS.has(parsed.hostname)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
