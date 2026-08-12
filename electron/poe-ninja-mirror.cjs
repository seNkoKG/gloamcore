"use strict";

const POE_NINJA_MIRROR_ROOT =
  "https://senkokg.github.io/gloamcore/data/poe-ninja/v1";
const POE_NINJA_MIRROR_MANIFEST_URL = `${POE_NINJA_MIRROR_ROOT}/manifest.json`;
const MIRROR_SCHEMA_VERSION = 1;
const MIRROR_CADENCE_MS = 30 * 60 * 1000;
const MAX_ACTIONABLE_MIRROR_AGE_MS = 2 * 60 * 60 * 1000;
const EXPECTED_ROUTES_PER_LEAGUE = 46;
const MAX_ACTIVE_LEAGUES = 12;
const MAX_ROUTE_BYTES = 16 * 1024 * 1024;
const MAX_MIRROR_BYTES = 512 * 1024 * 1024;
const ROUTE_FILE = /^routes\/[a-f0-9]{64}\.json$/;
const ROUTE_SOURCES = new Set(["exchange", "stash-currency", "stash-item"]);

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isText(value, maximum = 100) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function contentAddressedFile(sha256) {
  return `routes/${sha256}.json`;
}

function validSnapshotTimes(value, generatedAt) {
  return (
    isTimestamp(value.checkedAt) &&
    isTimestamp(value.sourceUpdatedAt) &&
    isTimestamp(value.nextRefreshAt) &&
    value.sourceUpdatedAt <= value.checkedAt &&
    value.checkedAt <= generatedAt &&
    value.nextRefreshAt >= value.checkedAt &&
    value.nextRefreshAt <= value.checkedAt + MIRROR_CADENCE_MS &&
    (value.upstreamEtag == null || typeof value.upstreamEtag === "string")
  );
}

function isPoeNinjaMirrorManifest(value, now = Date.now()) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== MIRROR_SCHEMA_VERSION ||
    value.cadenceMs !== MIRROR_CADENCE_MS ||
    !isTimestamp(value.generatedAt) ||
    value.generatedAt > now + 5 * 60 * 1000 ||
    !isRecord(value.leagueSnapshot) ||
    !validSnapshotTimes(value.leagueSnapshot, value.generatedAt) ||
    !Array.isArray(value.leagueSnapshot.data) ||
    value.leagueSnapshot.data.length < 1 ||
    value.leagueSnapshot.data.length > MAX_ACTIVE_LEAGUES ||
    !Array.isArray(value.routes) ||
    value.routes.length !== value.leagueSnapshot.data.length * EXPECTED_ROUTES_PER_LEAGUE
  ) return false;

  const leagueIds = new Set();
  for (const league of value.leagueSnapshot.data) {
    if (
      !isRecord(league) ||
      !isText(league.id) ||
      !isText(league.name) ||
      leagueIds.has(league.id)
    ) return false;
    leagueIds.add(league.id);
  }

  const identities = new Set();
  const files = new Map();
  const counts = new Map([...leagueIds].map((league) => [league, 0]));
  for (const route of value.routes) {
    if (
      !isRecord(route) ||
      !isText(route.league) ||
      !isText(route.type) ||
      !ROUTE_SOURCES.has(route.source) ||
      typeof route.file !== "string" ||
      !ROUTE_FILE.test(route.file) ||
      !validSnapshotTimes(route, value.generatedAt) ||
      !Number.isSafeInteger(route.bytes) ||
      route.bytes <= 0 ||
      route.bytes > MAX_ROUTE_BYTES ||
      typeof route.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(route.sha256) ||
      route.file !== contentAddressedFile(route.sha256) ||
      !leagueIds.has(route.league)
    ) return false;
    const identity = `${route.league}\0${route.source}\0${route.type}`;
    const existingBytes = files.get(route.file);
    if (identities.has(identity) || (existingBytes != null && existingBytes !== route.bytes)) {
      return false;
    }
    identities.add(identity);
    files.set(route.file, route.bytes);
    counts.set(route.league, (counts.get(route.league) || 0) + 1);
  }
  if (![...counts.values()].every((count) => count === EXPECTED_ROUTES_PER_LEAGUE)) {
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
      payload.file !== contentAddressedFile(payload.sha256) ||
      !Number.isSafeInteger(payload.bytes) ||
      payload.bytes <= 0 ||
      payload.bytes > MAX_ROUTE_BYTES ||
      !isTimestamp(payload.lastReferencedAt) ||
      payload.lastReferencedAt > value.generatedAt ||
      value.generatedAt - payload.lastReferencedAt > MAX_ACTIONABLE_MIRROR_AGE_MS ||
      files.has(payload.file)
    ) return false;
    files.set(payload.file, payload.bytes);
  }
  return [...files.values()].reduce((total, bytes) => total + bytes, 0) <= MAX_MIRROR_BYTES;
}

function mirrorRouteForRequest(manifest, request) {
  const route = manifest.routes.find(
    (candidate) =>
      candidate.league === request.league &&
      candidate.source === request.source &&
      candidate.type === request.type,
  );
  if (!route) throw new Error("The market mirror does not contain the requested route.");
  return route;
}

function mirrorRouteUrl(route) {
  if (
    !ROUTE_FILE.test(route.file) ||
    route.file !== contentAddressedFile(route.sha256)
  ) throw new Error("The market mirror route is unsafe.");
  return `${POE_NINJA_MIRROR_ROOT}/${route.file}`;
}

function mirrorEnvelopeTimes(snapshot, now = Date.now()) {
  const checkedAge = now - snapshot.checkedAt;
  const sourceAge = now - snapshot.sourceUpdatedAt;
  if (
    !Number.isFinite(now) ||
    checkedAge < 0 ||
    checkedAge > MAX_ACTIONABLE_MIRROR_AGE_MS ||
    sourceAge < 0 ||
    sourceAge > MAX_ACTIONABLE_MIRROR_AGE_MS
  ) {
    throw new Error("The market mirror is too old to use safely.");
  }
  return {
    fetchedAt: snapshot.sourceUpdatedAt,
    expiresAt: Math.min(
      Math.max(snapshot.nextRefreshAt, now + 60_000),
      now + MIRROR_CADENCE_MS,
    ),
  };
}

module.exports = {
  isPoeNinjaMirrorManifest,
  MAX_ACTIONABLE_MIRROR_AGE_MS,
  mirrorEnvelopeTimes,
  mirrorRouteForRequest,
  mirrorRouteUrl,
  POE_NINJA_MIRROR_MANIFEST_URL,
  POE_NINJA_MIRROR_ROOT,
};
