import type {
  PassiveTreeClusterData,
  PassiveTreeClusterJewelData,
  PassiveTreeClusterNodeVisual,
  PassiveTreeData,
  PassiveTreeGroupData,
  PassiveTreeNodeData,
} from "../../types";
import type { ImportedPassiveSpec, ImportedPobItem } from "./pob-build";

export interface ClusterJewelDescriptor {
  config: PassiveTreeClusterJewelData;
  skillId: string | null;
  nodeCount: number;
  socketCount: number;
  notables: string[];
  addedSmallStats: string[];
  nothingness: boolean;
  keystone: string | null;
}

export interface MaterializedPassiveTree {
  tree: PassiveTreeData;
  /** Current generated IDs corresponding to allocated official `hashes_ex`. */
  mappedExtendedAllocations: number[];
  /** Exact PoB v1-to-v2 generated cluster-node remap, present only during legacy conversion. */
  legacyClusterNodeMap?: ReadonlyMap<number, number>;
}

export interface MaterializedPassiveSpec extends MaterializedPassiveTree {
  /**
   * A lossless export-ready spec. Official character imports identify cluster
   * allocations with opaque `hashes_ex`; PoB XML instead stores the generated
   * deterministic node IDs in the Spec's `nodes` attribute.
   */
  spec: ImportedPassiveSpec;
}

function normalizedTreeVersion(value: string | undefined) {
  const normalized = String(value || "").trim().replace(/\./g, "_").toLocaleLowerCase();
  const base = normalized.replace(/_(?:ruthless|alternate)(?:_(?:ruthless|alternate))*$/, "");
  return `${base}${/(?:^|_)ruthless(?:_|$)/.test(normalized) ? "_ruthless" : ""}${/(?:^|_)alternate(?:_|$)/.test(normalized) ? "_alternate" : ""}`;
}

/** A spec's hashes are meaningful only against its exact PoB tree variant. */
export function passiveSpecMatchesTree(inputTree: PassiveTreeData, spec?: ImportedPassiveSpec | null) {
  const requested = String(spec?.treeVersion || "").trim();
  if (!requested) return true;
  return inputTree.game === "poe1"
    && normalizedTreeVersion(inputTree.version) === normalizedTreeVersion(requested);
}

