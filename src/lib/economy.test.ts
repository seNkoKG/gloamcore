import { describe, expect, it } from "vitest";
import { categories } from "../config/categories";
import type { RawExchangeOverview, RawItemOverview } from "../types";
import {
  emptyFilters,
  filterRows,
  normalizeOverview,
  sortRows,
} from "./economy";

const currency = categories[0];
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

  it("infers the live divine conversion from valid item rows", () => {
    const items: RawItemOverview = {
      lines: [
        { id: 1, name: "A", chaosValue: 175, divineValue: 1 },
        { id: 2, name: "B", chaosValue: 350, divineValue: 2 },
        { id: 3, name: "Missing conversion", chaosValue: 87.5 },
      ],
    };
    const skillGems = categories.find((category) => category.id === "skill-gems")!;
    const rows = normalizeOverview(items, "stash-item", skillGems).rows;
    expect(rows.find((row) => row.id === "3")?.divineValue).toBe(0.5);
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
});
