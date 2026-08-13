import { readMobileCache, writeMobileCache } from "./mobile-cache";

export const GAME_DATA_SCHEMA_VERSION = 1;
export const SUPPORTED_ATLAS_LINK_VERSION = 6;
export const GAME_DATA_REMOTE_ROOT =
  "https://senkokg.github.io/gloamcore/data/game/v1";
export const GAME_DATA_CACHE_KEY = "game-data:v1";

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_PACK_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const SHA256 = /^[a-f0-9]{64}$/;
const PACK_FILE = /^(atlas|navigator)-\d+\.\d+\.\d+\.json$/;
const GAME_VERSION = /^\d+\.\d+\.\d+$/;

export interface GameDataPackDescriptor {
  file: string;
  bytes: number;
  sha256: string;
  sourceRevision: string;
}

export interface GameDataManifest {
  schemaVersion: 1;
  game: "poe1";
  gameVersion: string;
  packRevision: number;
  generatedAt: string;
  packs: {
    atlas: GameDataPackDescriptor;
    navigator: GameDataPackDescriptor;
  };
}

export interface AtlasDataNode {
  id: number;
  groupId: number;
  orbit: number;
  orbitIndex: number;
  name: string;
  icon: string;
  stats: string[];
  reminderText: string[];
  flavourText: string[];
  x: number;
  y: number;
  neighbors: number[];
  notable: boolean;
  keystone: boolean;
  mastery: boolean;
  gateway: boolean;
  grantedPoints: number;
}

export interface AtlasDataGroup {
  id: number;
  x: number;
  y: number;
  orbits: number[];
  nodeIds: number[];
  background?: string;
}

export type AtlasSpriteKind =
  | "background"
  | "normalActive"
  | "notableActive"
  | "keystoneActive"
  | "wormholeActive"
  | "normalInactive"
  | "notableInactive"
  | "keystoneInactive"
  | "wormholeInactive"
  | "mastery"
  | "groupBackground"
  | "startNode"
  | "frame"
  | "line"
  | "atlasBackground";

export interface AtlasSpriteSheet {
  filename: string;
  width: number;
  height: number;
  coords: Record<string, { x: number; y: number; w: number; h: number }>;
}

export interface AtlasDataPack {
  schemaVersion: 1;
  game: "poe1";
  gameVersion: string;
  source: GameDataSource;
  rootId: number;
  totalPoints: number;
  linkFormat: { version: number; url: string; sha256: string };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  orbitRadii: number[];
  groups: AtlasDataGroup[];
  sprites: Record<AtlasSpriteKind, AtlasSpriteSheet>;
  nodes: AtlasDataNode[];
}

export interface NavigatorRouteStep {
  id: string;
  act: number;
  label: string;
  kind: "action" | "boss" | "note" | "quest" | "travel" | "trial" | "waypoint";
  areaIds: string[];
  questIds: string[];
  conditions: string[];
}

export interface NavigatorGemAcquisition {
  kind: "quest" | "vendor";
  act: number;
  questId: string;
  quest: string;
  offerId: string;
  npc: string;
  classes: string[];
}

export interface NavigatorGem {
  id: string;
  name: string;
  attribute: string;
  requiredLevel: number;
  support: boolean;
  acquisitions: NavigatorGemAcquisition[];
}

export interface NavigatorDataPack {
  schemaVersion: 1;
  game: "poe1";
  gameVersion: string;
  packRevision: number;
  source: GameDataSource & { license: "MIT" };
  art: {
    questIcon: { name: string; url: string; source: string };
    bandits: Record<"kill" | "alira" | "kraityn" | "oak", {
      name: string;
      url: string;
      source: string;
    }>;
  };
  classes: string[];
  acts: Array<{ act: number; steps: NavigatorRouteStep[] }>;
  areas: Array<{
    id: string;
    name: string;
    act: number;
    level: number;
    waypoint: boolean;
    town: boolean;
    recipes: string[];
  }>;
  gems: NavigatorGem[];
}

