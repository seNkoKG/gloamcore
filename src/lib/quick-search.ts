import type { QuickSearchRow } from "../types";
import {
  isMarketSnapshotActionable,
  MAX_ACTIONABLE_MARKET_AGE_MS,
} from "./market-freshness";

export interface QuickSearchIndexGroup {
  rows: QuickSearchRow[];
  fetchedAt: number;
  stale: boolean;
}

export function isQuickSearchIndexGroupActionable(
  group: Pick<QuickSearchIndexGroup, "fetchedAt" | "stale"> | null | undefined,
  now = Date.now(),
) {
  return Boolean(
    group &&
      group.stale === false &&
      isMarketSnapshotActionable(group, now),
  );
}

export function currentQuickSearchIndexRows(
  index: Map<string, QuickSearchIndexGroup>,
  now = Date.now(),
) {
  const rows: QuickSearchRow[] = [];
  for (const [key, group] of index) {
    if (!isQuickSearchIndexGroupActionable(group, now)) {
      index.delete(key);
      continue;
    }
    rows.push(...group.rows);
  }
  return rows;
}

export function nextQuickSearchIndexExpiryAt(
  index: ReadonlyMap<string, QuickSearchIndexGroup>,
) {
  let next = Number.POSITIVE_INFINITY;
  for (const group of index.values()) {
    if (group.stale) continue;
    next = Math.min(next, group.fetchedAt + MAX_ACTIONABLE_MARKET_AGE_MS);
  }
  return Number.isFinite(next) ? next : undefined;
}

function searchableText(row: QuickSearchRow) {
  return [
    row.name,
    row.variant,
    row.baseType,
    row.categoryLabel,
    row.league,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function rowScore(row: QuickSearchRow, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    const liquidity = row.volume ?? row.listingCount ?? 0;
    return Math.log10(liquidity + 1) - Number(row.lowConfidence) * 3;
  }

  const terms = normalized.split(/\s+/).filter(Boolean);
  const haystack = searchableText(row);
  if (!terms.every((term) => haystack.includes(term))) return -Infinity;

  const name = row.name.toLocaleLowerCase();
  const variant = row.variant?.toLocaleLowerCase() || "";
  let score = 0;
  if (name === normalized) score += 500;
  if (name.startsWith(normalized)) score += 260;
  if (name.includes(normalized)) score += 140;
  if (variant.startsWith(normalized)) score += 90;
  if (row.categoryLabel.toLocaleLowerCase().includes(normalized)) score += 35;
  for (const term of terms) {
    if (name.startsWith(term)) score += 55;
    if (name.split(/\s+/).some((word) => word.startsWith(term))) score += 30;
  }
  score += Math.min(24, Math.log10((row.volume ?? row.listingCount ?? 0) + 1) * 4);
  if (row.lowConfidence) score -= 18;
  return score;
}

export function quickRowIdentity(row: QuickSearchRow) {
  return `${row.league}:${row.categoryId}:${row.source}:${row.key}`;
}

export function dedupeQuickRows(rows: QuickSearchRow[]) {
  const unique = new Map<string, QuickSearchRow>();
  for (const row of rows) unique.set(quickRowIdentity(row), row);
  return [...unique.values()];
}

export function rankQuickRows(
  rows: QuickSearchRow[],
  query: string,
  limit = 60,
) {
  return rows
    .map((row) => ({ row, score: rowScore(row, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.row.chaosValue - a.row.chaosValue ||
        a.row.name.localeCompare(b.row.name),
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.row);
}
