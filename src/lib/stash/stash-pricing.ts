import type { EconomyRow } from "../../types";
import { STASH_FAMILY_CATEGORIES, UNIQUE_FAMILIES } from "./stash-classify";
import type { StashFamily } from "./stash-types";

export interface StashPricingOverview {
  categoryId: string;
  rows: EconomyRow[];
  fetchedAt: number;
  stale: boolean;
}

export interface StashPriceIndex {
  rowsByCategory: ReadonlyMap<string, EconomyRow[]>;
  byName: ReadonlyMap<string, { row: EconomyRow; categoryId: string }>;
  availableCategories: ReadonlySet<string>;
  /** Chaos value of one Divine Orb from the currency rows, when known. */
  divineChaos: number | null;
  pricesAt: number;
  pricesStale: boolean;
}

/** Normalized name key shared by stash items and poe.ninja rows. */
export function normalizePriceName(value: string | null | undefined) {
  return String(value || "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function inferDivineChaos(rows: EconomyRow[]) {
  const ratios = rows
    .map((row) =>
      row.divineValue > 0 && row.chaosValue > 0 ? row.chaosValue / row.divineValue : null,
    )
    .filter((ratio): ratio is number => ratio != null && ratio >= 20 && ratio <= 1_000);
  return median(ratios) || null;
}

export function buildStashPriceIndex(overviews: StashPricingOverview[]): StashPriceIndex {
  const rowsByCategory = new Map<string, EconomyRow[]>();
  const byName = new Map<string, { row: EconomyRow; categoryId: string }>();
  let pricesAt = 0;
  let pricesStale = false;
  for (const overview of overviews) {
    if (!overview || !Array.isArray(overview.rows) || overview.rows.length === 0) continue;
    rowsByCategory.set(overview.categoryId, overview.rows);
    if (Number.isFinite(overview.fetchedAt) && overview.fetchedAt > pricesAt) {
      pricesAt = overview.fetchedAt;
    }
    if (overview.stale) pricesStale = true;
    for (const row of overview.rows) {
      const key = normalizePriceName(row.name);
      if (!key || byName.has(key)) continue;
      byName.set(key, { row, categoryId: overview.categoryId });
    }
  }
  const currencyRows = rowsByCategory.get("currency") || [];
  const divineChaos =
    currencyRows.find((row) => normalizePriceName(row.name) === "divine orb")?.chaosValue ??
    inferDivineChaos(currencyRows) ??
    null;
  return {
    rowsByCategory,
    byName,
    availableCategories: new Set(rowsByCategory.keys()),
    divineChaos,
    pricesAt,
    pricesStale,
  };
}

export function normalizeIdentity(item: {
  name?: string;
  typeLine?: string;
  baseType?: string;
  frameType?: number;
}) {
  const isUnique = Number(item?.frameType) === 3;
  const primary = isUnique ? item?.name : item?.typeLine;
  return normalizePriceName(primary || item?.typeLine || item?.baseType || item?.name);
}

/**
 * Finds a priced row for an item: its own family categories first, then any
 * unique family as a fallback for frameType 3 items, then the currency
 * overview as a broad fallback for stackable trade goods.
 */
export function findPricedRow(
  index: StashPriceIndex,
  family: StashFamily,
  item: { name?: string; typeLine?: string; baseType?: string; frameType?: number },
  stackable: boolean,
): EconomyRow | null {
  const identity = normalizeIdentity(item);
  if (!identity) return null;
  const isUnique = Number(item?.frameType) === 3;
  const familyCategoryIds = STASH_FAMILY_CATEGORIES[family] || [];
  if (!isUnique || family === "unique-map") {
    for (const categoryId of familyCategoryIds) {
      const hit = index.byName.get(identity);
      if (hit && hit.categoryId === categoryId) return hit.row;
    }
  }
  if (isUnique) {
    for (const uniqueFamily of UNIQUE_FAMILIES) {
      for (const categoryId of STASH_FAMILY_CATEGORIES[uniqueFamily]) {
        const hit = index.byName.get(identity);
        if (hit && hit.categoryId === categoryId) return hit.row;
      }
    }
  }
  if (stackable && family !== "currency") {
    const hit = index.byName.get(identity);
    if (hit && hit.categoryId === "currency") return hit.row;
  }
  return null;
}