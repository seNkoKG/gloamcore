import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MIRROR_SCHEMA_VERSION = 1;
export const EXPECTED_CATEGORY_COUNT = 44;
export const EXPECTED_ROUTE_COUNT = 46;
export const MAX_ACTIVE_LEAGUES = 12;
export const MIRROR_CADENCE_MS = 30 * 60 * 1000;
export const MAX_ROUTE_BYTES = 16 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_MIRROR_BYTES = 512 * 1024 * 1024;
export const MAX_PAGES_SITE_BYTES = 768 * 1024 * 1024;
export const MAX_RETAINED_PAYLOAD_AGE_MS = 24 * 60 * 60 * 1000;

const ROUTE_SOURCES = new Set(["exchange", "stash-currency", "stash-item"]);
const ROUTE_FILE = /^routes\/[a-f0-9]{64}\.json$/;

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value, maximum = 100) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRecordArray(value) {
  return Array.isArray(value) && value.every(isRecord);
}

function optionalRecordArray(record, key) {
  return record[key] == null || isRecordArray(record[key]);
}

function optionalSparkline(record, key) {
  const value = record[key];
  if (value == null) return true;
  return isRecord(value) && (
    value.data == null ||
    (Array.isArray(value.data) && value.data.every(
      (point) => point == null || (typeof point === "number" && Number.isFinite(point)),
    ))
  );
}

export function parseCategoryCatalog(source) {
  const result = [];
  const pattern = /\{\s*id:\s*"([^"]+)"[\s\S]*?apiType:\s*"([^"]+)"[\s\S]*?source:\s*"([^"]+)"/g;
  for (const match of source.matchAll(pattern)) {
    result.push({ id: match[1], type: match[2], source: match[3] });
  }
  return result;
}

export function marketRoutes(catalog) {
  if (!Array.isArray(catalog)) throw new Error("The economy category catalog is invalid.");
  const routes = catalog.flatMap((category) => {
    if (
      !isRecord(category) ||
      !isBoundedText(category.id) ||
      !isBoundedText(category.type) ||
      !["exchange", "item", "dual"].includes(category.source)
    ) {
      throw new Error("The economy category catalog contains an invalid route.");
    }
    if (category.source === "dual") {
      return [
        { id: `${category.id}:exchange`, type: category.type, source: "exchange" },
        { id: `${category.id}:stash-currency`, type: category.type, source: "stash-currency" },
      ];
    }
    return [{
      id: category.id,
      type: category.type,
      source: category.source === "item" ? "stash-item" : "exchange",
    }];
  });
  const identities = new Set(routes.map(({ source, type }) => `${source}\0${type}`));
  if (
    catalog.length !== EXPECTED_CATEGORY_COUNT ||
    routes.length !== EXPECTED_ROUTE_COUNT ||
    identities.size !== routes.length
  ) {
    throw new Error(
      `Configured poe.ninja matrix drifted: ${catalog.length} categories / ${routes.length} routes.`,
    );
  }
  return routes;
}

export function validateLeagues(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ACTIVE_LEAGUES) {
    throw new Error(`Expected between 1 and ${MAX_ACTIVE_LEAGUES} active poe.ninja leagues.`);
  }
  const identities = new Set();
  const leagues = value.map((league) => {
    if (
      !isRecord(league) ||
      !isBoundedText(league.id) ||
      !isBoundedText(league.name) ||
      /[\u0000-\u001f\u007f]/.test(league.id) ||
      /[\u0000-\u001f\u007f]/.test(league.name)
    ) {
      throw new Error("poe.ninja returned an invalid league entry.");
    }
    if (identities.has(league.id)) throw new Error("poe.ninja returned duplicate leagues.");
    identities.add(league.id);
    return { id: league.id, name: league.name };
  });
  return leagues;
}