export interface GameDataSource {
  name: string;
  url: string;
  revision: string;
  releasedAt: string;
  compatibilityEvidence?: string;
  rawSha256?: string;
}

export interface GameDataBundle {
  manifest: GameDataManifest;
  atlas: AtlasDataPack;
  navigator: NavigatorDataPack;
  activatedAt: number;
  origin: "bundled" | "remote";
}

interface StoredGameData {
  schemaVersion: 1;
  active: GameDataBundle;
  previous: GameDataBundle | null;
}

export interface GameDataStatus {
  bundle: GameDataBundle;
  recoveredFromPrevious: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown, maximum = 300): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function textArray(value: unknown, maximumEntries = 20, maximumText = 1_000): value is string[] {
  return Array.isArray(value) && value.length <= maximumEntries && value.every((entry) =>
    typeof entry === "string" && entry.length <= maximumText,
  );
}

function isSource(value: unknown): value is GameDataSource {
  if (!record(value)) return false;
  try {
    const url = new URL(String(value.url));
    return text(value.name) && url.protocol === "https:" && text(value.revision, 64)
      && text(value.releasedAt, 40) && Number.isFinite(Date.parse(value.releasedAt))
      && (value.compatibilityEvidence == null || text(value.compatibilityEvidence, 1_000));
  } catch {
    return false;
  }
}

export function isGameDataManifest(value: unknown): value is GameDataManifest {
  if (!record(value) || value.schemaVersion !== GAME_DATA_SCHEMA_VERSION || value.game !== "poe1"
    || !text(value.gameVersion, 20) || !GAME_VERSION.test(value.gameVersion)
    || !safeInteger(value.packRevision, 1)
    || !text(value.generatedAt, 40) || !Number.isFinite(Date.parse(value.generatedAt))
    || !record(value.packs)) return false;
  const packs = value.packs;
  return (["atlas", "navigator"] as const).every((id) => {
    const pack = packs[id];
    return record(pack) && text(pack.file, 80) && PACK_FILE.test(pack.file)
      && pack.file === `${id}-${value.gameVersion}.json`
      && safeInteger(pack.bytes, 1) && (pack.bytes as number) <= MAX_PACK_BYTES
      && typeof pack.sha256 === "string" && SHA256.test(pack.sha256)
      && text(pack.sourceRevision, 64);
  });
}

