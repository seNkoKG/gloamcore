import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_ROUTE_COUNT,
  MAX_MANIFEST_BYTES,
  MAX_ROUTE_BYTES,
  MIRROR_CADENCE_MS,
  MIRROR_SCHEMA_VERSION,
  marketRoutes,
  overviewUrl,
  parseCategoryCatalog,
  parseManifestText,
  publishMirrorGeneration,
  retainedPayloadsForGeneration,
  routeFile,
  routeIdentity,
  validateLeagues,
  validateMirrorManifest,
  validateOverviewPayload,
  validateOutputLocation,
  validateOutputFilesystemLocation,
} from "./poe-ninja-mirror-core.mjs";

const UPSTREAM_ROOT = "https://poe.ninja";
const DEFAULT_PREVIOUS_ROOT = "https://senkokg.github.io/gloamcore/data/poe-ninja/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const CONCURRENCY = 4;
const MAX_REUSED_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function cacheSeconds(value) {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(value || "");
  return match ? Number(match[1]) : Math.round(MIRROR_CADENCE_MS / 1000);
}

function responseAgeSeconds(headers) {
  const age = Number(headers.get("age"));
  return Number.isFinite(age) && age > 0 ? age : 0;
}

function responseSourceTime(headers, checkedAt) {
  const parsed = Date.parse(headers.get("date") || "");
  const responseTime = Number.isFinite(parsed) && Math.abs(parsed - checkedAt) < 10 * 60 * 1000
    ? parsed
    : checkedAt;
  return Math.min(checkedAt, Math.max(0, responseTime - responseAgeSeconds(headers) * 1000));
}

async function readLimitedText(response, maximumBytes, label, controller) {
  const declared = response.headers.get("content-length");
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    controller.abort();
    throw new Error(`${label} exceeded the ${maximumBytes}-byte limit.`);
  }
  if (!response.body) throw new Error(`${label} did not provide a response body.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        controller.abort();
        throw new Error(`${label} exceeded the ${maximumBytes}-byte limit.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, bytes };
  } finally {
    reader.releaseLock?.();
  }
}

