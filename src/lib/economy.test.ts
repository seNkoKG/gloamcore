import { describe, expect, it } from "vitest";
import { categories } from "../config/categories";
import type { RawExchangeOverview, RawItemOverview } from "../types";
import {
  defaultFiltersForSource,
  emptyFilters,
  filterRows,
  marketStats,
  normalizeOverview,
  sortRows,
} from "./economy";

const currency = categories[0];

describe("source filter defaults", () => {
  it("shows guarded Faustus markets without changing other source defaults", () => {
    expect(defaultFiltersForSource("faustus").includeLowConfidence).toBe(true);
    expect(defaultFiltersForSource("exchange").includeLowConfidence).toBe(false);
    expect(defaultFiltersForSource("stash-item").includeLowConfidence).toBe(false);
  });
});
const sample: RawExchangeOverview = {
  core: {
    primary: "chaos",
    secondary: "divine",
    rates: { divine: 0.005 },
    items: [
      { id: "chaos", name: "Chaos Orb" },
      { id: "divine", name: "Divine Orb" },
    ],
  },
  items: [
    { id: "mirror", name: "Mirror of Kalandra", detailsId: "mirror" },
  ],
  lines: [
    {
      id: "mirror",
      primaryValue: 40000,
      volumePrimaryValue: 100,
      sparkline: { totalChange: 12, data: [0, 5, 12] },
    },
    {
      id: "chaos",
      primaryValue: 1,
      volumePrimaryValue: 100000,
      sparkline: { totalChange: -2, data: [0, -1, -2] },
    },
  ],
};