export function isAtlasDataPack(value: unknown, gameVersion?: string): value is AtlasDataPack {
  if (!record(value)) return false;
  const bounds = value.bounds;
  const totalPoints = value.totalPoints;
  const linkFormat = value.linkFormat;
  if (!record(value) || value.schemaVersion !== 1 || value.game !== "poe1"
    || !text(value.gameVersion, 20) || (gameVersion != null && value.gameVersion !== gameVersion)
    || !isSource(value.source) || !safeInteger(value.rootId, 1)
    || !safeInteger(totalPoints, 1) || totalPoints > 255
    || !record(linkFormat) || linkFormat.version !== SUPPORTED_ATLAS_LINK_VERSION
    || !text(linkFormat.url, 1_000) || !linkFormat.url.startsWith("https://web.poecdn.com/")
    || typeof linkFormat.sha256 !== "string" || !SHA256.test(linkFormat.sha256)
    || !record(bounds) || !finite(bounds.minX) || !finite(bounds.minY)
    || !finite(bounds.maxX) || !finite(bounds.maxY)
    || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY
    || !Array.isArray(value.orbitRadii) || !value.orbitRadii.length || value.orbitRadii.length > 12
    || !value.orbitRadii.every((radius) => finite(radius) && radius >= 0)
    || !Array.isArray(value.groups) || !value.groups.length || value.groups.length > 500
    || !record(value.sprites) || !Array.isArray(value.nodes) || value.nodes.length < 900 || value.nodes.length > 1_500) return false;
  const orbitRadii = value.orbitRadii as number[];
  const rawGroups = value.groups as unknown[];
  const spriteKinds: AtlasSpriteKind[] = [
    "background", "normalActive", "notableActive", "keystoneActive", "wormholeActive",
    "normalInactive", "notableInactive", "keystoneInactive", "wormholeInactive", "mastery",
    "groupBackground", "startNode", "frame", "line", "atlasBackground",
  ];
  for (const kind of spriteKinds) {
    const sprite = value.sprites[kind];
    if (!record(sprite) || !text(sprite.filename, 1_000) || !sprite.filename.startsWith("https://web.poecdn.com/")
      || !safeInteger(sprite.width, 1) || !safeInteger(sprite.height, 1) || !record(sprite.coords)) return false;
    const spriteWidth = sprite.width;
    const spriteHeight = sprite.height;
    const coordinates = Object.entries(sprite.coords);
    if (!coordinates.length || coordinates.length > 1_000 || coordinates.some(([key, coordinate]) =>
      !text(key, 500) || !record(coordinate)
      || !safeInteger(coordinate.x) || !safeInteger(coordinate.y)
      || !safeInteger(coordinate.w, 1) || !safeInteger(coordinate.h, 1)
      || coordinate.x + coordinate.w > spriteWidth || coordinate.y + coordinate.h > spriteHeight
    )) return false;
  }
  const ids = new Set<number>();
  for (const candidate of value.nodes) {
    if (!record(candidate)) return false;
    const id = candidate.id;
    const grantedPoints = candidate.grantedPoints;
    if (!safeInteger(id, 1) || ids.has(id)
      || !safeInteger(candidate.groupId) || !safeInteger(candidate.orbit) || candidate.orbit >= orbitRadii.length
      || !safeInteger(candidate.orbitIndex)
      || typeof candidate.name !== "string" || candidate.name.length > 300
      || typeof candidate.icon !== "string" || candidate.icon.length > 500
      || !textArray(candidate.stats) || !textArray(candidate.reminderText) || !textArray(candidate.flavourText)
      || !finite(candidate.x) || !finite(candidate.y)
      || !Array.isArray(candidate.neighbors) || candidate.neighbors.length > 30
      || !candidate.neighbors.every((id) => safeInteger(id, 1))
      || typeof candidate.notable !== "boolean" || typeof candidate.keystone !== "boolean"
      || typeof candidate.mastery !== "boolean" || typeof candidate.gateway !== "boolean"
      || !safeInteger(grantedPoints) || grantedPoints > 255) return false;
    ids.add(id);
  }
  if (!ids.has(value.rootId)) return false;
  const nodes = value.nodes as unknown as AtlasDataNode[];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sprites = value.sprites as unknown as AtlasDataPack["sprites"];
  const requiredFrames = [
    "WormholeFrameUnallocated", "WormholeFrameHighlight", "WormholeFrameCanAllocate", "WormholeFrameAllocated",
    "KeystoneFrameUnallocated", "KeystoneFrameCanAllocate", "KeystoneFrameAllocated",
    "NotableFrameUnallocated", "NotableFrameCanAllocate", "NotableFrameAllocated",
    "PSSkillFrameHighlighted", "PSSkillFrameActive", "PSSkillFrame",
  ];
  const requiredLines = ["LineConnectorActive", "LineConnectorNormal", "LineConnectorIntermediate"];
  if (!requiredFrames.every((key) => Boolean(sprites.frame.coords[key]))
    || !requiredLines.every((key) => Boolean(sprites.line.coords[key]))) return false;
  const groupIds = new Set<number>();
  for (const candidate of rawGroups) {
    if (!record(candidate) || !safeInteger(candidate.id) || groupIds.has(candidate.id)
      || !finite(candidate.x) || !finite(candidate.y)
      || !Array.isArray(candidate.orbits) || candidate.orbits.length > orbitRadii.length
      || !candidate.orbits.every((orbit) => safeInteger(orbit) && orbit < orbitRadii.length)
      || !Array.isArray(candidate.nodeIds) || candidate.nodeIds.length > 100
      || !candidate.nodeIds.every((id) => safeInteger(id, 1) && ids.has(id))
      || (candidate.background != null && (
        !text(candidate.background, 100) || !sprites.groupBackground.coords[candidate.background]
      ))) return false;
    groupIds.add(candidate.id);
  }
  const groups = rawGroups as AtlasDataGroup[];
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return Boolean(sprites.startNode.coords.AtlasPassiveSkillScreenStart)
    && Boolean(sprites.atlasBackground.coords.AtlasPassiveBackground)
    && nodes.every((node) => {
      const kind: AtlasSpriteKind = node.id === value.rootId
        ? "startNode"
        : node.mastery
          ? "mastery"
          : node.gateway
            ? "wormholeInactive"
            : node.keystone
              ? "keystoneInactive"
              : node.notable
                ? "notableInactive"
                : "normalInactive";
      const key = node.id === value.rootId
        ? "AtlasPassiveSkillScreenStart"
        : node.gateway ? "Wormhole" : node.icon;
      const group = groupsById.get(node.groupId);
      return groupIds.has(node.groupId) && group?.nodeIds.includes(node.id)
        && Boolean(sprites[kind].coords[key]) && node.neighbors.every((neighborId) =>
        neighborId !== node.id && byId.get(neighborId)?.neighbors.includes(node.id),
      );
    });
}

