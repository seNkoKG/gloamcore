import fs from "node:fs/promises";

const ROOT = "https://poe.ninja";
const TIMEOUT_MS = 30_000;
const CONCURRENCY = 4;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function cacheSeconds(value, directive) {
  const match = new RegExp(`(?:^|,)\\s*${directive}=(\\d+)`, "i").exec(value || "");
  return match ? Number(match[1]) : null;
}

async function requestJson(url, userAgent) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Timed out after ${TIMEOUT_MS}ms`)),
    TIMEOUT_MS,
  );
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: controller.signal,
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return {
      data: JSON.parse(text),
      bytes: Buffer.byteLength(text),
      elapsedMs,
      cacheControl: response.headers.get("cache-control") || "",
      ageSeconds: Number(response.headers.get("age") || 0),
      etag: response.headers.get("etag"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function categories() {
  const source = await fs.readFile(new URL("../src/config/categories.ts", import.meta.url), "utf8");
  const result = [];
  const pattern = /\{\s*id:\s*"([^"]+)"[\s\S]*?apiType:\s*"([^"]+)"[\s\S]*?source:\s*"([^"]+)"/g;
  for (const match of source.matchAll(pattern)) {
    result.push({ id: match[1], type: match[2], source: match[3] });
  }
  if (result.length < 30) throw new Error("Could not read the economy category catalog.");
  return result;
}

function marketRoutes(catalog) {
  return catalog.flatMap((category) => {
    if (category.source === "dual") {
      return [
        { ...category, id: `${category.id}:exchange`, source: "exchange" },
        { ...category, id: `${category.id}:stash-currency`, source: "stash-currency" },
      ];
    }
    return [{
      ...category,
      source: category.source === "item" ? "stash-item" : "exchange",
    }];
  });
}

function overviewUrl(league, route) {
  const path = route.source === "stash-item"
    ? "stash/current/item/overview"
    : route.source === "stash-currency"
      ? "stash/current/currency/overview"
      : "exchange/current/overview";
  const search = new URLSearchParams({ league, type: route.type });
  return `${ROOT}/poe1/api/economy/${path}?${search}`;
}

function inspect(route, response) {
  const lines = response.data?.lines;
  if (!Array.isArray(lines)) throw new Error("payload has no lines array");
  const itemSource = route.source === "stash-item";
  const stashCurrencySource = route.source === "stash-currency";
  const identifiers = new Set();
  let duplicateIds = 0;
  let invalidPrices = 0;
  let guardedEstimates = 0;
  let missingHistory = 0;
  for (const line of lines) {
    const id = String(
      stashCurrencySource
        ? line?.detailsId || line?.currencyTypeName || ""
        : line?.id ?? "",
    );
    if (!id || identifiers.has(id)) duplicateIds += 1;
    identifiers.add(id);
    const price = itemSource
      ? line?.chaosValue
      : stashCurrencySource
        ? line?.chaosEquivalent
        : line?.primaryValue;
    if (!positive(price)) invalidPrices += 1;
    const sample = itemSource
      ? Math.min(
          ...[line?.listingCount, line?.count]
            .map(Number)
            .filter((value) => Number.isFinite(value) && value > 0),
        )
      : stashCurrencySource
        ? Math.max(
            Number(line?.pay?.count ?? Number.NaN),
            Number(line?.receive?.count ?? Number.NaN),
          )
        : Number(line?.volumePrimaryValue);
    if (!Number.isFinite(sample) || sample < 5) guardedEstimates += 1;
    const history = itemSource
      ? line?.sparkLine?.data
      : stashCurrencySource
        ? line?.receiveSparkLine?.data || line?.paySparkLine?.data
        : line?.sparkline?.data;
    if (!Array.isArray(history) || history.filter((point) => Number.isFinite(Number(point))).length < 2) {
      missingHistory += 1;
    }
  }
  const maxAge = cacheSeconds(response.cacheControl, "max-age");
  return {
    id: route.id,
    source: route.source,
    rows: lines.length,
    guardedEstimates,
    invalidPrices,
    duplicateIds,
    missingHistory,
    ageSeconds: response.ageSeconds,
    maxAge,
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
    etag: Boolean(response.etag),
  };
}

async function mapLimited(values, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await worker(values[index]);
      }
    }),
  );
  return results;
}

const packageJson = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const userAgent = `GloamCore/${packageJson.version} live-market-audit (contact: https://github.com/seNkoKG/gloamcore)`;
const leagueEnvelope = await requestJson(`${ROOT}/poe1/api/economy/leagues`, userAgent);
if (!Array.isArray(leagueEnvelope.data) || leagueEnvelope.data.length === 0) {
  throw new Error("poe.ninja returned no active leagues.");
}
const requestedLeague = process.argv[2];
const league = requestedLeague || leagueEnvelope.data[0].id;
if (!leagueEnvelope.data.some((entry) => entry.id === league)) {
  throw new Error(`League ${league} is not active.`);
}

const catalog = await categories();
const routes = marketRoutes(catalog);
if (catalog.length !== 44 || routes.length !== 46 || !catalog.some((entry) => entry.type === "Flask")) {
  throw new Error(`Configured poe.ninja matrix drifted: ${catalog.length} types / ${routes.length} routes.`);
}
const failures = [];
const results = await mapLimited(routes, async (route) => {
  try {
    return inspect(route, await requestJson(overviewUrl(league, route), userAgent));
  } catch (error) {
    failures.push({ id: route.id, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
});
const valid = results.filter(Boolean);
const totals = valid.reduce(
  (sum, result) => ({
    rows: sum.rows + result.rows,
    guarded: sum.guarded + result.guardedEstimates,
    invalid: sum.invalid + result.invalidPrices,
    missingHistory: sum.missingHistory + result.missingHistory,
    bytes: sum.bytes + result.bytes,
  }),
  { rows: 0, guarded: 0, invalid: 0, missingHistory: 0, bytes: 0 },
);

console.log(`Live market audit · ${league}`);
console.log(`Routes ${valid.length}/${routes.length} · Types ${catalog.length} · Rows ${totals.rows.toLocaleString()} · Download ${(totals.bytes / 1024 / 1024).toFixed(1)} MiB`);
console.log(`Guarded estimates ${totals.guarded.toLocaleString()} · Invalid prices safely dropped ${totals.invalid.toLocaleString()} · Rows without usable history ${totals.missingHistory.toLocaleString()}`);
console.table(
  [...valid]
    .sort((a, b) => b.guardedEstimates - a.guardedEstimates || b.rows - a.rows)
    .slice(0, 12)
    .map(({ id, source, rows, guardedEstimates, invalidPrices, ageSeconds, maxAge, elapsedMs }) => ({
      category: id,
      source,
      rows,
      guarded: guardedEstimates,
      invalid: invalidPrices,
      age: `${ageSeconds}s/${maxAge ?? "?"}s`,
      request: `${elapsedMs}ms`,
    })),
);

const duplicateFailures = valid.filter((result) => result.duplicateIds > 0);
if (failures.length || duplicateFailures.length) {
  for (const failure of failures) console.error(`${failure.id}: ${failure.error}`);
  for (const result of duplicateFailures) {
    console.error(`${result.id}: ${result.duplicateIds} duplicate or missing row identifiers`);
  }
  process.exitCode = 1;
} else {
  console.log("PASS · every configured category returned a valid, uniquely keyed live payload");
}
