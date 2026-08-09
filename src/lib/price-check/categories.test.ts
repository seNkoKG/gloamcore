import { describe, expect, it } from "vitest";
import { priceCheckCategoryCandidates } from "./categories";
import type { ParsedPoeItem } from "./types";

function item(overrides: Partial<ParsedPoeItem>): ParsedPoeItem {
  return {
    rawText: "",
    language: "en",
    valid: true,
    itemClass: "",
    rarity: "unknown",
    name: "",
    baseType: "",
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
    ...overrides,
  };
}

describe("price-check category routing", () => {
  it.each(["rare", "magic"] as const)(
    "does not fetch aggregate base values for %s equipment",
    (rarity) => {
      expect(
        priceCheckCategoryCandidates(
          item({
            itemClass: "Body Armours",
            rarity,
            name: rarity === "rare" ? "Doom Shelter" : "Shimmering Astral Plate",
            baseType: "Astral Plate",
          }),
        ),
      ).toEqual([]);
    },
  );

  it("routes currency without downloading every market", () => {
    expect(
      priceCheckCategoryCandidates(
        item({ itemClass: "Stackable Currency", rarity: "currency", name: "Divine Orb" }),
      ).map((entry) => entry.category.id),
    ).toEqual(["currency", "fragments"]);
  });

  it("routes unique weapons without eagerly downloading the huge base market", () => {
    expect(
      priceCheckCategoryCandidates(
        item({ itemClass: "One Hand Swords", rarity: "unique", name: "The Saviour" }),
      ).map((entry) => entry.category.id),
    ).toEqual(["unique-weapons"]);
  });

  it.each([
    ["Helmets", "Memory Vault", "unique-armours"],
    ["Staves", "The Annihilating Light", "unique-weapons"],
    ["Fishing Rods", "Song of the Sirens", "unique-weapons"],
  ])("routes the unique %s / %s by item class", (itemClass, name, expected) => {
    expect(
      priceCheckCategoryCandidates(
        item({ itemClass, rarity: "unique", name, baseType: itemClass }),
      )[0].category.id,
    ).toBe(expected);
  });

  it.each([
    ["Wombgifts", "The Wombgift", "wombgifts"],
    ["Stackable Currency", "Golden Ducat", "ducats"],
    ["Stackable Currency", "Enshrouding Crystal", "enshrouding-crystals"],
    ["Stackable Currency", "Grand Astrolabe", "astrolabes"],
    ["Jewel", "Forbidden Flame", "forbidden-jewels"],
    ["Jewel", "Large Cluster Jewel", "cluster-jewels"],
    ["Maps", "Chronicle of Atzoatl", "temples"],
    ["Stackable Currency", "Valdo's Puzzle Box", "fragments"],
    ["Stackable Currency", "Vial of Sacrifice", "vials"],
  ])("routes %s / %s to its specialized market", (itemClass, name, expected) => {
    expect(
      priceCheckCategoryCandidates(item({ itemClass, name, baseType: name }))[0]
        .category.id,
    ).toBe(expected);
  });

  it("keeps opened Valdo maps in their own stash market", () => {
    expect(
      priceCheckCategoryCandidates(
        item({
          itemClass: "Maps",
          rarity: "normal",
          name: "Cursed Spires",
          baseType: "Valdo Map",
        }),
      ).map((entry) => entry.category.id),
    ).toEqual(["valdo-maps", "maps"]);
  });

  it("never mistakes a Puzzle Box for an opened Valdo map", () => {
    const categories = priceCheckCategoryCandidates(
      item({
        itemClass: "Maps",
        rarity: "currency",
        name: "Valdo's Puzzle Box",
        baseType: "Valdo's Puzzle Box",
      }),
    ).map((entry) => entry.category.id);
    expect(categories[0]).toBe("fragments");
    expect(categories).not.toContain("valdo-maps");
  });

  it("routes gems and maps to their specialized markets", () => {
    expect(
      priceCheckCategoryCandidates(
        item({ itemClass: "Support Gems", rarity: "gem", name: "Awakened Added Fire Damage Support" }),
      )[0].category.id,
    ).toBe("skill-gems");
    expect(
      priceCheckCategoryCandidates(
        item({ itemClass: "Maps", rarity: "normal", baseType: "Dunes Map" }),
      )[0].category.id,
    ).toBe("maps");
  });
});