const ROUTE_KINDS = new Set(["action", "boss", "note", "quest", "travel", "trial", "waypoint"]);
const ACQUISITION_KINDS = new Set(["quest", "vendor"]);

export function isNavigatorDataPack(
  value: unknown,
  gameVersion?: string,
  packRevision?: number,
): value is NavigatorDataPack {
  if (!record(value)) return false;
  const source = value.source;
  const art = value.art;
  if (!record(value) || value.schemaVersion !== 1 || value.game !== "poe1"
    || !text(value.gameVersion, 20) || (gameVersion != null && value.gameVersion !== gameVersion)
    || !safeInteger(value.packRevision, 1) || (packRevision != null && value.packRevision !== packRevision)
    || !isSource(source) || !record(source) || source.license !== "MIT" || !record(art) || !record(art.questIcon)
    || !text(art.questIcon.name) || !text(art.questIcon.url, 1_000) || !text(art.questIcon.source, 1_000)
    || !art.questIcon.url.startsWith("https://www.poewiki.net/images/")
    || !art.questIcon.source.startsWith("https://www.poewiki.net/wiki/") || !record(art.bandits)
    || !textArray(value.classes, 12, 30) || value.classes.length !== 7
    || !Array.isArray(value.acts) || value.acts.length !== 10
    || !Array.isArray(value.areas) || value.areas.length < 100 || value.areas.length > 1_000
    || !Array.isArray(value.gems) || value.gems.length < 300 || value.gems.length > 2_000) return false;
  for (const id of ["kill", "alira", "kraityn", "oak"]) {
    const banditArt = art.bandits[id];
    if (!record(banditArt) || !text(banditArt.name) || !text(banditArt.url, 1_000) || !text(banditArt.source, 1_000)
      || !banditArt.url.startsWith("https://www.poewiki.net/images/") || !banditArt.source.startsWith("https://www.poewiki.net/wiki/")) return false;
  }
  const classes = new Set(value.classes as string[]);
  for (let index = 0; index < value.acts.length; index += 1) {
    const act = value.acts[index];
    if (!record(act) || act.act !== index + 1 || !Array.isArray(act.steps) || !act.steps.length || act.steps.length > 300) return false;
    const stepIds = new Set<string>();
    for (const step of act.steps) {
      if (!record(step) || !text(step.id, 40) || stepIds.has(step.id) || step.act !== act.act
        || !text(step.label, 1_000) || !ROUTE_KINDS.has(String(step.kind))
        || !textArray(step.areaIds, 10, 100) || !textArray(step.questIds, 10, 100)
        || !textArray(step.conditions, 8, 40)) return false;
      stepIds.add(step.id);
    }
  }
  const areaIds = new Set<string>();
  for (const area of value.areas) {
    if (!record(area)) return false;
    const act = area.act;
    const level = area.level;
    if (!text(area.id, 100) || areaIds.has(area.id) || !text(area.name)
      || !safeInteger(act) || act > 11 || !safeInteger(level) || level > 100
      || typeof area.waypoint !== "boolean" || typeof area.town !== "boolean"
      || !textArray(area.recipes, 30, 300)) return false;
    areaIds.add(area.id);
  }
  const gemIds = new Set<string>();
  const gemNames = new Set<string>();
  for (const gem of value.gems) {
    if (!record(gem)) return false;
    const requiredLevel = gem.requiredLevel;
    const gemName = typeof gem.name === "string" ? gem.name.toLowerCase() : "";
    if (!text(gem.id, 160) || gemIds.has(gem.id) || !text(gem.name) || gemNames.has(gemName)
      || typeof gem.attribute !== "string" || gem.attribute.length > 40
      || !safeInteger(requiredLevel, 1) || requiredLevel > 100
      || typeof gem.support !== "boolean" || !Array.isArray(gem.acquisitions) || gem.acquisitions.length > 100) return false;
    gemIds.add(gem.id);
    gemNames.add(gemName);
    for (const acquisition of gem.acquisitions) {
      if (!record(acquisition)) return false;
      const acquisitionAct = acquisition.act;
      if (!ACQUISITION_KINDS.has(String(acquisition.kind))
        || !safeInteger(acquisitionAct, 1) || acquisitionAct > 10
        || !text(acquisition.questId, 100) || !text(acquisition.quest)
        || !text(acquisition.offerId, 100) || typeof acquisition.npc !== "string" || acquisition.npc.length > 200
        || !textArray(acquisition.classes, 7, 30)
        || !acquisition.classes.every((entry) => classes.has(entry))) return false;
    }
  }
  return true;
}

