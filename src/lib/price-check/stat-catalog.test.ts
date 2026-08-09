import { describe, expect, it } from "vitest";
import {
  applyTradeStatCatalog,
  EXPECTED_PACK_SHA256,
  isValidTradeStatCatalogPack,
  type TradeStatCatalogCandidate,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import type { ParsedPoeItem } from "./types";
import { parsePoeItem } from "./parser";
import {
  buildPriceCheckQueryPlan,
  planModifierFilters,
  planPriceCheckFilters,
} from "./query-plan";
import { isOfficialPriceCheckFilter } from "./equipment-properties";
import {
  advancedDecimalMagnitudeFixture,
  advancedIntegerMagnitudeFixture,
  advancedLegacyOutOfRangeFixture,
  advancedRareFixture,
  advancedUnscalableMagnitudeFixture,
  armourModifierParityFixture,
  chronicleFixture,
  expeditionLogbookFixture,
  lethalPrideKaomAdvancedFixture,
  magebloodAdvancedFixture,
  timelessJewelFixture,
} from "./fixtures/parser-fixtures";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import actualCatalogText from "../../../public/data/price-check/stats-v1.json?raw";

function item(): ParsedPoeItem {
  return {
    rawText: "",
    language: "en",
    valid: true,
    itemClass: "Rings",
    rarity: "rare",
    name: "Test Ring",
    baseType: "Amethyst Ring",
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
      {
        id: "local-life",
        kind: "explicit",
        text: "+76 to maximum Life",
        normalizedText: "+# to maximum life",
        values: [76],
        selectedByDefault: true,
        tags: [],
        advanced: false,
      },
    ],
    flavourText: [],
    reminderText: [],
    unknownSections: [],
    warnings: [],
    errors: [],
  };
}

function pack(
  ids: string[],
  entry: Partial<TradeStatCatalogPack["entries"][number]> = {},
): TradeStatCatalogPack {
  return {
    schema: 8,
    source: {
      project: "Awakened PoE Trade",
      repository: "https://example.invalid",
      commit: "adb6c287bd978a70701e2b65d744dd677c52fb65",
      dataUpdatedAt: "2026-08-08",
      inputSha256: "a".repeat(64),
      resolverGroupsSha256: "b".repeat(64),
    },
    generatedAt: "2026-08-08T00:00:00.000Z",
    coverage: { resolverGroups: 0, resolverStrategies: {} },
    groups: [],
    entries: [{
      pattern: "+# to maximum life",
      candidates: ids.map((id) => candidate(id)),
      ...entry,
    }],
  };
}

function candidate(
  id: string,
  entry: Partial<TradeStatCatalogCandidate> = {},
): TradeStatCatalogCandidate {
  return {
    id,
    kind: "explicit",
    ref: "+# to maximum Life",
    matcherText: "+# to maximum Life",
    semantics: { tokenCount: 1, indices: [0] },
    better: 1,
    ...entry,
  };
}

const CURRENT_TIMELESS_CASES = [
  ...["Ahuana", "Doryani", "Xibaqua", "Zerphi"].map((leader) => ({
    name: "Glorious Vanity",
    baseType: "Timeless Jewel",
    leader,
    seed: 5123,
    seedLine: `Bathed in the blood of 5123 sacrificed in the name of ${leader}`,
    conquest: "Passives in radius are Conquered by the Vaal",
  })),
  ...["Cadiro", "Caspiro", "Chitus", "Victario"].map((leader) => ({
    name: "Elegant Hubris",
    baseType: "Timeless Jewel",
    leader,
    seed: 82840,
    seedLine: `Commissioned 82840 coins to commemorate ${leader}`,
    conquest: "Passives in radius are Conquered by the Eternal Empire",
  })),
  ...["Akoya", "Kaom", "Kiloava", "Rakiata"].map((leader) => ({
    name: "Lethal Pride",
    baseType: "Timeless Jewel",
    leader,
    seed: 12476,
    seedLine: `Commanded leadership over 12476 warriors under ${leader}`,
    conquest: "Passives in radius are Conquered by the Karui",
  })),
  ...["Avarius", "Dominus", "Maxarius", "Venarius"].map((leader) => ({
    name: "Militant Faith",
    baseType: "Timeless Jewel",
    leader,
    seed: 7301,
    seedLine: `Carved to glorify 7301 new faithful converted by High Templar ${leader}`,
    conquest: "Passives in radius are Conquered by the Templars",
  })),
  ...["Asenath", "Balbala", "Deshret", "Nasima"].map((leader) => ({
    name: "Brutal Restraint",
    baseType: "Timeless Jewel",
    leader,
    seed: 1182,
    seedLine: `Denoted service of 1182 dekhara in the akhara of ${leader}`,
    conquest: "Passives in radius are Conquered by the Maraketh",
  })),
  ...["Medved", "Uhtred", "Vorana"].map((leader) => ({
    name: "Heroic Tragedy",
    baseType: "Timeless Jewel",
    leader,
    seed: 645,
    seedLine: `Remembrancing 645 songworthy deeds by the line of ${leader}`,
    conquest: "Passives in radius are Conquered by the Kalguur",
  })),
  ...[
    ["Amanamu", "Amanamu's Gaze", "Ghastly Eye Jewel"],
    ["Kurgal", "Kurgal's Gaze", "Hypnotic Eye Jewel"],
    ["Tecrod", "Tecrod's Gaze", "Murderous Eye Jewel"],
    ["Ulaman", "Ulaman's Gaze", "Searching Eye Jewel"],
  ].map(([leader, name, baseType]) => ({
    name,
    baseType,
    leader,
    seed: 777,
    seedLine: `Subjugating 777 souls in the thrall of ${leader}`,
    conquest: "Passives affected are Conquered by the Abyssal",
  })),
  {
    name: "Reclaimed Malevolence",
    baseType: "Assembled Eye Jewel",
    leader: "Zorath",
    seed: 777,
    seedLine: "Binding 777 souls to phylacteries to sustain Zorath",
    conquest: "Passives affected are Conquered by the Abyssal",
  },
];