export function validateOverviewPayload(value) {
  if (!isRecord(value) || !isRecordArray(value.lines)) return false;
  if (!optionalRecordArray(value, "items") || !optionalRecordArray(value, "currencyDetails")) {
    return false;
  }
  if (value.core != null) {
    if (!isRecord(value.core) || !optionalRecordArray(value.core, "items")) return false;
    if (value.core.rates != null && !isRecord(value.core.rates)) return false;
  }
  return value.lines.every((line) =>
    optionalRecordArray(line, "implicitModifiers") &&
    optionalRecordArray(line, "explicitModifiers") &&
    optionalRecordArray(line, "mutatedModifiers") &&
    optionalRecordArray(line, "tradeInfo") &&
    optionalSparkline(line, "sparkline") &&
    optionalSparkline(line, "sparkLine") &&
    optionalSparkline(line, "paySparkLine") &&
    optionalSparkline(line, "receiveSparkLine") &&
    optionalSparkline(line, "lowConfidencePaySparkLine") &&
    optionalSparkline(line, "lowConfidenceReceiveSparkLine"),
  );
}

export function routeIdentity(league, source, type) {
  return `${league}\0${source}\0${type}`;
}

export function routeFile(sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("Mirror route digest is invalid.");
  }
  return `routes/${sha256}.json`;
}

export function retainedPayloadsForGeneration(previous, routes, generatedAt) {
  if (!previous) return [];
  const currentFiles = new Set(routes.map((route) => route.file));
  const retained = new Map();
  const remember = (payload, lastReferencedAt) => {
    if (
      currentFiles.has(payload.file) ||
      !isTimestamp(lastReferencedAt) ||
      lastReferencedAt > generatedAt ||
      generatedAt - lastReferencedAt > MAX_RETAINED_PAYLOAD_AGE_MS
    ) return;
    const existing = retained.get(payload.file);
    if (existing && existing.lastReferencedAt >= lastReferencedAt) return;
    retained.set(payload.file, {
      file: payload.file,
      bytes: payload.bytes,
      sha256: payload.sha256,
      lastReferencedAt,
    });
  };
  for (const route of previous.routes) remember(route, previous.generatedAt);
  for (const payload of previous.retainedPayloads || []) {
    remember(payload, payload.lastReferencedAt);
  }
  return [...retained.values()].sort((left, right) => left.file.localeCompare(right.file));
}

export function overviewUrl(root, league, route) {
  const path = route.source === "stash-item"
    ? "stash/current/item/overview"
    : route.source === "stash-currency"
      ? "stash/current/currency/overview"
      : "exchange/current/overview";
  const search = new URLSearchParams({ league, type: route.type });
  return `${root}/poe1/api/economy/${path}?${search}`;
}