function isBundle(value: unknown): value is GameDataBundle {
  return record(value) && isGameDataManifest(value.manifest)
    && isAtlasDataPack(value.atlas, value.manifest.gameVersion)
    && isNavigatorDataPack(value.navigator, value.manifest.gameVersion, value.manifest.packRevision)
    && safeInteger(value.activatedAt) && (value.origin === "bundled" || value.origin === "remote");
}

function isStored(value: unknown): value is StoredGameData {
  return record(value) && value.schemaVersion === 1 && isBundle(value.active)
    && (value.previous === null || isBundle(value.previous));
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (entry) => entry.toString(16).padStart(2, "0")).join("");
}

async function verifyPack(bytes: Uint8Array, descriptor: GameDataPackDescriptor) {
  if (bytes.byteLength !== descriptor.bytes) throw new Error("Game-data size verification failed.");
  if (!globalThis.crypto?.subtle) throw new Error("Game-data integrity verification is unavailable.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if (hex(digest) !== descriptor.sha256) throw new Error("Game-data integrity verification failed.");
}

async function fetchBytes(url: string, maximumBytes: number, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Game-data request failed: ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("Game-data response exceeds its size limit.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > maximumBytes) throw new Error("Game-data response exceeds its size limit.");
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON.`, { cause: error });
  }
}

function bundledRoot() {
  return new URL(`${import.meta.env.BASE_URL}data/game/v1/`, document.baseURI).href.replace(/\/$/, "");
}

export async function fetchGameDataBundle(
  root: string,
  origin: GameDataBundle["origin"],
  fetchImpl: typeof fetch = fetch,
) {
  const safeRoot = root.replace(/\/$/, "");
  const manifestBytes = await fetchBytes(`${safeRoot}/manifest.json`, MAX_MANIFEST_BYTES, fetchImpl);
  const manifestValue = parseJson(manifestBytes, "Game-data manifest");
  if (!isGameDataManifest(manifestValue)) throw new Error("The game-data manifest has an unsupported schema.");
  const [atlasBytes, navigatorBytes] = await Promise.all([
    fetchBytes(`${safeRoot}/${manifestValue.packs.atlas.file}`, MAX_PACK_BYTES, fetchImpl),
    fetchBytes(`${safeRoot}/${manifestValue.packs.navigator.file}`, MAX_PACK_BYTES, fetchImpl),
  ]);
  await Promise.all([
    verifyPack(atlasBytes, manifestValue.packs.atlas),
    verifyPack(navigatorBytes, manifestValue.packs.navigator),
  ]);
  const atlas = parseJson(atlasBytes, "Atlas pack");
  const navigator = parseJson(navigatorBytes, "Navigator pack");
  if (!isAtlasDataPack(atlas, manifestValue.gameVersion)) throw new Error("The Atlas pack has an unsupported schema.");
  if (!isNavigatorDataPack(navigator, manifestValue.gameVersion, manifestValue.packRevision)) throw new Error("The Navigator pack has an unsupported schema.");
  return { manifest: manifestValue, atlas, navigator, activatedAt: Date.now(), origin } satisfies GameDataBundle;
}

let activePromise: Promise<GameDataStatus> | null = null;

async function loadFresh(): Promise<GameDataStatus> {
  const stored = await readMobileCache<unknown>(GAME_DATA_CACHE_KEY);
  if (isStored(stored)) return { bundle: stored.active, recoveredFromPrevious: false };
  if (record(stored) && isBundle(stored.previous)) {
    const recovered = { schemaVersion: 1, active: stored.previous, previous: null } satisfies StoredGameData;
    await writeMobileCache(GAME_DATA_CACHE_KEY, recovered);
    return { bundle: recovered.active, recoveredFromPrevious: true };
  }
  return { bundle: await fetchGameDataBundle(bundledRoot(), "bundled"), recoveredFromPrevious: false };
}

export function loadGameData() {
  activePromise ||= loadFresh();
  return activePromise;
}

export function compareGameDataVersions(
  left: Pick<GameDataManifest, "gameVersion" | "packRevision">,
  right: Pick<GameDataManifest, "gameVersion" | "packRevision">,
) {
  const leftVersion = left.gameVersion.split(".").map(Number);
  const rightVersion = right.gameVersion.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion[index] !== rightVersion[index]) {
      return leftVersion[index] > rightVersion[index] ? 1 : -1;
    }
  }
  return Math.sign(left.packRevision - right.packRevision);
}

export async function checkForGameDataUpdate(fetchImpl: typeof fetch = fetch) {
  const current = await loadGameData();
  const candidate = await fetchGameDataBundle(GAME_DATA_REMOTE_ROOT, "remote", fetchImpl);
  const comparison = compareGameDataVersions(candidate.manifest, current.bundle.manifest);
  const sameContent = candidate.manifest.packs.atlas.sha256 === current.bundle.manifest.packs.atlas.sha256
    && candidate.manifest.packs.navigator.sha256 === current.bundle.manifest.packs.navigator.sha256;
  if (comparison < 0) throw new Error("The remote game-data pack is older than the active pack.");
  if (comparison === 0 && !sameContent) {
    throw new Error("The remote game-data pack reuses an existing version with different content.");
  }
  if (comparison === 0) {
    return { status: "current" as const, data: current };
  }
  const stored = { schemaVersion: 1, active: candidate, previous: current.bundle } satisfies StoredGameData;
  await writeMobileCache(GAME_DATA_CACHE_KEY, stored);
  const data = { bundle: candidate, recoveredFromPrevious: false };
  activePromise = Promise.resolve(data);
  return { status: "updated" as const, data };
}

export async function rollbackGameData() {
  const stored = await readMobileCache<unknown>(GAME_DATA_CACHE_KEY);
  if (!isStored(stored) || !stored.previous) throw new Error("No validated previous game-data pack is available.");
  const next = { schemaVersion: 1, active: stored.previous, previous: stored.active } satisfies StoredGameData;
  await writeMobileCache(GAME_DATA_CACHE_KEY, next);
  const data = { bundle: next.active, recoveredFromPrevious: false };
  activePromise = Promise.resolve(data);
  return data;
}

export function resetGameDataForTests() {
  activePromise = null;
}
