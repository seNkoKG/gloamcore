import { describe, expect, it } from "vitest";
import {
  chartFixture,
  unidentifiedChartFixture,
} from "./fixtures/parser-fixtures";
import {
  defaultPriceCheckModeForItem,
  isBulkChartPriceCheckMode,
  priceCheckModesForItem,
} from "./official-trade-workflow";
import { parsePoeItem } from "./parser";

describe("Awakened Chart preset workflow parity", () => {
  it("starts an identified rare on Pseudo/property and also exposes Bulk", () => {
    const chart = parsePoeItem(chartFixture);
    expect(priceCheckModesForItem(chart)).toEqual(["exact", "bulk"]);
    expect(defaultPriceCheckModeForItem(chart)).toBe("exact");
    expect(isBulkChartPriceCheckMode(chart, "exact")).toBe(false);
    expect(isBulkChartPriceCheckMode(chart, "bulk")).toBe(true);
  });

  it("uses only Bulk for every other current non-unique Chart", () => {
    const unidentified = parsePoeItem(unidentifiedChartFixture);
    const rare = parsePoeItem(chartFixture);
    for (const chart of [
      unidentified,
      { ...rare, rarity: "normal" as const },
      { ...rare, rarity: "magic" as const },
      { ...rare, identified: false },
    ]) {
      expect(priceCheckModesForItem(chart)).toEqual(["bulk"]);
      expect(defaultPriceCheckModeForItem(chart)).toBe("bulk");
      expect(isBulkChartPriceCheckMode(chart, "bulk")).toBe(true);
      expect(isBulkChartPriceCheckMode(chart, "exact")).toBe(true);
    }
  });

  it("keeps the hypothetical APT unique-Chart branch Exact-only", () => {
    const unique = {
      ...parsePoeItem(chartFixture),
      rarity: "unique" as const,
    };
    expect(priceCheckModesForItem(unique)).toEqual(["exact"]);
    expect(isBulkChartPriceCheckMode(unique, "bulk")).toBe(false);
  });
});
