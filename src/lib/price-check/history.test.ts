import { describe, expect, it } from "vitest";
import {
  appendPriceCheckHistory,
  getPriceCheckHistoryTrend,
  priceCheckItemFingerprint,
  selectPriceCheckHistory,
} from "./history";
import type {
  ParsedPoeItem,
  PriceCheckEstimate,
  PriceCheckHistoryEntry,
} from "./types";

const NOW = Date.UTC(2026, 7, 2, 12);

function item(patch: Partial<ParsedPoeItem> = {}): ParsedPoeItem {
  return {
    rawText: "Rarity: Unique\nMageblood\nHeavy Belt",
    language: "en",
    valid: true,
    itemClass: "Belts",
    rarity: "unique",
    name: "Mageblood",
    baseType: "Heavy Belt",
    sockets: [],
    influences: [],
    corrupted: false,
    mirrored: false,
    split: false,
    identified: true,
    fractured: false,
    synthesised: false,
    veiled: false,
    foil: false,
    foulborn: false,
    replica: false,
    scourged: false,
    properties: {},
    requirements: {},
    modifiers: [],
    flavourText: [],
    reminderText: [],
    unknownSections: [],
    warnings: [],
    errors: [],
    ...patch,
  };
}

function estimate(value: number | null, confidence: PriceCheckEstimate["confidence"] = "high"): PriceCheckEstimate {
  return {
    chaosValue: value,
    divineValue: value == null ? null : value / 200,
    lowChaos: value == null ? null : value * 0.9,
    highChaos: value == null ? null : value * 1.1,
    confidence,
    confidenceScore: confidence === "none" ? 0 : 90,
    label: confidence === "none" ? "no reliable estimate" : "market estimate",
    reasons: [],
    warnings: [],
    evidence: [],
  };
}

function entry(
  id: string,
  checkedAt: number,
  value: number | null,
  patch: Partial<PriceCheckHistoryEntry> = {},
): PriceCheckHistoryEntry {
  return {
    id,
    checkedAt,
    league: "Allflame",
    item: item(),
    estimate: estimate(value),
    selectedMatchKey: "mageblood",
    ...patch,
  };
}

describe("price-check history identity", () => {
  it("normalizes cosmetic name differences and influence order", () => {
    const left = item({ name: "Mageblood", influences: ["Shaper", "Elder"] });
    const right = item({ name: "  MAGEBLOOD ", influences: ["Elder", "Shaper"] });
    expect(priceCheckItemFingerprint(left)).toBe(priceCheckItemFingerprint(right));
  });

  it("distinguishes market-defining state", () => {
    const base = priceCheckItemFingerprint(item());
    expect(priceCheckItemFingerprint(item({ corrupted: true }))).not.toBe(base);
    expect(priceCheckItemFingerprint(item({ replica: true }))).not.toBe(base);
    expect(priceCheckItemFingerprint(item({ links: 6 }))).not.toBe(base);
    expect(priceCheckItemFingerprint(item({ foil: true }))).not.toBe(base);
    expect(priceCheckItemFingerprint(item({ foulborn: true }))).not.toBe(base);
    expect(priceCheckItemFingerprint(item({ identified: false }))).not.toBe(base);
    expect(priceCheckItemFingerprint(item({ itemLevel: 86 }))).not.toBe(base);
  });

  it("distinguishes rare items by modifier IDs and rolls", () => {
    const rare = item({
      rarity: "rare",
      name: "Doom Needle",
      baseType: "Imbued Wand",
      modifiers: [{
        id: "explicit.stat_1",
        kind: "explicit",
        text: "+100 to maximum Life",
        normalizedText: "+# to maximum life",
        values: [100],
        selectedByDefault: true,
        tags: [],
        advanced: false,
      }],
    });
    const better = { ...rare, modifiers: [{ ...rare.modifiers[0], values: [110] }] };
    expect(priceCheckItemFingerprint(rare)).not.toBe(priceCheckItemFingerprint(better));
  });
});

