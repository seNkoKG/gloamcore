import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { QuickSearchRow } from "../src/types";

const require = createRequire(import.meta.url);
const { createQuickSearchIndex } = require("./quick-search-index.cjs") as {
  createQuickSearchIndex: (options: {
    sanitizeRow: (value: unknown, league: string) => QuickSearchRow | null;
    maxGroups?: number;
    maxRowsPerGroup?: number;
    maxRows?: number;
    now?: () => number;
  }) => {
    apply: (update: unknown) => unknown;
    search: (query: string, limit: number, league: string, maximumAgeMs: number) => {
      rows: QuickSearchRow[];
      total: number;
      truncated: boolean;
      indexedTotal: number;
      indexTruncated: boolean;
      marketCount: number;
      revision: number;
    };
  };
};

function row(name: string, key = name): QuickSearchRow {
  return {
    key,
    name,
    categoryId: "currency",
    categoryLabel: "Currency",
    source: "exchange",
    league: "Current",
    chaosValue: 10,
    divineValue: 0.05,
    change: 1,
    volume: 100,
    listingCount: null,
    lowConfidence: false,
  };
}

const sanitizeRow = (value: unknown, league: string) => {
  if (!value || typeof value !== "object") return null;
  return { ...(value as QuickSearchRow), league };
};

describe("desktop quick-search index", () => {
  it("finds an exact match beyond the former 6,000-row surface cap", () => {
    const index = createQuickSearchIndex({ sanitizeRow });
    const rows = Array.from({ length: 7_000 }, (_, position) =>
      row(position === 6_500 ? "Needle Beyond Cap" : `Common Item ${position}`, String(position)),
    );
    index.apply({
      publisherId: "dashboard",
      revision: 1,
      reset: true,
      replace: [{ id: "Current:currency:exchange", league: "Current", fetchedAt: 1_000, rows }],
    });

    const result = index.search("needle beyond", 10, "Current", Number.POSITIVE_INFINITY);

    expect(result.rows.map((entry) => entry.name)).toEqual(["Needle Beyond Cap"]);
    expect(result.indexedTotal).toBe(7_000);
    expect(result.indexTruncated).toBe(false);
  });

  it("reports query truncation separately from corpus truncation", () => {
    const index = createQuickSearchIndex({ sanitizeRow, maxRowsPerGroup: 2 });
    index.apply({
      publisherId: "dashboard",
      revision: 1,
      reset: true,
      replace: [{
        id: "Current:currency:exchange",
        league: "Current",
        fetchedAt: 1_000,
        rows: [row("Orb One"), row("Orb Two"), row("Orb Three")],
      }],
    });

    const result = index.search("orb", 1, "Current", Number.POSITIVE_INFINITY);

    expect(result).toMatchObject({
      total: 2,
      truncated: true,
      indexedTotal: 2,
      indexTruncated: true,
    });
  });

  it("replaces and removes groups while rejecting stale revisions", () => {
    const index = createQuickSearchIndex({ sanitizeRow });
    index.apply({
      publisherId: "dashboard",
      revision: 2,
      reset: true,
      replace: [{ id: "one", league: "Current", fetchedAt: 1_000, rows: [row("Fresh")] }],
    });
    index.apply({
      publisherId: "dashboard",
      revision: 1,
      remove: ["one"],
    });
    expect(index.search("fresh", 10, "Current", Number.POSITIVE_INFINITY).total).toBe(1);

    index.apply({ publisherId: "dashboard", revision: 3, remove: ["one"] });
    expect(index.search("fresh", 10, "Current", Number.POSITIVE_INFINITY).total).toBe(0);
  });

  it("requires a reset when an acknowledged revision is skipped", () => {
    const index = createQuickSearchIndex({ sanitizeRow });
    index.apply({
      publisherId: "dashboard",
      revision: 1,
      reset: true,
      replace: [{ id: "one", league: "Current", fetchedAt: 1_000, rows: [row("First")] }],
    });

    expect(() => index.apply({
      publisherId: "dashboard",
      revision: 3,
      remove: ["one"],
    })).toThrow(/revision gap/i);
    expect(index.search("first", 10, "Current", Number.POSITIVE_INFINITY).total).toBe(1);

    expect(() => index.apply({
      publisherId: "dashboard",
      revision: 3,
      reset: true,
      replace: [],
      remove: [],
    })).not.toThrow();
    expect(index.search("first", 10, "Current", Number.POSITIVE_INFINITY).total).toBe(0);
  });

  it("deduplicates watched rows that also exist in a loaded market group", () => {
    const index = createQuickSearchIndex({ sanitizeRow });
    index.apply({
      publisherId: "dashboard",
      revision: 1,
      reset: true,
      replace: [
        { id: "market", league: "Current", fetchedAt: 1_000, rows: [row("Divine Orb")] },
        { id: "watchlist", league: "Current", fetchedAt: 2_000, rows: [row("Divine Orb")] },
      ],
    });

    const result = index.search("divine", 10, "Current", Number.POSITIVE_INFINITY);

    expect(result.total).toBe(1);
    expect(result.indexedTotal).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it("drops groups that expire between a hidden surface's searches", () => {
    let now = 4_000;
    const index = createQuickSearchIndex({ sanitizeRow, now: () => now });
    index.apply({
      publisherId: "dashboard",
      revision: 1,
      reset: true,
      replace: [{ id: "old", league: "Current", fetchedAt: 1_000, rows: [row("Expired")] }],
    });

    expect(index.search("expired", 10, "Current", 5_000).total).toBe(1);
    now = 10_000;
    expect(index.search("expired", 10, "Current", 5_000).total).toBe(0);
  });
});
