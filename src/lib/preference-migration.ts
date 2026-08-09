import { categoryById, defaultSource } from "../config/categories";
import type { AppPreferences, DataSource, WatchEntry } from "../types";

export function migrateStoredPreferences(value: unknown): {
  stored: Partial<AppPreferences> & {
    sourceByCategory: Record<string, DataSource>;
    watchlist: WatchEntry[];
  };
  migrated: boolean;
} {
  const saved =
    value && typeof value === "object"
      ? (value as Partial<AppPreferences>)
      : {};
  const rawSources =
    saved.sourceByCategory && typeof saved.sourceByCategory === "object"
      ? saved.sourceByCategory
      : {};
  const sourceByCategory: Record<string, DataSource> = {};
  let migrated = false;

  for (const [categoryId, source] of Object.entries(rawSources)) {
    if (source === "faustus") {
      const category = categoryById[categoryId];
      if (category) sourceByCategory[categoryId] = defaultSource(category);
      migrated = true;
      continue;
    }
    sourceByCategory[categoryId] = source;
  }

  const rawWatchlist = Array.isArray(saved.watchlist) ? saved.watchlist : [];
  const migratedWatchlist = rawWatchlist.flatMap((entry): WatchEntry[] => {
    if (entry?.row?.source !== "faustus") return [entry];
    const category = categoryById[entry.row.categoryId];
    migrated = true;
    if (!category || !entry.row.id) return [];
    const source = defaultSource(category);
    const key = `${category.id}:${source}:${entry.row.id}`;
    return [{
      ...entry,
      key,
      marketFetchedAt: undefined,
      marketStale: true,
      row: {
        ...entry.row,
        key,
        source,
        faustus: undefined,
      },
    }];
  });
  const watchByIdentity = new Map<string, WatchEntry>();
  for (const entry of migratedWatchlist) {
    const identity = `${entry.league}\u0000${entry.key}`;
    const existing = watchByIdentity.get(identity);
    if (!existing) {
      watchByIdentity.set(identity, entry);
      continue;
    }
    migrated = true;
    const freshness = (candidate: WatchEntry) =>
      (candidate.marketStale === true ? -1 : 0) +
      (candidate.marketFetchedAt != null ? 2 : 0);
    const preferred = freshness(entry) > freshness(existing) ? entry : existing;
    const fallback = preferred === entry ? existing : entry;
    watchByIdentity.set(identity, {
      ...preferred,
      addedAt: Math.min(preferred.addedAt, fallback.addedAt),
      targetPrice: preferred.targetPrice ?? fallback.targetPrice,
      targetUnit: preferred.targetUnit ?? fallback.targetUnit,
      note: preferred.note ?? fallback.note,
    });
  }
  const watchlist = [...watchByIdentity.values()];

  return {
    stored: {
      ...saved,
      sourceByCategory,
      watchlist,
    },
    migrated,
  };
}
