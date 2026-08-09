import { describe, expect, it } from "vitest";
import type { EconomyRow } from "../../types";
import { estimatePriceCheck } from "./estimator";
import type {
  ParsedPoeItem,
  PriceCheckEstimate,
  PriceCheckHistoryEntry,
  PriceCheckMatch,
} from "./types";

const NOW = Date.UTC(2026, 7, 2, 12);

function item(patch: Partial<ParsedPoeItem> = {}): ParsedPoeItem {
  return {
    rawText: "Rarity: Gem\nFireball",
    language: "en",
    valid: true,
    itemClass: "Skill Gems",
    rarity: "gem",
    name: "Fireball",
    baseType: "Fireball",
    quality: 20,
    gemLevel: 20,
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

function row(patch: Partial<EconomyRow> = {}): EconomyRow {
  return {
    key: "fireball",
    id: "fireball",
    name: "Fireball",
    categoryId: "skill-gems",
    categoryLabel: "Skill Gems",
    source: "stash-item",
    chaosValue: 100,
    divineValue: 0.5,
    change: null,
    sparkline: [],
    volume: null,
    listingCount: 40,
    observationCount: 40,
    implicitModifiers: [],
    explicitModifiers: [],
    mutatedModifiers: [],
    lowConfidence: false,
    ...patch,
  };
}

function match(patch: Partial<PriceCheckMatch> = {}): PriceCheckMatch {
  return {
    row: row(),
    kind: "exact",
    score: 96,
    reasons: ["item name matches exactly"],
    ...patch,
  };
}

function priorEstimate(chaosValue: number): PriceCheckEstimate {
  return {
    chaosValue,
    divineValue: chaosValue / 200,
    lowChaos: chaosValue * 0.9,
    highChaos: chaosValue * 1.1,
    confidence: "high",
    confidenceScore: 90,
    label: "market estimate",
    reasons: [],
    warnings: [],
    evidence: [],
  };
}

function historyEntry(id: string, checkedAt: number, chaosValue: number): PriceCheckHistoryEntry {
  return {
    id,
    checkedAt,
    league: "Allflame",
    item: item(),
    estimate: priorEstimate(chaosValue),
    selectedMatchKey: "fireball",
  };
}

describe("price-check confidence estimator", () => {
  it("prices the explicitly selected market row", () => {
    const first = match({
      row: row({ key: "first", chaosValue: 100, observationCount: 40 }),
    });
    const selected = match({
      row: row({ key: "selected", chaosValue: 250, observationCount: 40 }),
    });
    const estimate = estimatePriceCheck(item(), [first, selected], {
      now: NOW,
      sourceFetchedAt: NOW - 5 * 60_000,
      selectedMatchKey: "selected",
    });

    expect(estimate.chaosValue).toBe(250);
    expect(estimate.evidence[0]?.label).toContain("exact match");
  });
  it("returns a high-confidence bounded range for a fresh liquid exact match", () => {
    const estimate = estimatePriceCheck(item(), [match()], {
      now: NOW,
      sourceFetchedAt: NOW - 5 * 60_000,
    });
    expect(estimate).toMatchObject({
      chaosValue: 100,
      divineValue: 0.5,
      confidence: "high",
      label: "market estimate",
    });
    expect(estimate.lowChaos).toBeLessThan(100);
    expect(estimate.highChaos).toBeGreaterThan(100);
    expect(estimate.warnings.join(" ")).toContain("not verified completed sales");
  });

  it("never promotes a one-listing manipulable ask", () => {
    const estimate = estimatePriceCheck(item(), [
      match({
        row: row({
          chaosValue: 7_000,
          divineValue: 35,
          listingCount: 1,
          observationCount: 1,
          lowConfidence: true,
          confidenceReason: "1 market observation",
        }),
      }),
    ], { now: NOW, sourceFetchedAt: NOW - 60_000 });
    expect(estimate.confidence).toBe("low");
    expect(estimate.label).toBe("rough estimate");
    expect(estimate.confidenceScore).toBeLessThan(45);
    expect(estimate.highChaos! - estimate.lowChaos!).toBeGreaterThan(5_000);
    expect(estimate.warnings.join(" ")).toMatch(/thin|manipulated|1 market observation/i);
  });

  it("chooses a liquid equivalent over a close manipulated duplicate", () => {
    const estimate = estimatePriceCheck(item(), [
      match({ row: row({ key: "fake", chaosValue: 7_000, listingCount: 1, observationCount: 1, lowConfidence: true }) }),
      match({ row: row({ key: "liquid", chaosValue: 102, divineValue: 0.51, listingCount: 50, observationCount: 50 }) }),
    ], { now: NOW, sourceFetchedAt: NOW - 60_000 });
    expect(estimate.chaosValue).toBe(102);
    expect(estimate.confidence).toBe("high");
  });

  it("caps stale source data at low confidence", () => {
    const estimate = estimatePriceCheck(item(), [match()], {
      now: NOW,
      sourceFetchedAt: NOW - 3 * 60 * 60_000,
      sourceStale: true,
    });
    expect(estimate.confidence).toBe("low");
    expect(estimate.confidenceScore).toBeLessThanOrEqual(29);
    expect(estimate.warnings.join(" ")).toContain("stale");
  });

  it("caps a source with unknown age at medium confidence", () => {
    const estimate = estimatePriceCheck(item(), [match()]);
    expect(estimate.confidence).toBe("medium");
    expect(estimate.warnings.join(" ")).toContain("Source age is unknown");
  });

  it("rejects invalid and non-positive prices", () => {
    const estimate = estimatePriceCheck(item(), [
      match({ row: row({ chaosValue: Number.NaN }) }),
      match({ row: row({ key: "zero", chaosValue: 0 }) }),
    ]);
    expect(estimate).toMatchObject({
      chaosValue: null,
      confidence: "none",
      label: "no reliable estimate",
    });
  });

  it("never estimates an item that did not parse cleanly", () => {
    const estimate = estimatePriceCheck(item({ valid: false }), [match()], {
      now: NOW,
      sourceFetchedAt: NOW - 60_000,
    });
    expect(estimate).toMatchObject({ chaosValue: null, confidence: "none" });
    expect(estimate.warnings.join(" ")).toContain("did not parse cleanly");
  });

  it("does not estimate an unidentified unique or a Foulborn item from clean rows", () => {
    const unidentified = estimatePriceCheck(
      item({ rarity: "unique", identified: false }),
      [match()],
    );
    expect(unidentified).toMatchObject({ chaosValue: null, confidence: "none" });
    expect(unidentified.warnings.join(" ")).toMatch(/unidentified/i);

    const foulborn = estimatePriceCheck(
      item({ rarity: "unique", foulborn: true }),
      [match({ row: row({ name: "Mageblood" }) })],
    );
    expect(foulborn).toMatchObject({ chaosValue: null, confidence: "none" });
    expect(foulborn.warnings.join(" ")).toMatch(/Foulborn/i);
  });

  it("does not price a rare item from a generic base value", () => {
    const rare = item({ rarity: "rare", itemClass: "Wands", name: "Doom Needle", baseType: "Imbued Wand" });
    const estimate = estimatePriceCheck(
      rare,
      [match({ kind: "base", row: row({ name: "Imbued Wand", categoryId: "base-types" }) })],
      { now: NOW, sourceFetchedAt: NOW - 60_000 },
    );
    expect(estimate.confidence).toBe("none");
    expect(estimate.chaosValue).toBeNull();
    expect(estimate.evidence[0].detail).toContain("Base-only reference");
    expect(estimate.warnings.join(" ")).toContain("modifiers can change value dramatically");
  });

  it("uses stable agreeing local history as explicit supporting evidence", () => {
    const history = [
      historyEntry("1", NOW - 60_000, 101),
      historyEntry("2", NOW - 2 * 60_000, 99),
      historyEntry("3", NOW - 3 * 60_000, 100),
    ];
    const estimate = estimatePriceCheck(item(), [match()], {
      now: NOW,
      league: "Allflame",
      sourceFetchedAt: NOW - 60_000,
      history,
    });
    expect(estimate.evidence.some((entry) => entry.source === "local-history")).toBe(true);
    expect(estimate.reasons.join(" ")).toContain("local history agrees");
  });

  it("warns and lowers confidence when current data sharply disagrees with history", () => {
    const history = [
      historyEntry("1", NOW - 60_000, 100),
      historyEntry("2", NOW - 2 * 60_000, 101),
      historyEntry("3", NOW - 3 * 60_000, 99),
    ];
    const estimate = estimatePriceCheck(item(), [match({ row: row({ chaosValue: 1_000, divineValue: 5 }) })], {
      now: NOW,
      league: "Allflame",
      sourceFetchedAt: NOW - 60_000,
      history,
    });
    expect(estimate.confidence).toBe("low");
    expect(estimate.warnings.join(" ")).toContain("differs sharply");
  });

  it("does not treat future source or history timestamps as fresh evidence", () => {
    const history = [
      historyEntry("1", NOW + 60_000, 100),
      historyEntry("2", NOW + 120_000, 100),
      historyEntry("3", NOW + 180_000, 100),
    ];
    const estimate = estimatePriceCheck(item(), [match()], {
      now: NOW,
      league: "Allflame",
      sourceFetchedAt: NOW + 1,
      history,
    });
    expect(estimate.evidence.some((entry) => entry.source === "local-history")).toBe(
      false,
    );
    expect(estimate.warnings.join(" ")).toContain("Source age is unknown");
    expect(estimate.confidence).not.toBe("high");
  });

  it("records Faustus completed-hour evidence and detects disagreement", () => {
    const estimate = estimatePriceCheck(item(), [
      match({
        row: row({
          faustus: {
            hour: Math.floor(NOW / (60 * 60_000)),
            minimumChaos: 45,
            maximumChaos: 55,
            traded: 100,
            reference: "chaos",
          },
        }),
      }),
    ], { now: NOW, sourceFetchedAt: NOW - 60_000 });
    expect(estimate.evidence.some((entry) => entry.source === "faustus")).toBe(true);
    expect(estimate.confidence).toBe("low");
    expect(estimate.warnings.join(" ")).toContain("disagree materially");
  });

  it("uses exchange volume when listing observations are not published", () => {
    const estimate = estimatePriceCheck(
      item({ rarity: "currency" }),
      [
        match({
          row: row({
            source: "exchange",
            volume: 12_000,
            listingCount: null,
            observationCount: null,
          }),
        }),
      ],
      { now: NOW, sourceFetchedAt: NOW - 60_000 },
    );
    expect(estimate.confidence).toBe("high");
    expect(estimate.evidence[0].sampleCount).toBe(12_000);
  });

  it("adds Faustus evidence when the liquid listing row remains selected", () => {
    const exchange = match({
      row: row({
        key: "exchange",
        source: "exchange",
        volume: 12_000,
        listingCount: null,
        observationCount: null,
      }),
    });
    const faustus = match({
      row: row({
        key: "faustus",
        source: "faustus",
        listingCount: null,
        observationCount: null,
        volume: 80,
        faustus: {
          hour: Math.floor(NOW / (60 * 60_000)),
          minimumChaos: 95,
          maximumChaos: 105,
          traded: 80,
          reference: "chaos",
        },
      }),
    });
    const estimate = estimatePriceCheck(item({ rarity: "currency" }), [exchange, faustus], {
      now: NOW,
      sourceFetchedAt: NOW - 60_000,
    });
    expect(estimate.evidence.some((entry) => entry.source === "faustus")).toBe(true);
    expect(estimate.reasons.join(" ")).toContain("Faustus completed-hour evidence agrees");
  });
});
