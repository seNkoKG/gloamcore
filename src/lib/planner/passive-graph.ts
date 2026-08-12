import type { PassiveTreeData, PassiveTreeNodeData } from "../../types";
import type { ImportedPassiveSpec, ImportedPobItem } from "./pob-build";

export interface PassiveRemoteAllocationProvider {
  providerId: number;
  centerId: number;
  kind: "intuitive-leap" | "impossible-escape";
  keystoneOnly?: boolean;
  affected: ReadonlySet<number>;
}

export interface PassiveAllocationContext {
  remoteProviders: readonly PassiveRemoteAllocationProvider[];
  /** Nodes owned by another weapon-set graph; they cannot seed or cross this path. */
  blockedNodeIds?: ReadonlySet<number>;
}

const CURRENT_JEWEL_RADII: Record<string, number> = {
  Small: 960,
  Medium: 1440,
  Large: 1800,
  "Very Large": 2400,
  Massive: 2880,
};

const LEGACY_JEWEL_RADII: Record<string, number> = {
  Small: 800,
  Medium: 1200,
  Large: 1500,
};

function normalizedPassiveName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function jewelOuterRadius(version: string, label: string) {
  const [major, minor] = String(version || "").match(/\d+/g)?.map(Number) || [];
  const radii = major < 3 || (major === 3 && minor <= 15) ? LEGACY_JEWEL_RADII : CURRENT_JEWEL_RADII;
  return radii[label] || 0;
}

/**
 * Materialises the exact item-granted allocation providers PoB exposes for
 * Intuitive Leap and Impossible Escape. The provider socket remains the
 * dependency; radius-allocated passives are leaves and never path sources.
 */
export function buildPassiveAllocationContext(
  tree: PassiveTreeData,
  spec: ImportedPassiveSpec | null | undefined,
  items: readonly ImportedPobItem[],
): PassiveAllocationContext {
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  // Like PoB, trust the active passive spec's socket assignments. Callers
  // synchronise that map when the user changes the jewel loadout.
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const remoteProviders: PassiveRemoteAllocationProvider[] = [];
  for (const [rawSocketId, rawItemId] of Object.entries(spec?.sockets || {})) {
    const providerId = Number(rawSocketId);
    const socket = nodes.get(providerId);
    const item = itemsById.get(Number(rawItemId));
    if (!socket?.jewelSocket || !item) continue;
    const radiusLabel = /(?:^|\n)Radius:\s*(Small|Medium|Large|Very Large|Massive)\s*(?:\n|$)/i.exec(item.text)?.[1];
    if (!radiusLabel) continue;
    const radius = jewelOuterRadius(tree.version, radiusLabel.replace(/\b\w/g, (letter) => letter.toUpperCase()));
    if (!radius) continue;

    let kind: PassiveRemoteAllocationProvider["kind"] | null = null;
    let keystoneOnly = false;
    let center = socket;
    if (/\bIntuitive Leap\b/i.test(`${item.name}\n${item.baseType}\n${item.text}`)
      && /Passive Skills in Radius can be Allocated without being connected to your tree/i.test(item.text.replace(/\s+/g, " "))) {
      kind = "intuitive-leap";
      keystoneOnly = /Keystone Passive Skills in Radius can be Allocated/i.test(item.text.replace(/\s+/g, " "));
    } else {
      const impossible = /Passive Skills in Radius of\s+(.+?)\s+can be Allocated without being connected to your tree/i.exec(item.text.replace(/\s+/g, " "));
      if (!/\bImpossible Escape\b/i.test(`${item.name}\n${item.baseType}\n${item.text}`) || !impossible) continue;
      const keystoneName = normalizedPassiveName(impossible[1]);
      const keystone = tree.nodes.find((node) => node.keystone && normalizedPassiveName(node.name) === keystoneName);
      if (!keystone) continue;
      kind = "impossible-escape";
      center = keystone;
    }

    const radiusSquared = radius * radius;
    const affected = new Set(tree.nodes.filter((node) => {
      // Mirrors PassiveSpec.lua: class starts, sockets and ascendancy nodes are
      // not candidates for Intuitive-Leap-like allocation.
      if (node.classStartIds.length || node.jewelSocket || node.ascendancyName || node.mastery || node.isBlighted) return false;
      if (kind === "impossible-escape" && node.id === center.id) return false;
      if (keystoneOnly && !node.keystone) return false;
      const dx = node.x - center.x;
      const dy = node.y - center.y;
      return dx * dx + dy * dy <= radiusSquared;
    }).map((node) => node.id));
    remoteProviders.push({ providerId, centerId: center.id, kind, keystoneOnly, affected });
  }
  return { remoteProviders };
}

