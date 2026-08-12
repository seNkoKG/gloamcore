import { describe, expect, it } from "vitest";
import type { AppPreferences, WatchEntry } from "../types";
import { migrateStoredPreferences } from "./preference-migration";
import {
  decodePreferencesRecord,
  normalizeStoredPreferences,
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
  it("preserves supported interface themes and rejects unknown palettes", () => {
    expect(migrateStoredPreferences({ theme: "ember" }).stored.theme).toBe("ember");
    const repaired = migrateStoredPreferences({ theme: "neon-random" });
    expect(repaired.migrated).toBe(true);
    expect(repaired.stored.theme).toBeUndefined();
  });

  it("preserves valid Faustus sources and watches while repairing incompatible selections", () => {
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
      currency: "faustus",
      incubators: "stash-item",
      fossils: "exchange",
    });
    expect(result.stored.watchlist).toEqual([faustusWatch, exchangeWatch]);
  });

  it("keeps a valid Faustus watch unchanged", () => {
    const faustusWatch = storedWatch("faustus");
    const result = migrateStoredPreferences({ watchlist: [faustusWatch] });

    expect(result.migrated).toBe(false);
    expect(result.stored.watchlist).toEqual([faustusWatch]);
  });

  it("drops only a malformed Faustus watch", () => {
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

  it("invalidates legacy derived Divine prices until a live refresh", () => {
    const exchangeWatch = storedWatch("exchange");
    const result = migrateStoredPreferences(
      { watchlist: [exchangeWatch] },
      { invalidateLegacyDivineValues: true },
    );

    expect(result.migrated).toBe(true);
    expect(result.stored.watchlist[0]).toMatchObject({
      marketFetchedAt: undefined,
      marketStale: true,
      row: { chaosValue: 180, divineValue: null },
    });
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

  it("recognizes current schema records without a migration flag", () => {
    expect(decodePreferencesRecord(JSON.stringify({
      schema: 3,
      revision: 1,
      updatedAt: 2,
      preferences: { categoryId: "currency" },
    }))).toMatchObject({ schema: 3, legacy: false });
  });

  it.each([2, 3] as const)(
    "preserves Faustus selections and watch identity from schema %s",
    (schema) => {
      const faustusWatch = storedWatch("faustus");
      const decoded = decodePreferencesRecord(JSON.stringify({
        schema,
        revision: 4,
        updatedAt: 5,
        preferences: {
          sourceByCategory: { currency: "faustus" },
          watchlist: [faustusWatch],
        },
      }));
      const normalized = normalizeStoredPreferences(
        decoded?.preferences,
        decoded?.schema !== 3,
      );

      expect(normalized.preferences.sourceByCategory.currency).toBe("faustus");
      expect(normalized.preferences.watchlist).toHaveLength(1);
      expect(normalized.preferences.watchlist[0]).toMatchObject({
        key: faustusWatch.key,
        row: { key: faustusWatch.row.key, source: "faustus" },
      });
      if (schema === 2) {
        expect(normalized.preferences.watchlist[0]).toMatchObject({
          marketStale: true,
          row: { divineValue: null },
        });
      } else {
        expect(normalized.preferences.watchlist[0]).toEqual(faustusWatch);
      }
    },
  );

  it("drops only corrupt current-schema watch rows and preserves valid preferences", () => {
    const valid = storedWatch("exchange");
    const result = normalizeStoredPreferences({
      league: "Allflame",
      categoryId: "fragments",
      sourceByCategory: { fragments: "stash-currency", removed: "exchange" },
      valueDisplay: "divine",
      density: "comfortable",
      sidebarCollapsed: true,
      refreshMinutes: 10,
      lastViewed: ["fragments", 42],
      watchlist: [null, valid, { key: "broken", league: "Allflame", addedAt: 3, row: null }],
    }, false);

    expect(result.migrated).toBe(true);
    expect(result.preferences).toMatchObject({
      league: "Allflame",
      categoryId: "fragments",
      sourceByCategory: { fragments: "stash-currency" },
      valueDisplay: "divine",
      density: "comfortable",
      sidebarCollapsed: true,
      refreshMinutes: 10,
      lastViewed: ["fragments"],
    });
    expect(result.preferences.watchlist).toEqual([valid]);
  });

  it("sanitizes corrupt legacy rows while preserving Divine invalidation", () => {
    const valid = storedWatch("exchange");
    const result = normalizeStoredPreferences({
      categoryId: "currency",
      valueDisplay: "chaos",
      watchlist: [{ row: null }, valid, undefined],
    }, true);

    expect(result.migrated).toBe(true);
    expect(result.preferences.categoryId).toBe("currency");
    expect(result.preferences.valueDisplay).toBe("chaos");
    expect(result.preferences.watchlist).toHaveLength(1);
    expect(result.preferences.watchlist[0]).toMatchObject({
      key: valid.key,
      league: valid.league,
      marketFetchedAt: undefined,
      marketStale: true,
      row: { key: valid.row.key, divineValue: null },
    });
  });
});