function normalizedLine(value: string) {
  return value
    .replace(/^(?:\{[^}]+\})+/, "")
    .replace(/<<[^>]+>>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(value: string) {
  return normalizedLine(value).toLocaleLowerCase();
}

function itemLines(item: ImportedPobItem) {
  return item.text.replace(/\r\n/g, "\n").split("\n").map(normalizedLine).filter(Boolean);
}

function clusterConfig(item: ImportedPobItem, cluster: PassiveTreeClusterData) {
  if (cluster.jewels[item.baseType]) return cluster.jewels[item.baseType];
  const identity = `${item.baseType}\n${item.text}`.toLocaleLowerCase();
  return Object.values(cluster.jewels).find((candidate) => identity.includes(candidate.baseType.toLocaleLowerCase())) || null;
}

/**
 * Parses exactly the structural subset PoB's ModParser uses to build cluster
 * subgraphs. It accepts both regular in-game text/API mods and PoB's two
 * lossless `Cluster Jewel ...` metadata lines.
 */
export function parseClusterJewelDescriptor(
  item: ImportedPobItem,
  cluster: PassiveTreeClusterData,
): ClusterJewelDescriptor | null {
  const config = clusterConfig(item, cluster);
  if (!config) return null;
  const lines = itemLines(item);
  const lineKeys = new Set(lines.map(normalizedKey));
  const flattened = normalizedKey(lines.join(" "));

  let declaredNodeCount: number | null = null;
  let socketCount = 0;
  let socketCountOverride: number | null = null;
  let nothingnessCount = 0;
  let smallsAreNothingness = false;
  const addedSmallStats: string[] = [];
  for (const line of lines) {
    let match = /^Cluster Jewel Node Count:\s*(\d+)$/i.exec(line)
      || /^Adds (\d+) Passive Skills$/i.exec(line);
    if (match) declaredNodeCount = Number(match[1]);
    if (/^1 Added Passive Skill is a Jewel Socket$/i.test(line)) socketCount = 1;
    match = /^(\d+) Added Passive Skills are Jewel Sockets$/i.exec(line);
    if (match) socketCount = Number(match[1]);
    match = /^Adds (\d+) Jewel Socket Passive Skills$/i.exec(line);
    if (match) socketCountOverride = Number(match[1]);
    match = /^Adds (\d+) Small Passive Skills? which grants? nothing$/i.exec(line);
    if (match) nothingnessCount = Number(match[1]);
    if (/^Added Small Passive Skills grant nothing$/i.test(line)) smallsAreNothingness = true;
    match = /^Added Small Passive Skills also grant:\s*(.+)$/i.exec(line);
    if (match) addedSmallStats.push(match[1]);
  }

  const explicitSkill = lines.map((line) => /^Cluster Jewel Skill:\s*(\S+)$/i.exec(line)?.[1]).find(Boolean);
  let skillId = explicitSkill && config.skills[explicitSkill] ? explicitSkill : null;
  if (!skillId) {
    const candidates = Object.values(config.skills)
      .map((skill) => ({ skill, key: normalizedKey(skill.enchant.join(" ")) }))
      .filter((entry) => entry.key && flattened.includes(entry.key))
      .sort((left, right) => right.key.length - left.key.length);
    skillId = candidates[0]?.skill.id || null;
  }

  const notables = Object.keys(cluster.notableSortOrder).filter((name) => (
    lineKeys.has(normalizedKey(`1 Added Passive Skill is ${name}`))
  ));
  const keystone = cluster.keystones.find((name) => lineKeys.has(normalizedKey(`Adds ${name}`))) || null;
  const effectiveSocketCount = socketCountOverride ?? socketCount;
  const inferredNodeCount = effectiveSocketCount + notables.length + nothingnessCount;
  const nodeCount = declaredNodeCount == null
    ? inferredNodeCount
    : Math.min(config.maxNodes, Math.max(config.minNodes, declaredNodeCount));
  const valid = Boolean(
    keystone
    || ((skillId || smallsAreNothingness) && nodeCount)
    || (socketCountOverride != null && nothingnessCount),
  );
  if (!valid || !nodeCount) return null;
  return {
    config,
    skillId,
    nodeCount,
    socketCount: effectiveSocketCount,
    notables,
    addedSmallStats,
    nothingness: smallsAreNothingness || nothingnessCount > 0,
    keystone,
  };
}

function baseNode(id: number, name: string, visual: PassiveTreeClusterNodeVisual = { name, stats: [] }): PassiveTreeNodeData {
  return {
    id,
    name,
    stats: [...visual.stats],
    x: 0,
    y: 0,
    out: [],
    in: [],
    classStartIndex: null,
    classStartIds: [],
    ascendancyName: null,
    notable: Boolean(visual.notable),
    keystone: Boolean(visual.keystone),
    mastery: Boolean(visual.mastery),
    jewelSocket: false,
    multipleChoice: false,
    bloodline: false,
    reminderText: visual.reminderText ? [...visual.reminderText] : [],
    flavourText: visual.flavourText ? [...visual.flavourText] : [],
    spriteActive: visual.spriteActive,
    spriteInactive: visual.spriteInactive,
  };
}

function translateClusterOrbitIndex(source: number, sourceCount: number, destinationCount: number) {
  if (sourceCount === destinationCount) return source;
  const mappings: Record<string, number[]> = {
    "12:16": [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15],
    "16:12": [0, 1, 1, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10, 10, 11],
    "6:16": [0, 3, 5, 8, 11, 13],
    "16:6": [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5],
  };
  return mappings[`${sourceCount}:${destinationCount}`]?.[source]
    ?? Math.floor((source * destinationCount) / Math.max(1, sourceCount));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function importedExtendedGroups(spec: ImportedPassiveSpec) {
  const result: Array<{
    proxy: number;
    nodeIds: Set<number>;
    nodes: Array<{ id: number; orbitIndex: number; mastery: boolean }>;
  }> = [];
  for (const jewel of Object.values(spec.jewelData || {})) {
    const subgraph = asRecord(asRecord(jewel).subgraph);
    const groups = asRecord(subgraph.groups);
    const nodes = asRecord(subgraph.nodes);
    for (const [groupId, rawGroup] of Object.entries(groups)) {
      const group = asRecord(rawGroup);
      const nodeIds = new Set((Array.isArray(group.nodes) ? group.nodes : []).map(Number).filter(Number.isFinite));
      result.push({
        proxy: Number(group.proxy),
        nodeIds,
        nodes: Object.entries(nodes).flatMap(([id, rawNode]) => {
          const node = asRecord(rawNode);
          if (String(node.group) !== String(groupId)) return [];
          const numericId = Number(id);
          const orbitIndex = Number(node.orbitIndex);
          return Number.isFinite(numericId) && Number.isFinite(orbitIndex)
            ? [{ id: numericId, orbitIndex, mastery: Boolean(node.isMastery) }]
            : [];
        }),
      });
    }
  }
  return result.filter((entry) => Number.isFinite(entry.proxy));
}

function overrideStats(value: Record<string, unknown>) {
  const candidate = Array.isArray(value.stats) ? value.stats : Array.isArray(value.sd) ? value.sd : null;
  return candidate?.map(String).flatMap((stat) => stat.split(/\r?\n/)).filter(Boolean);
}

/** Applies official tattoo/skill overrides while retaining the original node topology. */
export function applyImportedSkillOverrides(tree: PassiveTreeData, spec?: ImportedPassiveSpec | null) {
  if (!spec?.skillOverrides || !Object.keys(spec.skillOverrides).length) return tree;
  let changed = false;
  const nodes = tree.nodes.map((node) => {
    const override = spec.skillOverrides?.[node.id];
    if (!override) return node;
    changed = true;
    const overrideName = String(override.name || override.dn || "").trim();
    const template = tree.cluster?.tattoos[overrideName];
    const stats = overrideStats(override) || template?.stats || node.stats;
    return {
      ...node,
      name: overrideName || template?.name || node.name,
      stats: [...stats],
      notable: template?.notable ?? node.notable,
      keystone: template?.keystone ?? node.keystone,
      mastery: template?.mastery ?? node.mastery,
      reminderText: template?.reminderText || node.reminderText,
      flavourText: template?.flavourText || node.flavourText,
      isTattoo: Boolean(template || overrideName.toLocaleLowerCase().startsWith("tattoo of ")),
      spriteActive: template?.spriteActive || node.spriteActive,
      spriteInactive: template?.spriteInactive || node.spriteInactive,
    };
  });
  return changed ? { ...tree, nodes } : tree;
}

/** Applies the imported active mastery option to the base mastery node. */
export function applyImportedMasteryEffects(tree: PassiveTreeData, spec?: ImportedPassiveSpec | null) {
  if (!spec?.masteryEffects || !Object.keys(spec.masteryEffects).length) return tree;
  let changed = false;
  const nodes = tree.nodes.map((node) => {
    const selected = Number(spec.masteryEffects[node.id]);
    const effect = node.masteryEffects?.[selected];
    if (!node.mastery || !Number.isFinite(selected) || !effect) return node;
    changed = true;
    return {
      ...node,
      stats: [...effect.stats],
      reminderText: [...effect.reminderText],
      selectedMasteryEffect: selected,
    };
  });
  return changed ? { ...tree, nodes } : tree;
}

/**
 * Faithful TypeScript port of PoB 2.65's BuildClusterJewelGraphs/BuildSubgraph.
 * It materializes only graphs backed by an actual socketed item; proxy/template
 * nodes remain hidden when no valid cluster jewel is present.
 */
export function materializeImportedPassiveTree(
  inputTree: PassiveTreeData,
  spec?: ImportedPassiveSpec | null,
  items: readonly ImportedPobItem[] = [],
): MaterializedPassiveTree {
  // Never reinterpret allocations or overrides against a different league tree.
  // Callers must first ask the desktop service for this spec's exact version.
  if (!passiveSpecMatchesTree(inputTree, spec)) {
    return { tree: inputTree, mappedExtendedAllocations: [] };
  }
  const overriddenTree = applyImportedMasteryEffects(applyImportedSkillOverrides(inputTree, spec), spec);
  const cluster = overriddenTree.cluster;
  if (!cluster || !spec?.sockets || !items.length) {
    return { tree: overriddenTree, mappedExtendedAllocations: [] };
  }
  // A tree spec's socket map is authoritative in PoB. Item-set "equipped"
  // state describes the currently selected UI set and must not invalidate
  // jewels belonging to another passive-tree spec.
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const nodes = overriddenTree.nodes.map((node) => ({ ...node, out: [...node.out], in: [...node.in] }));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const groups: PassiveTreeGroupData[] = [...(overriddenTree.groups || [])];
  const mappedExtendedAllocations = new Set<number>();
  const legacyClusterNodeMap = spec.clusterHashFormatVersion === 1 ? new Map<number, number>() : null;
  const extended = new Set((spec.extendedHashes || []).map(Number));
  const importedGroups = importedExtendedGroups(spec);

  const clusterSocket = (groupId: number, index: number) => cluster.socketTemplates.find((candidate) => (
    candidate.groupId === groupId && candidate.expansionJewel.index === index
  ));
  const legacyProxyGroupId = (groupId: number, expansionSize: number, clusterSizeIndex: number) => {
    let legacyGroupId = groupId;
    let groupSize = expansionSize;
    for (let guard = 0; clusterSizeIndex < groupSize && guard < 4; guard += 1) {
      const socket = clusterSocket(legacyGroupId, 1) || clusterSocket(legacyGroupId, 0);
      const proxy = socket && cluster.proxies[socket.expansionJewel.proxy];
      if (!socket || !proxy) break;
      legacyGroupId = proxy.groupId;
      groupSize = socket.expansionJewel.size;
    }
    return legacyGroupId;
  };

  const link = (left: PassiveTreeNodeData, right: PassiveTreeNodeData) => {
    if (!left.out.includes(right.id)) left.out.push(right.id);
    if (!right.out.includes(left.id)) right.out.push(left.id);
  };

  const mapExtendedAllocation = (node: PassiveTreeNodeData, proxyId: number) => {
    if (extended.has(node.id)) mappedExtendedAllocations.add(node.id);
    for (const group of importedGroups) {
      if (group.proxy !== proxyId) continue;
      const match = group.nodes.find((candidate) => (
        !candidate.mastery
        && candidate.orbitIndex === node.orbitIndex
        && group.nodeIds.has(candidate.id)
        && extended.has(candidate.id)
      ));
      if (match) mappedExtendedAllocations.add(node.id);
    }
  };

  const addNode = (node: PassiveTreeNodeData) => {
    const existing = nodeMap.get(node.id);
    if (existing) return existing;
    nodes.push(node);
    nodeMap.set(node.id, node);
    return node;
  };

  const buildSubgraph = (item: ImportedPobItem, parent: PassiveTreeNodeData, inheritedId = 0x10000) => {
    const descriptor = parseClusterJewelDescriptor(item, cluster);
    const expansion = parent.expansionJewel;
    // Cluster sockets accept their own size or any smaller jewel (for example,
    // Voices commonly holds Small clusters in its Medium sockets).
    if (!descriptor || !expansion || descriptor.config.sizeIndex > expansion.size) return;
    let graphId = inheritedId;
    if (expansion.size === 2) graphId += expansion.index << 6;
    else if (expansion.size === 1) graphId += expansion.index << 9;
    const nodeBase = graphId + (descriptor.config.sizeIndex << 4);
    const proxy = cluster.proxies[expansion.proxy];
    if (!proxy) return;
    const groupId = -nodeBase;
    const nodeOrbit = descriptor.config.sizeIndex + 1;
    const group: PassiveTreeGroupData = {
      id: groupId,
      x: proxy.x,
      y: proxy.y,
      orbits: descriptor.config.skills[descriptor.skillId || ""]?.mastery ? [0, nodeOrbit] : [nodeOrbit],
      background: {
        image: descriptor.config.size === "Large"
          ? "GroupBackgroundLargeHalfAlt"
          : descriptor.config.size === "Medium"
            ? "GroupBackgroundMediumAlt"
            : "GroupBackgroundSmallAlt",
        isHalfImage: descriptor.config.size === "Large",
      },
      ascendancyName: null,
      isAscendancyStart: false,
    };
    groups.push(group);

    if (descriptor.keystone) {
      const definition = cluster.definitions[descriptor.keystone];
      if (!definition) return;
      const node = baseNode(nodeBase, descriptor.keystone, definition);
      node.groupId = groupId;
      node.orbit = 0;
      node.orbitIndex = 1;
      node.x = group.x;
      node.y = group.y;
      addNode(node);
      link(node, parent);
      mapExtendedAllocation(node, proxy.id);
      return;
    }

    const notableDefinitions = descriptor.notables
      .map((name) => cluster.definitions[name])
      .filter((definition): definition is PassiveTreeClusterNodeVisual => Boolean(definition));
    if (notableDefinitions.length !== descriptor.notables.length) return;
    notableDefinitions.sort((left, right) => (
      (cluster.notableSortOrder[left.name] ?? Number.MAX_SAFE_INTEGER)
      - (cluster.notableSortOrder[right.name] ?? Number.MAX_SAFE_INTEGER)
    ));
    const skill = descriptor.skillId ? descriptor.config.skills[descriptor.skillId] : null;
    const indices = new Map<number, PassiveTreeNodeData>();

    const makeSocket = (nodeIndex: number, jewelIndex: number) => {
      const template = cluster.socketTemplates.find((candidate) => (
        candidate.groupId === proxy.groupId && candidate.expansionJewel.index === jewelIndex
      ));
      if (!template) return;
      const node = baseNode(template.id, template.name, {
        name: template.name,
        stats: [],
        spriteActive: template.spriteActive,
        spriteInactive: template.spriteInactive,
      });
      node.jewelSocket = true;
      node.expansionJewel = { ...template.expansionJewel };
      node.groupId = groupId;
      node.orbit = nodeOrbit;
      node.orbitIndex = nodeIndex;
      indices.set(nodeIndex, addNode(node));
      if (legacyClusterNodeMap) {
        const legacyGroupId = legacyProxyGroupId(proxy.groupId, expansion.size, descriptor.config.sizeIndex);
        const legacySocket = clusterSocket(legacyGroupId, jewelIndex);
        if (legacySocket && legacySocket.id !== node.id) legacyClusterNodeMap.set(legacySocket.id, node.id);
      }
    };

    if (descriptor.config.size === "Large" && descriptor.socketCount === 1) {
      makeSocket(6, 1);
    } else {
      const jewelIndices = [0, 2, 1];
      for (let index = 0; index < Math.min(descriptor.socketCount, descriptor.config.socketIndices.length); index += 1) {
        makeSocket(descriptor.config.socketIndices[index], jewelIndices[index]);
      }
    }

    const notableIndices: number[] = [];
    for (let nodeIndex of descriptor.config.notableIndices) {
      if (notableIndices.length === notableDefinitions.length) break;
      if (descriptor.config.size === "Medium") {
        if (descriptor.socketCount === 0 && notableDefinitions.length === 2) {
          if (nodeIndex === 6) nodeIndex = 4;
          else if (nodeIndex === 10) nodeIndex = 8;
        } else if (descriptor.nodeCount === 4) {
          if (nodeIndex === 10) nodeIndex = 9;
          else if (nodeIndex === 2) nodeIndex = 3;
        }
      }
      if (!indices.has(nodeIndex)) notableIndices.push(nodeIndex);
    }
    notableIndices.sort((left, right) => left - right);
    notableDefinitions.forEach((definition, index) => {
      const nodeIndex = notableIndices[index];
      if (nodeIndex == null) return;
      const node = baseNode(nodeBase + nodeIndex, definition.name, definition);
      node.groupId = groupId;
      node.orbit = nodeOrbit;
      node.orbitIndex = nodeIndex;
      indices.set(nodeIndex, addNode(node));
    });

    const smallCount = Math.max(0, descriptor.nodeCount - descriptor.socketCount - notableDefinitions.length);
    const smallIndices: number[] = [];
    for (let nodeIndex of descriptor.config.smallIndices) {
      if (smallIndices.length === smallCount) break;
      if (descriptor.config.size === "Medium") {
        if (descriptor.nodeCount === 5 && nodeIndex === 4) nodeIndex = 3;
        else if (descriptor.nodeCount === 4) {
          if (nodeIndex === 8) nodeIndex = 9;
          else if (nodeIndex === 4) nodeIndex = 3;
        }
      }
      if (!indices.has(nodeIndex)) smallIndices.push(nodeIndex);
    }
    for (let index = 0; index < smallCount; index += 1) {
      const nodeIndex = smallIndices[index];
      if (nodeIndex == null) break;
      const visual: PassiveTreeClusterNodeVisual = skill || { name: "Nothingness", stats: [] };
      const node = baseNode(nodeBase + nodeIndex, skill?.name || "Nothingness", visual);
      // A cluster skill's `mastery` asset describes the separate centre
      // mastery icon. Its ordinary orbit passives remain Normal nodes in PoB.
      node.mastery = false;
      node.stats.push(...descriptor.addedSmallStats);
      node.groupId = groupId;
      node.orbit = nodeOrbit;
      node.orbitIndex = nodeIndex;
      indices.set(nodeIndex, addNode(node));
    }

    const entrance = indices.get(0);
    if (!entrance) return;
    const skillsInOrbit = cluster.skillsPerOrbit[nodeOrbit] || descriptor.config.totalIndices;
    const offset = cluster.orbitOffsets[proxy.id]?.[descriptor.config.sizeIndex] || 0;
    for (const node of indices.values()) {
      const relative = ((Number(node.orbitIndex) + offset) % descriptor.config.totalIndices + descriptor.config.totalIndices) % descriptor.config.totalIndices;
      const orbitIndex = translateClusterOrbitIndex(relative, descriptor.config.totalIndices, skillsInOrbit);
      const angle = cluster.orbitAngles[nodeOrbit]?.[orbitIndex] ?? ((360 * orbitIndex) / Math.max(1, skillsInOrbit));
      const radians = (angle * Math.PI) / 180;
      const radius = cluster.orbitRadii[nodeOrbit] || 0;
      node.orbitIndex = orbitIndex;
      node.x = group.x + Math.sin(radians) * radius;
      node.y = group.y - Math.cos(radians) * radius;
      mapExtendedAllocation(node, proxy.id);
    }
    if (legacyClusterNodeMap) {
      const legacySkillsPerOrbit = cluster.skillsPerOrbit[proxy.orbit] || skillsInOrbit;
      const legacyProxyIndex = translateClusterOrbitIndex(
        proxy.orbitIndex,
        legacySkillsPerOrbit,
        descriptor.config.totalIndices,
      );
      const legacyNodeIdsByOrbit = new Map<number, number>();
      const currentNodeIdsByOrbit = new Map<number, number>();
      for (const [nodeIndex, node] of indices) {
        const legacyRelative = (nodeIndex + legacyProxyIndex) % descriptor.config.totalIndices;
        const legacyOrbitIndex = translateClusterOrbitIndex(
          legacyRelative,
          descriptor.config.totalIndices,
          legacySkillsPerOrbit,
        );
        legacyNodeIdsByOrbit.set(legacyOrbitIndex, node.id);
        const currentRelative = translateClusterOrbitIndex(
          Number(node.orbitIndex),
          skillsInOrbit,
          descriptor.config.totalIndices,
        );
        const currentInLegacyOrbit = translateClusterOrbitIndex(
          currentRelative,
          descriptor.config.totalIndices,
          legacySkillsPerOrbit,
        );
        currentNodeIdsByOrbit.set(currentInLegacyOrbit, node.id);
      }
      for (const [orbitIndex, legacyNodeId] of legacyNodeIdsByOrbit) {
        const currentNodeId = currentNodeIdsByOrbit.get(orbitIndex);
        if (currentNodeId != null && currentNodeId !== legacyNodeId) {
          legacyClusterNodeMap.set(legacyNodeId, currentNodeId);
        }
      }
    }

    const ordered = [...indices.entries()].sort(([left], [right]) => left - right).map(([, node]) => node);
    for (let index = 1; index < ordered.length; index += 1) link(ordered[index - 1], ordered[index]);
    if (ordered.length > 1 && descriptor.config.size !== "Small") link(ordered[0], ordered[ordered.length - 1]);
    link(entrance, parent);

    if (skill?.mastery) {
      const mastery = baseNode(nodeBase + 12, "Nothingness", {
        name: "Nothingness",
        stats: [],
        mastery: true,
        spriteActive: skill.masterySpriteActive,
        spriteInactive: skill.masterySpriteInactive,
      });
      mastery.groupId = groupId;
      mastery.orbit = 0;
      mastery.orbitIndex = 0;
      mastery.x = group.x;
      mastery.y = group.y;
      addNode(mastery);
    }

    for (const node of indices.values()) {
      if (!node.jewelSocket) continue;
      const socketedItem = itemMap.get(Number(spec.sockets?.[node.id]));
      if (socketedItem) buildSubgraph(socketedItem, node, graphId);
    }
  };

  for (const parent of nodes) {
    if (parent.expansionJewel?.size !== 2) continue;
    const item = itemMap.get(Number(spec.sockets[parent.id]));
    if (item) buildSubgraph(item, parent);
  }

  return {
    tree: { ...overriddenTree, nodes, groups },
    mappedExtendedAllocations: [...mappedExtendedAllocations],
    ...(legacyClusterNodeMap ? { legacyClusterNodeMap } : {}),
  };
}

/**
 * Materializes an imported tree and promotes mapped `hashes_ex` allocations
 * into the spec itself. Keeping this conversion beside the graph algorithm
 * makes the UI, workspaces, and immediate Copy-PoB export use identical IDs.
 */
export function materializeImportedPassiveSpec(
  inputTree: PassiveTreeData,
  spec: ImportedPassiveSpec,
  items: readonly ImportedPobItem[] = [],
): MaterializedPassiveSpec {
  const materialized = materializeImportedPassiveTree(inputTree, spec, items);
  const legacyMap = materialized.legacyClusterNodeMap;
  const mapNodeId = (nodeId: number) => legacyMap?.get(nodeId) || nodeId;
  const converted = spec.clusterHashFormatVersion === 1 && inputTree.cluster && legacyMap
    ? {
        ...spec,
        clusterHashFormatVersion: 2,
        nodes: [...new Set(spec.nodes.map(mapNodeId))],
        sockets: Object.fromEntries(Object.entries(spec.sockets || {}).map(([nodeId, itemId]) => [mapNodeId(Number(nodeId)), itemId])),
        masteryEffects: Object.fromEntries(Object.entries(spec.masteryEffects).map(([nodeId, effectId]) => [mapNodeId(Number(nodeId)), effectId])),
        skillOverrides: Object.fromEntries(Object.entries(spec.skillOverrides || {}).map(([nodeId, override]) => [mapNodeId(Number(nodeId)), override])),
      }
    : spec;
  const mappedExtendedAllocations = materialized.mappedExtendedAllocations.map(mapNodeId);
  if (!mappedExtendedAllocations.length && converted === spec) return { ...materialized, spec };
  return {
    ...materialized,
    mappedExtendedAllocations,
    spec: {
      ...converted,
      nodes: [...new Set([...converted.nodes, ...mappedExtendedAllocations])],
    },
  };
}
