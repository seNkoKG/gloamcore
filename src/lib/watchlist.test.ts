import { describe, expect, it } from "vitest";
import {
  actionableWatchesForLeague,
  isWatchTargetHit,
  mergeWatchlistMarketRefresh,
  normalizeTargetPrice,
  pruneAnnouncedWatchIdentities,
  watchAlertDecision,
  watchEntryIdentity,
  watchIdentity,
  watchMarketGroupIdentity,
  watchMarketGroupScheduleKey,
  watchMarketSelection,
} from "./watchlist";
import type { WatchEntry } from "../types";

describe("watchlist identity", () => {
  it("keeps identical market rows independent across leagues", () => {
    expect(watchIdentity("Allflame", "currency:exchange:divine")).not.toBe(
      watchIdentity("Standard", "currency:exchange:divine"),
    );
  });

  it("only accepts positive finite alert targets", () => {
    expect(normalizeTargetPrice("12.5")).toBe(12.5);
    expect(normalizeTargetPrice("  ")).toBeUndefined();
    expect(normalizeTargetPrice("not a price")).toBeUndefined();
    expect(normalizeTargetPrice(0)).toBeUndefined();
    expect(normalizeTargetPrice(-1)).toBeUndefined();
  });

  it("never fires targets from stale or low-confidence prices", () => {
    const now = Date.parse("2026-08-01T07:00:00Z");
    const entry = {
      key: "test",
      league: "Allflame",
      addedAt: now,
      marketFetchedAt: now - 1_000,
      marketStale: false,
      targetPrice: 20,
      targetUnit: "chaos",
      row: {
        key: "test",
        id: "test",
        name: "Test",
        categoryId: "currency",
        categoryLabel: "Currency",
        source: "exchange",
        chaosValue: 10,
        divineValue: 0.05,
        change: null,
        sparkline: [],
        volume: 100,
        listingCount: null,
        observationCount: null,
        implicitModifiers: [],
        explicitModifiers: [],
        mutatedModifiers: [],
        lowConfidence: false,
      },
    } satisfies WatchEntry;

    expect(isWatchTargetHit(entry, now)).toBe(true);
    expect(isWatchTargetHit({ ...entry, marketStale: true }, now)).toBe(false);
    expect(
      isWatchTargetHit({ ...entry, row: { ...entry.row, lowConfidence: true } }, now),
    ).toBe(false);
    expect(
      isWatchTargetHit({ ...entry, marketFetchedAt: now - 3 * 60 * 60 * 1000 }, now),
    ).toBe(false);
    expect(
      isWatchTargetHit({ ...entry, marketFetchedAt: now + 1 }, now),
    ).toBe(false);
    expect(
      isWatchTargetHit({
        ...entry,
        targetUnit: "divine",
        row: { ...entry.row, divineValue: null },
      }, now),
    ).toBe(false);
  });
});

describe("watchlist market refresh merging", () => {
  it("updates only market data on the latest entry and preserves user edits", () => {
    const current = {
      key: "test",
      league: "Allflame",
      addedAt: 100,
      marketFetchedAt: 200,
      marketStale: true,
      targetPrice: 25,
      targetUnit: "chaos",
      note: "keep this note",
      lastAlertState: "above",
      row: {
        key: "test",
        id: "test",
        name: "Test",
        categoryId: "currency",
        categoryLabel: "Currency",
        source: "exchange",
        chaosValue: 30,
        divineValue: 0.15,
        change: null,
        sparkline: [],
        volume: 100,
        listingCount: null,
        observationCount: null,
        implicitModifiers: [],
        explicitModifiers: [],
        mutatedModifiers: [],
        lowConfidence: false,
      },
    } satisfies WatchEntry;
    const freshRow = { ...current.row, chaosValue: 20 };
    const refreshed = new Map([
      [
        watchEntryIdentity(current),
        { row: freshRow, fetchedAt: 300, stale: false },
      ],
    ]);

    const result = mergeWatchlistMarketRefresh([current], refreshed);

    expect(result[0]).toMatchObject({
      targetPrice: 25,
      targetUnit: "chaos",
      note: "keep this note",
      lastAlertState: "above",
      marketFetchedAt: 300,
      marketStale: false,
    });
    expect(result[0]?.row).toBe(freshRow);
  });

  it("cannot resurrect a watch removed while a refresh was in flight", () => {
    const removed: WatchEntry[] = [];
    const refreshed = new Map([
      [
        watchIdentity("Allflame", "removed"),
        {
          row: {
            key: "removed",
          } as WatchEntry["row"],
          fetchedAt: 300,
          stale: false,
        },
      ],
    ]);

    expect(mergeWatchlistMarketRefresh(removed, refreshed)).toBe(removed);
  });

  it("marks watches stale when missing from success or their group hard-fails", () => {
    const missingFromSuccess = {
      key: "missing-success",
      league: "Allflame",
      addedAt: 1,
      marketFetchedAt: 2,
      marketStale: false,
      row: {
        key: "missing-success",
        categoryId: "currency",
        source: "exchange",
      } as WatchEntry["row"],
    } satisfies WatchEntry;
    const missingFromFailure = {
      key: "missing-failure",
      league: "Allflame",
      addedAt: 1,
      marketFetchedAt: 2,
      marketStale: false,
      row: {
        key: "missing-failure",
        categoryId: "unique-accessories",
        source: "stash-item",
      } as WatchEntry["row"],
    } satisfies WatchEntry;
    const successfulGroups = new Set([
      watchMarketGroupIdentity("Allflame", "currency", "exchange"),
    ]);
    const failedGroups = new Set([
      watchMarketGroupIdentity(
        "Allflame",
        "unique-accessories",
        "stash-item",
      ),
    ]);

    const result = mergeWatchlistMarketRefresh(
      [missingFromSuccess, missingFromFailure],
      new Map(),
      successfulGroups,
      failedGroups,
    );

    expect(result[0]?.marketStale).toBe(true);
    expect(result[1]?.marketStale).toBe(true);
  });

  it("preserves watch entries when refreshed market rows are semantically equal", () => {
    const current = {
      key: "same",
      league: "Allflame",
      addedAt: 1,
      marketFetchedAt: 200,
      marketStale: false,
      row: {
        key: "same",
        categoryId: "currency",
        source: "exchange",
        chaosValue: 10,
        sparkline: [9, 10],
      } as WatchEntry["row"],
    } satisfies WatchEntry;
    const refreshed = new Map([
      [
        watchEntryIdentity(current),
        {
          row: { ...current.row, sparkline: [...current.row.sparkline] },
          fetchedAt: 200,
          stale: false,
        },
      ],
    ]);

    expect(mergeWatchlistMarketRefresh([current], refreshed)[0]).toBe(current);
  });
});