describe("economy normalization", () => {
  it("converts exchange primary values to chaos and divine", () => {
    const normalized = normalizeOverview(sample, "exchange", currency);
    const mirror = normalized.rows.find((row) => row.id === "mirror");
    expect(mirror?.chaosValue).toBe(40000);
    expect(mirror?.divineValue).toBe(200);
    expect(mirror?.change).toBe(12);
  });

  it("keeps direct chaos while marking a missing exchange Divine rate unavailable", () => {
    const normalized = normalizeOverview(
      { ...sample, core: { ...sample.core!, rates: {} } },
      "exchange",
      currency,
    );
    expect(normalized.rows[0]).toMatchObject({ chaosValue: 40_000, divineValue: null });
  });

  it("filters by search and trend", () => {
    const rows = normalizeOverview(sample, "exchange", currency).rows;
    const filtered = filterRows(
      rows,
      { ...emptyFilters, query: "mirror", trend: "gainers" },
      "adaptive",
    );
    expect(filtered.map((row) => row.name)).toEqual(["Mirror of Kalandra"]);
  });

  it("sorts by displayed value", () => {
    const rows = normalizeOverview(sample, "exchange", currency).rows;
    const sorted = sortRows(
      rows,
      { key: "value", direction: "desc" },
      "adaptive",
    );
    expect(sorted[0].id).toBe("mirror");
  });

  it("hides manipulable low-sample estimates by default", () => {
    const skillGems = categories.find((category) => category.id === "skill-gems")!;
    const rows = normalizeOverview(
      {
        lines: [
          {
            id: 1,
            name: "One Listing Gem",
            chaosValue: 7_000,
            divineValue: 40,
            count: 1,
            listingCount: 1,
          },
          {
            id: 2,
            name: "Liquid Gem",
            chaosValue: 400,
            divineValue: 2.3,
            count: 30,
            listingCount: 30,
          },
        ],
      },
      "stash-item",
      skillGems,
    ).rows;

    expect(rows[0].lowConfidence).toBe(true);
    expect(rows[0].confidenceReason).toBe("1 market observation");
    expect(filterRows(rows, emptyFilters, "adaptive").map((row) => row.name)).toEqual([
      "Liquid Gem",
    ]);
    expect(
      filterRows(rows, { ...emptyFilters, includeLowConfidence: true }, "adaptive"),
    ).toHaveLength(2);
  });

  it("does not present a zero-change trend without enough history", () => {
    const rows = normalizeOverview(
      {
        ...sample,
        lines: [
          {
            id: "mirror",
            primaryValue: 40_000,
            volumePrimaryValue: 1,
            sparkline: { totalChange: 0, data: [] },
          },
        ],
      },
      "exchange",
      currency,
    ).rows;
    expect(rows[0].change).toBeNull();
    expect(rows[0].sparkline).toEqual([]);
  });

  it("does not invent a divine conversion for an item row that lacks one", () => {
    const items: RawItemOverview = {
      lines: [
        { id: 1, name: "A", chaosValue: 175, divineValue: 1 },
        { id: 2, name: "B", chaosValue: 350, divineValue: 2 },
        { id: 3, name: "Missing conversion", chaosValue: 87.5 },
      ],
    };
    const skillGems = categories.find((category) => category.id === "skill-gems")!;
    const rows = normalizeOverview(items, "stash-item", skillGems).rows;
    expect(rows.find((row) => row.id === "3")?.divineValue).toBeNull();
  });

  it("sorts unavailable Divine values last and excludes them from Divine bounds", () => {
    const skillGems = categories.find((category) => category.id === "skill-gems")!;
    const rows = normalizeOverview({ lines: [
      { id: 1, name: "Unavailable", chaosValue: 10, count: 10, listingCount: 10 },
      { id: 2, name: "Known", chaosValue: 20, divineValue: 0.1, count: 10, listingCount: 10 },
    ] }, "stash-item", skillGems).rows;

    expect(sortRows(rows, { key: "value", direction: "asc" }, "divine")
      .map((row) => row.name)).toEqual(["Known", "Unavailable"]);
    expect(filterRows(rows, emptyFilters, "divine")).toHaveLength(2);
    expect(filterRows(rows, { ...emptyFilters, minPrice: "0.01" }, "divine")
      .map((row) => row.name)).toEqual(["Known"]);
  });

  it("drops unpriced or invalid market rows", () => {
    const rows = normalizeOverview(
      {
        lines: [
          { id: 1, name: "Zero", chaosValue: 0 },
          { id: 2, name: "Broken", chaosValue: Number.NaN },
          { id: 3, name: "Valid", chaosValue: 1, divineValue: 0.005 },
        ],
      },
      "stash-item",
      categories.find((category) => category.id === "skill-gems")!,
    ).rows;
    expect(rows.map((row) => row.name)).toEqual(["Valid"]);
  });

  it("filters skill gems by required level independently of gem level", () => {
    const skillGems = categories.find((category) => category.id === "skill-gems")!;
    const rows = normalizeOverview(
      {
        lines: [
          {
            id: 1,
            name: "Test Gem",
            chaosValue: 10,
            divineValue: 0.05,
            gemLevel: 20,
            levelRequired: 70,
            count: 30,
            listingCount: 30,
          },
        ],
      },
      "stash-item",
      skillGems,
    ).rows;

    expect(
      filterRows(
        rows,
        { ...emptyFilters, level: "61-999" },
        "adaptive",
      ),
    ).toHaveLength(1);
    expect(
      filterRows(rows, { ...emptyFilters, level: "0-20" }, "adaptive"),
    ).toHaveLength(0);
  });

  it("marks zero and unknown liquidity as non-actionable and rejects invalid counts", () => {
    const skillGems = categories.find((category) => category.id === "skill-gems")!;
    const rows = normalizeOverview(
      {
        lines: [
          { id: 1, name: "Zero", chaosValue: 1, count: 0, listingCount: 0 },
          { id: 2, name: "Unknown", chaosValue: 2 },
          { id: 3, name: "Negative", chaosValue: 3, count: -1, listingCount: 8 },
          { id: 4, name: "Reliable", chaosValue: 4, count: 8, listingCount: 8 },
        ],
      },
      "stash-item",
      skillGems,
    ).rows;

    expect(rows.map((row) => row.name)).toEqual(["Zero", "Unknown", "Reliable"]);
    expect(rows[0]).toMatchObject({ lowConfidence: true, confidenceReason: "0 market observations" });
    expect(rows[1]).toMatchObject({ lowConfidence: true, confidenceReason: "Market sample count unavailable" });
    expect(rows[2].lowConfidence).toBe(false);
  });

  it("never promotes weak or directionally wrong rows into market pulse stats", () => {
    const rows = normalizeOverview(sample, "exchange", currency).rows;
    const weak = { ...rows[0], lowConfidence: true, change: 99, volume: 999_999 };
    const falling = { ...rows[0], key: "falling", change: -5, volume: null };
    const stats = marketStats([weak, falling]);
    expect(stats.gainer).toBeUndefined();
    expect(stats.loser?.key).toBe("falling");
    expect(stats.liquid).toBeUndefined();
  });
});
