import { SUPPORTED_ATLAS_LINK_VERSION, type AtlasDataNode, type AtlasDataPack } from "./game-data";

export const ATLAS_WORKSPACE_KEY = "gloamcore:atlas-command-center:v1";
export const ATLAS_LINK_VERSION = SUPPORTED_ATLAS_LINK_VERSION;

export interface AtlasLoadout {
  id: string;
  name: string;
  gameVersion: string;
  basePoints: number;
  nodeIds: number[];
  updatedAt: number;
  createdAt: number;
  folder: string;
  tags: string[];
  notes: string;
}

export interface AtlasWorkspace {
  version: 2;
  gameVersion: string;
  basePoints: number;
  nodeIds: number[];
  loadouts: AtlasLoadout[];
}

export interface AtlasAllocationAnalysis {
  spent: number;
  granted: number;
  total: number;
  remaining: number;
}

export interface AtlasAllocationResult {
  ok: boolean;
  nodeIds: number[];
  added: number[];
  removed: number[];
  message: string;
}

export interface AtlasMigrationResult {
  workspace: AtlasWorkspace;
  droppedNodeIds: number[];
  changedVersion: boolean;
  loadoutReports: Array<{
    id: string;
    name: string;
    sourceGameVersion: string;
    droppedNodeIds: number[];
  }>;
}

function nodeMap(pack: AtlasDataPack) {
  return new Map(pack.nodes.map((node) => [node.id, node]));
}

function sortedIds(values: Iterable<number>) {
  return [...values].sort((left, right) => left - right);
}

export function isAllocatableAtlasNode(pack: AtlasDataPack, node: AtlasDataNode | undefined) {
  return Boolean(node && node.id !== pack.rootId && !node.mastery);
}

export function atlasAllocationAnalysis(
  pack: AtlasDataPack,
  nodeIds: Iterable<number>,
  basePoints = pack.totalPoints,
): AtlasAllocationAnalysis {
  const nodes = nodeMap(pack);
  let spent = 0;
  let granted = 0;
  for (const id of new Set(nodeIds)) {
    const node = nodes.get(id);
    if (!isAllocatableAtlasNode(pack, node)) continue;
    spent += 1;
    granted += node?.grantedPoints || 0;
  }
  const total = basePoints + granted;
  return { spent, granted, total, remaining: total - spent };
}

function connectedAllocated(pack: AtlasDataPack, requested: ReadonlySet<number>) {
  const nodes = nodeMap(pack);
  const connected = new Set<number>();
  const queue = [pack.rootId];
  const visited = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const node = nodes.get(queue[index]);
    for (const neighborId of node?.neighbors || []) {
      if (visited.has(neighborId) || !requested.has(neighborId)) continue;
      visited.add(neighborId);
      connected.add(neighborId);
      queue.push(neighborId);
    }
  }
  return connected;
}

function shortestPath(
  pack: AtlasDataPack,
  allocated: ReadonlySet<number>,
  target: (node: AtlasDataNode) => boolean,
  allowed?: ReadonlySet<number>,
) {
  const nodes = nodeMap(pack);
  const queue: number[] = [pack.rootId, ...sortedIds(allocated)];
  const previous = new Map<number, number | null>(queue.map((id) => [id, null]));
  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index];
    const current = nodes.get(currentId);
    for (const neighborId of current?.neighbors || []) {
      if (previous.has(neighborId)) continue;
      const neighbor = nodes.get(neighborId);
      if (!isAllocatableAtlasNode(pack, neighbor) || (allowed && !allowed.has(neighborId))) continue;
      previous.set(neighborId, currentId);
      if (neighbor && target(neighbor)) {
        const path: number[] = [];
        let cursor: number | null = neighborId;
        while (cursor != null && !allocated.has(cursor) && cursor !== pack.rootId) {
          path.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(neighborId);
    }
  }
  return null;
}

