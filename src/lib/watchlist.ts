import type { DataSource, EconomyRow, WatchEntry } from "../types";

export const MAX_ACTIONABLE_PRICE_AGE_MS = 2 * 60 * 60 * 1000;

export function watchIdentity(league: string, rowKey: string) {
  return `${league}\u0000${rowKey}`;
}

export function watchEntryIdentity(entry: WatchEntry) {
  return watchIdentity(entry.league, entry.key);
}

export function watchMarketGroupIdentity(
  league: string,
  categoryId: string,
  source: DataSource,
) {
  return `${league}\u0000${categoryId}\u0000${source}`;
}

export function watchMarketGroupScheduleKey(entries: readonly WatchEntry[]) {
  return [
    ...new Set(
      entries.map((entry) =>
        watchMarketGroupIdentity(
          entry.league,
          entry.row.categoryId,
          entry.row.source,
        ),
      ),
    ),
  ]
    .sort()
    .join("\u0001");
}

export function watchMarketSelection(entry: WatchEntry) {
  return {
    league: entry.league,
    categoryId: entry.row.categoryId,
    source: entry.row.source,
    rowKey: entry.key,
  };
}

export function pruneAnnouncedWatchIdentities(
  announced: Set<string>,
  entries: readonly WatchEntry[],
) {
  const active = new Set(entries.map(watchEntryIdentity));
  for (const identity of announced) {
    if (!active.has(identity)) announced.delete(identity);
  }
}

export function isSameWatch(
  entry: WatchEntry,
  league: string,
  row: Pick<EconomyRow, "key">,
) {
  return entry.league === league && entry.key === row.key;
}

export function normalizeTargetPrice(value: string | number | undefined) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isWatchPriceActionable(entry: WatchEntry, now = Date.now()) {
  const age = entry.marketFetchedAt == null
    ? Number.NaN
    : now - entry.marketFetchedAt;
  return (
    !entry.row.lowConfidence &&
    entry.marketStale === false &&
    entry.marketFetchedAt != null &&
    Number.isFinite(entry.marketFetchedAt) &&
    Number.isFinite(now) &&
    age >= 0 &&
    age <= MAX_ACTIONABLE_PRICE_AGE_MS &&
    (entry.targetPrice == null ||
      !entry.targetUnit ||
      watchTargetMarketValue(entry) != null)
  );
}

function watchTargetMarketValue(entry: WatchEntry) {
  if (!entry.targetUnit) return null;
  const value =
    entry.targetUnit === "chaos" ? entry.row.chaosValue : entry.row.divineValue;
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export function isWatchTargetHit(entry: WatchEntry, now = Date.now()) {
  if (
    !isWatchPriceActionable(entry, now) ||
    entry.targetPrice == null ||
    !entry.targetUnit
  ) {
    return false;
  }
  const current = watchTargetMarketValue(entry);
  return current != null && current <= entry.targetPrice;
}

export function watchAlertDecision(
  entry: WatchEntry,
  initialRefreshComplete: boolean,
  now = Date.now(),
): {
  state?: NonNullable<WatchEntry["lastAlertState"]>;
  notify: boolean;
} {
  if (
    !initialRefreshComplete ||
    !isWatchPriceActionable(entry, now) ||
    entry.targetPrice == null ||
    !entry.targetUnit ||
    watchTargetMarketValue(entry) == null
  ) {
    return { notify: false };
  }
  const state = isWatchTargetHit(entry, now) ? "below" : "above";
  return {
    state,
    notify: state === "below" && entry.lastAlertState !== "below",
  };
}

export function actionableWatchesForLeague(
  entries: WatchEntry[],
  league: string,
  now = Date.now(),
) {
  return entries.filter(
    (entry) =>
      entry.league === league && isWatchPriceActionable(entry, now),
  );
}

export interface RefreshedWatchMarket {
  row: EconomyRow;
  fetchedAt: number;
  stale: boolean;
}

function marketRowsSemanticallyEqual(left: EconomyRow, right: EconomyRow) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function mergeWatchlistMarketRefresh(
  current: WatchEntry[],
  refreshed: ReadonlyMap<string, RefreshedWatchMarket>,
  successfulGroups: ReadonlySet<string> = new Set(),
  failedGroups: ReadonlySet<string> = new Set(),
) {
  let changed = false;
  const next = current.map((entry) => {
    const group = watchMarketGroupIdentity(
      entry.league,
      entry.row.categoryId,
      entry.row.source,
    );
    if (failedGroups.has(group)) {
      if (entry.marketStale === true) return entry;
      changed = true;
      return { ...entry, marketStale: true };
    }
    const fresh = refreshed.get(watchEntryIdentity(entry));
    if (!fresh) {
      if (!successfulGroups.has(group) || entry.marketStale === true) return entry;
      changed = true;
      return { ...entry, marketStale: true };
    }
    const sameRow = marketRowsSemanticallyEqual(entry.row, fresh.row);
    if (
      sameRow &&
      entry.marketFetchedAt === fresh.fetchedAt &&
      entry.marketStale === fresh.stale
    ) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      row: sameRow ? entry.row : fresh.row,
      marketFetchedAt: fresh.fetchedAt,
      marketStale: fresh.stale,
    };
  });
  return changed ? next : current;
}
