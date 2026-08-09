import { describe, expect, it } from "vitest";
import type { QuickSearchRow } from "../types";
import {
  currentQuickSearchIndexRows,
  dedupeQuickRows,
  isQuickSearchIndexGroupActionable,
  nextQuickSearchIndexExpiryAt,
  type QuickSearchIndexGroup,
  quickRowIdentity,
  rankQuickRows,
} from "./quick-search";

const row = (
  name: string,
  overrides: Partial<QuickSearchRow> = {},
): QuickSearchRow => ({
  key: name,
  name,
  categoryId: "currency",
  categoryLabel: "Currency",
  source: "exchange",
  league: "Current",
  chaosValue: 10,
  divineValue: 0.05,
  change: 2,
  volume: 100,
  listingCount: null,
  lowConfidence: false,
  ...overrides,
});

describe("quick search", () => {
  it("ranks exact and prefix item names ahead of category-only matches", () => {
    const results = rankQuickRows(
      [
        row("Divine Orb"),
        row("Divine Vessel"),
        row("Orb of Annulment", { categoryLabel: "Divine Currency" }),
      ],
      "Divine Orb",
    );
    expect(results[0].name).toBe("Divine Orb");
    expect(results.map((entry) => entry.name)).toContain("Orb of Annulment");
  });

  it("matches multiple terms across name and variant", () => {
    const results = rankQuickRows(
      [
        row("Awakened Gem", { variant: "Level 5 Corrupted" }),
        row("Awakened Gem", { variant: "Level 1" }),
      ],
      "awakened corrupted",
    );
    expect(results).toHaveLength(1);
    expect(results[0].variant).toBe("Level 5 Corrupted");
  });

  it("deduplicates only identical market identities", () => {
    const exchange = row("Chaos Orb");
    const stash = row("Chaos Orb", { source: "stash-currency" });
    expect(dedupeQuickRows([exchange, exchange, stash])).toHaveLength(2);
    expect(quickRowIdentity(exchange)).not.toBe(quickRowIdentity(stash));
  });

  it("drops index groups after the two-hour freshness cap", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    const current = new Map<string, QuickSearchIndexGroup>([
      [
        "recent",
        { rows: [row("Recent")], fetchedAt: now - 1_000, stale: false },
      ],
      [
        "expired",
        {
          rows: [row("Expired")],
          fetchedAt: now - 2 * 60 * 60 * 1000 - 1,
          stale: false,
        },
      ],
    ]);

    expect(currentQuickSearchIndexRows(current, now).map((entry) => entry.name)).toEqual([
      "Recent",
    ]);
    expect(current.has("expired")).toBe(false);
    expect(nextQuickSearchIndexExpiryAt(current)).toBe(
      now - 1_000 + 2 * 60 * 60 * 1000,
    );
  });

  it("never publishes a stale mixed-market group beside fresh prices", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    const current = new Map<string, QuickSearchIndexGroup>([
      [
        "fresh-active-category",
        {
          rows: [row("Fresh item", { categoryId: "fragments" })],
          fetchedAt: now - 1_000,
          stale: false,
        },
      ],
      [
        "stale-currency-conversion",
        {
          rows: [row("Divine Orb", { chaosValue: 999 })],
          fetchedAt: now - 1_000,
          stale: true,
        },
      ],
    ]);

    const published = currentQuickSearchIndexRows(current, now);

    expect(published.map((entry) => entry.name)).toEqual(["Fresh item"]);
    expect(published.find((entry) => entry.name === "Divine Orb")).toBeUndefined();
    expect(current.has("stale-currency-conversion")).toBe(false);
    expect(
      isQuickSearchIndexGroupActionable(
        { fetchedAt: now - 1_000, stale: true },
        now,
      ),
    ).toBe(false);
  });
});