function orderAtlasAllocation(
  pack: AtlasDataPack,
  requested: ReadonlySet<number>,
  basePoints: number,
) {
  const nodes = nodeMap(pack);
  const allocated = new Set<number>();
  while (allocated.size < requested.size) {
    const analysis = atlasAllocationAnalysis(pack, allocated, basePoints);
    const remaining = new Set([...requested].filter((id) => !allocated.has(id)));
    const grantPath = shortestPath(
      pack,
      allocated,
      (node) => remaining.has(node.id) && node.grantedPoints > 0,
      requested,
    );
    if (grantPath && grantPath.length <= analysis.remaining) {
      grantPath.forEach((id) => allocated.add(id));
      continue;
    }
    if (remaining.size <= analysis.remaining) {
      const connected = connectedAllocated(pack, requested);
      if (connected.size !== requested.size) return null;
      sortedIds(remaining).forEach((id) => allocated.add(id));
      continue;
    }
    return null;
  }
  return sortedIds(allocated);
}

export function validateAtlasAllocation(
  pack: AtlasDataPack,
  nodeIds: readonly number[],
  basePoints = pack.totalPoints,
) {
  if (!Number.isSafeInteger(basePoints) || basePoints < 0 || basePoints > pack.totalPoints) {
    return { ok: false as const, message: `Atlas point budget must be between 0 and ${pack.totalPoints}.` };
  }
  const nodes = nodeMap(pack);
  const requested = new Set<number>();
  for (const id of nodeIds) {
    if (!Number.isSafeInteger(id) || requested.has(id)) {
      return { ok: false as const, message: "The Atlas allocation contains an invalid or duplicate node ID." };
    }
    const node = nodes.get(id);
    if (!isAllocatableAtlasNode(pack, node)) {
      return { ok: false as const, message: `Atlas node ${id} is unknown or cannot be allocated.` };
    }
    requested.add(id);
  }
  if (connectedAllocated(pack, requested).size !== requested.size) {
    return { ok: false as const, message: "The Atlas allocation is not connected to the official tree root." };
  }
  if (!orderAtlasAllocation(pack, requested, basePoints)) {
    return {
      ok: false as const,
      message: "The Atlas allocation cannot reach its point-granting nodes before the available points are spent.",
    };
  }
  return { ok: true as const, message: "Atlas allocation is connected and within its point budget." };
}

export function allocateAtlasPath(
  pack: AtlasDataPack,
  nodeIds: readonly number[],
  targetId: number,
  basePoints = pack.totalPoints,
): AtlasAllocationResult {
  const current = new Set(nodeIds);
  const target = nodeMap(pack).get(targetId);
  if (!isAllocatableAtlasNode(pack, target)) {
    return { ok: false, nodeIds: sortedIds(current), added: [], removed: [], message: "That Atlas node cannot be allocated." };
  }
  if (current.has(targetId)) return refundAtlasNode(pack, nodeIds, targetId, basePoints);
  const path = shortestPath(pack, current, (node) => node.id === targetId);
  if (!path) {
    return { ok: false, nodeIds: sortedIds(current), added: [], removed: [], message: "No connected route to that Atlas node exists." };
  }
  const next = new Set(current);
  const added: number[] = [];
  for (const id of path) {
    if (next.has(id)) continue;
    if (atlasAllocationAnalysis(pack, next, basePoints).remaining < 1) {
      return {
        ok: false,
        nodeIds: sortedIds(current),
        added: [],
        removed: [],
        message: `The shortest route needs ${path.length} new points, but the current budget cannot fund it.`,
      };
    }
    next.add(id);
    added.push(id);
  }
  const validation = validateAtlasAllocation(pack, sortedIds(next), basePoints);
  if (!validation.ok) {
    return { ok: false, nodeIds: sortedIds(current), added: [], removed: [], message: validation.message };
  }
  return {
    ok: true,
    nodeIds: sortedIds(next),
    added,
    removed: [],
    message: `Allocated ${target?.name || "Atlas node"}${added.length > 1 ? ` through ${added.length - 1} connecting node${added.length === 2 ? "" : "s"}` : ""}.`,
  };
}