describe("watchlist refresh scheduling and navigation", () => {
  it("keeps the schedule stable when only refreshed row objects change", () => {
    const entry = {
      key: "divine",
      league: "Allflame",
      addedAt: 1,
      row: {
        key: "divine",
        categoryId: "currency",
        source: "exchange",
        chaosValue: 180,
      } as WatchEntry["row"],
    } satisfies WatchEntry;
    const refreshed = {
      ...entry,
      marketFetchedAt: 300,
      row: { ...entry.row, chaosValue: 181 },
    } satisfies WatchEntry;

    expect(watchMarketGroupScheduleKey([refreshed])).toBe(
      watchMarketGroupScheduleKey([entry]),
    );
  });

  it("builds a complete pending selection for cross-league watch navigation", () => {
    const entry = {
      key: "unique-belt:mageblood",
      league: "Standard",
      addedAt: 1,
      row: {
        key: "unique-belt:mageblood",
        categoryId: "unique-accessories",
        source: "stash-item",
      } as WatchEntry["row"],
    } satisfies WatchEntry;

    expect(watchMarketSelection(entry)).toEqual({
      league: "Standard",
      categoryId: "unique-accessories",
      source: "stash-item",
      rowKey: "unique-belt:mageblood",
    });
  });

  it("forgets removed announced identities so a re-added watch can alert", () => {
    const active = {
      key: "active",
      league: "Allflame",
      addedAt: 1,
      row: { key: "active" } as WatchEntry["row"],
    } satisfies WatchEntry;
    const activeIdentity = watchEntryIdentity(active);
    const removedIdentity = watchIdentity("Allflame", "removed");
    const announced = new Set([activeIdentity, removedIdentity]);

    pruneAnnouncedWatchIdentities(announced, [active]);

    expect([...announced]).toEqual([activeIdentity]);
    expect(announced.has(removedIdentity)).toBe(false);
  });
});

describe("watchlist quick-search publication", () => {
  it("publishes only fresh actionable watches from the active league", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    const base = {
      key: "fresh",
      league: "Allflame",
      addedAt: 1,
      marketFetchedAt: now - 1_000,
      marketStale: false,
      row: {
        key: "fresh",
        lowConfidence: false,
      } as WatchEntry["row"],
    } satisfies WatchEntry;

    expect(
      actionableWatchesForLeague(
        [
          base,
          { ...base, key: "stale", marketStale: true },
          {
            ...base,
            key: "expired",
            marketFetchedAt: now - 3 * 60 * 60 * 1000,
          },
          { ...base, key: "other", league: "Standard" },
        ],
        "Allflame",
        now,
      ),
    ).toEqual([base]);
  });

  it("waits for the initial refresh and honors persisted alert state", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    const entry = {
      key: "divine",
      league: "Allflame",
      addedAt: 1,
      marketFetchedAt: now - 1_000,
      marketStale: false,
      targetPrice: 200,
      targetUnit: "chaos",
      row: {
        key: "divine",
        lowConfidence: false,
        chaosValue: 180,
        divineValue: 1,
      } as WatchEntry["row"],
    } satisfies WatchEntry;

    expect(watchAlertDecision(entry, false, now)).toEqual({ notify: false });
    expect(watchAlertDecision(entry, true, now)).toEqual({
      state: "below",
      notify: true,
    });
    expect(
      watchAlertDecision({ ...entry, lastAlertState: "below" }, true, now),
    ).toEqual({ state: "below", notify: false });
    expect(
      watchAlertDecision(
        { ...entry, row: { ...entry.row, chaosValue: 201 } },
        true,
        now,
      ),
    ).toEqual({ state: "above", notify: false });
  });
});
