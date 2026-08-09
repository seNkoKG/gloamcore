import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import statCatalogJson from "../../../public/data/price-check/stats-v1.json";
import basePackJson from "./base-types-v1.json";
import {
  hasUniqueFixedStatMetadata,
  isFixedUniqueModifier,
  uniqueIdentityProfile,
  uniqueIdentityProfilesForBase,
  uniqueModifierMetadataPolicy,
  uniqueModifierProfileCount,
} from "./magic-base-type";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import type { ParsedPoeItem, ParsedPoeModifier } from "./types";

interface UniqueProfile {
  sourceIndex: number;
  name: string;
  baseType: string;
  icon?: string;
  modifierPolicy:
    | "source-bounds-only"
    | "all-explicit-variants"
    | "non-fixed-explicit-variants";
  fixedStats?: string[];
}

interface BasePack {
  schema: number;
  source: {
    project: string;
    repository: string;
    commit: string;
    dataUpdatedAt: string;
    inputGitBlob: string;
    inputSha256: string;
  };
  capabilities: {
    uniqueFixedStatDeclarations: boolean;
    embeddedUniqueRollBounds: boolean;
    variantRecords: boolean;
    variantDiscriminators: string[];
  };
  coverage: {
    itemIdentities: number;
    itemVariants: number;
    armourVariants: number;
    discriminatedItemVariants: number;
    uniqueIdentities: number;
    uniqueVariants: number;
  };
  baseTypes: string[];
  itemProfiles: Record<string, Array<{
    sourceIndex: number;
    armour?: Record<string, [number, number]>;
  }>>;
  uniqueProfiles: Record<string, UniqueProfile[]>;
  gemProfiles: Record<string, unknown>;
  itemTradeDiscriminators: Record<string, string>;
  mapAreaTradeDiscriminators: Record<string, string>;
  tradeTags: Record<string, string>;
  exchangeableWithoutTradeTag: string[];
}

const basePack = basePackJson as unknown as BasePack;
const statCatalog = statCatalogJson as unknown as TradeStatCatalogPack;
const uniqueIdentities = Object.entries(basePack.uniqueProfiles);
const uniqueVariants = uniqueIdentities.flatMap(([name, variants]) =>
  variants.map((profile) => ({ name, profile }))
);

function modifier(
  id: string,
  kind: ParsedPoeModifier["kind"],
  text: string,
  normalizedText: string,
  value: number,
  bounds: { min: number; max: number },
): ParsedPoeModifier {
  return {
    id,
    kind,
    text,
    normalizedText,
    values: [value],
    selectedByDefault: false,
    tags: [],
    advanced: true,
    tradeBounds: bounds,
  };
}

function pseudoProbe(name: string, baseType: string): ParsedPoeItem {
  return {
    rawText: "",
    language: "en",
    valid: true,
    itemClass: "Belts",
    rarity: "unique",
    name,
    baseType,
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
    modifiers: [
      modifier("source-strength", "implicit", "+31(25-35) to Strength", "# to strength", 31, { min: 25, max: 35 }),
      modifier("source-dexterity", "explicit", "+31(30-50) to Dexterity", "# to dexterity", 31, { min: 30, max: 50 }),
      modifier("source-fire", "explicit", "+20(15-25)% to Fire Resistance", "#% to fire resistance", 20, { min: 15, max: 25 }),
      modifier("source-cold", "explicit", "+19(15-25)% to Cold Resistance", "#% to cold resistance", 19, { min: 15, max: 25 }),
    ],
    flavourText: [],
    reminderText: [],
    unknownSections: [],
    warnings: [],
    errors: [],
  };
}

