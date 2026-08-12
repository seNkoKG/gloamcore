"use strict";

const { readResponseBufferLimited } = require("./bounded-remote-fetch.cjs");

const TRADE_ORIGIN = "https://www.pathofexile.com";
const SEARCH_PATH = "/api/trade/search/";
const FETCH_PATH = "/api/trade/fetch/";
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_FETCH_BYTES = 4 * 1024 * 1024;
const MAX_FETCH_IDS = 10;
const TIMEOUT_MS = 10_000;
const CACHE_MS = 30_000;
const MIN_REQUEST_INTERVAL_MS = 750;
const DEFAULT_RATE_LIMIT_MS = 60_000;
const SAFE_LEAGUE = /^[A-Za-z0-9][A-Za-z0-9 ._'()-]{0,79}$/;
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function cleanText(value, maximum = 120) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum)
    : "";
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A Trade price request is required.");
  }
  const keys = Object.keys(value);
  if (
    keys.some((key) => key !== "league" && key !== "tradeQuery" && key !== "force") ||
    ("force" in value && typeof value.force !== "boolean") ||
    typeof value.league !== "string" ||
    value.league !== value.league.trim() ||
    !SAFE_LEAGUE.test(value.league) ||
    value.league.includes("..") ||
    !value.tradeQuery ||
    typeof value.tradeQuery !== "object" ||
    Array.isArray(value.tradeQuery)
  ) {
    throw new Error("The Trade price request is invalid.");
  }
  const body = JSON.stringify(value.tradeQuery, (key, entry) => {
    if (BLOCKED_KEYS.has(key)) throw new Error("The Trade query contains a blocked field.");
    if (typeof entry === "string" && entry.length > 4_096) {
      throw new Error("The Trade query contains an oversized value.");
    }
    if (typeof entry === "number" && !Number.isFinite(entry)) {
      throw new Error("The Trade query contains an invalid number.");
    }
    return entry;
  });
  if (!body || Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
    throw new Error("The Trade query is too large.");
  }
  const parsed = JSON.parse(body);
  if (!parsed.query || typeof parsed.query !== "object" || Array.isArray(parsed.query)) {
    throw new Error("The Trade query is missing its query object.");
  }
  return {
    league: value.league,
    body,
    force: value.force === true,
  };
}

function rateTriples(value) {
  return typeof value === "string"
    ? value.split(",").map((entry) => {
        const values = entry.trim().split(":").map(Number);
        return values.length === 3 && values.every(
          (number) => Number.isFinite(number) && number >= 0,
        ) ? values : null;
      })
    : [];
}

function retryAfterMilliseconds(value, now) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(0, deadline - now) : 0;
}

function rateLimitTiming(headers, status, now) {
  let spacingMs = 0;
  let cooldownMs = retryAfterMilliseconds(headers.get("retry-after"), now);
  const rules = (headers.get("x-rate-limit-rules") || "")
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter((rule) => /^[a-z][a-z0-9_-]{0,31}$/.test(rule));
  for (const rule of rules) {
    const limits = rateTriples(headers.get(`x-rate-limit-${rule}`));
    const states = rateTriples(headers.get(`x-rate-limit-${rule}-state`));
    for (let index = 0; index < Math.min(limits.length, states.length); index += 1) {
      const limit = limits[index];
      const state = states[index];
      if (!limit || !state) continue;
      const [maximumHits, periodSeconds] = limit;
      const [currentHits, , restrictionSeconds] = state;
      if (restrictionSeconds > 0) {
        cooldownMs = Math.max(cooldownMs, restrictionSeconds * 1_000);
      } else if (
        maximumHits > 0 &&
        periodSeconds > 0 &&
        currentHits >= maximumHits
      ) {
        // GGG's rule is a hit ceiling inside a tested window, not a mandate
        // to distribute every allowed hit evenly across that entire period.
        // Once the state reaches the ceiling, stop locally for one complete
        // window instead of issuing the request that would trigger a 429.
        cooldownMs = Math.max(cooldownMs, periodSeconds * 1_000);
      }
    }
  }
  if (status === 429 && cooldownMs === 0) cooldownMs = DEFAULT_RATE_LIMIT_MS;
  return { spacingMs, cooldownMs };
}

function cooldownError(milliseconds) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1_000));
  const duration = seconds >= 3_600
    ? `${Math.ceil(seconds / 3_600)}h`
    : seconds >= 60
      ? `${Math.ceil(seconds / 60)}m`
      : `${seconds}s`;
  return new Error(`Official Trade cooldown active. Retry in ${duration}.`);
}

function supersededError() {
  const error = new Error("Trade price request superseded by newer filters.");
  error.code = "ERR_TRADE_PRICE_SUPERSEDED";
  return error;
}

