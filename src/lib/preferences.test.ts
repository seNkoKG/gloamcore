import { describe, expect, it } from "vitest";
import type { AppPreferences, WatchEntry } from "../types";
import { migrateStoredPreferences } from "./preference-migration";
import {
  decodePreferencesRecord,
  selectNewestPreferencesRecord,
} from "./preferences";

function storedWatch(source: WatchEntry["row"]["source"]): WatchEntry {
  return {
    key: `currency:${source}:divine`,
    league: "Allflame",
    addedAt: 1,
    marketFetchedAt: 2,
    marketStale: false,
    targetPrice: 200,
    targetUnit: "chaos",
    row: {
      key: `currency:${source}:divine`,
      id: "divine",
      name: "Divine Orb",
      categoryId: "currency",
      categoryLabel: "Currency",
      source,
      chaosValue: 180,
      divineValue: 1,
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
  };
}

describe("stored preference migrations", () => {
  it("remaps disabled Faustus sources and preserves recoverable watches as stale", () => {
    const exchangeWatch = storedWatch("exchange");
    const faustusWatch = storedWatch("faustus");
    const result = migrateStoredPreferences({
      categoryId: "currency",
      sourceByCategory: {
        currency: "faustus",
        incubators: "faustus",
        fossils: "exchange",
        removedCategory: "faustus",
      },
      watchlist: [faustusWatch, exchangeWatch],
    } as Partial<AppPreferences>);

    expect(result.migrated).toBe(true);
    expect(result.stored.sourceByCategory).toEqual({
      currency: "exchange",
      incubators: "stash-item",
      fossils: "exchange",
    });
    expect(result.stored.watchlist).toEqual([exchangeWatch]);
  });

  it("keeps a recoverable disabled-source watch pending a live refresh", () => {
    const faustusWatch = storedWatch("faustus");
    const result = migrateStoredPreferences({ watchlist: [faustusWatch] });

    expect(result.stored.watchlist).toEqual([{
      ...faustusWatch,
      key: "currency:exchange:divine",
      marketFetchedAt: undefined,
      marketStale: true,
      row: {
        ...faustusWatch.row,
        key: "currency:exchange:divine",
        source: "exchange",
        faustus: undefined,
      },
    }]);
  });

  it("drops only an unmappable disabled-source watch", () => {
    const watch = storedWatch("faustus");
    watch.row.categoryId = "removed-category";

    const result = migrateStoredPreferences({ watchlist: [watch] });

    expect(result.migrated).toBe(true);
    expect(result.stored.watchlist).toEqual([]);
  });

  it("leaves supported stored sources and watches unchanged", () => {
    const exchangeWatch = storedWatch("exchange");
    const result = migrateStoredPreferences({
      sourceByCategory: { currency: "exchange" },
      watchlist: [exchangeWatch],
    });

    expect(result.migrated).toBe(false);
    expect(result.stored.sourceByCategory.currency).toBe("exchange");
    expect(result.stored.watchlist).toEqual([exchangeWatch]);
  });
});

describe("durable mobile preference records", () => {
  const record = (revision: number, updatedAt: number, categoryId: string) =>
    decodePreferencesRecord(JSON.stringify({
      schema: 2,
      revision,
      updatedAt,
      preferences: { categoryId },
    }));

  it("keeps a newer WebView write instead of overwriting it from stale native storage", () => {
    const local = record(12, 120, "currency");
    const native = record(11, 110, "fragments");

    expect(selectNewestPreferencesRecord(local, native)?.preferences).toEqual({
      categoryId: "currency",
    });
  });

  it("accepts a newer native record and prefers local on an exact tie", () => {
    const local = record(12, 120, "currency");
    const native = record(13, 130, "fragments");
    expect(selectNewestPreferencesRecord(local, native)?.preferences).toEqual({
      categoryId: "fragments",
    });

    const tiedNative = record(12, 120, "fragments");
    expect(selectNewestPreferencesRecord(local, tiedNative)?.preferences).toEqual({
      categoryId: "currency",
    });
  });

  it("reads legacy direct preference objects for one-time migration", () => {
    const legacy = decodePreferencesRecord(JSON.stringify({ categoryId: "currency" }));
    expect(legacy).toMatchObject({
      revision: 0,
      updatedAt: 0,
      legacy: true,
      preferences: { categoryId: "currency" },
    });
  });
});