describe("pinned Awakened unique-profile corpus", () => {
  it("pins v3.29.104 input identities, generated hashes, and complete counts", () => {
    expect(basePack.schema).toBe(2);
    expect(basePack.source).toEqual({
      project: "Awakened PoE Trade",
      repository: "https://github.com/SnosMe/awakened-poe-trade",
      commit: "adb6c287bd978a70701e2b65d744dd677c52fb65",
      dataUpdatedAt: "2026-08-08",
      inputGitBlob: "986361944cb6107fe308eb2417ae21807739a0c8",
      inputSha256: "1ab9c6c9fbd5450d66c7ada132e32e291267d63ee1228a664e49e2040cfbdf47",
    });
    expect(basePack.capabilities).toEqual({
      uniqueFixedStatDeclarations: true,
      embeddedUniqueRollBounds: false,
      variantRecords: true,
      variantDiscriminators: [
        "copied-base",
        "propAR",
        "propEV",
        "propES",
        "mapTier",
        "hasImplicit",
        "hasExplicit",
        "sectionText",
      ],
    });
    expect(statCatalog.source).toEqual({
      project: "Awakened PoE Trade",
      repository: "https://github.com/SnosMe/awakened-poe-trade",
      commit: "adb6c287bd978a70701e2b65d744dd677c52fb65",
      dataUpdatedAt: "2026-08-08",
      inputSha256: "f07f0bcd2e2d23669e71bbc0d91522e9d154f7124d2f93d3c65cf34433d18350",
      resolverGroupsSha256: "93f60aa7ffef512e2440fec85309c272f0f0d704a7ce332c936af2876c3dca06",
    });
    expect({
      baseTypes: basePack.baseTypes.length,
      itemProfiles: Object.keys(basePack.itemProfiles).length,
      itemVariants: Object.values(basePack.itemProfiles).flat().length,
      armourVariants: Object.values(basePack.itemProfiles).flat()
        .filter((profile) => profile.armour).length,
      uniqueProfiles: uniqueIdentities.length,
      uniqueVariants: uniqueVariants.length,
      gemProfiles: Object.keys(basePack.gemProfiles).length,
      itemTradeDiscriminators: Object.keys(basePack.itemTradeDiscriminators).length,
      mapAreaTradeDiscriminators: Object.keys(basePack.mapAreaTradeDiscriminators).length,
      tradeTags: Object.keys(basePack.tradeTags).length,
      exchangeableWithoutTradeTag: basePack.exchangeableWithoutTradeTag.length,
      statPatterns: statCatalog.entries.length,
    }).toEqual({
      baseTypes: 1183,
      itemProfiles: 1986,
      itemVariants: 1991,
      armourVariants: 478,
      uniqueProfiles: 1248,
      uniqueVariants: 1259,
      gemProfiles: 824,
      itemTradeDiscriminators: 4,
      mapAreaTradeDiscriminators: 161,
      tradeTags: 656,
      exchangeableWithoutTradeTag: 466,
      statPatterns: 11891,
    });
    expect(createHash("sha256").update(readFileSync(resolve(
      process.cwd(),
      "src/lib/price-check/base-types-v1.json",
    ))).digest("hex")).toBe(
      "24ce549f3fa9d9b08fb219190fa9b5d8e4bc87c391e5e9c5b598782b4002a330",
    );
    expect(createHash("sha256").update(readFileSync(resolve(
      process.cwd(),
      "public/data/price-check/stats-v1.json",
    ))).digest("hex")).toBe(
      "42a6c5722c0a49a65d76155a2d01005e6dc36aa3db6f95a356a7316596bc304c",
    );
    expect(basePack.coverage).toEqual({
      itemIdentities: 1986,
      itemVariants: 1991,
      armourVariants: 478,
      discriminatedItemVariants: 6,
      uniqueIdentities: 1248,
      uniqueVariants: 1259,
    });
    expect(basePack.uniqueProfiles["Dread Captain's Cutlass"][0]).toMatchObject({
      modifierPolicy: "non-fixed-explicit-variants",
      fixedStats: ["Can be Allflame Crafted as if Rare\nCannot gain Intangibility"],
    });
  });

  it("preserves fixed-stat declaration semantics for every unique variant", () => {
    expect(uniqueModifierProfileCount()).toBe(uniqueVariants.length);
    const canonicalRefs = new Set(statCatalog.entries.flatMap((entry) =>
      entry.candidates.map((candidate) => candidate.ref)
    ));
    for (const { name, profile } of uniqueVariants) {
      const context = { baseType: profile.baseType };
      const hasFixedStats = Object.prototype.hasOwnProperty.call(profile, "fixedStats");
      expect(hasUniqueFixedStatMetadata(name, context), name).toBe(hasFixedStats);
      expect(uniqueModifierMetadataPolicy(name, context), name).toBe(profile.modifierPolicy);
      expect(profile.modifierPolicy, name).toBe(
        !hasFixedStats
          ? "source-bounds-only"
          : profile.fixedStats!.length
            ? "non-fixed-explicit-variants"
            : "all-explicit-variants",
      );
      expect(new Set(profile.fixedStats || []).size, name).toBe((profile.fixedStats || []).length);
      for (const fixedStat of profile.fixedStats || []) {
        expect(fixedStat.trim(), `${name}: empty fixed stat`).not.toBe("");
        expect(isFixedUniqueModifier(name, fixedStat, context), `${name}: ${fixedStat}`).toBe(true);
        expect(canonicalRefs.has(fixedStat), `${name}: missing canonical ${fixedStat}`)
          .toBe(true);
      }
    }
    expect(canonicalRefs).toContain("+# to Maximum Charges");
    expect(canonicalRefs).toContain(
      "Can be Allflame Crafted as if Rare\nCannot gain Intangibility",
    );
  });

  it("preserves and selects all 16 current multi-base unique records", () => {
    const expected = {
      "Combat Focus": ["Viridian Jewel", "Crimson Jewel", "Cobalt Jewel"],
      "Grand Spectrum": ["Viridian Jewel", "Cobalt Jewel", "Crimson Jewel"],
      "Doryani's Delusion": ["Leviathan Greaves", "Velour Boots", "Warlock Boots"],
      "Precursor's Emblem": [
        "Sapphire Ring",
        "Topaz Ring",
        "Ruby Ring",
        "Two-Stone Ring",
        "Prismatic Ring",
      ],
      Stormblood: ["Sapphire Flask", "Topaz Flask"],
    };
    expect(Object.fromEntries(Object.keys(expected).map((name) => [
      name,
      basePack.uniqueProfiles[name].map((profile) => profile.baseType),
    ]))).toEqual(expected);
    const records = Object.entries(expected).flatMap(([name, bases]) =>
      bases.map((baseType) => {
        const selected = uniqueIdentityProfile(name, { baseType });
        const candidate = uniqueIdentityProfilesForBase(baseType)
          .find((profile) => profile.name === name);
        expect(selected, `${name}: ${baseType}`).toBeDefined();
        expect(candidate, `${name}: ${baseType} candidate`).toEqual(selected);
        return selected!;
      })
    );
    expect(records).toHaveLength(16);
    expect(records.every((record) => record.icon.startsWith("https://"))).toBe(true);
    expect(new Set(records.map((record) => record.icon)).size).toBe(16);
  });

  it("pins every canonical ref that differs from its raw or advanced matcher", () => {
    const normalized = (value: string) => value
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const allCandidates = statCatalog.entries.flatMap((entry) =>
      entry.candidates.map((candidate) => ({ entry, candidate }))
    );
    expect(allCandidates.every(({ candidate }) =>
      candidate.ref.length > 0 &&
      candidate.ref.length <= 512 &&
      !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(candidate.ref)
    )).toBe(true);
    expect(new Set(allCandidates
      .filter(({ candidate }) => candidate.ref.includes("\n"))
      .map(({ candidate }) => candidate.ref)).size).toBe(262);
    const divergent = allCandidates.flatMap(({ entry, candidate }) =>
      normalized(candidate.ref) === entry.pattern
        ? []
        : [[entry.pattern, candidate.id, candidate.kind, candidate.ref]]
    );
    expect(divergent).toHaveLength(7_945);
    expect(createHash("sha256").update(JSON.stringify(divergent)).digest("hex"))
      .toBe("3c5faeeff59697c2de5f9a13712454d4c8fa6ce10c7d740e66a80d97d4fbb53b");
  });

  it("orders generated pseudos before untouched raw modifiers", () => {
    const probe = pseudoProbe("Ordering Fixture", "Leather Belt");
    probe.modifiers.unshift(modifier(
      "unconsumed-implicit",
      "implicit",
      "12(10-15)% increased Rarity of Items found",
      "#% increased rarity of items found",
      12,
      { min: 10, max: 15 },
    ));
    const hydrated = applyTradeStatCatalog(probe, statCatalog);
    expect(hydrated.modifiers.map((entry) => entry.id)).toEqual([
      "pseudo-total-elemental-resistance",
      "pseudo-total-fire-resistance",
      "pseudo-total-strength",
      "pseudo-total-dexterity",
      "unconsumed-implicit",
    ]);
    expect(hydrated.modifiers.at(-1)).toMatchObject({
      tradeId: "implicit.stat_3917489142",
      values: [12],
    });
  });

  it("applies Awakened pseudo source consumption, order, and hidden metadata across the corpus", () => {
    const pseudoIds = [
      "pseudo.pseudo_total_elemental_resistance",
      "pseudo.pseudo_total_fire_resistance",
      "pseudo.pseudo_total_strength",
      "pseudo.pseudo_total_dexterity",
    ];
    for (const { name, profile } of uniqueVariants) {
      const hydrated = applyTradeStatCatalog(pseudoProbe(name, profile.baseType), statCatalog);
      if (name === "Split Personality") {
        expect(hydrated.modifiers.some((entry) => entry.kind === "pseudo"), name).toBe(false);
        expect(hydrated.modifiers).toHaveLength(4);
        continue;
      }
      expect(hydrated.modifiers.map((entry) => entry.tradeId), name).toEqual(pseudoIds);
      expect(hydrated.modifiers[1].tags, name).toContain("upstream-hidden");
      expect(hydrated.modifiers.filter((entry) => entry.tags.includes("upstream-hidden")), name)
        .toHaveLength(1);
      expect(hydrated.modifiers.map((entry) => entry.id), name).not.toContain("source-fire");
      expect(hydrated.modifiers.map((entry) => entry.id), name).not.toContain("source-cold");
    }
  });
});