describe("local Trade stat catalog", () => {
  it("pins the exact bytes shipped to the desktop renderer", async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(actualCatalogText),
    );
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe(EXPECTED_PACK_SHA256);
  });

  it("accepts the exact bundled Awakened stat pack used by the desktop renderer", () => {
    expect(isValidTradeStatCatalogPack(actualCatalog)).toBe(true);
  });

  it("maps Chronicle room pseudo stats and carries their exact option state", () => {
    const result = applyTradeStatCatalog(
      parsePoeItem(chronicleFixture),
      actualCatalog as TradeStatCatalogPack,
    );

    expect(result.modifiers).toHaveLength(8);
    expect(result.modifiers[0]).toMatchObject({
      text: "Apex of Atzoatl",
      kind: "pseudo",
      values: [1],
      roomState: 1,
      tradeOption: 1,
      tradeId: "pseudo.pseudo_temple_apex",
    });
    expect(result.modifiers[6]).toMatchObject({
      text: "Museum of Artefacts (Tier 3)",
      values: [2],
      roomState: 2,
      tradeOption: 2,
      tradeId: "pseudo.pseudo_temple_chests_3",
    });
  });

  it("never applies an option-valued room stat without a copied room state", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      kind: "pseudo",
      text: "Apex of Atzoatl",
      normalizedText: "apex of atzoatl",
      values: [],
    }];
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "apex of atzoatl",
        candidates: [candidate("pseudo.pseudo_temple_apex", {
          kind: "pseudo",
          semantics: { tokenCount: 0, indices: [] },
          option: true,
        })],
      }],
    });

    expect(result.modifiers[0].tradeId).toBeUndefined();
    expect(result.modifiers[0].tradeOption).toBeUndefined();
  });

  it("resolves one exact stat ID without replacing the stable UI id", () => {
    const result = applyTradeStatCatalog(item(), pack(["explicit.stat_3299347043"]));
    expect(result.modifiers[0]).toMatchObject({
      id: "local-life",
      tradeId: "explicit.stat_3299347043",
    });
  });

  it("keeps compatible multiple IDs as Awakened OR alternatives", () => {
    const result = applyTradeStatCatalog(
      item(),
      pack(["explicit.stat_1", "explicit.stat_2"]),
    );
    expect(result.modifiers[0]).toMatchObject({
      tradeId: "explicit.stat_1",
      tradeIds: ["explicit.stat_1", "explicit.stat_2"],
      tradeIdCandidates: ["explicit.stat_1", "explicit.stat_2"],
    });
    expect(result.warnings.join(" ")).not.toContain("multiple possible Trade IDs");
  });

  it("aggregates resolved sources by stat ref and kind before display selection", () => {
    const source = item();
    source.modifiers = [
      ["first-source", "First source 40", 40],
      ["unrelated", "Unrelated 7", 7],
      ["second-source", "Second source 60", 60],
    ].map(([id, text, value]) => ({
      ...source.modifiers[0],
      id: String(id),
      text: String(text),
      normalizedText: String(text).toLowerCase().replace(/\d+/g, "#"),
      values: [Number(value)],
    }));
    const chanceCandidate = (id: string, matcherText: string) => candidate(id, {
      ref: "#% chance for Aggregated Fixture",
      matcherText,
      displayMatchers: [
        { text: "#% chance for Aggregated Fixture" },
        { text: "Guaranteed Aggregated Fixture", value: 100 },
      ],
    });
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "first source #",
        candidates: [chanceCandidate("explicit.stat_101", "First source #")],
      }, {
        pattern: "unrelated #",
        candidates: [candidate("explicit.stat_202", {
          ref: "Unrelated #",
          matcherText: "Unrelated #",
        })],
      }, {
        pattern: "second source #",
        candidates: [chanceCandidate("explicit.stat_303", "Second source #")],
      }],
    });

    expect(result.modifiers).toHaveLength(2);
    expect(result.modifiers[0]).toMatchObject({
      id: "first-source+second-source",
      tradeId: "explicit.stat_101",
      tradeIds: ["explicit.stat_101"],
      tradeIdCandidates: ["explicit.stat_101"],
      values: [100],
      sourceValues: [40, 60],
      tradeBounds: { min: 100, max: 100 },
      tradeDisplayText: "Guaranteed Aggregated Fixture",
    });
    expect(result.modifiers[1]).toMatchObject({
      id: "unrelated",
      tradeId: "explicit.stat_202",
    });
  });

  it("uses Tablet max aggregation from zero for positive and negative sources", () => {
    const source = item();
    source.itemClass = "Currency";
    source.name = "Mirrored Tablet";
    source.baseType = "Mirrored Tablet";
    source.modifiers = [
      ["positive-a", "Positive 8(7-9)", 8, "positive #"],
      ["positive-b", "Positive 12(10-13)", 12, "positive #"],
      ["negative-a", "Negative -4(-6--3)", -4, "negative #"],
      ["negative-b", "Negative -2(-5--1)", -2, "negative #"],
    ].map(([id, text, value, normalizedText]) => ({
      ...source.modifiers[0],
      id: String(id),
      text: String(text),
      normalizedText: String(normalizedText),
      values: [Number(value)],
    }));
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "positive #",
        candidates: [candidate("explicit.stat_401", {
          ref: "Positive #",
          matcherText: "Positive #",
        })],
      }, {
        pattern: "negative #",
        candidates: [candidate("explicit.stat_402", {
          ref: "Negative #",
          matcherText: "Negative #",
        })],
      }],
    });

    expect(result.modifiers).toHaveLength(2);
    expect(result.modifiers[0]).toMatchObject({
      values: [12],
      tradeBounds: { min: 10, max: 13 },
      tradeDisplayText: "Positive 12",
    });
    expect(result.modifiers[1]).toMatchObject({
      values: [0],
      tradeBounds: { min: 0, max: 0 },
      tradeDisplayText: "Negative 0",
    });
  });

  it("preserves matcher-negated source rolls while planning a canonical inverted filter", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "20% reduced Charges per use",
      normalizedText: "#% reduced charges per use",
      values: [20],
    }];
    const result = applyTradeStatCatalog(
      source,
      pack(["explicit.stat_388617051"], {
        pattern: "#% reduced charges per use",
        candidates: [candidate("explicit.stat_388617051", {
          matcherText: "#% reduced Charges per use",
          displayMatchers: [
            { text: "#% increased Charges per use" },
            { text: "#% reduced Charges per use", negate: true },
          ],
          semantics: { tokenCount: 1, indices: [0], negate: true },
          better: -1,
        })],
      }),
    );

    expect(result.modifiers[0]).toMatchObject({
      values: [-20],
      sourceValues: [20],
      tradeId: "explicit.stat_388617051",
      tradeDirection: 1,
      tradeInverted: true,
      tradeDisplayText: "20% reduced Charges per use",
    });
    expect(planModifierFilters(result, 10)[0]).toMatchObject({
      copiedValue: 20,
      min: 20,
      tradeInverted: true,
    });
    expect(planModifierFilters(result, 10)[0].max).toBeUndefined();
  });

  it("serializes a reduced Flask charge roll exactly once as a negative Trade maximum", () => {
    const source = item();
    Object.assign(source, {
      itemClass: "Utility Flasks",
      rarity: "magic",
      name: "Amethyst Flask",
      baseType: "Amethyst Flask",
    });
    source.modifiers = [{
      ...source.modifiers[0],
      text: "20(20-20)% reduced Charges per use",
      normalizedText: "#% reduced charges per use",
      values: [20],
      advanced: true,
      source: "Chemist's",
      generation: "prefix",
      tier: "1",
    }];
    const hydrated = applyTradeStatCatalog(
      source,
      actualCatalog as TradeStatCatalogPack,
    );
    const plan = buildPriceCheckQueryPlan(hydrated, "Allflame", {
      mode: "exact",
      rollTolerance: 10,
    });

    expect(hydrated.modifiers[0].values).toEqual([-20]);

    expect(plan.filters.find((filter) =>
      filter.tradeId === "explicit.stat_388617051"
    )).toMatchObject({
      copiedValue: 20,
      min: 20,
      tradeInverted: true,
    });
    expect((plan.tradeQuery as any).query.stats[0].filters).toContainEqual({
      id: "explicit.stat_388617051",
      value: { max: -20 },
    });
  });

  it("averages two roll placeholders without averaging fixed numeric text", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "Adds 10 to 20 Physical Damage to Attacks",
      normalizedText: "adds # to # physical damage to attacks",
      values: [10, 20],
    }, {
      ...source.modifiers[0],
      id: "local-per-strength",
      text: "30% increased Damage per 15 Strength",
      normalizedText: "#% increased damage per # strength",
      values: [30, 15],
    }];
    const productionStylePack: TradeStatCatalogPack = {
      ...pack([]),
      entries: [{
        pattern: "adds # to # physical damage to attacks",
        candidates: [candidate("explicit.stat_3032590688", {
          ref: "Adds # to # Physical Damage to Attacks",
          matcherText: "Adds # to # Physical Damage to Attacks",
          semantics: { tokenCount: 2, indices: [0, 1] },
        })],
      }, {
        pattern: "#% increased damage per # strength",
        candidates: [candidate("explicit.stat_3948776386", {
          ref: "#% increased Damage per 15 Strength",
          matcherText: "#% increased Damage per 15 Strength",
          semantics: {
            tokenCount: 2,
            indices: [0],
            literals: [[1, 15]],
          },
        })],
      }],
    };
    const result = applyTradeStatCatalog(source, productionStylePack);

    expect(result.modifiers[0]).toMatchObject({
      values: [15],
      sourceValues: [10, 20],
      tradeDisplayText: "Adds 15 to 15 Physical Damage to Attacks",
    });
    expect(result.modifiers[0].tradeDecimalPrecision).toBe(false);
    expect(planModifierFilters(result, 10)[0]).toMatchObject({ min: 15 });
    expect(planModifierFilters(result, 10)[0].max).toBeUndefined();
    expect(result.modifiers[1]).toMatchObject({
      values: [30],
      sourceValues: [30, 15],
      tradeDisplayText: "30% increased Damage per 15 Strength",
    });
  });

  it("renders the resolved matcher grammar from the final aggregate roll", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "+1 to Level of all Fireball(Fireball-Mana-Infused Staff) Gems",
      normalizedText: "+# to level of all fireball(fireball-mana-infused staff) gems",
      values: [1],
    }, {
      ...source.modifiers[0],
      id: "cluster-plural",
      kind: "enchant",
      text: "2 Added Passive Skills are Jewel Sockets",
      normalizedText: "# added passive skills are jewel sockets",
      values: [2],
    }, {
      ...source.modifiers[0],
      id: "cluster-singular",
      text: "1 Added Passive Skill is a Jewel Socket",
      normalizedText: "# added passive skill is a jewel socket",
      values: [1],
    }, {
      ...source.modifiers[0],
      id: "constant-phrase",
      text: "100% chance to Curse Enemies with Vulnerability on Hit",
      normalizedText: "#% chance to curse enemies with vulnerability on hit",
      values: [100],
    }, {
      ...source.modifiers[0],
      id: "multiline-aggregate",
      text: "Gain 10 Power\nand 20 Power",
      normalizedText: "gain # power and # power",
      values: [10, 20],
    }];
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "+# to level of all fireball(fireball-mana-infused staff) gems",
        candidates: [candidate("explicit.indexable_skill_33", {
          ref: "+# to Level of all Fireball Gems",
          matcherText: "+# to Level of all Fireball(Fireball-Mana-Infused Staff) Gems",
          displayText: "+# to Level of all Fireball Gems",
          displayMatchers: [{ text: "+# to Level of all Fireball Gems" }],
        })],
      }, {
        pattern: "# added passive skills are jewel sockets",
        candidates: [candidate("enchant.stat_3086156145", {
          kind: "enchant",
          ref: "# Added Passive Skills are Jewel Sockets",
          matcherText: "# Added Passive Skills are Jewel Sockets",
          displayMatchers: [
            { text: "# Added Passive Skills are Jewel Sockets" },
            { text: "1 Added Passive Skill is a Jewel Socket", value: 1 },
          ],
        })],
      }, {
        pattern: "# added passive skill is a jewel socket",
        candidates: [candidate("explicit.stat_4073200695", {
          ref: "# Added Passive Skills are Jewel Sockets",
          matcherText: "# Added Passive Skills are Jewel Sockets",
          displayMatchers: [
            { text: "# Added Passive Skills are Jewel Sockets" },
            { text: "1 Added Passive Skill is a Jewel Socket", value: 1 },
          ],
        })],
      }, {
        pattern: "#% chance to curse enemies with vulnerability on hit",
        candidates: [candidate("explicit.stat_210067635", {
          ref: "#% chance to Curse Enemies with Vulnerability on Hit",
          matcherText: "#% chance to Curse Enemies with Vulnerability on Hit",
          displayMatchers: [
            { text: "#% chance to Curse Enemies with Vulnerability on Hit" },
            { text: "Curse Enemies with Vulnerability on Hit", value: 100 },
          ],
        })],
      }, {
        pattern: "gain # power and # power",
        candidates: [candidate("explicit.stat_123456789", {
          ref: "Gain # Power\nand # Power",
          matcherText: "Gain # Power\nand # Power",
          displayMatchers: [{ text: "Gain +# Power\nand +# Power" }],
          semantics: { tokenCount: 2, indices: [0, 1] },
        })],
      }],
    });

    expect(result.modifiers.map((modifier) => modifier.tradeDisplayText)).toEqual([
      "1 to Level of all Fireball Gems",
      "2 Added Passive Skills are Jewel Sockets",
      "1 Added Passive Skill is a Jewel Socket",
      "Curse Enemies with Vulnerability on Hit",
      "Gain 15 Power\nand 15 Power",
    ]);
  });

  it("keeps option display text candidate-local instead of reselecting the stat", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "Contains 1 Alpha Room",
      normalizedText: "contains # alpha room",
      values: [1],
      roomState: 1,
    }];
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "contains # alpha room",
        candidates: [candidate("explicit.stat_123456789|1", {
          matcherText: "Contains # Alpha Room",
          displayText: "Contains # Alpha Room",
          displayMatchers: [{ text: "Wrong resolved-stat display" }],
          option: true,
        })],
      }],
    });

    expect(result.modifiers[0]).toMatchObject({
      tradeDisplayText: "Contains 1 Alpha Room",
      tradeOption: 1,
    });
  });

  it("averages every selected advanced roll bound before unique planning", () => {
    const source = item();
    source.rarity = "unique";
    source.name = "Test Unique";
    source.baseType = "Test Base";
    source.modifiers = [{
      ...source.modifiers[0],
      text: "Adds 10(5-10) to 20(15-25) Physical Damage to Attacks",
      normalizedText: "adds # to # physical damage to attacks",
      values: [10, 20],
    }];
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "adds # to # physical damage to attacks",
        candidates: [candidate("explicit.stat_3032590688", {
          ref: "Adds # to # Physical Damage to Attacks",
          semantics: { tokenCount: 2, indices: [0, 1] },
        })],
      }],
    });

    expect(result.modifiers[0]).toMatchObject({
      values: [15],
      sourceValues: [10, 20],
      tradeBounds: { min: 10, max: 17.5 },
    });
    expect(planModifierFilters(result, 10)[0]).toMatchObject({
      mode: "range",
      min: 14,
      bounds: { min: 10, max: 17.5 },
    });
  });

  it("keeps decimal precision from selected copied tokens and Stat.dp", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "Adds 1.0 to 2 Physical Damage to Attacks",
      normalizedText: "adds # to # physical damage to attacks",
      values: [1, 2],
    }, {
      ...source.modifiers[0],
      id: "source-dp",
      text: "+2 to Maximum Life",
      normalizedText: "+# to maximum life",
      values: [2],
    }];
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "adds # to # physical damage to attacks",
        candidates: [candidate("explicit.stat_3032590688", {
          ref: "Adds # to # Physical Damage to Attacks",
          semantics: { tokenCount: 2, indices: [0, 1] },
        })],
      }, {
        pattern: "+# to maximum life",
        candidates: [candidate("explicit.stat_3299347043", { dp: true })],
      }],
    });

    expect(result.modifiers.map((modifier) => modifier.tradeDecimalPrecision))
      .toEqual([true, true]);
    expect(planModifierFilters(result, 10).map((filter) => filter.min))
      .toEqual([1.5, 2]);
  });

  it("keeps each ID tied to its own literal and Trade metadata", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "30% increased Damage per 15 Strength",
      normalizedText: "#% increased damage per # strength",
      values: [30, 15],
    }];
    const result = applyTradeStatCatalog(source, pack([], {
      pattern: "#% increased damage per # strength",
      candidates: [
        candidate("explicit.stat_15", {
          semantics: {
            tokenCount: 2,
            indices: [0],
            literals: [[1, 15]],
          },
          better: 1,
        }),
        candidate("explicit.stat_10", {
          semantics: {
            tokenCount: 2,
            indices: [0],
            literals: [[1, 10]],
          },
          better: -1,
          inverted: true,
        }),
      ],
    }));

    expect(result.modifiers[0]).toMatchObject({
      tradeId: "explicit.stat_15",
      values: [30],
      sourceValues: [30, 15],
      tradeDirection: 1,
      tradeInverted: false,
    });
  });

  it("applies matcher negation to both display direction and query inversion", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "20% increased Action Speed",
      normalizedText: "#% increased action speed",
      values: [20],
    }];
    const result = applyTradeStatCatalog(source, pack([], {
      pattern: "#% increased action speed",
      candidates: [candidate("explicit.stat_2878959938", {
        semantics: { tokenCount: 1, indices: [0], negate: true },
        better: -1,
        inverted: true,
      })],
    }));

    expect(result.modifiers[0]).toMatchObject({
      values: [-20],
      tradeDirection: 1,
      tradeInverted: false,
    });
  });

  it("preserves selector-qualified and imbued IDs as opaque Trade IDs", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "Only affects Passives in Massive Ring",
      normalizedText: "only affects passives in massive ring",
      values: [],
    }, {
      ...source.modifiers[0],
      id: "imbued-support",
      kind: "imbued",
      text: "Supported by Level 20 Fortify",
      normalizedText: "supported by level # fortify",
      values: [20],
    }];
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "only affects passives in massive ring",
        candidates: [candidate("explicit.stat_3642528642|5", {
          semantics: { tokenCount: 0, indices: [] },
          better: 0,
        })],
      }, {
        pattern: "supported by level # fortify",
        candidates: [candidate("imbued.pseudo_built_in_support|1826945816", {
          kind: "imbued",
          semantics: { tokenCount: 1, indices: [0] },
        })],
      }],
    });

    expect(result.modifiers.map((modifier) => modifier.tradeId)).toEqual([
      "explicit.stat_3642528642|5",
      "imbued.pseudo_built_in_support|1826945816",
    ]);
  });

  it("resolves the shortest catalog prefix inside one copied modifier group", () => {
    const source = item();
    source.modifiers = ["Alpha 10", "Beta 20", "Gamma 30"].map(
      (text, index) => ({
        ...source.modifiers[0],
        id: `line-${index + 1}`,
        sourceGroupId: "section:1:advanced:0",
        text,
        normalizedText: text.toLowerCase().replace(/\d+/g, "#"),
        values: [(index + 1) * 10],
      }),
    );
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "alpha #",
        candidates: [candidate("explicit.stat_1")],
      }, {
        pattern: "alpha # beta #",
        candidates: [candidate("explicit.stat_2", {
          semantics: { tokenCount: 2, indices: [0, 1] },
        })],
      }, {
        pattern: "alpha # beta # gamma #",
        candidates: [candidate("explicit.stat_3", {
          matcherText: "Alpha #\nBeta 20\nGamma 30",
          semantics: { tokenCount: 3, indices: [0] },
        })],
      }],
    });

    expect(result.modifiers).toHaveLength(3);
    expect(result.modifiers[0]).toMatchObject({
      id: "line-1",
      tradeId: "explicit.stat_1",
      text: "Alpha 10",
      values: [10],
    });
    expect(result.modifiers.slice(1).map((modifier) => modifier.id)).toEqual([
      "line-2",
      "line-3",
    ]);
  });

  it("matches a catalog entry spanning up to seven lines in one group", () => {
    const source = item();
    source.modifiers = Array.from({ length: 7 }, (_value, index) => ({
      ...source.modifiers[0],
      id: `long-line-${index + 1}`,
      sourceGroupId: "section:2:advanced:0",
      text: `Effect ${index + 1}`,
      normalizedText: "effect #",
      values: [index + 1],
    }));
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: Array.from({ length: 7 }, () => "effect #").join(" "),
        candidates: [candidate("explicit.stat_777", {
          semantics: {
            tokenCount: 7,
            indices: [0],
            literals: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]],
          },
        })],
      }],
    });

    expect(result.modifiers).toHaveLength(1);
    expect(result.modifiers[0]).toMatchObject({
      tradeId: "explicit.stat_777",
      values: [1],
      sourceValues: [1, 2, 3, 4, 5, 6, 7],
    });
  });

  it("never fuses adjacent catalog lines from separate copied affixes", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      id: "action-speed",
      sourceGroupId: "section:3:advanced:0",
      text: "Action Speed cannot be modified to below 70% of base value",
      normalizedText: "action speed cannot be modified to below #% of base value",
      values: [70],
    }, {
      ...source.modifiers[0],
      id: "movement-speed",
      sourceGroupId: "section:3:advanced:1",
      text: "Movement Speed cannot be modified to below 70% of base value",
      normalizedText: "movement speed cannot be modified to below #% of base value",
      values: [70],
    }];
    const result = applyTradeStatCatalog(source, {
      ...pack([]),
      entries: [{
        pattern: "action speed cannot be modified to below #% of base value",
        candidates: [candidate("explicit.stat_2758454849", {
          ref: "Action Speed cannot be modified to below #% of base value",
        })],
      }, {
        pattern: "movement speed cannot be modified to below #% of base value",
        candidates: [candidate("explicit.stat_777421120", {
          ref: "Movement Speed cannot be modified to below #% of base value",
        })],
      }, {
        pattern: "action speed cannot be modified to below #% of base value movement speed cannot be modified to below #% of base value",
        candidates: [candidate("explicit.stat_798009319", {
          semantics: { tokenCount: 2, indices: [0] },
        })],
      }],
    });

    expect(result.modifiers.map((modifier) => modifier.tradeId)).toEqual([
      "explicit.stat_2758454849",
      "explicit.stat_777421120",
    ]);
  });

  it("resolves a real two-line cluster enchant to its discrete selector", () => {
    const source = item();
    source.modifiers = [
      "Added Small Passive Skills grant: 10% increased Life Recovery from Flasks",
      "Added Small Passive Skills grant: 10% increased Mana Recovery from Flasks",
    ].map((text, index) => ({
      ...source.modifiers[0],
      id: `cluster-${index + 1}`,
      sourceGroupId: "section:4:plain",
      kind: "enchant" as const,
      text,
      normalizedText: text.toLowerCase().replace(/\d+/g, "#"),
      values: [10],
    }));
    const result = applyTradeStatCatalog(
      source,
      actualCatalog as TradeStatCatalogPack,
    );

    expect(result.modifiers).toHaveLength(1);
    expect(result.modifiers[0]).toMatchObject({
      tradeId: "enchant.stat_3948993189|38",
      values: [],
      sourceValues: [10, 10],
      tradeDirection: 0,
    });
  });

  it("ships the numeric semantics in the pinned production pack", () => {
    const source = item();
    source.modifiers = [{
      ...source.modifiers[0],
      text: "20% reduced Movement Speed",
      normalizedText: "#% reduced movement speed",
      values: [20],
    }, {
      ...source.modifiers[0],
      id: "local-physical",
      text: "Adds 10 to 20 Physical Damage to Attacks",
      normalizedText: "adds # to # physical damage to attacks",
      values: [10, 20],
    }, {
      ...source.modifiers[0],
      id: "local-per-strength",
      text: "30% increased Damage per 15 Strength",
      normalizedText: "#% increased damage per # strength",
      values: [30, 15],
    }];
    const result = applyTradeStatCatalog(
      source,
      actualCatalog as TradeStatCatalogPack,
    );

    expect(result.modifiers.map((modifier) => modifier.values)).toEqual([
      [-20],
      [15],
      [30],
    ]);
    expect(result.modifiers[0].tradeInverted).toBe(true);
    expect(result.modifiers.every((modifier) => modifier.tradeId)).toBe(true);
  });

  it("applies Advanced magnitude, Unscalable and legacy bounds end to end", () => {
    const cases = [
      {
        raw: advancedIntegerMagnitudeFixture,
        value: 184,
        bounds: { min: 183, max: 193 },
        queryMin: 183,
      },
      {
        raw: advancedDecimalMagnitudeFixture,
        value: 1.35,
        bounds: { min: 1.08, max: 1.62 },
        queryMin: 1.21,
      },
      {
        raw: advancedUnscalableMagnitudeFixture,
        value: 1.25,
        bounds: { min: 1, max: 1.5 },
        queryMin: 1.12,
      },
      {
        raw: advancedLegacyOutOfRangeFixture,
        value: 25,
        bounds: { min: 10, max: 25 },
        queryMin: 22,
      },
    ];

    for (const expected of cases) {
      const hydrated = applyTradeStatCatalog(
        parsePoeItem(expected.raw),
        actualCatalog as TradeStatCatalogPack,
      );
      expect(hydrated.modifiers).toHaveLength(1);
      expect(hydrated.modifiers[0]).toMatchObject({
        values: [expected.value],
        tradeBounds: expected.bounds,
      });
      const filter = planModifierFilters(hydrated, 10)[0];
      expect(filter).toMatchObject({
        copiedValue: expected.value,
        min: expected.queryMin,
      });
      const query = buildPriceCheckQueryPlan(hydrated, "Allflame", {
        rollTolerance: 10,
      }).tradeQuery as any;
      expect(query.query.stats.flatMap((group: any) => group.filters)).toContainEqual(
        expect.objectContaining({
          id: hydrated.modifiers[0].tradeId,
          value: expect.objectContaining({ min: expected.queryMin }),
        }),
      );
    }
  });

  it("ships associated selector, current key-family and imbued records", () => {
    const production = actualCatalog as TradeStatCatalogPack;
    const candidates = production.entries.flatMap((entry) => entry.candidates);
    expect(production.schema).toBe(8);
    expect(candidates.find(
      (candidate) => candidate.id === "explicit.stat_2460506030|38999",
    )).toMatchObject({
      kind: "explicit",
      better: 0,
      semantics: { tokenCount: 0, indices: [] },
    });
    expect(candidates.find(
      (candidate) =>
        candidate.id === "imbued.pseudo_built_in_support|1826945816",
    )).toMatchObject({ kind: "imbued" });
    expect(candidates.find(
      (candidate) => candidate.id === "explicit.stat_1251731548",
    )).toMatchObject({ dp: true });
    expect(candidates.filter((candidate) => candidate.dp)).toHaveLength(233);
    for (const id of [
      "explicit.indexable_skill_251",
      "sanctum.stat_774484840",
      "pseudo.lake_38892",
      "veiled.mod_63772",
    ]) {
      expect(candidates.some((candidate) => candidate.id === id), id).toBe(true);
    }
    expect(candidates.filter((candidate) => candidate.id.includes("|")).length)
      .toBeGreaterThan(1_500);
    expect(candidates.filter((candidate) =>
      candidate.id.startsWith("explicit.pseudo_timeless_jewel_"),
    ).length).toBeGreaterThanOrEqual(21);
  });

  it("resolves generic and named veils through their dedicated Trade kind", () => {
    for (const [source, tradeId] of [
      ["Veiled Prefix", "veiled.mod_65000"],
      ["Catarina's Veiled", "veiled.mod_63772"],
      ["Elreon's Veiled", "veiled.mod_5769"],
    ] as const) {
      const parsed = parsePoeItem(`Item Class: Rings
Rarity: Rare
Veiled Ring
Amethyst Ring
--------
{ Veiled Prefix Modifier "${source}" — Life, Mana }
Veiled Prefix`);
      const resolved = applyTradeStatCatalog(
        parsed,
        actualCatalog as TradeStatCatalogPack,
      );
      expect(resolved.modifiers[0]).toMatchObject({
        kind: "veiled",
        tradeId,
      });
    }
  });

  it("maps current unique-item modifiers with the pinned production pack", () => {
    const result = applyTradeStatCatalog(
      parsePoeItem(magebloodAdvancedFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const mapped = result.modifiers.filter((modifier) => modifier.tradeId);
    expect(mapped.length).toBeGreaterThanOrEqual(6);
    expect(
      mapped.some(
        (modifier) =>
          modifier.tradeId === "pseudo.pseudo_total_elemental_resistance",
      ),
    ).toBe(true);
  });

  it("maps Timeless Jewel conqueror plus seed as one exact enabled filter", () => {
    const result = applyTradeStatCatalog(
      parsePoeItem(timelessJewelFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const seed = result.modifiers.find((modifier) =>
      modifier.tags.includes("seed"),
    );
    expect(seed).toMatchObject({
      tradeId: "explicit.pseudo_timeless_jewel_doryani",
      values: [5123],
    });
    expect(planModifierFilters(result, 10).find(
      (filter) => filter.modifierId === seed?.id,
    )).toMatchObject({
      enabled: true,
      mode: "exact",
      min: 5123,
      max: 5123,
      importance: "key",
    });
  });

  it("sends the reported 12476/Kaom advanced roll exactly through API and browser queries", () => {
    const parsed = parsePoeItem(lethalPrideKaomAdvancedFixture);
    const result = applyTradeStatCatalog(
      parsed,
      actualCatalog as TradeStatCatalogPack,
    );
    const seed = result.modifiers.find((modifier) =>
      modifier.tags.includes("seed"),
    );
    const tradeId = "explicit.pseudo_timeless_jewel_kaom";

    expect(seed).toMatchObject({
      tradeId,
      tradeIds: [tradeId],
      tradeIdCandidates: [tradeId],
      values: [12476],
      selectedByDefault: true,
      tradeDirection: 0,
      tradeInverted: false,
    });
    expect(result.modifiers).toHaveLength(1);
    expect(result.modifiers.some((modifier) => /^historic$/i.test(modifier.text)))
      .toBe(false);

    const plan = buildPriceCheckQueryPlan(result, "Allflame");
    const expectedStat = {
      id: tradeId,
      value: { min: 12476, max: 12476 },
    };
    expect(plan.filters.find((filter) => filter.modifierId === seed?.id))
      .toMatchObject({
        tradeId,
        enabled: true,
        mode: "exact",
        min: 12476,
        max: 12476,
      });
    expect((plan.tradeQuery as any).query.stats[0].filters)
      .toContainEqual(expectedStat);

    const browserQuery = JSON.parse(
      new URL(plan.tradeUrl).searchParams.get("q") || "null",
    );
    expect(browserQuery).toEqual(plan.tradeQuery);
    expect(browserQuery.query.stats[0].filters).toContainEqual(expectedStat);

    // The current resolver must remain safe even if the bundled Awakened data
    // is unavailable or temporarily behind GGG's current leader list.
    const withoutPack = applyTradeStatCatalog(parsed, null);
    expect(withoutPack.modifiers.find((modifier) =>
      modifier.tags.includes("seed")
    )).toMatchObject({ tradeId, values: [12476] });
  });

  it.each(CURRENT_TIMELESS_CASES)(
    "maps current official Timeless conqueror $leader end-to-end",
    ({ name, baseType, leader, seedLine, conquest, seed }) => {
      const parsed = parsePoeItem([
        "Item Class: Jewels",
        "Rarity: Unique",
        name,
        baseType,
        "--------",
        "Item Level: 83",
        "--------",
        seedLine,
        conquest,
        ...(baseType === "Timeless Jewel" ? ["--------", "Historic"] : []),
      ].join("\n"));
      const result = applyTradeStatCatalog(
        parsed,
        actualCatalog as TradeStatCatalogPack,
      );
      const mappedSeed = result.modifiers.find((modifier) =>
        modifier.tags.includes("seed"),
      );
      const tradeId = `explicit.pseudo_timeless_jewel_${leader.toLowerCase()}`;

      expect(mappedSeed).toMatchObject({
        tradeId,
        tradeIds: [tradeId],
        tradeIdCandidates: [tradeId],
        values: [seed],
        selectedByDefault: true,
        tradeDirection: 0,
        tradeInverted: false,
      });
      expect(result.warnings.some((warning) =>
        /no copied modifiers matched/i.test(warning)
      )).toBe(false);

      const filter = planModifierFilters(result, 10).find(
        (candidate) => candidate.modifierId === mappedSeed?.id,
      );
      expect(filter).toMatchObject({
        tradeId,
        enabled: true,
        mode: "exact",
        min: seed,
        max: seed,
        importance: "key",
      });

      const plan = buildPriceCheckQueryPlan(result, "Allflame");
      const expectedStat = { id: tradeId, value: { min: seed, max: seed } };
      expect((plan.tradeQuery as any).query.stats[0].filters)
        .toContainEqual(expectedStat);
      const browserQuery = JSON.parse(
        new URL(plan.tradeUrl).searchParams.get("q") || "null",
      );
      expect(browserQuery).toEqual(plan.tradeQuery);
      expect(browserQuery.query.stats[0].filters).toContainEqual(expectedStat);

      expect(applyTradeStatCatalog(parsed, null).modifiers.find((modifier) =>
        modifier.tags.includes("seed")
      )).toMatchObject({ tradeId, values: [seed] });
    },
  );

  it("keeps Watcher's Eye aura effects mapped, visible and selected by default", () => {
    const result = applyTradeStatCatalog(
      parsePoeItem(`Item Class: Jewels
Rarity: Unique
Watcher's Eye
Prismatic Jewel
--------
Limited to: 1
Radius: Medium
--------
Item Level: 86
--------
{ Unique Modifier â€” Critical }
+25(20-30)% to Critical Strike Multiplier while affected by Precision
{ Unique Modifier â€” Damage }
Gain 15(10-20)% of Physical Damage as Extra Fire Damage while affected by Anger`),
      actualCatalog as TradeStatCatalogPack,
    );
    const auraEffects = result.modifiers.filter((modifier) =>
      /while affected by/i.test(modifier.text),
    );
    expect(auraEffects).toHaveLength(2);
    expect(auraEffects.every((modifier) => modifier.tradeId)).toBe(true);
    const planned = planModifierFilters(result, 10);
    expect(auraEffects.every((modifier) =>
      planned.find((filter) => filter.modifierId === modifier.id)?.enabled,
    )).toBe(true);
  });

  it("uses the armour-specific flat Energy Shield Trade stat in a multi-stat affix", () => {
    const result = applyTradeStatCatalog(
      parsePoeItem(advancedRareFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const resplendent = result.modifiers.filter(
      (modifier) => modifier.source === "Resplendent",
    );

    expect(resplendent).toHaveLength(2);
    expect(resplendent.map((modifier) => modifier.normalizedText)).toEqual([
      "# to maximum energy shield",
      "#% increased energy shield",
    ]);
    expect(resplendent[0]).toMatchObject({
      tradeId: "explicit.stat_4052037485",
      tradeIdCandidates: ["explicit.stat_4052037485"],
      values: [154],
    });
    expect(resplendent[1].tradeId).toBe("explicit.stat_4015621042");
    expect(result.warnings).not.toContainEqual(
      expect.stringContaining("multiple possible Trade IDs"),
    );
  });

  it("matches Awakened armour rows with one aggregated elemental-resistance pseudo", () => {
    const result = applyTradeStatCatalog(
      parsePoeItem(armourModifierParityFixture),
      actualCatalog as TradeStatCatalogPack,
    );

    expect(result.modifiers).toHaveLength(9);
    expect(result.modifiers.map((modifier) => modifier.text)).toEqual([
      "+41% total Elemental Resistance",
      "+17% total to Fire Resistance",
      "7 Life Regenerated per second",
      "100(81-100)% increased Energy Shield",
      "10(9-10)% increased Area of Effect",
      "Enemies you Kill have a 35(31-35)% chance to Explode, dealing a quarter of their maximum Life as Chaos Damage",
      "17(16-17)% increased Stun and Block Recovery",
      "Ignore Stuns while using Socketed Attack Skills",
      "Socketed Attacks have -20 to Total Mana Cost",
    ]);
    expect(result.modifiers[0]).toMatchObject({
      kind: "pseudo",
      values: [41],
      selectedByDefault: true,
      tradeId: "pseudo.pseudo_total_elemental_resistance",
      tradeDirection: 1,
    });
    expect(result.modifiers[1]).toMatchObject({
      kind: "pseudo",
      values: [17],
      selectedByDefault: false,
      tradeId: "pseudo.pseudo_total_fire_resistance",
      tradeDirection: 1,
      tags: expect.arrayContaining(["upstream-hidden"]),
    });
    expect(result.modifiers[2]).toMatchObject({
      kind: "pseudo",
      values: [7],
      selectedByDefault: false,
      tradeId: "pseudo.pseudo_total_life_regen",
      tradeDirection: 1,
    });
    expect(result.modifiers.every((modifier) => modifier.tradeId)).toBe(true);
    expect(result.modifiers.some((modifier) =>
      /^\+\d+% to (?:fire|cold|lightning) resistance$/i.test(modifier.text)
    )).toBe(false);

    const filters = planPriceCheckFilters(result, 10);
    expect(filters).toHaveLength(9);
    expect(filters.filter((filter) => !filter.advancedOnly)).toHaveLength(8);
    expect(filters.every(isOfficialPriceCheckFilter)).toBe(true);
    expect(filters.filter((filter) => filter.enabled)).toHaveLength(2);
    expect(filters.map((filter) => filter.label || result.modifiers.find(
      (modifier) => modifier.id === filter.modifierId,
    )?.text)).toEqual([
      "Energy Shield: 753",
      "41% total Elemental Resistance",
      "17% total to Fire Resistance",
      "7 Life Regenerated per Second",
      "10% increased Area of Effect",
      "Enemies you Kill have a 35% chance to Explode, dealing a quarter of their maximum Life as Chaos Damage",
      "17% increased Stun and Block Recovery",
      "Ignore Stuns while using Socketed Attack Skills",
      "Socketed Attacks have -20 to Total Mana Cost",
    ]);
    expect(filters[0]).toMatchObject({
      modifierId: "property:energy-shield",
      copiedValue: 753,
      enabled: true,
      mode: "range",
      min: 677,
    });
    expect(filters[0].bounds).toBeUndefined();
    expect(filters[1]).toMatchObject({
      modifierId: "pseudo-total-elemental-resistance",
      tradeId: "pseudo.pseudo_total_elemental_resistance",
      enabled: true,
      mode: "range",
      min: 41,
    });

    const localEsModifier = result.modifiers.find((modifier) =>
      modifier.text === "100(81-100)% increased Energy Shield"
    )!;
    const staleLocalEsFilter = planModifierFilters(result, 10).find(
      (filter) => filter.modifierId === localEsModifier.id,
    )!;
    const query = buildPriceCheckQueryPlan(result, "Allflame", {
      filters: [
        ...filters,
        { ...staleLocalEsFilter, enabled: true },
      ],
    });
    expect(query.filters).toHaveLength(9);
    expect(query.filters.some(
      (filter) => filter.modifierId === staleLocalEsFilter.modifierId,
    )).toBe(false);
    expect((query.tradeQuery as any).query.filters.armour_filters.filters.es)
      .toEqual({ min: 677 });
    expect((query.tradeQuery as any).query.stats[0].filters.filter(
      (filter: { disabled?: boolean }) => !filter.disabled,
    )).toEqual([
      {
        id: "pseudo.pseudo_total_elemental_resistance",
        value: { min: 41 },
      },
    ]);
  });

  it("uses Awakened's total flat Energy Shield pseudo outside armour", () => {
    const parsed = parsePoeItem([
      "Item Class: Rings",
      "Rarity: Rare",
      "Doom Circle",
      "Amethyst Ring",
      "--------",
      "Item Level: 86",
      "--------",
      "{ Prefix Modifier \"Shimmering\" (Tier: 1) â€” Defences, Energy Shield }",
      "+48(40-48) to maximum Energy Shield",
    ].join("\n"));
    const result = applyTradeStatCatalog(
      parsed,
      actualCatalog as TradeStatCatalogPack,
    );

    expect(result.modifiers[0]).toMatchObject({
      tradeId: "pseudo.pseudo_total_energy_shield",
      tradeIdCandidates: ["pseudo.pseudo_total_energy_shield"],
      values: [48],
    });
    expect(result.warnings).not.toContainEqual(
      expect.stringContaining("multiple possible Trade IDs"),
    );
  });

  it("applies Advanced magnitude and legacy expansion before pseudo aggregation", () => {
    const magnitude = item();
    magnitude.modifiers = [{
      ...magnitude.modifiers[0],
      text: "+30(25-35)% to Fire Resistance",
      normalizedText: "#% to fire resistance",
      values: [30],
      rollIncr: 20,
      advanced: true,
    }];
    const increased = applyTradeStatCatalog(
      magnitude,
      actualCatalog as TradeStatCatalogPack,
    );
    expect(increased.modifiers.find((modifier) =>
      modifier.tradeId === "pseudo.pseudo_total_elemental_resistance"
    )).toMatchObject({
      values: [36],
      tradeBounds: { min: 30, max: 42 },
    });

    const legacy = item();
    legacy.modifiers = [{
      ...legacy.modifiers[0],
      text: "+50(25-35)% to Fire Resistance",
      normalizedText: "#% to fire resistance",
      values: [50],
      advanced: true,
    }];
    const expanded = applyTradeStatCatalog(
      legacy,
      actualCatalog as TradeStatCatalogPack,
    );
    expect(expanded.modifiers.find((modifier) =>
      modifier.tradeId === "pseudo.pseudo_total_elemental_resistance"
    )).toMatchObject({
      values: [50],
      tradeBounds: { min: 25, max: 50 },
    });
  });

  it("retains a pseudo-consumed Fractured crafting row without an Explicit duplicate", () => {
    const source = item();
    source.fractured = true;
    source.modifiers = [{
      ...source.modifiers[0],
      id: "fractured-strength",
      kind: "fractured",
      text: "+58(56-60) to Strength",
      normalizedText: "# to strength",
      values: [58],
      generation: "suffix",
      tier: "1",
      advanced: true,
    }];
    const hydrated = applyTradeStatCatalog(
      source,
      actualCatalog as TradeStatCatalogPack,
    );
    expect(hydrated.modifiers.map((modifier) => modifier.tradeId)).toEqual([
      "pseudo.pseudo_total_strength",
      "fractured.stat_4080418644",
    ]);
    const filters = planModifierFilters(hydrated, 10);
    expect(filters).toEqual([
      expect.objectContaining({
        tradeId: "pseudo.pseudo_total_strength",
      }),
      expect.objectContaining({
        tradeId: "fractured.stat_4080418644",
        enabled: false,
        advancedOnly: true,
      }),
    ]);
    expect(filters[0].advancedOnly).toBeUndefined();
  });

  it("builds isolated exact faction-and-boss queries for Logbook I-V presets", () => {
    const parsed = parsePoeItem(expeditionLogbookFixture);
    const logbookAreas = parsed.logbookAreas!.map((modifiers) =>
      applyTradeStatCatalog(
        { ...parsed, modifiers, warnings: [] },
        actualCatalog as TradeStatCatalogPack,
      ).modifiers
    );
    const hydrated = { ...parsed, logbookAreas };
    const first = buildPriceCheckQueryPlan(hydrated, "Allflame", { mode: "I" });
    const second = buildPriceCheckQueryPlan(hydrated, "Allflame", { mode: "II" });

    expect(first.filters.map((filter) => filter.tradeId)).toEqual([
      "pseudo.pseudo_logbook_faction_druids",
      "implicit.stat_3159649981|1",
    ]);
    expect(second.filters.map((filter) => filter.tradeId)).toEqual([
      "pseudo.pseudo_logbook_faction_mercenaries",
      "implicit.stat_3159649981|2",
    ]);
    expect(first.filters.every((filter) => filter.enabled)).toBe(true);
    expect(second.filters.every((filter) => filter.enabled)).toBe(true);
    expect((first.tradeQuery as any).query.filters.map_filters.filters.area_level)
      .toEqual({ min: 83 });
    expect((first.tradeQuery as any).query.stats[0].filters).toEqual([
      { id: "pseudo.pseudo_logbook_faction_druids" },
      { id: "implicit.stat_3159649981|1" },
    ]);
  });
});
