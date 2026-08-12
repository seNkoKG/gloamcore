import type { EconomyLeague, OverviewRequest } from "../types";

export const POE_NINJA_MIRROR_ROOT =
  "https://senkokg.github.io/gloamcore/data/poe-ninja/v1";
export const POE_NINJA_MIRROR_MANIFEST_URL = `${POE_NINJA_MIRROR_ROOT}/manifest.json`;
export const POE_NINJA_MIRROR_SCHEMA_VERSION = 1;
export const POE_NINJA_MIRROR_CADENCE_MS = 30 * 60 * 1000;
export const MAX_ACTIONABLE_MIRROR_AGE_MS = 2 * 60 * 60 * 1000;

const EXPECTED_ROUTES_PER_LEAGUE = 46;
const MAX_ACTIVE_LEAGUES = 12;
const MAX_ROUTE_BYTES = 16 * 1024 * 1024;
const MAX_MIRROR_BYTES = 512 * 1024 * 1024;
const ROUTE_FILE = /^routes\/[a-f0-9]{64}\.json$/;
const ROUTE_SOURCES = new Set(["exchange", "stash-currency", "stash-item"]);

export interface PoeNinjaMirrorSnapshot<T> {
  data: T;
  upstreamEtag: string | null;
  checkedAt: number;
  sourceUpdatedAt: number;
  nextRefreshAt: number;
}

export interface PoeNinjaMirrorRoute {
  league: string;
  type: string;
  source: OverviewRequest["source"];
  file: string;
  upstreamEtag: string | null;
  checkedAt: number;
  sourceUpdatedAt: number;
  nextRefreshAt: number;
  bytes: number;
  sha256: string;
}

export interface PoeNinjaMirrorRetainedPayload {
  file: string;
  bytes: number;
  sha256: string;
  lastReferencedAt: number;
}

export interface PoeNinjaMirrorManifest {
  schemaVersion: 1;
  generatedAt: number;
  cadenceMs: number;
  leagueSnapshot: PoeNinjaMirrorSnapshot<EconomyLeague[]>;
  routes: PoeNinjaMirrorRoute[];
  retainedPayloads?: PoeNinjaMirrorRetainedPayload[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isText(value: unknown, maximum = 100): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function contentAddressedFile(sha256: string) {
  return `routes/${sha256}.json`;
}

function validSnapshotTimes(
  value: Record<string, unknown>,
  generatedAt: number,
) {
  const checkedAt = value.checkedAt;
  const sourceUpdatedAt = value.sourceUpdatedAt;
  const nextRefreshAt = value.nextRefreshAt;
  return (
    isTimestamp(checkedAt) &&
    isTimestamp(sourceUpdatedAt) &&
    isTimestamp(nextRefreshAt) &&
    sourceUpdatedAt <= checkedAt &&
    checkedAt <= generatedAt &&
    nextRefreshAt >= checkedAt &&
    nextRefreshAt <= checkedAt + POE_NINJA_MIRROR_CADENCE_MS &&
    (value.upstreamEtag == null || typeof value.upstreamEtag === "string")
  );
}

export function isPoeNinjaMirrorManifest(
  value: unknown,
): value is PoeNinjaMirrorManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== POE_NINJA_MIRROR_SCHEMA_VERSION ||
    value.cadenceMs !== POE_NINJA_MIRROR_CADENCE_MS ||
    !isTimestamp(value.generatedAt) ||
    value.generatedAt > Date.now() + 5 * 60 * 1000 ||
    !isRecord(value.leagueSnapshot) ||
    !validSnapshotTimes(value.leagueSnapshot, value.generatedAt) ||
    !Array.isArray(value.leagueSnapshot.data) ||
    value.leagueSnapshot.data.length < 1 ||
    value.leagueSnapshot.data.length > MAX_ACTIVE_LEAGUES ||
    !Array.isArray(value.routes) ||
    value.routes.length !==
      value.leagueSnapshot.data.length * EXPECTED_ROUTES_PER_LEAGUE
  ) return false;

  const leagueIds = new Set<string>();
  for (const league of value.leagueSnapshot.data) {
    if (
      !isRecord(league) ||
      !isText(league.id) ||
      !isText(league.name) ||
      leagueIds.has(league.id)
    ) return false;
    leagueIds.add(league.id);
  }

