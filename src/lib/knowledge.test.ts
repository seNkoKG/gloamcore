import { describe, expect, it } from "vitest";
import type { EconomyRow, KnowledgeEntry } from "../types";
import {
  craftOfExileUrl,
  isCraftableKnowledgeEntry,
  isCraftableMarketRow,
  knowledgeImageQuery,
  knowledgeImageTitles,
  knowledgeSearchQueries,
  knowledgeWikiUrl,
  normalizeKnowledgeImages,
  normalizeKnowledgeSearch,
  poeDbUrl,
  sanitizeKnowledgeQuery,
} from "./knowledge";

describe("knowledge search", () => {
  it("removes Cargo wildcard and string escape characters", () => {
    expect(sanitizeKnowledgeQuery('  Divine%_ Orb\\"  ')).toBe("Divine Orb");
    expect(sanitizeKnowledgeQuery("a\u0000b")).toBe("a b");
  });

  it("builds bounded current-game item and modifier queries", () => {
    const queries = knowledgeSearchQueries({ query: "maximum Life", limit: 500 });
    expect(queries.limit).toBe(40);
    expect(queries.items.get("tables")).toBe("items");
    expect(queries.items.get("where")).toContain("is_in_game=1");
    expect(queries.items.get("where")).toContain('class!="Cosmetic Item"');
    expect(queries.modifiers.get("tables")).toBe("mods");
    expect(queries.modifiers.get("where")).toContain("game_mode=0");
  });

  it("rejects searches that cannot produce useful results", () => {
    expect(() => knowledgeSearchQueries({ query: "x" })).toThrow(
      "Enter at least two letters",
    );
  });

  it("resolves Cargo file titles to trusted game artwork", () => {
    const items = {
      cargoquery: [
        {
          title: {
            name: "Mageblood",
            inventory_icon: "File:Mageblood inventory icon.png",
          },
        },
        {
          title: {
            name: "Armageddon Brand",
            "inventory icon": "Armageddon Brand inventory icon.png",
          },
        },
      ],
    };
    const titles = knowledgeImageTitles(items);
    expect(titles).toEqual([
      "File:Mageblood inventory icon.png",
      "File:Armageddon Brand inventory icon.png",
    ]);
    const query = knowledgeImageQuery(titles, 9_999);
    expect(query.get("prop")).toBe("imageinfo");
    expect(query.get("iiurlwidth")).toBe("256");

    const images = normalizeKnowledgeImages({
      query: {
        pages: [
          {
            title: "File:Mageblood inventory icon.png",
            imageinfo: [
              {
                mime: "image/png",
                url: "https://www.poewiki.net/images/c/c0/Mageblood_inventory_icon.png",
                thumburl:
                  "https://www.poewiki.net/images/thumb/c/c0/Mageblood_inventory_icon.png/128px-Mageblood_inventory_icon.png",
                dataUrl: "data:image/png;base64,bWFnZWJsb29k",
              },
            ],
          },
          {
            title: "File:Untrusted.png",
            imageinfo: [
              { mime: "image/png", url: "https://example.com/untrusted.png" },
            ],
          },
          {
            title: "File:Cached.png",
            imageinfo: [
              {
                mime: "image/png",
                url: "https://example.com/ignored.png",
                dataUrl: "data:image/png;base64,aGVsbG8=",
              },
            ],
          },
        ],
      },
    });
    expect(images.get("file:mageblood inventory icon.png")).toBe(
      "data:image/png;base64,bWFnZWJsb29k",
    );
    expect(images.has("file:untrusted.png")).toBe(false);
    expect(images.get("file:cached.png")).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
  });

  it("attaches resolved artwork to item results", () => {
    const results = normalizeKnowledgeSearch(
      {
        items: {
          cargoquery: [
            {
              title: {
                name: "Mageblood",
                class: "Belt",
                inventory_icon: "File:Mageblood inventory icon.png",
              },
            },
          ],
        },
        modifiers: { cargoquery: [] },
        images: {
          query: {
            pages: [
              {
                title: "File:Mageblood inventory icon.png",
                imageinfo: [
                  {
                    mime: "image/png",
                    url: "https://www.poewiki.net/images/c/c0/Mageblood_inventory_icon.png",
                    dataUrl: "data:image/png;base64,bWFnZWJsb29k",
                  },
                ],
              },
            ],
          },
        },
      },
      "Mageblood",
    );

    expect(results[0].icon).toBe(
      "data:image/png;base64,bWFnZWJsb29k",
    );
  });

  it("normalizes, deduplicates, and relevance-sorts Cargo records", () => {
    const results = normalizeKnowledgeSearch(
      {
        items: {
          cargoquery: [
            {
              title: {
                name: "Divine Orb",
                class: "Currency Item",
                description: "Randomises modifier values.",
                inventory_icon: "Divine Orb inventory icon.png",
                metadata_id: "Metadata/Items/Currency/CurrencyModValues",
                drop_areas: "Area One, Area Two",
                acquisition_tags: "currency, global",
                drop_enabled: "1",
              },
            },
            {
              title: {
                name: "Divine Orb",
                metadata_id: "Metadata/Items/Currency/CurrencyModValues",
              },
            },
          ],
        },
        modifiers: {
          cargoquery: [
            {
              title: {
                id: "LocalDivineTest",
                name: "Divine test",
                stat_text_raw: "+# to Divine power",
                generation_type: "1",
                domain: "13",
                mod_groups: "DivineGroup",
                tags: "caster, jewellery",
                required_level: "42",
              },
            },
          ],
        },
      },
      "Divine Orb",
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      kind: "item",
      name: "Divine Orb",
      itemClass: "Currency Item",
      dropAreas: ["Area One", "Area Two"],
      acquisitionTags: ["currency", "global"],
      dropEnabled: true,
      icon: undefined,
    });
    expect(results[1]).toMatchObject({
      kind: "modifier",
      generationType: "Prefix",
      generationTypeId: 1,
      modifierDomain: "Abyss jewel",
      modifierDomainId: 13,
      requiredLevel: 42,
      tags: ["caster", "jewellery"],
    });
  });

  it("creates trusted handoff links and identifies craftable records", () => {
    const item: KnowledgeEntry = {
      key: "item:test",
      kind: "item",
      name: "Vaal Regalia",
      itemClass: "Body Armour",
      modifierGroups: [],
      tags: [],
      dropAreas: [],
      dropMonsters: [],
      acquisitionTags: [],
      source: "poewiki",
    };
    const modifier: KnowledgeEntry = {
      ...item,
      key: "modifier:test",
      kind: "modifier",
      name: "+# to maximum Life",
      itemClass: undefined,
    };

    expect(knowledgeWikiUrl(item)).toBe("https://www.poewiki.net/wiki/Vaal_Regalia");
    expect(poeDbUrl(item)).toBe("https://poedb.tw/us/Vaal_Regalia");
    expect(craftOfExileUrl()).toBe("https://www.craftofexile.com/en/");
    expect(isCraftableKnowledgeEntry(item)).toBe(true);
    expect(isCraftableKnowledgeEntry(modifier)).toBe(true);
  });

  it("only offers the market craft handoff for crafting bases", () => {
    const row = { categoryId: "base-types" } as EconomyRow;
    expect(isCraftableMarketRow(row)).toBe(true);
    expect(isCraftableMarketRow({ ...row, categoryId: "currency" })).toBe(false);
    expect(isCraftableMarketRow({ ...row, categoryId: "uniques" }, "Ring")).toBe(true);
  });
});
