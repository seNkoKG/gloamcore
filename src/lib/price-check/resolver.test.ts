import { describe, expect, it } from "vitest";
import type { EconomyRow } from "../../types";
import { estimatePriceCheck } from "./estimator";
import { malachaisLoopVestigialFixture } from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import { resolvePriceCheckMatches, scorePriceCheckMatch } from "./resolver";
import type { ParsedPoeItem } from "./types";

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
    key: "skill-gems:fireball",
    id: "fireball",
    name: "Fireball",
    baseType: "Fireball",
    categoryId: "skill-gems",
    categoryLabel: "Skill Gems",
    source: "stash-item",
    chaosValue: 10,
    divineValue: 0.05,
    change: null,
    sparkline: [],
    volume: null,
    listingCount: 20,
    observationCount: 20,
    gemLevel: 20,
    gemQuality: 20,
    corrupted: false,
    implicitModifiers: [],
    explicitModifiers: [],
    mutatedModifiers: [],
    lowConfidence: false,
    ...patch,
  };
}

describe("price-check market resolver", () => {
  it("matches specialized cluster and forbidden rows by copied enchant/passive text", () => {
    const clusterItem = item({
      rarity: "rare",
      name: "Doom Ornament",
      baseType: "Large Cluster Jewel",
      itemClass: "Jewel",
      rawText: "Added Small Passive Skills grant: Minions deal 10% increased Damage\nAdds 12 Passive Skills",
    });
    const clusterRow = row({
      key: "cluster",
      name: "Minions deal 10% increased Damage",
      baseType: "Large Cluster Jewel",
      variant: "12 passives",
      categoryId: "cluster-jewels",
    });
    expect(resolvePriceCheckMatches(clusterItem, [clusterRow])[0]?.row.key).toBe("cluster");

    const forbiddenItem = item({
      rarity: "unique",
      name: "Forbidden Flame",
      baseType: "Crimson Jewel",
      itemClass: "Jewel",
      rawText: "Allocates Heart of Destruction if you have the matching modifier on Forbidden Flesh",
    });
    const forbiddenRow = row({
      key: "forbidden",
      name: "Heart of Destruction",
      baseType: "Crimson Jewel",
      variant: "Forbidden Flame",
      categoryId: "forbidden-jewels",
    });
    expect(resolvePriceCheckMatches(forbiddenItem, [forbiddenRow])[0]?.row.key).toBe("forbidden");
  });
  it("finds exact rows across nested category arrays", () => {
    const matches = resolvePriceCheckMatches(item(), [
      [row({ key: "currency:fire", name: "Orb of Fire", categoryId: "currency" })],
      [row()],
    ]);
    expect(matches[0]).toMatchObject({ kind: "exact", row: { name: "Fireball" } });
    expect(matches[0].score).toBeGreaterThan(85);
  });

  it("strongly prefers the correct gem level and quality", () => {
    const matches = resolvePriceCheckMatches(item(), [
      row({ key: "wrong-level", gemLevel: 21 }),
      row({ key: "wrong-quality", gemQuality: 0 }),
      row({ key: "correct" }),
    ]);
    expect(matches[0].row.key).toBe("correct");
    expect(matches.find((match) => match.row.key === "wrong-level")!.score).toBeLessThan(
      matches[0].score - 20,
    );
    expect(matches.find((match) => match.row.key === "wrong-quality")!.score).toBeLessThan(
      matches[0].score - 35,
    );
  });

  it("matches Wombgift variants by copied item level", () => {
    const wombgift = item({
      rawText: "Item Class: Wombgifts\nRarity: Normal\nLavish Wombgift\nItem Level: 40",
      itemClass: "Wombgifts",
      rarity: "normal",
      name: "Lavish Wombgift",
      baseType: "Lavish Wombgift",
      itemLevel: 40,
      gemLevel: undefined,
      quality: undefined,
    });
    const matches = resolvePriceCheckMatches(wombgift, [
      row({
        key: "wombgifts:lavish:84",
        name: "Lavish Wombgift",
        baseType: "Lavish Wombgift",
        categoryId: "wombgifts",
        levelRequired: 84,
        gemLevel: undefined,
        gemQuality: undefined,
      }),
      row({
        key: "wombgifts:lavish:40",
        name: "Lavish Wombgift",
        baseType: "Lavish Wombgift",
        categoryId: "wombgifts",
        levelRequired: 40,
        gemLevel: undefined,
        gemQuality: undefined,
      }),
    ]);

    expect(matches[0].row.key).toBe("wombgifts:lavish:40");
    expect(matches[0].reasons).toContain("item level 40 matches");
    expect(
      matches.find((match) => match.row.key === "wombgifts:lavish:84"),
    ).toBeUndefined();
  });

  it("penalizes the wrong corruption state", () => {
    const correct = scorePriceCheckMatch(item({ corrupted: true }), row({ corrupted: true }))!;
    const wrong = scorePriceCheckMatch(item({ corrupted: true }), row({ corrupted: false }))!;
    expect(correct.kind).toBe("exact");
    expect(wrong.kind).toBe("variant");
    expect(correct.score - wrong.score).toBeGreaterThanOrEqual(45);
    expect(wrong.reasons).toContain("corruption state differs");
  });

  it("strongly distinguishes socket-link states", () => {
    const sixLink = item({
      rawText: "Item Class: Body Armours\nRarity: Unique\nShavronne's Wrappings\nOccultist's Vestment\nSockets: B-B-B-B-B-B",
      rarity: "unique",
      itemClass: "Body Armours",
      name: "Shavronne's Wrappings",
      baseType: "Occultist's Vestment",
      links: 6,
    });
    const rows = [
      row({ key: "five", name: "Shavronne's Wrappings", baseType: "Occultist's Vestment", categoryId: "unique-armours", links: 5 }),
      row({ key: "six", name: "Shavronne's Wrappings", baseType: "Occultist's Vestment", categoryId: "unique-armours", variant: "6 Links", links: 6 }),
    ];
    expect(resolvePriceCheckMatches(sixLink, rows)[0].row.key).toBe("six");

    const compactVariant = resolvePriceCheckMatches(sixLink, [
      row({ key: "six-l", name: "Shavronne's Wrappings", baseType: "Occultist's Vestment", categoryId: "unique-armours", variant: "6L", links: 6 }),
    ]);
    expect(compactVariant[0]?.row.key).toBe("six-l");
  });

  it("strongly distinguishes map tiers", () => {
    const map = item({ rarity: "normal", itemClass: "Maps", name: "Dunes Map", baseType: "Dunes Map", mapTier: 16, gemLevel: undefined, quality: undefined });
    const rows = [
      row({ key: "t12", name: "Dunes Map", baseType: "Dunes Map", categoryId: "maps", mapTier: 12, gemLevel: undefined, gemQuality: undefined }),
      row({ key: "t16", name: "Dunes Map", baseType: "Dunes Map", categoryId: "maps", mapTier: 16, gemLevel: undefined, gemQuality: undefined }),
    ];
    expect(resolvePriceCheckMatches(map, rows)[0].row.key).toBe("t16");
    expect(resolvePriceCheckMatches(map, rows).find((match) => match.row.key === "t12")).toBeUndefined();
  });

  it("does not confuse replica and original unique variants", () => {
    const replica = item({ rarity: "unique", itemClass: "Body Armours", name: "Replica Farrul's Fur", baseType: "Triumphant Lamellar", replica: true, gemLevel: undefined, quality: 20 });
    const rows = [
      row({ key: "original", name: "Farrul's Fur", baseType: "Triumphant Lamellar", categoryId: "unique-armours", gemLevel: undefined, gemQuality: undefined }),
      row({ key: "replica", name: "Replica Farrul's Fur", baseType: "Triumphant Lamellar", categoryId: "unique-armours", gemLevel: undefined, gemQuality: undefined }),
    ];
    const matches = resolvePriceCheckMatches(replica, rows);
    expect(matches[0].row.key).toBe("replica");
    expect(matches.find((match) => match.row.key === "original")?.score ?? 0).toBeLessThan(45);
  });

  it("requires an explicit Foulborn market row", () => {
    const foulborn = item({
      rarity: "unique",
      itemClass: "Belts",
      name: "Mageblood",
      baseType: "Heavy Belt",
      foulborn: true,
      gemLevel: undefined,
      quality: undefined,
    });
    const matches = resolvePriceCheckMatches(foulborn, [
      row({ key: "clean", name: "Mageblood", baseType: "Heavy Belt", categoryId: "unique-accessories" }),
      row({ key: "foulborn", name: "Foulborn Mageblood", baseType: "Heavy Belt", categoryId: "unique-accessories" }),
    ]);
    expect(matches.map((match) => match.row.key)).toEqual(["foulborn"]);
  });

  it("suppresses the clean poe.ninja aggregate for a Vestigial unique", () => {
    const vestigial = parsePoeItem(malachaisLoopVestigialFixture);
    const cleanAggregate = row({
      key: "unique-armours:malachais-loop",
      name: "Malachai's Loop",
      baseType: "Harmonic Spirit Shield",
      categoryId: "unique-armours",
      chaosValue: 2,
      divineValue: 0.01,
      listingCount: 2_619,
      observationCount: 399,
      explicitModifiers: [
        { text: "(210-250)% increased Energy Shield" },
        { text: "+2 to Maximum Power Charges" },
        { text: "20% chance to gain a Power Charge on Hit" },
        { text: "(12-16)% increased Spell Damage per Power Charge" },
        { text: "Lose all Power Charges on reaching Maximum Power Charges" },
        { text: "Shocks you when you reach Maximum Power Charges" },
      ],
    });

    expect(vestigial).toMatchObject({
      rarity: "unique",
      name: "Malachai's Loop",
      baseType: "Harmonic Spirit Shield",
      vestigial: true,
    });
    const matches = resolvePriceCheckMatches(vestigial, [cleanAggregate]);
    expect(matches).toEqual([]);
    expect(estimatePriceCheck(vestigial, matches)).toMatchObject({
      chaosValue: null,
      confidence: "none",
      label: "no reliable estimate",
    });
  });

  it("does not confuse a Foil item state with the Jewelled Foil base type", () => {
    const cleanCospri = item({
      rawText: "Item Class: One Hand Swords\nRarity: Unique\nCospri's Malice\nJewelled Foil",
      rarity: "unique",
      itemClass: "One Hand Swords",
      name: "Cospri's Malice",
      baseType: "Jewelled Foil",
      gemLevel: undefined,
      quality: 20,
    });
    const normalAggregate = row({
      key: "unique-weapons:cospris-malice",
      name: "Cospri's Malice",
      baseType: "Jewelled Foil",
      categoryId: "unique-weapons",
      chaosValue: 8,
      divineValue: 0.04,
    });

    expect(scorePriceCheckMatch(cleanCospri, normalAggregate)).toMatchObject({
      kind: "exact",
    });
    expect(scorePriceCheckMatch(
      { ...cleanCospri, foil: true, rawText: `${cleanCospri.rawText}\nFoil Unique` },
      normalAggregate,
    )).toBeNull();
  });

  it("keeps dedicated Foulborn rows exact on a base whose name contains Foil", () => {
    const foulbornCospri = item({
      rawText: [
        "Item Class: One Hand Swords",
        "Rarity: Unique",
        "Foulborn Cospri's Malice",
        "Jewelled Foil",
        "No Physical Damage",
        "Foulborn Item",
      ].join("\n"),
      rarity: "unique",
      itemClass: "One Hand Swords",
      name: "Foulborn Cospri's Malice",
      baseType: "Jewelled Foil",
      foulborn: true,
      gemLevel: undefined,
      quality: 20,
    });
    const matches = resolvePriceCheckMatches(foulbornCospri, [
      row({
        key: "clean-cospri",
        name: "Cospri's Malice",
        baseType: "Jewelled Foil",
        categoryId: "unique-weapons",
      }),
      row({
        key: "foulborn-cospri",
        name: "Foulborn Cospri's Malice",
        baseType: "Jewelled Foil",
        variant: "Elemental Attack",
        categoryId: "unique-weapons",
        mutatedModifiers: [{ text: "No Physical Damage" }],
      }),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      kind: "exact",
      row: { key: "foulborn-cospri" },
    });
  });

  it("does not assign named unique rows to an unidentified base", () => {
    const unidentified = item({
      rarity: "unique",
      itemClass: "Belts",
      name: "",
      baseType: "Heavy Belt",
      identified: false,
      gemLevel: undefined,
      quality: undefined,
    });
    expect(resolvePriceCheckMatches(unidentified, [
      row({ name: "Mageblood", baseType: "Heavy Belt", categoryId: "unique-accessories" }),
    ])).toEqual([]);
  });

  it("does not show unrelated uniques that share the same base type", () => {
    const mageblood = item({
      rarity: "unique",
      itemClass: "Belts",
      name: "Mageblood",
      baseType: "Heavy Belt",
      gemLevel: undefined,
      quality: undefined,
    });
    const matches = resolvePriceCheckMatches(mageblood, [
      row({ key: "mageblood", name: "Mageblood", baseType: "Heavy Belt", categoryId: "unique-accessories" }),
      row({ key: "doryani", name: "Doryani's Invitation", baseType: "Heavy Belt", categoryId: "unique-accessories" }),
      row({ key: "deceiver", name: "Belt of the Deceiver", baseType: "Heavy Belt", categoryId: "unique-accessories" }),
    ]);

    expect(matches.map((match) => match.row.key)).toEqual(["mageblood"]);
  });

  it("keeps single-digit unique variants separate", () => {
    const mageblood = item({
      rawText: [
        "Item Class: Belts",
        "Rarity: Unique",
        "Mageblood",
        "Heavy Belt",
        "Adds 3 to 5 Physical Damage",
        "Leftmost 4 Magic Utility Flasks constantly apply their Flask Effects to you",
      ].join("\n"),
      rarity: "unique",
      itemClass: "Belts",
      name: "Mageblood",
      baseType: "Heavy Belt",
      gemLevel: undefined,
      quality: undefined,
    });
    const matches = resolvePriceCheckMatches(mageblood, [
      row({
        key: "three-flasks",
        name: "Mageblood",
        baseType: "Heavy Belt",
        variant: "3 Flask",
        categoryId: "unique-accessories",
        gemLevel: undefined,
        gemQuality: undefined,
      }),
      row({
        key: "four-flasks",
        name: "Mageblood",
        baseType: "Heavy Belt",
        variant: "4 Flask",
        categoryId: "unique-accessories",
        gemLevel: undefined,
        gemQuality: undefined,
      }),
    ]);

    expect(matches.map((match) => match.row.key)).toEqual(["four-flasks"]);
    expect(matches[0]?.reasons).toContain("variant matches: 4 Flask");
  });

  it("uses structured unique modifiers when display variant labels are misleading", () => {
    const shroud = item({
      rawText: "Item Class: Body Armours\nRarity: Unique\nShroud of the Lightless\nCarnal Armour\nHas 2 Abyssal Sockets",
      rarity: "unique",
      itemClass: "Body Armours",
      name: "Shroud of the Lightless",
      baseType: "Carnal Armour",
      gemLevel: undefined,
      quality: undefined,
    });
    const matches = resolvePriceCheckMatches(shroud, [
      row({
        key: "one-jewel-label",
        name: "Shroud of the Lightless",
        baseType: "Carnal Armour",
        variant: "1 Jewel",
        categoryId: "unique-armours",
        explicitModifiers: [{ text: "Has 3 Abyssal Sockets" }],
        gemLevel: undefined,
        gemQuality: undefined,
      }),
      row({
        key: "two-jewel-label",
        name: "Shroud of the Lightless",
        baseType: "Carnal Armour",
        variant: "2 Jewels",
        categoryId: "unique-armours",
        explicitModifiers: [{ text: "Has 2 Abyssal Sockets" }],
        gemLevel: undefined,
        gemQuality: undefined,
      }),
    ]);

    expect(matches.map((match) => match.row.key)).toEqual(["two-jewel-label"]);
  });

  it("requires the complete structured Foulborn mutation set", () => {
    const foulbornSquire = item({
      rawText: [
        "Item Class: Shields",
        "Rarity: Unique",
        "Foulborn The Squire",
        "Elegant Round Shield",
        "+2 to Level of Socketed Support Gems",
        "Socketed Gems have no Attribute Requirements",
      ].join("\n"),
      rarity: "unique",
      itemClass: "Shields",
      name: "Foulborn The Squire",
      baseType: "Elegant Round Shield",
      foulborn: true,
      gemLevel: undefined,
      quality: undefined,
    });
    const gemLevel = { text: "+2 to Level of Socketed Support Gems" };
    const noRequirements = { text: "Socketed Gems have no Attribute Requirements" };
    const matches = resolvePriceCheckMatches(foulbornSquire, [
      row({
        key: "partial-mutation",
        name: "Foulborn The Squire",
        baseType: "Elegant Round Shield",
        variant: "Gem Level",
        categoryId: "unique-accessories",
        mutatedModifiers: [gemLevel],
        gemLevel: undefined,
        gemQuality: undefined,
      }),
      row({
        key: "complete-mutations",
        name: "Foulborn The Squire",
        baseType: "Elegant Round Shield",
        variant: "Gem Level, No Requirements",
        categoryId: "unique-accessories",
        mutatedModifiers: [gemLevel, noRequirements],
        gemLevel: undefined,
        gemQuality: undefined,
      }),
    ]);

    expect(matches.map((match) => match.row.key)).toEqual(["complete-mutations"]);
    expect(matches[0]?.reasons).toContain("2 Foulborn mutations match");
  });

  it("does not contaminate mutation evidence with unrelated market rows", () => {
    const foulbornSquire = item({
      rawText: [
        "Item Class: Shields",
        "Rarity: Unique",
        "Foulborn The Squire",
        "Elegant Round Shield",
        "+1 to Level of Socketed Gems",
        "10% increased Movement Speed",
      ].join("\n"),
      rarity: "unique",
      itemClass: "Shields",
      name: "Foulborn The Squire",
      baseType: "Elegant Round Shield",
      foulborn: true,
      gemLevel: undefined,
      quality: undefined,
    });
    const matches = resolvePriceCheckMatches(foulbornSquire, [
      row({
        key: "correct-squire",
        name: "Foulborn The Squire",
        baseType: "Elegant Round Shield",
        categoryId: "unique-armours",
        mutatedModifiers: [{ text: "+1 to Level of Socketed Gems" }],
        gemLevel: undefined,
        gemQuality: undefined,
      }),
      row({
        key: "unrelated-mutation",
        name: "Foulborn Seven-League Step",
        baseType: "Rawhide Boots",
        categoryId: "unique-armours",
        mutatedModifiers: [{ text: "10% increased Movement Speed" }],
        gemLevel: undefined,
        gemQuality: undefined,
      }),
    ]);

    expect(matches.map((match) => match.row.key)).toEqual(["correct-squire"]);
    expect(matches[0]?.reasons).toContain("1 Foulborn mutations match");
  });

  it("matches a rare item to its base instead of its generated name", () => {
    const rare = item({ rarity: "rare", itemClass: "Wands", name: "Doom Needle", baseType: "Imbued Wand", gemLevel: undefined, quality: 20 });
    const matches = resolvePriceCheckMatches(rare, [
      row({ key: "base", name: "Imbued Wand", baseType: "Imbued Wand", categoryId: "base-types", gemLevel: undefined, gemQuality: undefined }),
      row({ key: "random-name", name: "Doom Needle", baseType: "Opal Wand", categoryId: "base-types", gemLevel: undefined, gemQuality: undefined }),
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "base", row: { key: "base" } });
  });

  it("allows conservative fuzzy recovery but ranks it below exact identity", () => {
    const copied = item({ name: "Exceptional Eldritch Ember", baseType: "Exceptional Eldritch Ember", itemClass: "Stackable Currency", rarity: "currency", gemLevel: undefined, quality: undefined });
    const exact = row({ key: "exact", name: "Exceptional Eldritch Ember", categoryId: "currency", gemLevel: undefined, gemQuality: undefined });
    const fuzzy = row({ key: "fuzzy", name: "Exceptional Eldritch Ichor", categoryId: "currency", gemLevel: undefined, gemQuality: undefined });
    const matches = resolvePriceCheckMatches(copied, [fuzzy, exact]);
    expect(matches[0].row.key).toBe("exact");
    expect(matches.find((match) => match.row.key === "fuzzy")?.kind).toBe("fuzzy");
  });

  it("is deterministic and deduplicates rows by key", () => {
    const rows = [row({ key: "same", chaosValue: 1 }), row({ key: "same", chaosValue: 99 })];
    const first = resolvePriceCheckMatches(item(), rows);
    const second = resolvePriceCheckMatches(item(), rows);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
  });

  it("returns no matches for invalid clipboard items", () => {
    expect(resolvePriceCheckMatches(item({ valid: false }), [row()])).toEqual([]);
  });
});