async function requestJson(
  fetchImpl,
  url,
  options,
  maximumBytes,
  userAgent,
  rateGate,
  ensureCurrent = () => undefined,
) {
  await rateGate.beforeRequest();
  // A selection can change while this request is waiting for the official
  // rate gate. Never spend a Trade request on a filter state the user has
  // already replaced.
  ensureCurrent();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Official Trade timed out.")),
    TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
        ...(options.headers || {}),
      },
      redirect: "error",
      signal: controller.signal,
    });
    rateGate.observe(response);
    if (response.url && response.url !== url) {
      throw new Error("Official Trade redirected unexpectedly.");
    }
    if (response.status === 429) {
      throw rateGate.cooldownError();
    }
    if (!response.ok) {
      throw new Error(`Official Trade request failed (${response.status}).`);
    }
    const bytes = await readResponseBufferLimited(
      response,
      maximumBytes,
      "Official Trade",
      controller,
    );
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("Official Trade returned invalid JSON.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeListing(entry) {
  const amount = Number(entry?.listing?.price?.amount);
  const currency = cleanText(entry?.listing?.price?.currency, 32).toLowerCase();
  const id = cleanText(entry?.id, 128);
  if (
    !SAFE_TOKEN.test(id) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 1e12 ||
    !/^[a-z][a-z0-9_-]{0,31}$/.test(currency)
  ) return null;
  const indexedValue = Date.parse(entry?.listing?.indexed);
  return {
    id,
    amount,
    currency,
    seller: cleanText(entry?.listing?.account?.name, 80) || "Seller",
    indexed: Number.isFinite(indexedValue)
      ? new Date(indexedValue).toISOString()
      : "",
    itemName: cleanText(entry?.item?.name || entry?.item?.typeLine, 160),
  };
}

function createTradePriceSnapshotService({
  fetchImpl = fetch,
  userAgent,
  minimumIntervalMs = MIN_REQUEST_INTERVAL_MS,
  nowImpl = Date.now,
  waitImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const cache = new Map();
  const pending = new Map();
  let queue = Promise.resolve();
  let newestGeneration = 0;
  let nextRequestAt = 0;
  let blockedUntil = 0;
  const safeMinimumInterval = Math.max(0, Math.round(Number(minimumIntervalMs) || 0));
  const rateGate = {
    async beforeRequest() {
      const now = nowImpl();
      if (blockedUntil > now) throw cooldownError(blockedUntil - now);
      const delay = Math.max(0, nextRequestAt - now);
      if (delay) await waitImpl(delay);
      const resumedAt = nowImpl();
      if (blockedUntil > resumedAt) throw cooldownError(blockedUntil - resumedAt);
      nextRequestAt = Math.max(nextRequestAt, resumedAt + safeMinimumInterval);
    },
    observe(response) {
      const now = nowImpl();
      const timing = rateLimitTiming(response.headers, response.status, now);
      nextRequestAt = Math.max(
        nextRequestAt,
        now + Math.max(safeMinimumInterval, timing.spacingMs),
      );
      if (timing.cooldownMs > 0) {
        blockedUntil = Math.max(blockedUntil, now + timing.cooldownMs);
      }
    },
    cooldownError() {
      return cooldownError(Math.max(1, blockedUntil - nowImpl()));
    },
  };

  return function getTradePriceSnapshot(rawRequest) {
    const request = validateRequest(rawRequest);
    const cacheKey = `${request.league}\n${request.body}`;
    const existing = pending.get(cacheKey);
    if (!request.force && existing?.generation === newestGeneration) {
      return existing.operation;
    }
    const generation = ++newestGeneration;
    const ensureCurrent = () => {
      if (generation !== newestGeneration) throw supersededError();
    };
    const cached = cache.get(cacheKey);
    if (!request.force && cached && cached.expiresAt > nowImpl()) {
      return Promise.resolve({ ...cached.result, cached: true });
    }

    const operation = queue.then(async () => {
      ensureCurrent();
      const refreshed = cache.get(cacheKey);
      if (!request.force && refreshed && refreshed.expiresAt > nowImpl()) {
        return { ...refreshed.result, cached: true };
      }
      const league = encodeURIComponent(request.league);
      const searchUrl = `${TRADE_ORIGIN}${SEARCH_PATH}${league}`;
      const search = await requestJson(fetchImpl, searchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: request.body,
      }, MAX_SEARCH_BYTES, userAgent, rateGate, ensureCurrent);
      // Search and fetch are separate rate-limited calls. If the user changed
      // another checkbox while the search was in flight, skip its now-useless
      // fetch so the final selection is not stuck behind stale work.
      ensureCurrent();
      const searchId = cleanText(search?.id, 128);
      if (!SAFE_TOKEN.test(searchId)) {
        throw new Error("Official Trade returned an invalid search identifier.");
      }
      const ids = Array.isArray(search?.result)
        ? search.result.filter((id) => typeof id === "string" && SAFE_TOKEN.test(id)).slice(0, MAX_FETCH_IDS)
        : [];
      let listings = [];
      if (ids.length) {
        const fetchUrl = `${TRADE_ORIGIN}${FETCH_PATH}${ids.join(",")}?query=${encodeURIComponent(searchId)}`;
        const fetched = await requestJson(
          fetchImpl,
          fetchUrl,
          { method: "GET" },
          MAX_FETCH_BYTES,
          userAgent,
          rateGate,
          ensureCurrent,
        );
        ensureCurrent();
        listings = Array.isArray(fetched?.result)
          ? fetched.result.map(sanitizeListing).filter(Boolean)
          : [];
      }
      const result = {
        listings,
        total: Math.max(0, Math.min(1_000_000, Math.round(Number(search?.total) || ids.length))),
        searchId,
        fetchedAt: nowImpl(),
        cached: false,
      };
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { result, expiresAt: nowImpl() + CACHE_MS });
      return result;
    });
    const pendingEntry = { generation, operation };
    pending.set(cacheKey, pendingEntry);
    queue = operation.then(() => undefined, () => undefined);
    operation.then(
      () => {
        if (pending.get(cacheKey) === pendingEntry) pending.delete(cacheKey);
      },
      () => {
        if (pending.get(cacheKey) === pendingEntry) pending.delete(cacheKey);
      },
    );
    return operation;
  };
}

module.exports = {
  createTradePriceSnapshotService,
  sanitizeListing,
  validateRequest,
};
