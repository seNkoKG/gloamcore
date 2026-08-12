import { describe, expect, it } from "vitest";
import type { EconomyRow } from "../types";
import { buildTradeQuery, poeWikiUrl, tradeUrl } from "./format";

function row(patch: Partial<EconomyRow> = {}): EconomyRow {
  return {
    key: "skill-gems:stash-item:1",
    id: "1",
    name: "Detonate Dead of Scavenging",
    categoryId: "skill-gems",
    categoryLabel: "Skill Gems",
    source: "stash-item",
    chaosValue: 100,
    divineValue: 0.5,
    change: 1,
    sparkline: [],
    volume: null,
    listingCount: 10,
    observationCount: 10,
    implicitModifiers: [],
    explicitModifiers: [],
    mutatedModifiers: [],
    lowConfidence: false,
    ...patch,
  };
}

describe("trade query generation", () => {
  it("uses poe.ninja's supplied trade filter for transfigured gems", () => {
    const query = buildTradeQuery(
      row({
        tradeFilter: {
          query: {
            type: { option: "Detonate Dead", discriminator: "alt_x" },
            filters: {
              misc_filters: {
                filters: { gem_level: { min: 20 } },
              },
            },
          },
        },
      }),
    );
    if (!query) throw new Error("Expected an exact trade query.");

    expect(query).toMatchObject({
      query: {
        status: { option: "any" },
        type: { option: "Detonate Dead", discriminator: "alt_x" },
      },
      sort: { price: "asc" },
    });
  });

  it("searches base types by type and preserves item level and influence", () => {
    const query = buildTradeQuery(
      row({
        name: "Silk Gloves",
        categoryId: "base-types",
        categoryLabel: "Base Types",
        variant: "Redeemer",
        levelRequired: 86,
      }),
    );
    if (!query) throw new Error("Expected an exact trade query.");

    expect(query.query).toMatchObject({
      type: "Silk Gloves",
      filters: {
        misc_filters: {
          filters: {
            ilvl: { min: 86 },
            redeemer_item: { option: true },
          },
        },
      },
    });
    expect(query.query).not.toHaveProperty("name");
  });

  it("adds Foulborn mutation stats without zero-value constraints", () => {
    const query = buildTradeQuery(
      row({
        name: "Foulborn The Squire",
        categoryId: "unique-armours",
        baseType: "Elegant Round Shield",
        tradeInfo: [{ mod: "explicit.stat_123", min: 0, max: 0 }],
      }),
    );
    if (!query) throw new Error("Expected an exact trade query.");

    expect(query.query).toMatchObject({
      name: "The Squire",
      type: "Elegant Round Shield",
      stats: [
        {
          type: "and",
          filters: [{ id: "explicit.stat_123" }],
        },
      ],
      filters: {
        misc_filters: { filters: { mutated: { option: true } } },
      },
    });
    expect(JSON.stringify(query)).not.toContain('"value"');
  });

  it("uses free-text search for named Valdo maps", () => {
    const query = buildTradeQuery(
      row({
        name: "Iron Nadir",
        categoryId: "valdo-maps",
        categoryLabel: "Valdo Maps",
      }),
    );
    if (!query) throw new Error("Expected an exact trade query.");
    expect(query.query).toMatchObject({ term: "Iron Nadir" });
  });

  it("preserves poe.ninja selector options for current cluster jewel enchants", () => {
    const query = buildTradeQuery(row({
      name: "6% increased Mana Reservation Efficiency of Skills",
      baseType: "Small Cluster Jewel",
      categoryId: "cluster-jewels",
      tradeInfo: [
        { mod: "enchant.stat_3948993189", min: 0, max: 0, option: "54" },
        { mod: "enchant.stat_3086156145", min: 3, max: 3 },
      ],
    }));
    if (!query) throw new Error("Expected an exact trade query.");

    expect(query.query).toMatchObject({
      type: "Small Cluster Jewel",
      stats: [{
        type: "and",
        filters: [
          { id: "enchant.stat_3948993189|54" },
          { id: "enchant.stat_3086156145", value: { min: 3, max: 3 } },
        ],
      }],
    });
  });

  it.each([
    ["Forbidden Flame", "Crimson Jewel", "explicit.stat_1190333629|61627"],
    ["Forbidden Flesh", "Cobalt Jewel", "explicit.stat_2460506030|61627"],
  ])("builds an exact %s passive selector", (variant, baseType, statId) => {
    const query = buildTradeQuery(row({
      name: "Ricochet",
      baseType,
      variant,
      categoryId: "forbidden-jewels",
      metadata: { baseClass: "Ranger", ascendancy: "Deadeye", passiveName: "Ricochet" },
    }));
    if (!query) throw new Error("Expected an exact Forbidden jewel query.");

    expect(query.query).toMatchObject({
      name: variant,
      type: baseType,
      stats: [{ type: "and", filters: [{ id: statId }] }],
    });
  });

  it("fails closed for a future Forbidden passive missing from the pinned stat pack", () => {
    expect(buildTradeQuery(row({
      name: "Unknown Future Passive",
      baseType: "Crimson Jewel",
      variant: "Forbidden Flame",
      categoryId: "forbidden-jewels",
    }))).toBeNull();
  });
});

describe("wiki links", () => {
  it("links combined Vaal variants to their real base gem page", () => {
    const url = poeWikiUrl(
      row({
        name: "Vaal Detonate Dead (Detonate Dead of Scavenging)",
        baseType: "Vaal Detonate Dead",
      }),
    );
    expect(url).toBe("https://www.poewiki.net/wiki/Vaal_Detonate_Dead");
  });
});

describe("official Trade links", () => {
  it("prefills Exchange with the selected currency instead of opening a blank page", () => {
    const url = new URL(tradeUrl(
      row({
        name: "Divine Orb",
        baseType: "Divine Orb",
        source: "exchange",
        stackSize: 10,
      }),
      "Allflame",
    )!);

    expect(url.pathname).toBe("/trade/exchange/Allflame");
    expect(JSON.parse(url.searchParams.get("q") || "null")).toEqual({
      exchange: {
        status: { option: "any" },
        have: ["chaos"],
        want: ["divine"],
      },
    });
  });

  it("falls back to an item search when an exchange row has no legacy trade tag", () => {
    const url = new URL(tradeUrl(
      row({
        name: "Entirely Fictional Orb",
        baseType: "Entirely Fictional Orb",
        source: "faustus",
      }),
      "Allflame",
    )!);

    expect(url.pathname).toBe("/trade/search/Allflame");
    expect(JSON.parse(url.searchParams.get("q") || "null")).toMatchObject({
      query: { type: "Entirely Fictional Orb" },
    });
  });
});
