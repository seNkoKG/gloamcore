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

async function requestJson(fetchImpl, url, options, maximumBytes, userAgent) {
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
    if (response.url && response.url !== url) {
      throw new Error("Official Trade redirected unexpectedly.");
    }
    if (response.status === 429) {
      throw new Error("Official Trade is rate-limiting searches. Retry shortly.");
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

function createTradePriceSnapshotService({ fetchImpl = fetch, userAgent }) {
  const cache = new Map();
  return async function getTradePriceSnapshot(rawRequest) {
    const request = validateRequest(rawRequest);
    const cacheKey = `${request.league}\n${request.body}`;
    const cached = cache.get(cacheKey);
    if (!request.force && cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, cached: true };
    }
    const league = encodeURIComponent(request.league);
    const searchUrl = `${TRADE_ORIGIN}${SEARCH_PATH}${league}`;
    const search = await requestJson(fetchImpl, searchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: request.body,
    }, MAX_SEARCH_BYTES, userAgent);
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
      );
      listings = Array.isArray(fetched?.result)
        ? fetched.result.map(sanitizeListing).filter(Boolean)
        : [];
    }
    const result = {
      listings,
      total: Math.max(0, Math.min(1_000_000, Math.round(Number(search?.total) || ids.length))),
      searchId,
      fetchedAt: Date.now(),
      cached: false,
    };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_MS });
    return result;
  };
}

module.exports = {
  createTradePriceSnapshotService,
  sanitizeListing,
  validateRequest,
};