  const identities = new Set<string>();
  const files = new Map<string, number>();
  const counts = new Map([...leagueIds].map((league) => [league, 0]));
  for (const candidate of value.routes) {
    if (!isRecord(candidate)) return false;
    const route = candidate;
    if (
      !isText(route.league) ||
      !isText(route.type) ||
      !ROUTE_SOURCES.has(String(route.source)) ||
      typeof route.file !== "string" ||
      !ROUTE_FILE.test(route.file) ||
      !validSnapshotTimes(route, value.generatedAt) ||
      typeof route.bytes !== "number" ||
      !Number.isSafeInteger(route.bytes) ||
      route.bytes <= 0 ||
      route.bytes > MAX_ROUTE_BYTES ||
      typeof route.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(route.sha256) ||
      route.file !== contentAddressedFile(route.sha256) ||
      !leagueIds.has(route.league)
    ) return false;
    const league = route.league;
    const source = route.source;
    const type = route.type;
    const file = route.file;
    const identity = `${league}\0${source}\0${type}`;
    const existingBytes = files.get(file);
    if (identities.has(identity) || (existingBytes != null && existingBytes !== route.bytes)) {
      return false;
    }
    identities.add(identity);
    files.set(file, route.bytes);
    counts.set(league, (counts.get(league) || 0) + 1);
  }
  if (![...counts.values()].every((count) => count === EXPECTED_ROUTES_PER_LEAGUE)) {
    return false;
  }
  if (value.retainedPayloads != null && !Array.isArray(value.retainedPayloads)) return false;
  for (const candidate of value.retainedPayloads || []) {
    if (
      !isRecord(candidate) ||
      typeof candidate.file !== "string" ||
      !ROUTE_FILE.test(candidate.file) ||
      typeof candidate.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.sha256) ||
      candidate.file !== contentAddressedFile(candidate.sha256) ||
      typeof candidate.bytes !== "number" ||
      !Number.isSafeInteger(candidate.bytes) ||
      candidate.bytes <= 0 ||
      candidate.bytes > MAX_ROUTE_BYTES ||
      !isTimestamp(candidate.lastReferencedAt) ||
      candidate.lastReferencedAt > value.generatedAt ||
      value.generatedAt - candidate.lastReferencedAt > MAX_ACTIONABLE_MIRROR_AGE_MS ||
      files.has(candidate.file)
    ) return false;
    files.set(candidate.file, candidate.bytes);
  }
  return [...files.values()].reduce((total, bytes) => total + bytes, 0) <= MAX_MIRROR_BYTES;
}

export function mirrorRouteForRequest(
  manifest: PoeNinjaMirrorManifest,
  request: Pick<OverviewRequest, "league" | "source" | "type">,
) {
  const route = manifest.routes.find(
    (candidate) =>
      candidate.league === request.league &&
      candidate.source === request.source &&
      candidate.type === request.type,
  );
  if (!route) throw new Error("The market mirror does not contain the requested route.");
  return route;
}

export function mirrorRouteUrl(route: PoeNinjaMirrorRoute) {
  if (
    !ROUTE_FILE.test(route.file) ||
    route.file !== contentAddressedFile(route.sha256)
  ) throw new Error("The market mirror route is unsafe.");
  return `${POE_NINJA_MIRROR_ROOT}/${route.file}`;
}

export function assertActionableMirrorSnapshot(
  snapshot: Pick<PoeNinjaMirrorSnapshot<unknown>, "checkedAt" | "sourceUpdatedAt">,
  now = Date.now(),
) {
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
}

export function mirrorEnvelopeTimes(
  snapshot: Pick<
    PoeNinjaMirrorSnapshot<unknown>,
    "checkedAt" | "sourceUpdatedAt" | "nextRefreshAt"
  >,
  now = Date.now(),
) {
  assertActionableMirrorSnapshot(snapshot, now);
  return {
    fetchedAt: snapshot.sourceUpdatedAt,
    // Avoid a per-second retry loop when a scheduled workflow is delayed.
    expiresAt: Math.min(
      Math.max(snapshot.nextRefreshAt, now + 60_000),
      now + POE_NINJA_MIRROR_CADENCE_MS,
    ),
  };
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function verifyMirrorPayloadBytes(
  bytes: Uint8Array,
  route: Pick<PoeNinjaMirrorRoute, "bytes" | "sha256">,
) {
  if (bytes.byteLength !== route.bytes) {
    throw new Error("The market mirror payload failed its size check.");
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("The market mirror integrity checker is unavailable.");
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  if (hex(digest) !== route.sha256) {
    throw new Error("The market mirror payload failed its integrity check.");
  }
}

export async function verifyMirrorPayloadText(
  text: string,
  route: Pick<PoeNinjaMirrorRoute, "bytes" | "sha256">,
) {
  if (typeof text !== "string") {
    throw new Error("The market mirror did not return text.");
  }
  const bytes = new TextEncoder().encode(text);
  await verifyMirrorPayloadBytes(bytes, route);
  return text;
}
