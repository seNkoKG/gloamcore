import { describe, expect, it } from "vitest";
import type { EconomyRow } from "../../types";
import { parseItemFilter } from "./item-filter";
import {
  auditFilterEconomy,
  calculateDustValue,
  divinationAreaExpectedValue,
  filterAuditEntries,
} from "./economy-audit";

const row = (overrides: Partial<EconomyRow>): EconomyRow => ({
  key: "card:one",
  id: "one",
  name: "The Doctor",
  categoryId: "divination-cards",
  categoryLabel: "Divination Cards",
  source: "exchange",
  chaosValue: 100,
  divineValue: 0.5,
  change: null,
  sparkline: [],
  volume: 20,
  listingCount: 10,
  observationCount: 10,
  implicitModifiers: [],
  explicitModifiers: [],
  mutatedModifiers: [],
  lowConfidence: false,
  ...overrides,
});

describe("filter economy audit", () => {
  it("maps a live row to the first explicit BaseType tier", () => {
    const filter = parseItemFilter(
      "# tier: premium\nShow\n    BaseType == \"The Doctor\"\n\n# tier: rest\nHide\n    BaseType == \"Rain of Chaos\"\n",
    );
    expect(auditFilterEconomy(filter, [row({})])[0]).toMatchObject({
      sourceTier: "premium",
      visibility: "Show",
    });
  });

  it("filters by price, text, tier, and target mismatch", () => {
    const entries = auditFilterEconomy(null, [row({}), row({ key: "two", name: "Rain of Chaos", chaosValue: 1 })]);
    expect(filterAuditEntries(entries, { query: "doctor", minimumChaos: 50 })).toHaveLength(1);
    expect(filterAuditEntries(entries, { targetTier: "premium", onlyMisplaced: true })).toHaveLength(2);
  });

  it("calculates quality and influence dust multipliers deterministically", () => {
    expect(calculateDustValue(2, { itemLevel: 84, quality: 20, influences: 1 })).toBe(9500);
    expect(calculateDustValue(2, { itemLevel: 0, quality: 20, influences: 1 })).toBe(0);
    expect(calculateDustValue(2, { itemLevel: 84, quality: Number.POSITIVE_INFINITY, influences: Number.NaN })).toBe(5000);
  });

  it("does not assign or move a base that appears in multiple explicit blocks", () => {
    const filter = parseItemFilter([
      "# tier: first",
      "Show",
      '    BaseType "The Doctor"',
      "# tier: second",
      "Hide",
      '    BaseType "The Doctor"',
    ].join("\n"));
    expect(auditFilterEconomy(filter, [row({})])[0]).toMatchObject({
      sourceBlockId: null,
      ambiguityCount: 2,
    });
  });

  it("computes weighted per-card expected value and excludes outliers", () => {
    expect(divinationAreaExpectedValue([
      { chaosValue: 100, stackSize: 5, weight: 1 },
      { chaosValue: 20, stackSize: 2, weight: 3 },
      { chaosValue: 10000, stackSize: 1, weight: 100, excluded: true },
    ]).perDrop).toBeCloseTo(12.5);
    expect(divinationAreaExpectedValue([
      { chaosValue: Number.POSITIVE_INFINITY, stackSize: 1, weight: 100 },
      { chaosValue: 10, stackSize: 1, weight: Number.NaN },
    ])).toEqual({ perDrop: 0, totalWeight: 0 });
  });
});