describe("bounded price-check history", () => {
  it("stores newest first and replaces duplicate IDs", () => {
    const history = [entry("same", NOW - 1_000, 90), entry("old", NOW - 2_000, 80)];
    const result = appendPriceCheckHistory(history, entry("same", NOW, 100), 10);
    expect(result.map((candidate) => candidate.id)).toEqual(["same", "old"]);
    expect(result[0].estimate.chaosValue).toBe(100);
  });

  it("deduplicates an identical rapid capture but preserves real trend samples", () => {
    const first = entry("first", NOW - 10_000, 100);
    expect(appendPriceCheckHistory([first], entry("second", NOW, 100.4))).toHaveLength(1);
    expect(appendPriceCheckHistory([first], entry("later", NOW + 31_000, 100))).toHaveLength(2);
    expect(appendPriceCheckHistory([first], entry("changed", NOW, 120))).toHaveLength(2);
  });

  it("enforces its caller-defined bound", () => {
    let history: PriceCheckHistoryEntry[] = [];
    for (let index = 0; index < 20; index += 1) {
      history = appendPriceCheckHistory(
        history,
        entry(String(index), NOW + index * 31_000, 100 + index),
        5,
      );
    }
    expect(history).toHaveLength(5);
    expect(history[0].id).toBe("19");
    expect(history.at(-1)?.id).toBe("15");
  });

  it("selects only matching league and selected market row", () => {
    const history = [
      entry("wanted", NOW, 100),
      entry("league", NOW, 100, { league: "Standard" }),
      entry("row", NOW, 100, { selectedMatchKey: "other" }),
      entry("item", NOW, 100, { item: item({ corrupted: true }) }),
    ];
    expect(selectPriceCheckHistory(history, item(), {
      league: "Allflame",
      selectedMatchKey: "mageblood",
    }).map((candidate) => candidate.id)).toEqual(["wanted"]);
  });
});

describe("local trend evidence", () => {
  it("computes newest-to-oldest rising evidence", () => {
    const history = [
      entry("new", NOW, 120),
      entry("middle", NOW - 60_000, 110),
      entry("old", NOW - 120_000, 100),
    ];
    const trend = getPriceCheckHistoryTrend(history, item(), {
      league: "Allflame",
      selectedMatchKey: "mageblood",
      now: NOW,
    });
    expect(trend).toMatchObject({
      sampleCount: 3,
      medianChaos: 110,
      direction: "rising",
      changePercent: 20,
      ageMs: 0,
    });
    expect(trend.stable).toBe(true);
  });

  it("uses quartiles so one extreme historical estimate does not define the median", () => {
    const history = [
      entry("1", NOW, 100),
      entry("2", NOW - 60_000, 101),
      entry("3", NOW - 120_000, 99),
      entry("manipulated", NOW - 180_000, 10_000),
      entry("5", NOW - 240_000, 100),
    ];
    const trend = getPriceCheckHistoryTrend(history, item(), { now: NOW });
    expect(trend.medianChaos).toBe(100);
    expect(trend.highChaos).toBe(101);
  });

  it("excludes no-estimate and invalid historical values", () => {
    const history = [
      entry("good", NOW, 100),
      entry("none", NOW - 1, null, { estimate: estimate(null, "none") }),
      entry("nan", NOW - 2, Number.NaN),
      entry("zero", NOW - 3, 0),
    ];
    const trend = getPriceCheckHistoryTrend(history, item());
    expect(trend.values).toEqual([100]);
    expect(trend.direction).toBe("unknown");
  });

  it("rejects future-dated checks from freshness and trend evidence", () => {
    const history = [
      entry("future", NOW + 1, 1_000),
      entry("current", NOW - 1_000, 100),
    ];
    const trend = getPriceCheckHistoryTrend(history, item(), { now: NOW });
    expect(trend.entries.map((candidate) => candidate.id)).toEqual(["current"]);
    expect(trend.values).toEqual([100]);
    expect(trend.ageMs).toBe(1_000);
  });
});