export function validateMirrorManifest(value, { now = Date.now() } = {}) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== MIRROR_SCHEMA_VERSION ||
    !isTimestamp(value.generatedAt) ||
    value.generatedAt > now + 5 * 60 * 1000 ||
    value.cadenceMs !== MIRROR_CADENCE_MS ||
    !isRecord(value.leagueSnapshot) ||
    !isTimestamp(value.leagueSnapshot.checkedAt) ||
    !isTimestamp(value.leagueSnapshot.sourceUpdatedAt) ||
    !isTimestamp(value.leagueSnapshot.nextRefreshAt) ||
    value.leagueSnapshot.sourceUpdatedAt > value.leagueSnapshot.checkedAt ||
    value.leagueSnapshot.checkedAt > value.generatedAt ||
    value.leagueSnapshot.nextRefreshAt < value.leagueSnapshot.checkedAt ||
    value.leagueSnapshot.nextRefreshAt > value.leagueSnapshot.checkedAt + MIRROR_CADENCE_MS ||
    (value.leagueSnapshot.upstreamEtag != null &&
      typeof value.leagueSnapshot.upstreamEtag !== "string") ||
    !Array.isArray(value.leagueSnapshot.data) ||
    !Array.isArray(value.routes)
  ) return false;

  try {
    validateLeagues(value.leagueSnapshot.data);
  } catch {
    return false;
  }
  if (value.routes.length !== value.leagueSnapshot.data.length * EXPECTED_ROUTE_COUNT) return false;

  const identities = new Set();
  const files = new Map();
  const leagueIds = new Set(value.leagueSnapshot.data.map((league) => league.id));
  const leagueRouteCounts = new Map([...leagueIds].map((league) => [league, 0]));
  for (const route of value.routes) {
    if (
      !isRecord(route) ||
      !isBoundedText(route.league) ||
      !isBoundedText(route.type) ||
      !ROUTE_SOURCES.has(route.source) ||
      !ROUTE_FILE.test(route.file) ||
      typeof route.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(route.sha256) ||
      route.file !== routeFile(route.sha256) ||
      !isTimestamp(route.checkedAt) ||
      !isTimestamp(route.sourceUpdatedAt) ||
      !isTimestamp(route.nextRefreshAt) ||
      route.sourceUpdatedAt > route.checkedAt ||
      route.checkedAt > value.generatedAt ||
      route.nextRefreshAt < route.checkedAt ||
      route.nextRefreshAt > route.checkedAt + MIRROR_CADENCE_MS ||
      !Number.isSafeInteger(route.bytes) ||
      route.bytes <= 0 ||
      route.bytes > MAX_ROUTE_BYTES ||
      (route.upstreamEtag != null && typeof route.upstreamEtag !== "string") ||
      !leagueIds.has(route.league)
    ) return false;
    const identity = routeIdentity(route.league, route.source, route.type);
    const existingBytes = files.get(route.file);
    if (identities.has(identity) || (existingBytes != null && existingBytes !== route.bytes)) {
      return false;
    }
    identities.add(identity);
    files.set(route.file, route.bytes);
    leagueRouteCounts.set(route.league, leagueRouteCounts.get(route.league) + 1);
  }
  if (![...leagueRouteCounts.values()].every((count) => count === EXPECTED_ROUTE_COUNT)) {
    return false;
  }
  if (value.retainedPayloads != null && !Array.isArray(value.retainedPayloads)) return false;
  for (const payload of value.retainedPayloads || []) {
    if (
      !isRecord(payload) ||
      typeof payload.file !== "string" ||
      !ROUTE_FILE.test(payload.file) ||
      typeof payload.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.sha256) ||
      payload.file !== routeFile(payload.sha256) ||
      !Number.isSafeInteger(payload.bytes) ||
      payload.bytes <= 0 ||
      payload.bytes > MAX_ROUTE_BYTES ||
      !isTimestamp(payload.lastReferencedAt) ||
      payload.lastReferencedAt > value.generatedAt ||
      value.generatedAt - payload.lastReferencedAt > MAX_RETAINED_PAYLOAD_AGE_MS ||
      files.has(payload.file)
    ) return false;
    files.set(payload.file, payload.bytes);
  }
  return [...files.values()].reduce((total, bytes) => total + bytes, 0) <= MAX_MIRROR_BYTES;
}

export function parseManifestText(text, options) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_MANIFEST_BYTES) return null;
  try {
    const manifest = JSON.parse(text);
    return validateMirrorManifest(manifest, options) ? manifest : null;
  } catch {
    return null;
  }
}

export function validateOutputLocation(output, siteRoot, projectRoot) {
  const resolvedOutput = path.resolve(output);
  const containmentRoot = path.resolve(siteRoot || projectRoot);
  const relative = path.relative(containmentRoot, resolvedOutput);
  if (
    resolvedOutput === path.parse(resolvedOutput).root ||
    resolvedOutput === containmentRoot ||
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Mirror output must be a child of the declared site root.");
  }
  return resolvedOutput;
}

function isContainedPath(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function lstatIfPresent(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

async function directoryBytesExcluding(directory, excluded) {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (path.resolve(target) === excluded) continue;
    if (entry.isDirectory()) total += await directoryBytesExcluding(target, excluded);
    else if (entry.isFile()) total += (await fs.stat(target)).size;
    else throw new Error(`Pages artifact contains an unsupported entry: ${target}`);
    if (total > MAX_PAGES_SITE_BYTES) break;
  }
  return total;
}

export async function validateOutputFilesystemLocation(
  output,
  siteRoot,
  projectRoot,
) {
  const resolvedOutput = validateOutputLocation(output, siteRoot, projectRoot);
  const containmentRoot = path.resolve(siteRoot || projectRoot);
  const rootStat = await fs.lstat(containmentRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("The declared site root must be a real directory.");
  }
  const realRoot = await fs.realpath(containmentRoot);
  let cursor = containmentRoot;
  const relativeParts = path.relative(containmentRoot, resolvedOutput)
    .split(path.sep)
    .filter(Boolean);
  for (const part of relativeParts) {
    cursor = path.join(cursor, part);
    const stat = await lstatIfPresent(cursor);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(`Mirror output path contains a symbolic link: ${cursor}`);
    }
    const realCursor = await fs.realpath(cursor);
    if (!isContainedPath(realRoot, realCursor)) {
      throw new Error("Mirror output resolves outside the declared site root.");
    }
  }
  for (const name of ["routes", "manifest.json"]) {
    const target = path.join(resolvedOutput, name);
    const stat = await lstatIfPresent(target);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(`Mirror output target is a symbolic link: ${target}`);
    }
    const realTarget = await fs.realpath(target);
    if (!isContainedPath(realRoot, realTarget)) {
      throw new Error("Mirror output target resolves outside the declared site root.");
    }
  }
  return resolvedOutput;
}

