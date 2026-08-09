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

    expect(query.query).toMatchObject({
      name: "The Squire",
      type: "Elegant Round Shield",
      stats: [
        {
          type: "and",
          filters: [{ id: "explicit.stat_123" }],
        },
      ],
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
    expect(query.query).toMatchObject({ term: "Iron Nadir" });
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
    ));

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
    ));

    expect(url.pathname).toBe("/trade/search/Allflame");
    expect(JSON.parse(url.searchParams.get("q") || "null")).toMatchObject({
      query: { type: "Entirely Fictional Orb" },
    });
  });
});
