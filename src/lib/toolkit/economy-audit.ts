import type { EconomyRow } from "../../types";
import type { ItemFilterBlock, ItemFilterDocument } from "./item-filter";

export interface FilterEconomyEntry {
  key: string;
  name: string;
  baseType: string;
  icon?: string;
  chaosValue: number;
  divineValue: number;
  listingCount: number | null;
  sourceBlockId: string | null;
  sourceTier: string | null;
  visibility: ItemFilterBlock["visibility"] | null;
  ambiguityCount: number;
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

function explicitBaseTypes(block: ItemFilterBlock) {
  return block.statements
    .filter(
      (statement) =>
        statement.key === "BaseType" &&
        (statement.operator === "" || statement.operator === "=" || statement.operator === "=="),
    )
    .flatMap((statement) => statement.values);
}

export function findExplicitBaseTypeBlock(
  document: ItemFilterDocument,
  candidates: string[],
) {
  const names = new Set(candidates.filter(Boolean).map(normalized));
  const matches = document.blocks.filter((block) =>
    explicitBaseTypes(block).some((baseType) => names.has(normalized(baseType))),
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Join live poe.ninja rows to explicit BaseType filter tiers. Variants are kept
 * separate because link count, gem state, or unique variant can carry a real
 * price difference even when their filter BaseType is shared.
 */
export function auditFilterEconomy(
  document: ItemFilterDocument | null,
  rows: EconomyRow[],
): FilterEconomyEntry[] {
  return rows
    .filter((row) => Number.isFinite(row.chaosValue) && row.chaosValue > 0)
    .map((row) => {
      const baseType = row.baseType || row.name;
      const candidates = new Set([baseType, row.name].filter(Boolean).map(normalized));
      const matchingBlocks = document?.blocks.filter((block) =>
        explicitBaseTypes(block).some((candidate) => candidates.has(normalized(candidate))),
      ) || [];
      const block = matchingBlocks.length === 1 ? matchingBlocks[0] : null;
      return {
        key: row.key,
        name: row.name,
        baseType,
        icon: row.icon,
        chaosValue: row.chaosValue,
        divineValue: Number.isFinite(row.divineValue) ? row.divineValue : 0,
        listingCount: row.listingCount != null && Number.isFinite(row.listingCount) ? row.listingCount : null,
        sourceBlockId: block?.id || null,
        sourceTier: block?.tier || null,
        visibility: block?.visibility || null,
        ambiguityCount: matchingBlocks.length > 1 ? matchingBlocks.length : 0,
      };
    })
    .sort((left, right) => right.chaosValue - left.chaosValue);
}

export function filterAuditEntries(
  entries: FilterEconomyEntry[],
  options: {
    query?: string;
    tier?: string;
    minimumChaos?: number | null;
    maximumChaos?: number | null;
    onlyMisplaced?: boolean;
    targetTier?: string;
  },
) {
  const query = normalized(options.query || "");
  return entries.filter((entry) => {
    if (query && !normalized(`${entry.name} ${entry.baseType}`).includes(query)) return false;
    if (options.tier && options.tier !== "all" && entry.sourceTier !== options.tier) return false;
    if (options.minimumChaos != null && entry.chaosValue < options.minimumChaos) return false;
    if (options.maximumChaos != null && entry.chaosValue > options.maximumChaos) return false;
    if (options.onlyMisplaced && options.targetTier && entry.sourceTier === options.targetTier) return false;
    return true;
  });
}

export function calculateDustValue(
  baseDust: number,
  options: { itemLevel: number; quality: number; influences?: number },
) {
  if (!Number.isFinite(baseDust) || baseDust <= 0 || !Number.isFinite(options.itemLevel) || options.itemLevel < 1) {
    return 0;
  }
  const itemLevel = Math.min(84, Math.max(65, Math.floor(options.itemLevel)));
  const quality = Number.isFinite(options.quality) ? Math.max(0, options.quality) : 0;
  const influences = Number.isFinite(options.influences) ? Math.max(0, options.influences || 0) : 0;
  const bonus = quality * 2 + influences * 50;
  return Math.round(baseDust * 125 * (20 - (84 - itemLevel)) * ((bonus + 100) / 100));
}

export function divinationAreaExpectedValue(
  cards: Array<{ chaosValue: number; stackSize: number; weight: number; excluded?: boolean }>,
) {
  const usable = cards.filter(
    (card) => !card.excluded &&
      Number.isFinite(card.weight) && card.weight > 0 &&
      Number.isFinite(card.stackSize) && card.stackSize > 0 &&
      Number.isFinite(card.chaosValue) && card.chaosValue >= 0,
  );
  const totalWeight = usable.reduce((sum, card) => sum + card.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return { perDrop: 0, totalWeight: 0 };
  const perDrop = usable.reduce(
    (sum, card) => sum + (card.weight / totalWeight) * (card.chaosValue / card.stackSize),
    0,
  );
  return {
    perDrop: Number.isFinite(perDrop) ? perDrop : 0,
    totalWeight,
  };
}
