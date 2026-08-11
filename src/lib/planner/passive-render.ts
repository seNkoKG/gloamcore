import type { PassiveTreeData, PassiveTreeNodeData } from "../../types";

export interface PassiveTreeConnection {
  from: PassiveTreeNodeData;
  to: PassiveTreeNodeData;
}

export interface PassiveTreeCircle {
  x: number;
  y: number;
  radius: number;
}

/** Keeps PoB's authored mastery row order; integer object keys cannot preserve it. */
export function orderedMasteryEffects(node: PassiveTreeNodeData) {
  const effects = node.masteryEffects || {};
  const seen = new Set<number>();
  return [...(node.masteryEffectOrder || []), ...Object.keys(effects).map(Number)].flatMap((id) => {
    const effect = effects[id];
    if (!effect || seen.has(id)) return [];
    seen.add(id);
    return [{ id, effect }];
  });
}

export function visiblePassiveNodes(
  tree: PassiveTreeData,
  _ascendancyName = "",
  _secondaryAscendancyName = "",
) {
  // PoB keeps every current ascendancy/bloodline visible for inspection and
  // fades the unselected groups in the view. The raw current tree still ships
  // the three retired Wildwood choices, which PoB removes during tree load.
  const retiredWildwood = new Set(["Warden", "Warlock", "Primalist"]);
  return tree.nodes.filter((node) => !(node.bloodline && node.ascendancyName && retiredWildwood.has(node.ascendancyName)));
}

/**
 * PoB keeps more logical links than it draws. PassiveTree.lua builds a visual
 * connector only from `out` when neither endpoint is a class start or mastery
 * and both belong to the same ascendancy (including `null` for the base tree).
 * Hidden start/Path-of-X links remain available to pathing via passiveAdjacency.
 */
export function passiveTreeConnections(nodes: readonly PassiveTreeNodeData[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const result: PassiveTreeConnection[] = [];
  for (const node of nodes) {
    for (const targetId of node.out) {
      const target = nodeMap.get(targetId);
      if (!target || target.id === node.id) continue;
      if (node.classStartIds.length || target.classStartIds.length) continue;
      if (node.mastery || target.mastery) continue;
      if (node.ascendancyName !== target.ascendancyName) continue;
      const key = node.id < target.id ? `${node.id}:${target.id}` : `${target.id}:${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ from: node, to: target });
    }
  }
  return result;
}

/** Matches PoB's default zoom level (1.2^3) and tree-size definition. */
export function defaultPassiveTreeViewport(tree: PassiveTreeData, width: number, height: number) {
  const fallbackSize = Math.min(
    tree.bounds.maxX - tree.bounds.minX,
    tree.bounds.maxY - tree.bounds.minY,
  ) * 1.1;
  const size = Math.max(1, Number(tree.size) || fallbackSize);
  return {
    scale: (Math.min(width, height) / size) * (1.2 ** 3),
    x: width / 2,
    y: height / 2,
  };
}

export function passiveTreeViewportWithCircles(
  tree: PassiveTreeData,
  width: number,
  height: number,
  circles: readonly PassiveTreeCircle[],
  padding = 10,
) {
  const base = defaultPassiveTreeViewport(tree, width, height);
  if (!circles.length || width <= 0 || height <= 0) return base;
  const safePadding = Math.min(Math.max(0, padding), width / 3, height / 3);
  let minX = -width / 2 / base.scale;
  let maxX = width / 2 / base.scale;
  let minY = -height / 2 / base.scale;
  let maxY = height / 2 / base.scale;
  for (const circle of circles) {
    const radius = Math.max(0, circle.radius);
    minX = Math.min(minX, circle.x - radius);
    maxX = Math.max(maxX, circle.x + radius);
    minY = Math.min(minY, circle.y - radius);
    maxY = Math.max(maxY, circle.y + radius);
  }
  const scale = Math.min(
    (width - safePadding * 2) / (maxX - minX),
    (height - safePadding * 2) / (maxY - minY),
  );
  return {
    scale,
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
  };
}

export function resizedPassiveTreeViewport(
  viewport: { x: number; y: number; scale: number },
  previous: { width: number; height: number },
  next: { width: number; height: number },
) {
  if (viewport.scale <= 0 || previous.width <= 0 || previous.height <= 0 || next.width <= 0 || next.height <= 0) {
    return viewport;
  }
  return {
    ...viewport,
    x: viewport.x + (next.width - previous.width) / 2,
    y: viewport.y + (next.height - previous.height) / 2,
  };
}
