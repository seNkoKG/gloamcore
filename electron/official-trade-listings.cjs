"use strict";

const crypto = require("node:crypto");

const TRADE_ORIGIN = "https://www.pathofexile.com";
const SEARCH_PATH_PREFIX = "/api/trade/search/";
const EXCHANGE_PATH_PREFIX = "/api/trade/exchange/";
const FETCH_PATH_PREFIX = "/api/trade/fetch/";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CACHE_TTL_MS = 300_000;
const DEFAULT_MAX_STALE_MS = 2 * 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 100;
const MAX_REQUEST_BYTES = 128 * 1024;
// Broad searches can legitimately return thousands of opaque result IDs.
// Two MiB is enough for that official envelope while still bounding memory.
const MAX_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FETCH_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_FETCH_IDS = 10;
const MAX_SEARCH_RESULT_IDS = 100;
const MAX_EXCHANGE_RESULTS = 100;
const EXCHANGE_SHOW_RESULTS = 20;
const MAX_SERVER_COOLDOWN_MS = 24 * 60 * 60_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const DEFAULT_RATE_LIMIT = 1;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 0;
const RATE_LIMIT_SAFETY_MS = 2_000;
const SEARCH_QUEUE_REJECTION_MS = 1_500;
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_LEAGUE = /^[A-Za-z0-9][A-Za-z0-9 ._'()-]{0,79}$/;
const SAFE_RATE_LIMIT_RULE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const BLOCKED_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class PublicTradeError extends Error {
  constructor(message, { searchId = "", total = 0 } = {}) {
    super(message);
    this.name = "PublicTradeError";
    this.searchId = searchId;
    this.total = total;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeLeague(value) {
  if (typeof value !== "string" || value !== value.trim() || !SAFE_LEAGUE.test(value)) {
    throw new Error("A valid Path of Exile league is required.");
  }
  if (value.includes("..")) {
    throw new Error("A valid Path of Exile league is required.");
  }
  return value;
}

function cloneJsonValue(value, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 10_000 || depth > 16) {
    throw new Error("The trade query is too complex.");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) {
      throw new Error("The trade query contains an invalid number.");
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 4_096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      throw new Error("The trade query contains an invalid string.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 2_000) throw new Error("The trade query is too complex.");
    return value.map((entry) => cloneJsonValue(entry, state, depth + 1));
  }
  if (!isPlainObject(value)) {
    throw new Error("The trade query must contain only JSON data.");
  }
  const keys = Object.keys(value);
  if (keys.length > 256) throw new Error("The trade query is too complex.");
  const clone = Object.create(null);
  for (const key of keys) {
    if (
      !key ||
      key.length > 128 ||
      BLOCKED_OBJECT_KEYS.has(key) ||
      /[\u0000-\u001f\u007f]/.test(key)
    ) {
      throw new Error("The trade query contains an invalid field.");
    }
    clone[key] = cloneJsonValue(value[key], state, depth + 1);
  }
  return clone;
}

function validateLookupRequest(rawRequest) {
  if (!isPlainObject(rawRequest)) {
    throw new Error("A trade listing request is required.");
  }
  const keys = Object.keys(rawRequest);
  if (
    keys.length < 2 ||
    keys.length > 4 ||
    !keys.includes("league") ||
    !keys.includes("tradeQuery") ||
    keys.some((key) => (
      key !== "league" && key !== "tradeQuery" && key !== "force" && key !== "api"
    )) ||
    ("api" in rawRequest && rawRequest.api !== "trade" && rawRequest.api !== "exchange") ||
    ("force" in rawRequest && typeof rawRequest.force !== "boolean")
  ) {
    throw new Error("The trade listing request has unexpected fields.");
  }
  const league = sanitizeLeague(rawRequest.league);
  const api = rawRequest.api === "exchange" ? "exchange" : "trade";
  if (!isPlainObject(rawRequest.tradeQuery)) {
    throw new Error("A valid official trade query is required.");
  }
  const queryKeys = Object.keys(rawRequest.tradeQuery);
  if (!isPlainObject(rawRequest.tradeQuery.query)) {
    throw new Error("A valid official trade query is required.");
  }
  if (api === "trade") {
    if (
      queryKeys.length < 1 ||
      queryKeys.some((key) => key !== "query" && key !== "sort") ||
      ("sort" in rawRequest.tradeQuery && !isPlainObject(rawRequest.tradeQuery.sort))
    ) {
      throw new Error("A valid official trade query is required.");
    }
  } else {
    const query = rawRequest.tradeQuery.query;
    const status = query.status;
    const sort = rawRequest.tradeQuery.sort;
    if (
      queryKeys.length !== 3 ||
      queryKeys.some((key) => key !== "engine" && key !== "query" && key !== "sort") ||
      rawRequest.tradeQuery.engine !== "new" ||
      !isPlainObject(status) ||
      Object.keys(status).length !== 1 ||
      !["online", "onlineleague", "any"].includes(status.option) ||
      Object.keys(query).some((key) => (
        key !== "status" && key !== "have" && key !== "want" &&
        key !== "minimum" && key !== "fulfillable"
      )) ||
      !Array.isArray(query.have) ||
      query.have.length < 1 ||
      query.have.length > 2 ||
      query.have.some((value) => typeof value !== "string" || !SAFE_TOKEN.test(value)) ||
      !Array.isArray(query.want) ||
      query.want.length !== 1 ||
      typeof query.want[0] !== "string" ||
      !SAFE_TOKEN.test(query.want[0]) ||
      ("minimum" in query && (
        !Number.isSafeInteger(query.minimum) || query.minimum < 1 || query.minimum > 1_000_000_000
      )) ||
      ("fulfillable" in query && query.fulfillable !== null) ||
      !isPlainObject(sort) ||
      Object.keys(sort).length !== 1 ||
      sort.have !== "asc"
    ) {
      throw new Error("A valid official exchange query is required.");
    }
  }
  const tradeQuery = cloneJsonValue(rawRequest.tradeQuery);
  const body = JSON.stringify(tradeQuery);
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    throw new Error("The trade query is too large.");
  }
  return { api, league, tradeQuery, body, force: rawRequest.force === true };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function cacheKeyFor(request) {
  return crypto
    .createHash("sha256")
    .update(request.api)
    .update("\0")
    .update(request.league)
    .update("\0")
    .update(canonicalJson(request.tradeQuery))
    .digest("hex");
}

function assertOfficialTradeUrl(value, kind, expectedSearchId = "") {
  const url = new URL(value);
  const common =
    url.protocol === "https:" &&
    url.origin === TRADE_ORIGIN &&
    url.port === "" &&
    !url.username &&
    !url.password &&
    !url.hash;
  if (!common) throw new Error("Rejected an untrusted official trade URL.");

  if (kind === "search" || kind === "exchange") {
    const prefix = kind === "exchange" ? EXCHANGE_PATH_PREFIX : SEARCH_PATH_PREFIX;
    const encodedLeague = url.pathname.slice(prefix.length);
    let decodedLeague = "";
    try {
      decodedLeague = decodeURIComponent(encodedLeague);
    } catch {
      throw new Error("Rejected an untrusted official trade URL.");
    }
    if (
      !url.pathname.startsWith(prefix) ||
      !encodedLeague ||
      encodedLeague.includes("/") ||
      !SAFE_LEAGUE.test(decodedLeague) ||
      decodedLeague.includes("..") ||
      url.search
    ) {
      throw new Error("Rejected an untrusted official trade URL.");
    }
  } else if (kind === "fetch") {
    const ids = url.pathname.slice(FETCH_PATH_PREFIX.length).split(",");
    if (
      !url.pathname.startsWith(FETCH_PATH_PREFIX) ||
      ids.length < 1 ||
      ids.length > MAX_FETCH_IDS ||
      ids.some((id) => !SAFE_TOKEN.test(id)) ||
      url.searchParams.size !== 1 ||
      url.searchParams.get("query") !== expectedSearchId
    ) {
      throw new Error("Rejected an untrusted official trade URL.");
    }
  } else {
    throw new Error("Rejected an unknown official trade route.");
  }
  return url.toString();
}

async function readResponseLimited(response, maximumBytes, controller) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    controller.abort();
    throw new Error("Official trade returned an unexpectedly large response.");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    controller.abort();
    throw new Error("Official trade did not provide a bounded response stream.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        controller.abort();
        try {
          await reader.cancel();
        } catch {
          // Aborting the request may already have closed the stream.
        }
        throw new Error("Official trade returned an unexpectedly large response.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

function parsePositiveSeconds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function headerRateLimitRules(headers, name) {
  const policy = String(headers?.get?.(`x-rate-limit-${name}`) || "")
    .split(",")
    .map((part) => part.trim().split(":").map(Number))
    .filter((part) => (
      (part.length === 2 || part.length === 3) &&
      part.every(Number.isSafeInteger) &&
      part[0] > 0 &&
      part[0] <= 1_000_000 &&
      part[1] > 0 &&
      part[1] <= 86_400 &&
      (part[2] === undefined || (part[2] >= 0 && part[2] <= 86_400))
    ));
  const state = String(headers?.get?.(`x-rate-limit-${name}-state`) || "")
    .split(",")
    .map((part) => part.trim().split(":").map(Number))
    .filter((part) => (
      (part.length === 2 || part.length === 3) &&
      part.every(Number.isSafeInteger) &&
      part[0] >= 0 &&
      part[0] <= 1_000_000 &&
      part[1] > 0 &&
      part[1] <= 86_400 &&
      (part[2] === undefined || (part[2] >= 0 && part[2] <= 86_400))
    ));
  return policy.map((rule, index) => ({
    name,
    limit: rule[0],
    periodSeconds: rule[1],
    windowMs: rule[1] * 1_000 + RATE_LIMIT_SAFETY_MS,
    penaltySeconds: rule[2] || 0,
    hits: state[index]?.[0] || 0,
    activePenaltySeconds: state[index]?.[2] || 0,
  }));
}

function allRateLimitRules(headers) {
  const names = [...new Set(String(headers?.get?.("x-rate-limit-rules") || "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => SAFE_RATE_LIMIT_RULE_NAME.test(name)))]
    .slice(0, 32);
  const byWindow = new Map();
  for (const name of names) {
    for (const rule of headerRateLimitRules(headers, name)) {
      const key = `${rule.limit}:${rule.windowMs}`;
      const current = byWindow.get(key);
      if (!current) {
        byWindow.set(key, rule);
      } else {
        // Equal policies can be advertised for both an account and an IP. A
        // single limiter at the most restrictive observed state is equivalent.
        current.hits = Math.max(current.hits, rule.hits);
        current.penaltySeconds = Math.max(current.penaltySeconds, rule.penaltySeconds);
        current.activePenaltySeconds = Math.max(
          current.activePenaltySeconds,
          rule.activePenaltySeconds,
        );
      }
    }
  }
  return [...byWindow.values()]
    .sort((left, right) => left.windowMs - right.windowMs || left.limit - right.limit);
}

function retryAfterMs(headers, now) {
  const raw = headers?.get?.("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_SERVER_COOLDOWN_MS, Math.max(1_000, seconds * 1_000));
    }
    const date = Date.parse(raw);
    if (Number.isFinite(date)) {
      return Math.min(MAX_SERVER_COOLDOWN_MS, Math.max(1_000, date - now));
    }
  }
  const rules = [
    ...allRateLimitRules(headers),
  ];
  const headerPenalty = Math.max(
    0,
    ...rules.map((rule) => Math.max(rule.activePenaltySeconds, rule.penaltySeconds)),
  );
  return Math.min(
    MAX_SERVER_COOLDOWN_MS,
    Math.max(DEFAULT_RATE_LIMIT_COOLDOWN_MS, headerPenalty * 1_000),
  );
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // A redirect/error response may already have closed its body.
  }
}

function safeText(value, maximumLength) {
  if (typeof value !== "string" || value.length > maximumLength) return "";
  const normalized = value
    .replace(/<<[^<>]{1,80}>>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>]/g, "")
    .trim();
  return normalized.length <= maximumLength ? normalized : "";
}

function safeIcon(value) {
  if (typeof value !== "string" || value.length > 2_048) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "web.poecdn.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      (!url.pathname.startsWith("/image/") && !url.pathname.startsWith("/gen/image/"))
    ) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function safePrice(value) {
  if (!isPlainObject(value)) return null;
  const amount = value.amount;
  const currency = safeText(value.currency, 40);
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 1e12 ||
    !/^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,39}$/u.test(currency)
  ) return null;
  return { amount, currency };
}

function safePositiveAmount(value) {
  return Number.isFinite(value) && value > 0 && value <= 1e12 ? value : 0;
}

function safeStock(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : 0;
}

function safeIndexedTimestamp(value) {
  const indexed = safeText(value, 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(indexed)
  ) return "";
  return Number.isFinite(Date.parse(indexed)) ? indexed : "";
}

function sanitizeListingRow(value) {
  if (!isPlainObject(value) || typeof value.id !== "string" || !SAFE_TOKEN.test(value.id)) return null;
  if (!isPlainObject(value.listing) || !isPlainObject(value.item)) return null;
  const listing = value.listing;
  const account = isPlainObject(listing.account) ? listing.account : Object.create(null);
  const item = value.item;
  const indexed = safeIndexedTimestamp(listing.indexed);
  return {
    id: value.id,
    price: safePrice(listing.price),
    indexed,
    seller: {
      account: safeText(account.name, 100),
      character: safeText(account.lastCharacterName, 100),
    },
    item: {
      name: safeText(item.name, 200),
      baseType: safeText(item.baseType || item.typeLine, 200),
      icon: safeIcon(item.icon),
    },
    // The checker displays market evidence only. It never carries whisper
    // commands across IPC or automates contact with another player.
    whisper: "",
    _stackSize: safeStock(item.stackSize) || 0,
    _hasFee: listing.fee != null,
  };
}

function sanitizeSearchPayload(value) {
  if (!isPlainObject(value) || typeof value.id !== "string" || !SAFE_TOKEN.test(value.id)) {
    throw new Error("Official trade returned a malformed search response.");
  }
  if (!Array.isArray(value.result) || value.result.length > 100_000) {
    throw new Error("Official trade returned a malformed search response.");
  }
  const ids = [];
  const seen = new Set();
  for (const candidate of value.result) {
    if (typeof candidate !== "string" || !SAFE_TOKEN.test(candidate)) {
      throw new Error("Official trade returned a malformed search response.");
    }
    if (ids.length < MAX_SEARCH_RESULT_IDS && !seen.has(candidate)) {
      ids.push(candidate);
      seen.add(candidate);
    }
  }
  if (!Number.isSafeInteger(value.total) || value.total < 0 || value.total > 1_000_000_000) {
    throw new Error("Official trade returned a malformed search response.");
  }
  const total = value.total;
  return { searchId: value.id, total, ids };
}

function sanitizeExchangePayload(value, tradeQuery) {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    !SAFE_TOKEN.test(value.id) ||
    !isPlainObject(value.result) ||
    Object.keys(value.result).length > MAX_EXCHANGE_RESULTS ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    value.total > 1_000_000_000
  ) {
    throw new Error("Official trade returned a malformed exchange response.");
  }
  const allowedHave = new Set(tradeQuery.query.have);
  const wanted = tradeQuery.query.want[0];
  const rows = [];
  for (const [resultKey, entry] of Object.entries(value.result)) {
    if (
      !SAFE_TOKEN.test(resultKey) ||
      !isPlainObject(entry) ||
      typeof entry.id !== "string" ||
      !SAFE_TOKEN.test(entry.id) ||
      !isPlainObject(entry.listing) ||
      !Array.isArray(entry.listing.offers)
    ) {
      throw new Error("Official trade returned a malformed exchange response.");
    }
    // This is Awakened's intentional rule: multi-offer entries are ambiguous
    // and are excluded from the displayed market ratio.
    if (entry.listing.offers.length !== 1) continue;
    const offer = entry.listing.offers[0];
    if (!isPlainObject(offer) || !isPlainObject(offer.exchange) || !isPlainObject(offer.item)) {
      throw new Error("Official trade returned a malformed exchange response.");
    }
    const haveCurrency = safeText(offer.exchange.currency, 128);
    const itemCurrency = safeText(offer.item.currency, 128);
    const haveAmount = safePositiveAmount(offer.exchange.amount);
    const itemAmount = safePositiveAmount(offer.item.amount);
    if (
      !SAFE_TOKEN.test(haveCurrency) ||
      !allowedHave.has(haveCurrency) ||
      (itemCurrency && itemCurrency !== wanted) ||
      !haveAmount ||
      !itemAmount
    ) {
      throw new Error("Official trade returned a malformed exchange response.");
    }
    const account = isPlainObject(entry.listing.account)
      ? entry.listing.account
      : Object.create(null);
    const indexed = safeIndexedTimestamp(entry.listing.indexed);
    rows.push({
      // Current Exchange responses use an opaque object key that differs from
      // the public listing id. Awakened consumes entry.id and does not require
      // those two server-controlled identifiers to be equal.
      id: entry.id,
      price: { amount: haveAmount / itemAmount, currency: haveCurrency },
      indexed,
      seller: {
        account: safeText(account.name, 100),
        character: safeText(account.lastCharacterName, 100),
      },
      item: { name: "", baseType: "", icon: "" },
      whisper: "",
      exchange: {
        haveAmount,
        haveCurrency,
        itemAmount,
        itemCurrency: wanted,
        stock: safeStock(offer.item.stock),
      },
    });
  }
  return { searchId: value.id, total: value.total, rows };
}

function publicNormalListing(row, groupedCount = 1, stock = row._stackSize || 0) {
  return {
    id: row.id,
    price: row.price ? { ...row.price } : null,
    indexed: row.indexed,
    seller: { ...row.seller },
    item: { ...row.item },
    whisper: row.whisper,
    groupedCount: Math.max(1, groupedCount),
    stock: Math.max(0, stock),
  };
}

function groupNormalListings(rows) {
  const grouped = [];
  for (const row of rows) {
    if (!grouped.length || row._hasFee) {
      grouped.push({
        row,
        listedTimes: 1,
        groupedCount: 1,
        stock: row._stackSize || 0,
      });
      continue;
    }
    const existing = grouped.find((added, index) => (
      (
        added.row.seller.account === row.seller.account &&
        added.row.price?.currency === row.price?.currency &&
        added.row.price?.amount === row.price?.amount
      ) || (
        added.row.seller.account === row.seller.account &&
        (grouped.length - index) <= 2
      )
    ));
    if (!existing) {
      grouped.push({
        row,
        listedTimes: 1,
        groupedCount: 1,
        stock: row._stackSize || 0,
      });
    } else {
      existing.groupedCount += 1;
      if (existing.stock && row._stackSize) {
        existing.stock += row._stackSize;
      } else {
        existing.listedTimes += 1;
      }
    }
  }
  return grouped;
}

function sanitizeFetchPayload(value, expectedIds) {
  if (!isPlainObject(value) || !Array.isArray(value.result) || value.result.length > MAX_FETCH_IDS) {
    throw new Error("Official trade returned a malformed listing response.");
  }
  const expected = new Set(expectedIds);
  const seen = new Set();
  const rows = [];
  for (const entry of value.result) {
    // A listing can disappear between search and fetch. The official endpoint
    // represents that normal race as null rather than as an invalid payload.
    if (entry === null) continue;
    const row = sanitizeListingRow(entry);
    if (!row || !expected.has(row.id) || seen.has(row.id)) {
      throw new Error("Official trade returned a malformed listing response.");
    }
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

function cloneResult(value, stale = value.stale, error = value.error) {
  return {
    listings: value.listings.map((row) => ({
      ...row,
      price: row.price ? { ...row.price } : null,
      seller: { ...row.seller },
      item: { ...row.item },
      ...(row.exchange ? { exchange: { ...row.exchange } } : {}),
    })),
    api: value.api || "trade",
    total: value.total,
    searchId: value.searchId,
    fetchedAt: value.fetchedAt,
    stale: Boolean(stale),
    error: error || "",
  };
}

function publicErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const clean = safeText(message, 180);
  return clean || "Official trade listings are temporarily unavailable.";
}

function createOfficialTradeListingService({
  fetchImpl = fetch,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  userAgent = "GloamCore (Path of Exile companion)",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  paceMs,
  searchPaceMs = paceMs,
  fetchPaceMs = paceMs,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  maxStaleMs = DEFAULT_MAX_STALE_MS,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
} = {}) {
  // These legacy options remain accepted so existing callers do not break.
  // Awakened PoE Trade does not evenly pace requests; advertised burst windows
  // are authoritative, so fixed cadence values are intentionally not applied.
  void searchPaceMs;
  void fetchPaceMs;
  const cache = new Map();
  const inflight = new Map();
  const createRateLimitPool = () => ({
    gate: Promise.resolve(),
    retryBlockedUntil: 0,
    pending: 0,
    rules: [{
      limit: DEFAULT_RATE_LIMIT,
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
      releaseTimes: [],
    }],
  });
  // GGG's trade contract assigns SEARCH and EXCHANGE to the same policy, so
  // either endpoint consumes the same advertised windows. FETCH has its own
  // policy and remains independent.
  const searchPacing = createRateLimitPool();
  const routePacing = {
    search: searchPacing,
    exchange: searchPacing,
    fetch: createRateLimitPool(),
  };

  function rateLimitKey(rule) {
    return `${rule.limit}:${rule.windowMs}`;
  }

  function pruneRateLimitRule(rule, checkedAt) {
    while (rule.releaseTimes.length && rule.releaseTimes[0] <= checkedAt) {
      rule.releaseTimes.shift();
    }
  }

  function rateLimitDelay(pacing, checkedAt) {
    let delayMs = 0;
    for (const rule of pacing.rules) {
      pruneRateLimitRule(rule, checkedAt);
      if (rule.releaseTimes.length >= rule.limit) {
        delayMs = Math.max(delayMs, rule.releaseTimes[0] - checkedAt);
      }
    }
    return Math.max(0, delayMs);
  }

  function recordRateLimitUse(pacing, checkedAt) {
    for (const rule of pacing.rules) {
      pruneRateLimitRule(rule, checkedAt);
      rule.releaseTimes.push(checkedAt + rule.windowMs);
    }
  }

  function applyAdvertisedRateLimits(pacing, headers, checkedAt) {
    const advertised = allRateLimitRules(headers);
    if (!advertised.length) return;
    const previous = new Map(pacing.rules.map((rule) => [rateLimitKey(rule), rule]));
    pacing.rules = advertised.map((rule) => {
      const existing = previous.get(rateLimitKey(rule));
      const releaseTimes = existing ? existing.releaseTimes : [];
      const next = { limit: rule.limit, windowMs: rule.windowMs, releaseTimes };
      pruneRateLimitRule(next, checkedAt);

      // The server can know about requests made by another app/process. Add
      // conservative full-window slots when its state is ahead of ours, while
      // never discarding local slots merely because a response reports fewer.
      const observedHits = Math.min(rule.limit, Math.max(0, rule.hits));
      while (next.releaseTimes.length < observedHits) {
        next.releaseTimes.push(checkedAt + rule.windowMs);
      }
      next.releaseTimes.sort((left, right) => left - right);
      return next;
    });

    const activePenalty = Math.max(
      0,
      ...advertised.map((rule) => parsePositiveSeconds(rule.activePenaltySeconds)),
    );
    if (activePenalty) {
      pacing.retryBlockedUntil = Math.max(
        pacing.retryBlockedUntil,
        checkedAt + Math.min(MAX_SERVER_COOLDOWN_MS, activePenalty * 1_000),
      );
    }
  }

  function throwIfRetryBlocked(pacing, checkedAt) {
    if (pacing.retryBlockedUntil <= checkedAt) return;
    const seconds = Math.max(1, Math.ceil((pacing.retryBlockedUntil - checkedAt) / 1_000));
    throw new Error(`Official trade is rate-limited. Try again in ${seconds}s.`);
  }

  async function acquireRateLimitSlot(pacing, kind) {
    const checkedAt = now();
    throwIfRetryBlocked(pacing, checkedAt);
    const waitMs = rateLimitDelay(pacing, checkedAt);
    if ((kind === "search" || kind === "exchange") && waitMs >= SEARCH_QUEUE_REJECTION_MS) {
      throw new Error(`Retry after ${Math.max(1, Math.round(waitMs / 1_000))} seconds`);
    }
    if (waitMs) await sleep(waitMs);
    const acquiredAt = Math.max(now(), checkedAt + waitMs);
    throwIfRetryBlocked(pacing, acquiredAt);
    recordRateLimitUse(pacing, acquiredAt);
  }

  function preventQueueCreation(targets) {
    const checkedAt = now();
    let waitMs = 0;
    for (const pacing of targets) {
      throwIfRetryBlocked(pacing, checkedAt);
      waitMs = Math.max(waitMs, rateLimitDelay(pacing, checkedAt));
    }
    if (waitMs >= SEARCH_QUEUE_REJECTION_MS) {
      throw new Error(`Retry after ${Math.max(1, Math.round(waitMs / 1_000))} seconds`);
    }
  }

  async function requestJson(url, { method = "GET", body, maximumBytes, kind, searchId = "" }) {
    const trustedUrl = assertOfficialTradeUrl(url, kind, searchId);
    const pacing = routePacing[kind];
    pacing.pending += 1;
    let releaseGate;
    const previousGate = pacing.gate;
    pacing.gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    await previousGate.catch(() => undefined);
    let gateReleased = false;
    try {
      await acquireRateLimitSlot(pacing, kind);
      // Only admission needs serialization. Once the sliding-window slots are
      // reserved, requests may overlap just as they do in Awakened PoE Trade.
      releaseGate();
      gateReleased = true;

      const controller = new AbortController();
      const deadline = setTimeout(
        () => controller.abort(new Error("Official trade request timed out.")),
        Math.max(250, Math.min(30_000, Math.round(timeoutMs))),
      );
      try {
        const response = await fetchImpl(trustedUrl, {
          method,
          body,
          headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
            "User-Agent": safeText(userAgent, 200) || "GloamCore",
          },
          redirect: "error",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        const finalUrl = assertOfficialTradeUrl(response.url || trustedUrl, kind, searchId);
        if (finalUrl !== trustedUrl) {
          await cancelResponseBody(response);
          throw new Error("Rejected an unexpected official trade response URL.");
        }
        const responseAt = now();
        applyAdvertisedRateLimits(pacing, response.headers, responseAt);
        if (response.status === 429) {
          pacing.retryBlockedUntil = Math.max(
            pacing.retryBlockedUntil,
            responseAt + retryAfterMs(response.headers, responseAt),
          );
          await cancelResponseBody(response);
          throw new Error("Official trade is rate-limited. Please retry shortly.");
        }
        const contentType = String(response.headers?.get?.("content-type") || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!response.ok) {
          await cancelResponseBody(response);
          throw new Error(`Official trade returned HTTP ${response.status}.`);
        }
        if (contentType !== "application/json") {
          await cancelResponseBody(response);
          throw new Error("Official trade returned an unexpected response type.");
        }
        const responseBody = await readResponseLimited(response, maximumBytes, controller);
        try {
          return JSON.parse(responseBody.toString("utf8"));
        } catch {
          throw new Error("Official trade returned invalid JSON.");
        }
      } finally {
        clearTimeout(deadline);
      }
    } finally {
      if (!gateReleased) releaseGate();
      pacing.pending -= 1;
    }
  }

  function pruneCache() {
    while (cache.size > Math.max(1, maxCacheEntries)) {
      cache.delete(cache.keys().next().value);
    }
  }

  function canUseStaleCache(cached, checkedAt) {
    if (!cached) return false;
    const ageMs = checkedAt - cached.value.fetchedAt;
    return ageMs <= cacheTtlMs + maxStaleMs;
  }

  async function fetchTradeBatch(searchId, ids) {
    if (!ids.length) return [];
    const fetchUrl = `${TRADE_ORIGIN}${FETCH_PATH_PREFIX}${ids.join(",")}?query=${encodeURIComponent(searchId)}`;
    const fetchPayload = await requestJson(fetchUrl, {
      maximumBytes: MAX_FETCH_RESPONSE_BYTES,
      kind: "fetch",
      searchId,
    });
    return sanitizeFetchPayload(fetchPayload, ids);
  }

  async function lookupTradeUncached(request) {
    preventQueueCreation([routePacing.search, routePacing.fetch]);
    const searchUrl = `${TRADE_ORIGIN}${SEARCH_PATH_PREFIX}${encodeURIComponent(request.league)}`;
    const searchPayload = await requestJson(searchUrl, {
      method: "POST",
      body: request.body,
      maximumBytes: MAX_SEARCH_RESPONSE_BYTES,
      kind: "search",
    });
    const search = sanitizeSearchPayload(searchPayload);
    try {
      // Awakened starts the first two ten-ID fetches together, preserves result
      // order, then loads more batches only when seller collapsing left too few
      // useful rows. The official FETCH pool still controls actual admission.
      const [first, second] = await Promise.all([
        fetchTradeBatch(search.searchId, search.ids.slice(0, 10)),
        fetchTradeBatch(search.searchId, search.ids.slice(10, 20)),
      ]);
      const fetchedRows = [...first, ...second];
      let fetched = Math.min(20, search.ids.length);
      let grouped = groupNormalListings(fetchedRows);
      while (
        (
          grouped.filter((entry) => entry.listedTimes <= 2).length < 7 ||
          grouped.length < 10
        ) &&
        fetched < search.ids.length &&
        fetched < MAX_SEARCH_RESULT_IDS
      ) {
        fetchedRows.push(...await fetchTradeBatch(
          search.searchId,
          search.ids.slice(fetched, fetched + MAX_FETCH_IDS),
        ));
        fetched += MAX_FETCH_IDS;
        grouped = groupNormalListings(fetchedRows);
      }

      return {
        api: "trade",
        listings: grouped.map((entry) => publicNormalListing(
          entry.row,
          entry.groupedCount,
          entry.stock,
        )),
        total: search.total,
        searchId: search.searchId,
        fetchedAt: now(),
        stale: false,
        error: "",
      };
    } catch (error) {
      throw new PublicTradeError(publicErrorMessage(error), {
        searchId: search.searchId,
        total: search.total,
      });
    }
  }

  async function lookupExchangeUncached(request) {
    preventQueueCreation([routePacing.exchange]);
    const exchangeUrl = `${TRADE_ORIGIN}${EXCHANGE_PATH_PREFIX}${encodeURIComponent(request.league)}`;
    const payload = await requestJson(exchangeUrl, {
      method: "POST",
      body: request.body,
      maximumBytes: MAX_FETCH_RESPONSE_BYTES,
      kind: "exchange",
    });
    const exchange = sanitizeExchangePayload(payload, request.tradeQuery);
    const byCurrency = new Map();
    for (const row of exchange.rows) {
      const currency = row.exchange.haveCurrency;
      const group = byCurrency.get(currency) || [];
      group.push(row);
      byCurrency.set(currency, group);
    }
    const requestedHave = request.tradeQuery.query.have;
    const candidates = requestedHave.map((currency) => {
      const group = byCurrency.get(currency) || [];
      const otherRows = exchange.rows.length - group.length;
      const lazyChaos = currency === "chaos" &&
        group.length < EXCHANGE_SHOW_RESULTS &&
        exchange.total > MAX_EXCHANGE_RESULTS;
      const chaosIsLoaded = currency === "divine" &&
        group.length < exchange.rows.length &&
        (otherRows >= EXCHANGE_SHOW_RESULTS || exchange.total <= MAX_EXCHANGE_RESULTS);
      return {
        currency,
        group,
        lazyChaos,
        total: chaosIsLoaded
          ? group.length
          : Math.max(group.length, exchange.total - otherRows),
      };
    });
    const selectable = candidates.filter((candidate) => !candidate.lazyChaos);
    const selected = (selectable.length ? selectable : candidates).reduce(
      (best, candidate) => (
        !best ||
        candidate.total > best.total ||
        (candidate.total === best.total && candidate.currency === "chaos")
          ? candidate
          : best
      ),
      null,
    );
    const selectedGroup = selected?.group || [];
    const selectedRows = [...selectedGroup]
      .sort((left, right) => left.price.amount - right.price.amount)
      .slice(0, EXCHANGE_SHOW_RESULTS);
    return {
      api: "exchange",
      listings: selectedRows,
      total: selected?.total || 0,
      searchId: exchange.searchId,
      fetchedAt: now(),
      stale: false,
      error: "",
    };
  }

  async function lookupUncached(request) {
    let searchId = "";
    let total = 0;
    try {
      const result = request.api === "exchange"
        ? await lookupExchangeUncached(request)
        : await lookupTradeUncached(request);
      searchId = result.searchId;
      total = result.total;
      return result;
    } catch (error) {
      throw new PublicTradeError(publicErrorMessage(error), {
        searchId: SAFE_TOKEN.test(String(error?.searchId || "")) ? error.searchId : searchId,
        total: Number.isSafeInteger(error?.total) ? error.total : total,
      });
    }
  }

  async function lookup(rawRequest) {
    const request = validateLookupRequest(rawRequest);
    const key = cacheKeyFor(request);
    const checkedAt = now();
    const cached = cache.get(key);
    if (!request.force && cached && checkedAt - cached.value.fetchedAt <= cacheTtlMs) {
      cache.delete(key);
      cache.set(key, cached);
      return cloneResult(cached.value);
    }
    if (inflight.has(key)) {
      try {
        return cloneResult(await inflight.get(key));
      } catch (error) {
        if (canUseStaleCache(cached, now())) {
          return cloneResult(cached.value, true, publicErrorMessage(error));
        }
        return {
          api: request.api,
          listings: [],
          total: Number.isSafeInteger(error?.total) ? error.total : 0,
          searchId: SAFE_TOKEN.test(String(error?.searchId || "")) ? error.searchId : "",
          fetchedAt: now(),
          stale: false,
          error: publicErrorMessage(error),
        };
      }
    }

    const operation = lookupUncached(request);
    inflight.set(key, operation);
    try {
      const value = await operation;
      cache.delete(key);
      cache.set(key, { value });
      pruneCache();
      return cloneResult(value);
    } catch (error) {
      if (canUseStaleCache(cached, checkedAt)) {
        return cloneResult(cached.value, true, publicErrorMessage(error));
      }
      return {
        api: request.api,
        listings: [],
        total: Number.isSafeInteger(error?.total) ? error.total : 0,
        searchId: SAFE_TOKEN.test(String(error?.searchId || "")) ? error.searchId : "",
        fetchedAt: now(),
        stale: false,
        error: publicErrorMessage(error),
      };
    } finally {
      if (inflight.get(key) === operation) inflight.delete(key);
    }
  }

  return Object.freeze({ lookup });
}

module.exports = {
  MAX_FETCH_IDS,
  assertOfficialTradeUrl,
  createOfficialTradeListingService,
  readResponseLimited,
  sanitizeFetchPayload,
  sanitizeListingRow,
  sanitizeSearchPayload,
  validateLookupRequest,
};