export function passiveAdjacency(tree: PassiveTreeData) {
  const known = new Set(tree.nodes.map((node) => node.id));
  const adjacency = new Map<number, Set<number>>();
  for (const node of tree.nodes) adjacency.set(node.id, new Set());
  for (const node of tree.nodes) {
    for (const target of [...node.out, ...node.in]) {
      if (!known.has(target)) continue;
      adjacency.get(node.id)?.add(target);
      adjacency.get(target)?.add(node.id);
    }
  }
  return adjacency;
}

export function classStartNode(tree: PassiveTreeData, classId: number) {
  return tree.nodes.find((node) => node.classStartIds.includes(classId)) || null;
}

export function countAllocatedPassivePoints(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
) {
  let passive = 0;
  let ascendancy = 0;
  let secondaryAscendancy = 0;
  let sockets = 0;
  for (const node of tree.nodes) {
    if (!allocated.has(node.id) || node.classStartIds.length || node.isAscendancyStart) continue;
    if (node.ascendancyName) {
      if (!node.multipleChoiceOption) {
        ascendancy += 1;
        if (node.bloodline) secondaryAscendancy += 1;
      }
    } else {
      passive += 1;
    }
    if (node.jewelSocket) sockets += 1;
  }
  return { passive, ascendancy, secondaryAscendancy, sockets };
}

/** PoB IsClassConnected: allocated main-tree links join both class starts. */
export function isAllocatedClassConnected(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  currentClassId: number,
  targetClassId: number,
) {
  const currentStart = classStartNode(tree, currentClassId);
  const targetStart = classStartNode(tree, targetClassId);
  if (!currentStart || !targetStart) return false;
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const adjacency = passiveAdjacency(tree);
  const reachable = new Set<number>([currentStart.id]);
  const queue = [currentStart.id];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighborId of adjacency.get(queue[cursor]) || []) {
      if (reachable.has(neighborId) || !allocated.has(neighborId)) continue;
      const neighbor = nodes.get(neighborId);
      if (!neighbor || neighbor.ascendancyName || neighbor.classStartIds.length || neighbor.isAscendancyStart) continue;
      reachable.add(neighborId);
      queue.push(neighborId);
    }
  }
  return [...(adjacency.get(targetStart.id) || [])].some((id) => reachable.has(id) && allocated.has(id));
}

/** PoB Shift trace: start with the default path, then accept adjacent hovers. */
export function extendPassiveTracePath(
  tree: PassiveTreeData,
  currentPath: readonly number[],
  hoverId: number,
  defaultPath: readonly number[],
) {
  if (!currentPath.length) return [...defaultPath];
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const lastId = currentPath[currentPath.length - 1];
  if (hoverId === lastId || nodes.get(lastId)?.mastery) return [...currentPath];
  if (!passiveAdjacency(tree).get(lastId)?.has(hoverId)) return [...currentPath];
  const next = [...currentPath];
  const existing = next.indexOf(hoverId);
  if (existing >= 0) next.splice(existing, 1);
  next.push(hoverId);
  return next;
}

function allowedNode(
  node: PassiveTreeNodeData,
  classId: number,
  ascendancyName?: string,
  secondaryAscendancyName?: string,
) {
  if (node.classStartIds.length && !node.classStartIds.includes(classId)) return false;
  if (
    node.ascendancyName
    && node.ascendancyName !== ascendancyName
    && node.ascendancyName !== secondaryAscendancyName
  ) return false;
  return true;
}

/** PoB PassiveSpec.lua BuildPathFromNode transition rules. */
function allowedPathStep(current: PassiveTreeNodeData, next: PassiveTreeNodeData, currentDistance: number) {
  // Masteries are leaves and paths may never enter a class/ascendancy start.
  if (current.mastery || next.classStartIds.length || next.isAscendancyStart) return false;
  if (current.ascendancyName === next.ascendancyName) return true;
  // An already allocated Ascendant Path-of-X node may seed a path into the
  // corresponding base-tree starting area, but paths cannot travel the reverse way.
  return currentDistance === 0 && Boolean(current.ascendancyName) && !next.ascendancyName;
}