export function refundAtlasNode(
  pack: AtlasDataPack,
  nodeIds: readonly number[],
  targetId: number,
  basePoints = pack.totalPoints,
): AtlasAllocationResult {
  const current = new Set(nodeIds);
  if (!current.has(targetId)) {
    return { ok: false, nodeIds: sortedIds(current), added: [], removed: [], message: "That Atlas node is not allocated." };
  }
  const candidate = new Set(current);
  candidate.delete(targetId);
  const connected = connectedAllocated(pack, candidate);
  const next = sortedIds(connected);
  const validation = validateAtlasAllocation(pack, next, basePoints);
  if (!validation.ok) {
    return {
      ok: false,
      nodeIds: sortedIds(current),
      added: [],
      removed: [],
      message: "That refund would remove points still required by the remaining allocation.",
    };
  }
  const removed = sortedIds([...current].filter((id) => !connected.has(id)));
  return {
    ok: true,
    nodeIds: next,
    added: [],
    removed,
    message: `Refunded ${removed.length} node${removed.length === 1 ? "" : "s"}; disconnected allocations were removed safely.`,
  };
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const value = (a << 16) | ((b || 0) << 8) | (c || 0);
    result += BASE64_ALPHABET[(value >>> 18) & 63];
    result += BASE64_ALPHABET[(value >>> 12) & 63];
    result += index + 1 < bytes.length ? BASE64_ALPHABET[(value >>> 6) & 63] : "=";
    result += index + 2 < bytes.length ? BASE64_ALPHABET[value & 63] : "=";
  }
  return result;
}

function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) throw new Error("The Atlas link payload is not valid base64.");
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const output: number[] = [];
  for (let index = 0; index < padded.length; index += 4) {
    const sextets = padded.slice(index, index + 4).split("").map((character) =>
      character === "=" ? 0 : BASE64_ALPHABET.indexOf(character),
    );
    if (sextets.some((entry) => entry < 0)) throw new Error("The Atlas link payload is not valid base64.");
    const combined = (sextets[0] << 18) | (sextets[1] << 12) | (sextets[2] << 6) | sextets[3];
    output.push((combined >>> 16) & 255);
    if (padded[index + 2] !== "=") output.push((combined >>> 8) & 255);
    if (padded[index + 3] !== "=") output.push(combined & 255);
  }
  return new Uint8Array(output);
}

export function encodeAtlasUrl(pack: AtlasDataPack, nodeIds: readonly number[]) {
  const validation = validateAtlasAllocation(pack, nodeIds, pack.totalPoints);
  if (!validation.ok) throw new Error(validation.message);
  const ids = sortedIds(nodeIds);
  if (ids.length > 255 || ids.some((id) => id > 65_535)) throw new Error("The Atlas allocation cannot be represented by the official link format.");
  const bytes = new Uint8Array(9 + ids.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, pack.linkFormat.version, false);
  bytes[4] = 0;
  bytes[5] = 0;
  bytes[6] = ids.length;
  ids.forEach((id, index) => view.setUint16(7 + index * 2, id, false));
  bytes[7 + ids.length * 2] = 0;
  bytes[8 + ids.length * 2] = 0;
  return `https://www.pathofexile.com/atlas-skill-tree/${encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_")}`;
}