export async function publishMirrorGeneration({
  output,
  siteRoot,
  projectRoot,
  manifest,
  payloads,
}) {
  if (!validateMirrorManifest(manifest)) {
    throw new Error("Generated mirror manifest failed validation.");
  }
  const manifestText = `${JSON.stringify(manifest)}\n`;
  if (Buffer.byteLength(manifestText) > MAX_MANIFEST_BYTES) {
    throw new Error("Mirror manifest exceeded its size bound.");
  }
  const expectedPayloads = new Map();
  for (const payload of [...manifest.routes, ...(manifest.retainedPayloads || [])]) {
    expectedPayloads.set(payload.file, payload);
  }
  if (!(payloads instanceof Map) || payloads.size !== expectedPayloads.size) {
    throw new Error("Mirror payload set does not match its manifest.");
  }
  let totalBytes = Buffer.byteLength(manifestText);
  for (const [file, metadata] of expectedPayloads) {
    const text = payloads.get(file);
    if (typeof text !== "string") throw new Error(`Mirror payload is missing: ${file}`);
    const bytes = Buffer.byteLength(text);
    const sha256 = createHash("sha256").update(text).digest("hex");
    if (bytes !== metadata.bytes || sha256 !== metadata.sha256 || file !== routeFile(sha256)) {
      throw new Error(`Mirror payload failed integrity validation: ${file}`);
    }
    totalBytes += bytes;
  }
  if (totalBytes > MAX_MIRROR_BYTES) {
    throw new Error(`Mirror exceeded the ${MAX_MIRROR_BYTES}-byte aggregate limit.`);
  }

  const resolvedOutput = await validateOutputFilesystemLocation(
    output,
    siteRoot,
    projectRoot,
  );
  if (siteRoot) {
    const existingSiteBytes = await directoryBytesExcluding(
      path.resolve(siteRoot),
      resolvedOutput,
    );
    if (existingSiteBytes + totalBytes > MAX_PAGES_SITE_BYTES) {
      throw new Error(`Pages artifact exceeded the ${MAX_PAGES_SITE_BYTES}-byte aggregate limit.`);
    }
  }
  const parent = path.dirname(resolvedOutput);
  await fs.mkdir(parent, { recursive: true });
  await validateOutputFilesystemLocation(resolvedOutput, siteRoot, projectRoot);
  const staging = await fs.mkdtemp(path.join(parent, `.${path.basename(resolvedOutput)}-staging-`));
  const backup = path.join(parent, `.${path.basename(resolvedOutput)}-previous-${randomUUID()}`);
  let stagingExists = true;
  let backupExists = false;
  try {
    await fs.mkdir(path.join(staging, "routes"));
    for (const [file, text] of payloads) {
      await fs.writeFile(path.join(staging, file), text, "utf8");
    }
    await fs.writeFile(path.join(staging, "manifest.json"), manifestText, "utf8");

    const existing = await lstatIfPresent(resolvedOutput);
    if (existing) {
      await fs.rename(resolvedOutput, backup);
      backupExists = true;
    }
    try {
      await fs.rename(staging, resolvedOutput);
      stagingExists = false;
    } catch (error) {
      if (backupExists) {
        try {
          await fs.rename(backup, resolvedOutput);
          backupExists = false;
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `Mirror publication failed and the previous output remains at ${backup}.`,
          );
        }
      }
      throw error;
    }
    if (backupExists) {
      await fs.rm(backup, { recursive: true, force: true });
      backupExists = false;
    }
    return { manifestText, totalBytes };
  } finally {
    if (stagingExists) await fs.rm(staging, { recursive: true, force: true });
  }
}