/** Multi-source BFS: selecting a remote node allocates the cheapest legal path. */
export function shortestAllocationPath(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  targetId: number,
  classId: number,
  ascendancyName?: string,
  secondaryAscendancyName?: string,
  context?: PassiveAllocationContext,
) {
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const target = nodes.get(targetId);
  const blocked = context?.blockedNodeIds || new Set<number>();
  if (blocked.has(targetId) || !target || !allowedNode(target, classId, ascendancyName, secondaryAscendancyName)) return [];
  const start = classStartNode(tree, classId);
  if (!start) return [];
  const connected = normallyReachableAllocated(
    tree,
    allocated,
    classId,
    ascendancyName,
    secondaryAscendancyName,
  );
  if (context?.remoteProviders.some((provider) => (
    connected.has(provider.providerId) && provider.affected.has(targetId)
  ))) return [targetId];
  const sources = connected.size
    ? [...connected].filter((id) => {
        const node = nodes.get(id);
        return !blocked.has(id) && Boolean(node && allowedNode(node, classId, ascendancyName, secondaryAscendancyName));
      })
    : [start.id];
  if (!sources.includes(start.id)) sources.push(start.id);
  const sourceSet = new Set(sources);
  const adjacency = passiveAdjacency(tree);
  const buckets: number[][] = [[...sources]];
  const distance = new Map<number, number>(sources.map((id) => [id, 0]));
  const parent = new Map<number, number | null>(sources.map((id) => [id, null]));
  for (let currentDistance = 0; currentDistance < buckets.length; currentDistance += 1) {
    const bucket = buckets[currentDistance] || [];
    for (let cursor = 0; cursor < bucket.length; cursor += 1) {
      const currentId = bucket[cursor];
      if (distance.get(currentId) !== currentDistance) continue;
      const current = nodes.get(currentId);
      if (!current) continue;
      for (const nextId of adjacency.get(currentId) || []) {
        const next = nodes.get(nextId);
        if (blocked.has(nextId) || !next || !allowedNode(next, classId, ascendancyName, secondaryAscendancyName)) continue;
        if (!allowedPathStep(current, next, currentDistance)) continue;
        const nextDistance = currentDistance + (allocated.has(nextId) ? 0 : 1);
        if ((distance.get(nextId) ?? Number.POSITIVE_INFINITY) <= nextDistance) continue;
        distance.set(nextId, nextDistance);
        parent.set(nextId, currentId);
        (buckets[nextDistance] ||= []).push(nextId);
      }
    }
  }
  if (!parent.has(targetId)) return [];
  const path: number[] = [];
  let current: number | null = targetId;
  while (current != null && !sourceSet.has(current)) {
    if (!allocated.has(current)) path.push(current);
    current = parent.get(current) ?? null;
  }
  return path.reverse();
}

/** Adds a path and enforces PoB's mutually-exclusive passive choices. */
export function allocatePassivePath(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  path: readonly number[],
  targetId: number,
) {
  const next = new Set(allocated);
  for (const id of path) next.add(id);
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const target = nodes.get(targetId);
  if (!target?.multipleChoiceOption) return next;
  const adjacency = passiveAdjacency(tree);
  const parentId = [...(adjacency.get(targetId) || [])].find((id) => {
    const candidate = nodes.get(id);
    return candidate?.multipleChoice && !candidate.multipleChoiceOption;
  });
  if (parentId == null) return next;
  for (const siblingId of adjacency.get(parentId) || []) {
    if (siblingId !== targetId && nodes.get(siblingId)?.multipleChoiceOption) next.delete(siblingId);
  }
  return next;
}

function allocatedRoots(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  classId: number,
  ascendancyName?: string,
  secondaryAscendancyName?: string,
) {
  return tree.nodes.filter((node) => allocated.has(node.id) && (
    node.classStartIds.includes(classId)
    || (Boolean(node.isAscendancyStart) && (
      node.ascendancyName === ascendancyName || node.ascendancyName === secondaryAscendancyName
    ))
  ));
}

