import { describe, expect, it } from "vitest";
import {
  armourBaseProfile,
  hasUniqueFixedStatMetadata,
  hasUniqueModifierProfile,
  gemIdentityProfile,
  isFixedUniqueModifier,
  isExchangeableItem,
  isCraftableBaseType,
  magicBaseTypeCatalogSize,
  pickCorrectPinnedVariant,
  resolveMagicBaseType,
  resolveTradeTag,
  tradeTagCatalogSize,
  uniqueModifierMetadataPolicy,
  uniqueIdentityProfile,
  uniqueIdentityProfilesForBase,
  uniqueModifierProfileCount,
} from "./magic-base-type";
import type { ParsedPoeModifier } from "./types";

function canonicalModifier(
  kind: ParsedPoeModifier["kind"],
  tradeStatRef: string,
): ParsedPoeModifier {
  return {
    id: `${kind}-${tradeStatRef}`,
    kind,
    text: tradeStatRef,
    normalizedText: tradeStatRef,
    values: [],
    selectedByDefault: false,
    tags: [],
    advanced: true,
    tradeStatRef,
  };
}

describe("pinned magic base-type catalog", () => {
  it("ships the pinned craftable item set", () => {
    expect(magicBaseTypeCatalogSize()).toBeGreaterThan(1_000);
    expect(uniqueModifierProfileCount()).toBeGreaterThan(1_200);
    expect(tradeTagCatalogSize()).toBeGreaterThan(600);
  });

  it("resolves exact pinned bulk tags without class-name guesses", () => {
    expect(resolveTradeTag("Aberrant Fossil")).toBe("aberrant-fossil");
    expect(resolveTradeTag("Foulborn Divine Orb", "Divine Orb")).toBe("divine");
    expect(resolveTradeTag("Entirely Fictional Orb")).toBeUndefined();
  });

  it("distinguishes exchangeable items that have no legacy bulk tag", () => {
    expect(isExchangeableItem("Aberrant Fossil")).toBe(true);
    expect(isExchangeableItem("A Chilling Wind")).toBe(true);
    expect(resolveTradeTag("A Chilling Wind")).toBeUndefined();
    expect(isExchangeableItem("Entirely Fictional Card")).toBe(false);
  });

  it("preserves reusable unique identity and gem discriminator metadata", () => {
    expect(uniqueIdentityProfile("Mageblood")).toMatchObject({
      name: "Mageblood",
      baseType: "Heavy Belt",
    });
    expect(uniqueIdentityProfilesForBase("Heavy Belt").map((profile) => profile.name))
      .toContain("Mageblood");
    expect(gemIdentityProfile("Absolution of Inspiring")).toEqual({
      maxLevel: 20,
      transfigured: true,
      normalVariant: "Absolution",
      tradeDisc: "alt_x",
    });
  });

  it("selects all pinned discriminator strategies in source order", () => {
    const variants = [
      { id: "fallback", disc: { sectionText: "not copied" } },
      { id: "armour", disc: { propAR: true as const } },
      { id: "evasion", disc: { propEV: true as const } },
      { id: "energy-shield", disc: { propES: true as const } },
      { id: "white-map", disc: { mapTier: "W" as const } },
      { id: "yellow-map", disc: { mapTier: "Y" as const } },
      { id: "red-map", disc: { mapTier: "R" as const } },
      { id: "implicit", disc: { hasImplicit: { ref: "implicit ref" } } },
      { id: "explicit", disc: { hasExplicit: { ref: "explicit ref" } } },
      { id: "section", disc: { sectionText: "copied section" } },
    ];
    expect(pickCorrectPinnedVariant(variants, {
      properties: { Armour: "100" },
    })?.id).toBe("armour");
    expect(pickCorrectPinnedVariant(variants, {
      properties: { "Evasion Rating": "100" },
    })?.id).toBe("evasion");
    expect(pickCorrectPinnedVariant(variants, {
      properties: { "Energy Shield": "100" },
    })?.id).toBe("energy-shield");
    expect(pickCorrectPinnedVariant(variants, {
      properties: { Armour: "100", "Evasion Rating": "100" },
    })?.id).toBe("evasion");
    expect(pickCorrectPinnedVariant(variants)?.id).toBe("fallback");
    expect(pickCorrectPinnedVariant(variants, { mapTier: 5 })?.id).toBe("white-map");
    expect(pickCorrectPinnedVariant(variants, { mapTier: 6 })?.id).toBe("yellow-map");
    expect(pickCorrectPinnedVariant(variants, { mapTier: 11 })?.id).toBe("red-map");
    expect(pickCorrectPinnedVariant(variants, {
      modifiers: [canonicalModifier("implicit", "implicit ref")],
    })?.id).toBe("implicit");
    expect(pickCorrectPinnedVariant(variants, {
      modifiers: [canonicalModifier("explicit", "explicit ref")],
    })?.id).toBe("explicit");
    expect(pickCorrectPinnedVariant(variants, {
      rawText: "prefix copied section suffix",
    })?.id).toBe("section");
    expect(pickCorrectPinnedVariant([
      { id: "first", baseType: "First Base" },
      { id: "second", baseType: "Second Base" },
    ], { baseType: "Second Base" })?.id).toBe("second");
    expect(pickCorrectPinnedVariant([
      { id: "first" },
      { id: "ignored", disc: { propAR: true as const } },
    ], { properties: { Armour: "100" } })?.id).toBe("first");
  });

  it("selects all three Two-Toned Boots defence profiles", () => {
    expect(armourBaseProfile("Two-Toned Boots", {
      properties: { "Evasion Rating": "130", "Energy Shield": "28" },
    })).toEqual({ ev: [126, 145], es: [26, 30] });
    expect(armourBaseProfile("Two-Toned Boots", {
      properties: { Armour: "130", "Evasion Rating": "130" },
    })).toEqual({ ar: [126, 145], ev: [126, 145] });
    expect(armourBaseProfile("Two-Toned Boots", {
      properties: { Armour: "130", "Energy Shield": "28" },
    })).toEqual({ ar: [126, 145], es: [26, 30] });
  });

  it("selects multi-base unique identity and icon from the copied base", () => {
    expect(uniqueIdentityProfile("Combat Focus")).toBeUndefined();
    const viridian = uniqueIdentityProfile("Combat Focus", {
      baseType: "Viridian Jewel",
    });
    const crimson = uniqueIdentityProfile("Combat Focus", {
      baseType: "Crimson Jewel",
    });
    expect(viridian).toMatchObject({
      name: "Combat Focus",
      baseType: "Viridian Jewel",
    });
    expect(crimson).toMatchObject({
      name: "Combat Focus",
      baseType: "Crimson Jewel",
    });
    expect(viridian?.icon).not.toBe(crimson?.icon);
    expect(uniqueIdentityProfilesForBase("Viridian Jewel")
      .find((profile) => profile.name === "Combat Focus"))
      .toEqual(viridian);
  });

  it("finds the longest embedded base inside prefix and suffix affixes", () => {
    expect(resolveMagicBaseType(
      "Subterranean Vaal Regalia of the Underground",
    )).toBe("Vaal Regalia");
    expect(resolveMagicBaseType("Glimmering Ruby Ring")).toBe("Ruby Ring");
  });

  it("does not guess an unknown affixed name", () => {
    expect(resolveMagicBaseType("Entirely Fictional Thing of Testing")).toBeUndefined();
  });

  it("exposes the pinned craftable-item predicate", () => {
    expect(isCraftableBaseType("Heavy Belt")).toBe(true);
    expect(isCraftableBaseType("Glimmering Ruby Ring", "Ruby Ring")).toBe(true);
    expect(isCraftableBaseType("Aberrant Fossil")).toBe(false);
  });

  it("distinguishes fixed unique boilerplate from roll-sensitive jewel effects", () => {
    expect(isFixedUniqueModifier(
      "Watcher's Eye",
      "#% increased maximum Life",
    )).toBe(true);
    expect(isFixedUniqueModifier(
      "Watcher's Eye",
      "+#% to Critical Strike Multiplier while affected by Precision",
    )).toBe(false);
    expect(isFixedUniqueModifier("Glorious Vanity", "Historic")).toBe(true);
    expect(isFixedUniqueModifier(
      "Cinderswallow Urn",
      "+# to Maximum Charges",
    )).toBe(true);
    expect(isFixedUniqueModifier(
      "Cinderswallow Urn",
      "+20 to Maximum Charges",
    )).toBe(false);
  });

  it.each([
    "Brutal Restraint",
    "Elegant Hubris",
    "Glorious Vanity",
    "Heroic Tragedy",
    "Lethal Pride",
    "Militant Faith",
  ])("ships current Historic metadata for %s", (name) => {
    expect(uniqueModifierMetadataPolicy(name))
      .toBe("non-fixed-explicit-variants");
    expect(isFixedUniqueModifier(name, "Historic")).toBe(true);
  });

  it("distinguishes known unique identities from safe unknown fallbacks", () => {
    expect(hasUniqueModifierProfile("Mageblood")).toBe(true);
    expect(hasUniqueModifierProfile("Foulborn Mageblood")).toBe(true);
    expect(hasUniqueModifierProfile("Repentance")).toBe(true);
    expect(hasUniqueModifierProfile("Watcher's Eye")).toBe(true);
    expect(hasUniqueModifierProfile("Thread of Hope")).toBe(true);
    expect(hasUniqueModifierProfile("Entirely Fictional Unique")).toBe(false);
  });

  it("preserves absent, explicitly empty, and populated fixed-stat metadata", () => {
    expect(hasUniqueFixedStatMetadata("Mageblood")).toBe(false);
    expect(hasUniqueFixedStatMetadata("Thread of Hope")).toBe(false);
    expect(hasUniqueFixedStatMetadata("Foulborn Mageblood")).toBe(false);
    expect(hasUniqueFixedStatMetadata("That Which Was Taken")).toBe(true);
    expect(hasUniqueFixedStatMetadata("The Light of Meaning")).toBe(true);
    expect(hasUniqueFixedStatMetadata("Watcher's Eye")).toBe(true);
    expect(hasUniqueFixedStatMetadata("Entirely Fictional Unique")).toBe(false);
    expect(uniqueModifierMetadataPolicy("Mageblood"))
      .toBe("source-bounds-only");
    expect(uniqueModifierMetadataPolicy("That Which Was Taken"))
      .toBe("all-explicit-variants");
    expect(uniqueModifierMetadataPolicy("Watcher's Eye"))
      .toBe("non-fixed-explicit-variants");
  });
});