async function request(url, { etag, maximumBytes, userAgent, allowMissing = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Timed out fetching ${url}`)),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const headers = { Accept: "application/json", "User-Agent": userAgent };
    if (etag) headers["If-None-Match"] = etag;
    const response = await fetch(url, {
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    if (response.url !== url) throw new Error(`Rejected a redirected response for ${url}`);
    if (allowMissing && response.status === 404) return null;
    if (response.status === 304) return { response, text: "", bytes: 0 };
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      throw new Error(`${url} returned ${contentType || "no content type"}, not JSON.`);
    }
    return { response, ...(await readLimitedText(response, maximumBytes, url, controller)) };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimited(values, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await worker(values[index], index);
    }
  }));
  return output;
}

async function previousManifest(previousRoot, userAgent) {
  const manifestUrl = new URL(`${previousRoot}/manifest.json`);
  manifestUrl.searchParams.set("generation", String(Date.now()));
  const result = await request(manifestUrl.href, {
    maximumBytes: MAX_MANIFEST_BYTES,
    userAgent,
    allowMissing: true,
  });
  if (!result) return null;
  const manifest = parseManifestText(result.text);
  if (!manifest) throw new Error("Previous mirror manifest failed validation.");
  return manifest;
}

async function previousPayload(previousRoot, metadata, userAgent) {
  const result = await request(`${previousRoot}/${metadata.file}`, {
    maximumBytes: MAX_ROUTE_BYTES,
    userAgent,
  });
  const data = JSON.parse(result.text);
  if (!validateOverviewPayload(data)) throw new Error("Previous mirror route failed schema validation.");
  const digest = createHash("sha256").update(result.text).digest("hex");
  if (digest !== metadata.sha256 || result.bytes !== metadata.bytes) {
    throw new Error("Previous mirror route failed integrity validation.");
  }
  return result.text;
}

function snapshotMetadata(response, checkedAt, previous = {}) {
  const maxAge = cacheSeconds(response.headers.get("cache-control"));
  const remainingSeconds = Math.max(1, maxAge - responseAgeSeconds(response.headers));
  return {
    upstreamEtag: response.headers.get("etag") || previous.upstreamEtag || null,
    checkedAt,
    sourceUpdatedAt: responseSourceTime(response.headers, checkedAt),
    nextRefreshAt: checkedAt + Math.min(MIRROR_CADENCE_MS, remainingSeconds * 1000),
  };
}

function assertReusableSnapshot(metadata, label, now = Date.now()) {
  const checkedAge = now - Number(metadata?.checkedAt);
  const sourceAge = now - Number(metadata?.sourceUpdatedAt);
  if (
    !Number.isFinite(checkedAge) ||
    checkedAge < 0 ||
    checkedAge > MAX_REUSED_SNAPSHOT_AGE_MS ||
    !Number.isFinite(sourceAge) ||
    sourceAge < 0 ||
    sourceAge > MAX_REUSED_SNAPSHOT_AGE_MS
  ) {
    throw new Error(`${label} is too old to reuse safely.`);
  }
}

const siteRootArgument = argument("--site-root", null);
const siteRoot = siteRootArgument ? path.resolve(siteRootArgument) : null;
const output = validateOutputLocation(
  argument("--output", path.join(projectRoot, ".mirror-site")),
  siteRoot,
  projectRoot,
);
await validateOutputFilesystemLocation(output, siteRoot, projectRoot);
const previousRoot = argument("--previous-root", DEFAULT_PREVIOUS_ROOT).replace(/\/$/, "");
const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const userAgent = `GloamCore/${packageJson.version} market-mirror (contact: https://github.com/seNkoKG/gloamcore)`;
const catalogSource = await fs.readFile(path.join(projectRoot, "src", "config", "categories.ts"), "utf8");
const routes = marketRoutes(parseCategoryCatalog(catalogSource));
const previous = await previousManifest(previousRoot, userAgent);
const previousRoutes = new Map(
  (previous?.routes || []).map((route) => [routeIdentity(route.league, route.source, route.type), route]),
);

const leagueUrl = `${UPSTREAM_ROOT}/poe1/api/economy/leagues`;
let leagueSnapshot;
let leagues;
try {
  const result = await request(leagueUrl, {
    etag: previous?.leagueSnapshot?.upstreamEtag,
    maximumBytes: MAX_MANIFEST_BYTES,
    userAgent,
  });
  const checkedAt = Date.now();
  if (result.response.status === 304) {
    if (!previous) throw new Error("poe.ninja returned 304 without a previous league snapshot.");
    leagues = validateLeagues(previous.leagueSnapshot.data);
  } else {
    leagues = validateLeagues(JSON.parse(result.text));
  }
  leagueSnapshot = {
    data: leagues,
    ...snapshotMetadata(result.response, checkedAt, previous?.leagueSnapshot),
  };
} catch (error) {
  if (!previous) throw error;
  assertReusableSnapshot(previous.leagueSnapshot, "Previous league snapshot");
  console.warn(`Reusing previous league snapshot: ${error instanceof Error ? error.message : String(error)}`);
  leagues = validateLeagues(previous.leagueSnapshot.data);
  leagueSnapshot = previous.leagueSnapshot;
}

const jobs = leagues.flatMap((league) => routes.map((route) => ({ league, route })));
let reused = 0;
let downloaded = 0;
const snapshots = await mapLimited(jobs, async ({ league, route }) => {
  const identity = routeIdentity(league.id, route.source, route.type);
  const prior = previousRoutes.get(identity);
  const url = overviewUrl(UPSTREAM_ROOT, league.id, route);
  let text;
  let metadata;
  try {
    const result = await request(url, {
      etag: prior?.upstreamEtag,
      maximumBytes: MAX_ROUTE_BYTES,
      userAgent,
    });
    const checkedAt = Date.now();
    if (result.response.status === 304) {
      if (!prior) throw new Error("poe.ninja returned 304 without a previous route.");
      text = await previousPayload(previousRoot, prior, userAgent);
      reused += 1;
    } else {
      const data = JSON.parse(result.text);
      if (!validateOverviewPayload(data)) throw new Error("Route failed market schema validation.");
      text = result.text;
      downloaded += 1;
    }
    metadata = snapshotMetadata(result.response, checkedAt, prior);
  } catch (error) {
    if (!prior) throw new Error(`${league.id}/${route.id}: ${error instanceof Error ? error.message : String(error)}`);
    assertReusableSnapshot(prior, `${league.id}/${route.id}`);
    console.warn(`Reusing ${league.id}/${route.id}: ${error instanceof Error ? error.message : String(error)}`);
    text = await previousPayload(previousRoot, prior, userAgent);
    metadata = {
      upstreamEtag: prior.upstreamEtag,
      checkedAt: prior.checkedAt,
      sourceUpdatedAt: prior.sourceUpdatedAt,
      nextRefreshAt: prior.nextRefreshAt,
    };
    reused += 1;
  }
  const bytes = Buffer.byteLength(text);
  if (bytes <= 0 || bytes > MAX_ROUTE_BYTES) throw new Error(`${identity} failed its size bound.`);
  const sha256 = createHash("sha256").update(text).digest("hex");
  const file = routeFile(sha256);
  return {
    text,
    metadata: {
      league: league.id,
      type: route.type,
      source: route.source,
      file,
      ...metadata,
      bytes,
      sha256,
    },
  };
});

const manifestRoutes = snapshots.map((snapshot) => snapshot.metadata);
const generatedAt = Date.now();
const retainedPayloads = retainedPayloadsForGeneration(previous, manifestRoutes, generatedAt);
const payloads = new Map(snapshots.map((snapshot) => [snapshot.metadata.file, snapshot.text]));
if (retainedPayloads.length) {
  if (!previous) throw new Error("Retained payloads require a previous mirror.");
  const retainedTexts = await mapLimited(retainedPayloads, async (metadata) => ({
    file: metadata.file,
    text: await previousPayload(previousRoot, metadata, userAgent),
  }));
  for (const payload of retainedTexts) payloads.set(payload.file, payload.text);
}
const manifest = {
  schemaVersion: MIRROR_SCHEMA_VERSION,
  generatedAt,
  cadenceMs: MIRROR_CADENCE_MS,
  leagueSnapshot,
  routes: manifestRoutes,
  retainedPayloads,
};
if (!validateMirrorManifest(manifest)) throw new Error("Generated mirror manifest failed validation.");
const { totalBytes } = await publishMirrorGeneration({
  output,
  siteRoot,
  projectRoot,
  manifest,
  payloads,
});
console.log(
  `Built poe.ninja mirror: ${leagues.length} leagues x ${EXPECTED_ROUTE_COUNT} routes = ${manifestRoutes.length} payloads; ` +
  `${(totalBytes / 1024 / 1024).toFixed(1)} MiB; ${downloaded} downloaded, ${reused} reused, ` +
  `${retainedPayloads.length} prior payloads retained.`,
);