export function decodeAtlasUrl(pack: AtlasDataPack, value: string) {
  const trimmed = value.trim();
  let payload = trimmed;
  try {
    if (/^https?:/i.test(trimmed)) {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || !["pathofexile.com", "www.pathofexile.com"].includes(url.hostname)) {
        throw new Error("Only official Path of Exile Atlas links are accepted.");
      }
      const match = /^\/(?:fullscreen-)?atlas-skill-tree\/([^/?#]+)\/?$/.exec(url.pathname);
      if (!match) throw new Error("The URL is not an official Atlas skill-tree link.");
      payload = match[1];
    }
    const bytes = decodeBase64(decodeURIComponent(payload).replace(/-/g, "+").replace(/_/g, "/"));
    if (bytes.length < 9) throw new Error("The Atlas link payload is truncated.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(0, false);
    if (version !== pack.linkFormat.version || version !== ATLAS_LINK_VERSION) {
      throw new Error(`Atlas link version ${version} is unsupported; expected ${pack.linkFormat.version}.`);
    }
    if (bytes[4] !== 0 || bytes[5] !== 0) throw new Error("The Atlas link contains character-tree fields and was rejected.");
    const count = bytes[6];
    const extendedIndex = 7 + count * 2;
    if (bytes.length !== extendedIndex + 2 || bytes[extendedIndex] !== 0 || bytes[extendedIndex + 1] !== 0) {
      throw new Error("The Atlas link contains unsupported extended or mastery data.");
    }
    const nodeIds = Array.from({ length: count }, (_, index) => view.getUint16(7 + index * 2, false));
    const validation = validateAtlasAllocation(pack, nodeIds, pack.totalPoints);
    if (!validation.ok) throw new Error(validation.message);
    return sortedIds(nodeIds);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function boundedName(value: unknown, fallback: string) {
  const name = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return name || fallback;
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, maximum) : "";
}

function boundedTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  const tags = new Map<string, string>();
  for (const candidate of value.slice(0, 12)) {
    const tag = boundedText(candidate, 32).replace(/[\r\n,]/g, " ").replace(/\s+/g, " ");
    if (tag) tags.set(tag.toLocaleLowerCase(), tag);
  }
  return [...tags.values()];
}

function migrateNodeIds(pack: AtlasDataPack, input: unknown, basePoints: number) {
  const nodes = nodeMap(pack);
  const known = new Set<number>();
  if (Array.isArray(input)) {
    for (const value of input.slice(0, 255)) {
      if (Number.isSafeInteger(value) && isAllocatableAtlasNode(pack, nodes.get(Number(value)))) known.add(Number(value));
    }
  }
  const wanted = sortedIds(known);
  if (validateAtlasAllocation(pack, wanted, basePoints).ok) return wanted;
  const kept = new Set<number>();
  while (kept.size < known.size) {
    const analysis = atlasAllocationAnalysis(pack, kept, basePoints);
    const path = shortestPath(pack, kept, (node) => known.has(node.id) && !kept.has(node.id), known);
    if (!path || path.length > analysis.remaining) break;
    path.forEach((id) => kept.add(id));
  }
  return sortedIds(kept);
}

export function parseAtlasWorkspace(pack: AtlasDataPack, raw: string | null): AtlasMigrationResult {
  const fallback: AtlasWorkspace = {
    version: 2,
    gameVersion: pack.gameVersion,
    basePoints: pack.totalPoints,
    nodeIds: [],
    loadouts: [],
  };
  if (!raw) return { workspace: fallback, droppedNodeIds: [], changedVersion: false, loadoutReports: [] };
  try {
    const source = JSON.parse(raw) as Record<string, unknown>;
    if (!source || (source.version !== 1 && source.version !== 2)) {
      return { workspace: fallback, droppedNodeIds: [], changedVersion: false, loadoutReports: [] };
    }
    const basePoints = Number.isSafeInteger(source.basePoints)
      ? Math.max(0, Math.min(pack.totalPoints, Number(source.basePoints)))
      : pack.totalPoints;
    const originalIds = Array.isArray(source.nodeIds) ? source.nodeIds.filter(Number.isSafeInteger).map(Number) : [];
    const nodeIds = migrateNodeIds(pack, originalIds, basePoints);
    const loadouts: AtlasLoadout[] = [];
    const loadoutReports: AtlasMigrationResult["loadoutReports"] = [];
    if (Array.isArray(source.loadouts)) {
      for (const [index, candidate] of source.loadouts.slice(0, 30).entries()) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
        const item = candidate as Record<string, unknown>;
        const loadoutPoints = Number.isSafeInteger(item.basePoints)
          ? Math.max(0, Math.min(pack.totalPoints, Number(item.basePoints)))
          : pack.totalPoints;
        const id = boundedName(item.id, `loadout-${index + 1}`);
        const name = boundedName(item.name, `Atlas loadout ${index + 1}`);
        const originalLoadoutIds = Array.isArray(item.nodeIds)
          ? item.nodeIds.filter(Number.isSafeInteger).map(Number)
          : [];
        const migratedLoadoutIds = migrateNodeIds(pack, originalLoadoutIds, loadoutPoints);
        const droppedNodeIds = sortedIds(new Set(
          originalLoadoutIds.filter((idValue) => !migratedLoadoutIds.includes(idValue)),
        ));
        loadouts.push({
          id,
          name,
          gameVersion: pack.gameVersion,
          basePoints: loadoutPoints,
          nodeIds: migratedLoadoutIds,
          updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : 0,
          createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Number(item.updatedAt) || 0,
          folder: boundedText(item.folder, 80),
          tags: boundedTags(item.tags),
          notes: boundedText(item.notes, 2_000),
        });
        if (String(item.gameVersion || "") !== pack.gameVersion || droppedNodeIds.length) {
          loadoutReports.push({
            id,
            name,
            sourceGameVersion: boundedText(item.gameVersion, 40),
            droppedNodeIds,
          });
        }
      }
    }
    return {
      workspace: { version: 2, gameVersion: pack.gameVersion, basePoints, nodeIds, loadouts },
      droppedNodeIds: sortedIds(new Set(originalIds.filter((id) => !nodeIds.includes(id)))),
      changedVersion: String(source.gameVersion || "") !== pack.gameVersion,
      loadoutReports,
    };
  } catch {
    return { workspace: fallback, droppedNodeIds: [], changedVersion: false, loadoutReports: [] };
  }
}

export interface AtlasPresetBundle {
  schema: "gloamcore-atlas-presets";
  version: 1;
  game: "poe1";
  gameVersion: string;
  exportedAt: number;
  loadouts: AtlasLoadout[];
}

export function createAtlasPresetBundle(
  pack: AtlasDataPack,
  loadouts: readonly AtlasLoadout[],
  exportedAt = Date.now(),
): AtlasPresetBundle {
  const parsed = parseAtlasWorkspace(pack, JSON.stringify({
    version: 2,
    gameVersion: pack.gameVersion,
    basePoints: pack.totalPoints,
    nodeIds: [],
    loadouts: loadouts.slice(0, 30),
  }));
  return {
    schema: "gloamcore-atlas-presets",
    version: 1,
    game: "poe1",
    gameVersion: pack.gameVersion,
    exportedAt: Math.max(0, Number(exportedAt) || 0),
    loadouts: parsed.workspace.loadouts,
  };
}

export function parseAtlasPresetBundle(pack: AtlasDataPack, value: string | unknown) {
  const source = typeof value === "string" ? JSON.parse(value) : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Atlas preset bundle is not a JSON object.");
  }
  const bundle = source as Record<string, unknown>;
  if (
    bundle.schema !== "gloamcore-atlas-presets" ||
    bundle.version !== 1 ||
    bundle.game !== "poe1" ||
    !Array.isArray(bundle.loadouts)
  ) throw new Error("This is not a supported GloamCore Atlas preset bundle.");
  const migration = parseAtlasWorkspace(pack, JSON.stringify({
    version: 2,
    gameVersion: bundle.gameVersion,
    basePoints: pack.totalPoints,
    nodeIds: [],
    loadouts: bundle.loadouts,
  }));
  return { loadouts: migration.workspace.loadouts, reports: migration.loadoutReports };
}

export function compareAtlasLoadouts(left: AtlasLoadout, right: AtlasLoadout) {
  const leftIds = new Set(left.nodeIds);
  const rightIds = new Set(right.nodeIds);
  return {
    shared: sortedIds([...leftIds].filter((id) => rightIds.has(id))),
    onlyLeft: sortedIds([...leftIds].filter((id) => !rightIds.has(id))),
    onlyRight: sortedIds([...rightIds].filter((id) => !leftIds.has(id))),
  };
}