function normallyReachableAllocated(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  classId: number,
  ascendancyName?: string,
  secondaryAscendancyName?: string,
) {
  const start = classStartNode(tree, classId);
  if (!start) return new Set<number>();
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const adjacency = passiveAdjacency(tree);
  const roots = allocatedRoots(tree, allocated, classId, ascendancyName, secondaryAscendancyName);
  if (!roots.some((node) => node.id === start.id)) roots.push(start);
  const reachable = new Set<number>(roots.map((node) => node.id));
  const queue = roots.map((node) => node.id);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = nodes.get(queue[cursor]);
    if (!current) continue;
    for (const neighborId of adjacency.get(current.id) || []) {
      if (!allocated.has(neighborId) || reachable.has(neighborId)) continue;
      const neighbor = nodes.get(neighborId);
      if (!neighbor || !allowedNode(neighbor, classId, ascendancyName, secondaryAscendancyName)) continue;
      if (!allowedPathStep(current, neighbor, 0)) continue;
      reachable.add(neighborId);
      queue.push(neighborId);
    }
  }
  return reachable;
}

/**
 * Drops allocations that no longer have a legal PoB dependency after a
 * loadout/tree mutation (for example removing Intuitive Leap or a cluster
 * jewel). Remote allocations remain valid only while their provider socket is
 * itself connected and the active spec still contains that provider.
 */
export function retainConnectedAllocatedPassives(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  classId: number,
  ascendancyName?: string,
  secondaryAscendancyName?: string,
  context?: PassiveAllocationContext,
) {
  const known = new Set(tree.nodes.map((node) => node.id));
  const next = new Set([...allocated].filter((id) => known.has(id)));
  const start = classStartNode(tree, classId);
  if (!start) return next;
  next.add(start.id);
  const reachable = normallyReachableAllocated(
    tree,
    next,
    classId,
    ascendancyName,
    secondaryAscendancyName,
  );
  for (const provider of context?.remoteProviders || []) {
    if (!reachable.has(provider.providerId)) continue;
    for (const id of provider.affected) if (next.has(id)) reachable.add(id);
  }
  return new Set([...next].filter((id) => reachable.has(id)));
}

/** Refunding a connector also refunds every allocated dependent branch. */
export function refundNodeAndDependents(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  removeId: number,
  classId: number,
  ascendancyName?: string,
  secondaryAscendancyName?: string,
  context?: PassiveAllocationContext,
) {
  const next = new Set(allocated);
  next.delete(removeId);
  return retainConnectedAllocatedPassives(
    tree,
    next,
    classId,
    ascendancyName,
    secondaryAscendancyName,
    context,
  );
}

export function dependentAllocatedNodes(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  removeId: number,
  classId: number,
  ascendancyName?: string,
  secondaryAscendancyName?: string,
  context?: PassiveAllocationContext,
) {
  const retained = refundNodeAndDependents(
    tree,
    allocated,
    removeId,
    classId,
    ascendancyName,
    secondaryAscendancyName,
    context,
  );
  return new Set([...allocated].filter((id) => !retained.has(id)));
}

export function searchPassiveNodes(tree: PassiveTreeData, rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) return [];
  const idMatch = /^#(\d+)$/.exec(query);
  if (idMatch) return tree.nodes.filter((node) => node.id === Number(idMatch[1]));
  const phrases = Array.from(query.matchAll(/"([^"]+)"|(\S+)/g), (match) => (match[1] || match[2]).toLocaleLowerCase());
  return tree.nodes.filter((node) => {
    const type = node.keystone ? "keystone" : node.mastery ? "mastery" : node.notable ? "notable" : node.jewelSocket ? "jewel socket" : "small";
    const haystack = `${node.name} ${node.stats.join(" ")} ${type}`.toLocaleLowerCase();
    return phrases.every((phrase) => haystack.includes(phrase));
  });
}

export interface PassiveStatSummary {
  label: string;
  value: number;
  percent: boolean;
}

export function summarizeAllocatedStats(tree: PassiveTreeData, allocated: ReadonlySet<number>) {
  const totals = new Map<string, PassiveStatSummary>();
  for (const node of tree.nodes) {
    if (!allocated.has(node.id)) continue;
    for (const stat of node.stats) {
      const match = /([+-]?\d+(?:\.\d+)?)\s*(%)?/.exec(stat);
      if (!match) continue;
      const label = stat.replace(match[0], "#").trim();
      const key = `${label}:${Boolean(match[2])}`;
      const current = totals.get(key) || { label, value: 0, percent: Boolean(match[2]) };
      current.value += Number(match[1]);
      totals.set(key, current);
    }
  }
  return [...totals.values()].sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
}
