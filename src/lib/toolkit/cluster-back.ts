export interface ClusterBackVariant {
  baseTag: string;
  generationType: 1 | 2;
  groups: string[];
  weight: number;
  modId: string;
}

export interface ClusterBackNotable {
  name: string;
  icon?: string;
  sortOrder: number;
  tradeId: string;
  variants: ClusterBackVariant[];
  legacyOnly: boolean;
}

export interface ClusterBackBase {
  tag: string;
  name: string;
  enchant: string[];
  enchantTradeId: string;
}

export interface ClusterBackData {
  schema: 1;
  passiveCountTradeId: string;
  largeJewelIcon: string;
  bases: ClusterBackBase[];
  notables: ClusterBackNotable[];
}

export interface ClusterBackCandidate {
  notable: ClusterBackNotable;
  baseTags: string[];
}

export function isClusterBackData(value: unknown): value is ClusterBackData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ClusterBackData>;
  return candidate.schema === 1
    && typeof candidate.passiveCountTradeId === "string"
    && typeof candidate.largeJewelIcon === "string"
    && Array.isArray(candidate.bases)
    && candidate.bases.length === 17
    && candidate.bases.every((base) => Boolean(base?.tag && base?.name && base?.enchantTradeId) && Array.isArray(base.enchant))
    && Array.isArray(candidate.notables)
    && candidate.notables.length === 107
    && candidate.notables.every((notable) => Boolean(notable?.name && notable?.tradeId && notable?.icon)
      && Number.isFinite(notable.sortOrder)
      && Array.isArray(notable.variants));
}

function variantsFor(notable: ClusterBackNotable, baseTag: string) {
  return notable.variants.filter((variant) => variant.baseTag === baseTag && variant.weight > 0);
}

function groupsConflict(variants: ClusterBackVariant[]) {
  const seen = new Set<string>();
  for (const variant of variants) {
    for (const group of variant.groups) {
      if (seen.has(group)) return true;
      seen.add(group);
    }
  }
  return false;
}

function affixesFit(variants: ClusterBackVariant[]) {
  const prefixes = variants.filter((variant) => variant.generationType === 1).length;
  const suffixes = variants.filter((variant) => variant.generationType === 2).length;
  return prefixes <= 2 && suffixes <= 2;
}

function feasibleOnBase(notables: ClusterBackNotable[], baseTag: string) {
  const lists = notables.map((notable) => variantsFor(notable, baseTag));
  if (lists.some((list) => list.length === 0)) return false;
  const visit = (index: number, selected: ClusterBackVariant[]): boolean => {
    if (index === lists.length) return affixesFit(selected) && !groupsConflict(selected);
    return lists[index].some((variant) => visit(index + 1, [...selected, variant]));
  };
  return visit(0, []);
}

export function eligibleClusterBackNotables(
  data: ClusterBackData,
  firstName: string,
  secondName: string,
  requestedBaseTag = "",
): ClusterBackCandidate[] {
  const first = data.notables.find((notable) => notable.name === firstName);
  const second = data.notables.find((notable) => notable.name === secondName);
  if (!first || !second || first === second || first.legacyOnly || second.legacyOnly) return [];
  const minimum = Math.min(first.sortOrder, second.sortOrder);
  const maximum = Math.max(first.sortOrder, second.sortOrder);
  const bases = requestedBaseTag
    ? data.bases.filter((base) => base.tag === requestedBaseTag)
    : data.bases;
  return data.notables
    .filter((candidate) => candidate !== first
      && candidate !== second
      && !candidate.legacyOnly
      && candidate.sortOrder > minimum
      && candidate.sortOrder < maximum)
    .map((notable) => ({
      notable,
      baseTags: bases
        .filter((base) => feasibleOnBase([first, second, notable], base.tag))
        .map((base) => base.tag),
    }))
    .filter((candidate) => candidate.baseTags.length > 0);
}

export function buildClusterBackTradeQuery(
  data: ClusterBackData,
  firstName: string,
  secondName: string,
  candidates: ClusterBackCandidate[],
  baseTag = "",
) {
  const first = data.notables.find((notable) => notable.name === firstName);
  const second = data.notables.find((notable) => notable.name === secondName);
  if (!first || !second || !candidates.length) throw new Error("Choose two compatible front notables first.");
  const base = data.bases.find((entry) => entry.tag === baseTag);
  const candidateFilters = candidates
    .filter((candidate) => !baseTag || candidate.baseTags.includes(baseTag))
    .map((candidate) => ({ id: candidate.notable.tradeId, value: { min: 1 } }));
  if (!candidateFilters.length) throw new Error("No craftable back notable exists on this base.");
  return {
    query: {
      status: { option: "onlineleague" },
      type: "Large Cluster Jewel",
      stats: [
        {
          type: "and",
          filters: [
            { id: data.passiveCountTradeId, value: { min: 8, max: 8 } },
            { id: first.tradeId, value: { min: 1 } },
            { id: second.tradeId, value: { min: 1 } },
            ...(base ? [{ id: base.enchantTradeId, value: {} }] : []),
          ],
        },
        { type: "count", value: { min: 1 }, filters: candidateFilters },
      ],
    },
    sort: { price: "asc" },
  };
}

function normalizeCopiedLine(line: string) {
  return line.replace(/\s+\((?:enchant|implicit)\)\s*$/i, "").trim();
}

export interface CopiedClusterBackResult {
  valid: boolean;
  errors: string[];
  passiveCount: number | null;
  base: ClusterBackBase | null;
  notables: ClusterBackNotable[];
  back: ClusterBackNotable | null;
}

export function inspectCopiedClusterBack(data: ClusterBackData, text: string): CopiedClusterBackResult {
  const lines = text.replace(/\r/g, "").split("\n").map(normalizeCopiedLine);
  const errors: string[] = [];
  if (!lines.some((line) => /^Item Class: Jewels$/i.test(line))) errors.push("Copy a PoE 1 jewel.");
  // Magic jewels include their affix in the copied display-name line instead
  // of emitting a second bare base-type line.
  if (!lines.some((line) => /(?:^|\s)Large Cluster Jewel(?:\s|$)/i.test(line))) errors.push("Only Large Cluster Jewels are supported.");
  const passiveCount = Number(lines.find((line) => /^Adds \d+ Passive Skills$/i.test(line))?.match(/\d+/)?.[0]);
  if (!Number.isFinite(passiveCount)) errors.push("Passive count is missing.");
  else if (passiveCount !== 8) errors.push("Cluster Back geometry requires exactly 8 passive skills.");
  const notableNames = lines
    .map((line) => /^1 Added Passive Skill is (.+)$/i.exec(line)?.[1]?.trim())
    .filter((name): name is string => Boolean(name));
  const notables = notableNames
    .map((name) => data.notables.find((notable) => notable.name === name))
    .filter((notable): notable is ClusterBackNotable => Boolean(notable));
  if (notableNames.length !== 3) errors.push("The jewel must have exactly three notable modifiers.");
  else if (notables.length !== 3) errors.push("One or more notables are not in the current PoB data.");
  const base = data.bases.find((candidate) => candidate.enchant.every((line) => lines.includes(line))) || null;
  if (!base) errors.push("The large-cluster base enchant could not be identified.");
  const ordered = [...notables].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    valid: errors.length === 0,
    errors,
    passiveCount: Number.isFinite(passiveCount) ? passiveCount : null,
    base,
    notables: ordered,
    back: ordered.length === 3 ? ordered[1] : null,
  };
}
