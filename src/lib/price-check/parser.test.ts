import { describe, expect, it } from "vitest";
import {
  advancedCrossAffixBoundaryFixture,
  advancedDecimalMagnitudeFixture,
  advancedIntegerMagnitudeFixture,
  advancedLegacyOutOfRangeFixture,
  advancedRareFixture,
  advancedUnscalableMagnitudeFixture,
  advancedWithinGroupPrefixAmbiguityFixture,
  aptAdvancedRareBodyArmourFixture,
  armourModifierParityFixture,
  clusterJewelPolicyFixture,
  chronicleFixture,
  currencyFixture,
  divinationCardFixture,
  doubleCorruptedFledglingFixture,
  expeditionLogbookFixture,
  foulbornWatcherEyeFixture,
  gemFixture,
  golemSpellKineticWandFixture,
  influencedStatusFixture,
  lethalPrideKaomAdvancedFixture,
  malachaisLoopVestigialFixture,
  malformedCorruptedUniqueFixture,
  malformedFixture,
  malformedVestigialSkyforthFixture,
  magicFixture,
  mapFixture,
  plainModifierGroupBoundaryFixture,
  socketsFixture,
  timelessJewelFixture,
  unquotedFlavourUniqueFixture,
  uniqueFixture,
  watcherEyeFixture,
} from "./fixtures/parser-fixtures";
import { isPoeItemText, parsePoeItem } from "./parser";

describe("PoE copied-item parser", () => {
  it("parses stackable currency without mistaking help text for modifiers", () => {
    const item = parsePoeItem(currencyFixture);

    expect(item).toMatchObject({
      valid: true,
      language: "en",
      itemClass: "Stackable Currency",
      rarity: "currency",
      name: "Divine Orb",
      baseType: "Divine Orb",
      stackSize: 3,
      maxStackSize: 20,
    });
    expect(item.modifiers).toEqual([]);
    expect(item.reminderText).toEqual([
      "Right click this item then left click a magic, rare or unique item to apply it.",
    ]);
    expect(item.unknownSections).toContainEqual([
      "Randomises the values of the random modifiers on an item",
    ]);
  });

  it("keeps basic-copy unique rows out of Advanced modifier results", () => {
    const item = parsePoeItem(uniqueFixture);

    expect(item).toMatchObject({
      valid: true,
      rarity: "unique",
      name: "Mageblood",
      baseType: "Heavy Belt",
      itemLevel: 86,
      requiredLevel: 44,
    });
    expect(item.requirements).toMatchObject({ Level: "44" });
    expect(item.modifiers).toEqual([]);
    expect(item.flavourText).toHaveLength(2);
  });

  it("keeps wrapped unquoted unique flavour out of trade modifier rows", () => {
    const item = parsePoeItem(unquotedFlavourUniqueFixture);

    expect(item.flavourText).toEqual([
      "The Master of a Million Faces lived by one",
      "simple ethos: why make the effort, when",
      "you can simply mimic what others have?",
    ]);
    expect(item.modifiers.map((modifier) => modifier.text)).toEqual([
      "+1 to Level of Socketed Gems",
      "+22(15-25)% to Cold Resistance",
      "Count as having maximum number of Power Charges",
    ]);
    expect(item.modifiers.some((modifier) => /million faces|simple ethos|mimic/i.test(modifier.text))).toBe(false);
    expect(item.modifiers[0]).toMatchObject({
      kind: "implicit",
      generation: "corrupted",
      tags: ["Gem"],
    });
  });

  it("does not invent unique-jewel modifiers from an unmarked basic copy", () => {
    const item = parsePoeItem(watcherEyeFixture);

    expect(item).toMatchObject({
      valid: true,
      rarity: "unique",
      name: "Watcher's Eye",
      baseType: "Prismatic Jewel",
    });
    expect(item.properties).toMatchObject({
      "Limited to": "1",
      Radius: "Medium",
    });
    expect(item.modifiers).toEqual([]);
  });

  it("combines the Timeless Jewel seed and conqueror lines into one searchable stat", () => {
    const item = parsePoeItem(timelessJewelFixture);

    expect(item).toMatchObject({
      valid: true,
      name: "Glorious Vanity",
      baseType: "Timeless Jewel",
    });
    expect(item.modifiers).toHaveLength(1);
    expect(item.modifiers[0]).toMatchObject({
      values: [5123],
      tags: ["timeless-jewel", "seed"],
      text: "Bathed in the blood of 5123 sacrificed in the name of Doryani Passives in radius are Conquered by the Vaal",
    });
    expect(item.reminderText).toContain("Historic");
    expect(item.unknownSections).toEqual([]);
  });

  it("keeps the real advanced Lethal Pride roll while discarding only fixed Timeless boilerplate", () => {
    const item = parsePoeItem(lethalPrideKaomAdvancedFixture);

    expect(item).toMatchObject({
      valid: true,
      name: "Lethal Pride",
      baseType: "Timeless Jewel",
    });
    expect(item.modifiers).toHaveLength(1);
    expect(item.modifiers[0]).toMatchObject({
      kind: "explicit",
      values: [12476],
      tags: expect.arrayContaining(["timeless-jewel", "seed"]),
      text: "Commanded leadership over 12476(10000-18000) warriors under Kaom(Akoya-Rakiata) Passives in radius are Conquered by the Karui",
    });
    expect(item.modifiers.some((modifier) => /^historic$/i.test(modifier.text)))
      .toBe(false);
    expect(item.flavourText).toEqual([
      "They believed themselves the greatest warriors, but that savagery",
      "turned upon their own.",
    ]);
    expect(item.unknownSections).toEqual([]);
  });

  it("parses every Chronicle room losslessly with its open or obstructed state", () => {
    const item = parsePoeItem(chronicleFixture);

    expect(item).toMatchObject({
      valid: true,
      name: "Chronicle of Atzoatl",
      baseType: "Chronicle of Atzoatl",
    });
    expect(item.modifiers).toHaveLength(8);
    expect(item.modifiers.map((modifier) => ({
      text: modifier.text,
      kind: modifier.kind,
      state: modifier.roomState,
      values: modifier.values,
      selected: modifier.selectedByDefault,
    }))).toEqual([
      { text: "Apex of Atzoatl", kind: "pseudo", state: 1, values: [1], selected: true },
      { text: "Locus of Corruption (Tier 3)", kind: "pseudo", state: 1, values: [1], selected: true },
      { text: "Doryani's Institute (Tier 3)", kind: "pseudo", state: 1, values: [1], selected: true },
      { text: "Apex of Ascension (Tier 3)", kind: "pseudo", state: 1, values: [1], selected: true },
      { text: "Wealth of the Vaal (Tier 3)", kind: "pseudo", state: 1, values: [1], selected: true },
      { text: "Atlas of Worlds (Tier 3)", kind: "pseudo", state: 1, values: [1], selected: false },
      { text: "Museum of Artefacts (Tier 3)", kind: "pseudo", state: 2, values: [2], selected: false },
      { text: "Hall of War (Tier 3)", kind: "pseudo", state: 2, values: [2], selected: false },
    ]);
    expect(item.unknownSections).toEqual([]);
  });

  it("keeps Expedition Logbook areas isolated for Awakened I-V presets", () => {
    const item = parsePoeItem(expeditionLogbookFixture);

    expect(item).toMatchObject({
      valid: true,
      itemClass: "Expedition Logbooks",
      baseType: "Expedition Logbook",
      properties: { "Area Level": "83" },
      modifiers: [],
    });
    expect(item.logbookAreas?.map((area) => area.map((modifier) => ({
      text: modifier.text,
      kind: modifier.kind,
      selected: modifier.selectedByDefault,
    })))).toEqual([
      [
        { text: "Druids of the Broken Circle", kind: "pseudo", selected: true },
        { text: "Area contains Medved, Feller of Heroes", kind: "implicit", selected: false },
      ],
      [
        { text: "Black Scythe Mercenaries", kind: "pseudo", selected: true },
        { text: "Area contains Vorana, Last to Fall", kind: "implicit", selected: false },
      ],
    ]);
    expect(item.unknownSections).toEqual([]);
  });

  it("preserves a one-line affixed magic name without inventing basic-copy rows", () => {
    const item = parsePoeItem(magicFixture);
    expect(item).toMatchObject({
      valid: true,
      rarity: "magic",
      name: "Subterranean Vaal Regalia of the Underground",
      baseType: "Subterranean Vaal Regalia of the Underground",
    });
    expect(item.modifiers).toEqual([]);
  });

  it("matches the pinned Advanced descriptor kinds and generations", () => {
    const item = parsePoeItem(aptAdvancedRareBodyArmourFixture);

    expect(item.modifiers.map((modifier) => ({
      kind: modifier.kind,
      generation: modifier.generation,
      source: modifier.source,
      tier: modifier.tier,
      tags: modifier.tags,
    }))).toEqual([
      {
        kind: "implicit",
        generation: undefined,
        source: undefined,
        tier: undefined,
        tags: ["Defence"],
      },
      {
        kind: "explicit",
        generation: "prefix",
        source: "Resplendent",
        tier: "1",
        tags: ["Defences", "Energy Shield"],
      },
      {
        kind: "explicit",
        generation: "suffix",
        source: "of the Underground",
        tier: "1",
        tags: ["Resistance", "Chaos"],
      },
      {
        kind: "crafted",
        generation: "prefix",
        source: "Chosen",
        tier: "3",
        tags: ["Life"],
      },
    ]);
  });

  it("preserves stable modifier-group boundaries for multiline catalog matching", () => {
    const separated = parsePoeItem(advancedCrossAffixBoundaryFixture);
    const repeated = parsePoeItem(advancedCrossAffixBoundaryFixture);
    const within = parsePoeItem(advancedWithinGroupPrefixAmbiguityFixture);
    const plain = parsePoeItem(plainModifierGroupBoundaryFixture);

    const separatedGroups = separated.modifiers.map((modifier) => modifier.sourceGroupId);
    expect(separatedGroups).toHaveLength(2);
    expect(separatedGroups.every((group) => typeof group === "string")).toBe(true);
    expect(new Set(separatedGroups).size).toBe(2);
    expect(repeated.modifiers.map((modifier) => modifier.sourceGroupId))
      .toEqual(separatedGroups);

    expect(within.modifiers).toHaveLength(2);
    expect(new Set(within.modifiers.map((modifier) => modifier.sourceGroupId)).size)
      .toBe(1);

    expect(plain.modifiers.map((modifier) => modifier.kind)).toEqual([
      "enchant",
      "enchant",
      "enchant",
    ]);
    expect(plain.modifiers[0].sourceGroupId).toBe(plain.modifiers[1].sourceGroupId);
    expect(plain.modifiers[2].sourceGroupId).not.toBe(plain.modifiers[0].sourceGroupId);
  });

  it("splits advanced affix stats while retaining shared tier, source and tags", () => {
    const item = parsePoeItem(advancedRareFixture);

    expect(item).toMatchObject({
      valid: true,
      rarity: "rare",
      name: "Havoc Shelter",
      baseType: "Vaal Regalia",
      quality: 30,
      itemLevel: 86,
      links: 6,
      fractured: true,
      influences: ["Hunter"],
    });
    expect(item.sockets[0]).toEqual({
      colors: ["B", "B", "B", "B", "B", "B"],
      links: 6,
    });
    expect(item.modifiers).toHaveLength(5);
    expect(item.modifiers[1]).toMatchObject({
      kind: "explicit",
      source: "Resplendent",
      tier: "1",
      tags: ["Defences", "Energy Shield"],
      advanced: true,
      text: "+129(121-132) to maximum Energy Shield",
      values: [129],
      selectedByDefault: true,
    });
    expect(item.modifiers[2]).toMatchObject({
      kind: "explicit",
      source: "Resplendent",
      tier: "1",
      tags: ["Defences", "Energy Shield"],
      advanced: true,
      text: "109(101-110)% increased Energy Shield",
      values: [109],
      selectedByDefault: true,
    });
    expect(item.modifiers[4]).toMatchObject({
      kind: "crafted",
      source: "Chosen",
      values: [70],
      selectedByDefault: false,
    });
    expect(item.modifiers[1].normalizedText).toBe("# to maximum energy shield");
    expect(item.modifiers[2].normalizedText).toBe("#% increased energy shield");
  });

  it("preserves APT magnitude and unscalable metadata for catalog roll semantics", () => {
    const integer = parsePoeItem(advancedIntegerMagnitudeFixture).modifiers[0];
    expect(integer).toMatchObject({
      text: "171(170-179)% increased Physical Damage",
      values: [171],
      tags: ["Damage", "Physical", "Attack"],
      rollIncr: 8,
    });

    const decimal = parsePoeItem(advancedDecimalMagnitudeFixture).modifiers[0];
    expect(decimal).toMatchObject({
      text: "1.25(1.00-1.50)% increased Attack Speed",
      values: [1.25],
      tags: ["Attack", "Speed"],
      rollIncr: 8,
    });

    const unscalable = parsePoeItem(
      advancedUnscalableMagnitudeFixture,
    ).modifiers[0];
    expect(unscalable).toMatchObject({
      text: "1.25(1.00-1.50)% increased Attack Speed",
      normalizedText: "#% increased attack speed",
      values: [1.25],
      rollIncr: 8,
      unscalable: true,
    });

    const legacy = parsePoeItem(advancedLegacyOutOfRangeFixture).modifiers[0];
    expect(legacy).toMatchObject({
      text: "25(10-20)% increased Attack Speed",
      values: [25],
    });
  });

  it("consumes an advanced item-class property header without losing weapon data", () => {
    const item = parsePoeItem(golemSpellKineticWandFixture);

    expect(item).toMatchObject({
      valid: true,
      itemClass: "Wands",
      name: "Golem Spell",
      baseType: "Kinetic Wand",
      quality: 28,
      itemLevel: 99,
      links: 3,
    });
    expect(item.properties).toMatchObject({
      Quality: "+28%",
      "Physical Damage": "283-513",
      "Critical Strike Chance": "11.05%",
      "Attacks per Second": "1.90",
      Sockets: "W-W-W",
    });
    expect(item.sockets).toEqual([{ colors: ["W", "W", "W"], links: 3 }]);
    expect(item.modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "crafted",
        text: "+28(25-28)% to Global Critical Strike Multiplier",
      }),
    ]));
    expect(item.unknownSections).toEqual([]);
    expect(item.warnings).toEqual([]);
  });

  it("consumes localized Intangibility as an armour property, never a modifier", () => {
    const item = parsePoeItem(armourModifierParityFixture);

    expect(item).toMatchObject({
      valid: true,
      rarity: "rare",
      itemClass: "Body Armours",
      name: "Damnation Pelt",
      baseType: "Twilight Regalia",
      quality: 20,
      itemLevel: 86,
      links: 6,
    });
    expect(item.properties).toMatchObject({
      "Energy Shield": "753",
      Intangibility: "8%",
    });
    expect(item.modifiers).toHaveLength(10);
    expect(item.modifiers[0]).toMatchObject({
      text: "100(81-100)% increased Energy Shield",
      tier: "1",
      source: "Unassailable",
      selectedByDefault: true,
    });
    expect(item.modifiers.some((modifier) =>
      /intangibility/i.test(modifier.text)
    )).toBe(false);
    expect(item.unknownSections).toEqual([]);
  });

  it("extracts gem level, quality and requirements while preserving descriptions", () => {
    const item = parsePoeItem(gemFixture);

    expect(item).toMatchObject({
      valid: true,
      rarity: "gem",
      gemLevel: 5,
      quality: 20,
      requiredLevel: 72,
      corrupted: true,
    });
    expect(item.properties).toMatchObject({
      Level: "5 (Max)",
      Quality: "+20%",
      Experience: "1/1",
    });
    expect(item.modifiers).toEqual([]);
    expect(item.unknownSections.flat()).toContain("Supports any skill that hits enemies.");
  });

  it("parses map identity without treating unmarked basic-copy rows as modifiers", () => {
    const item = parsePoeItem(mapFixture);

    expect(item).toMatchObject({
      valid: true,
      itemClass: "Maps",
      rarity: "rare",
      baseType: "Crater Map",
      mapTier: 16,
      itemLevel: 83,
      corrupted: true,
    });
    expect(item.modifiers).toEqual([]);
  });

  it("keeps divination-card reward text separate and reads flavour text", () => {
    const item = parsePoeItem(divinationCardFixture);

    expect(item).toMatchObject({
      valid: true,
      rarity: "divination-card",
      name: "The Doctor",
      stackSize: 1,
      maxStackSize: 8,
    });
    expect(item.unknownSections).toContainEqual(["Headhunter"]);
    expect(item.flavourText).toEqual([
      '"They said I needed my head examined, but I\'d rather just take yours."',
    ]);
  });

  it("keeps only marked Cluster Jewel enchant rows", () => {
    const item = parsePoeItem(clusterJewelPolicyFixture);

    expect(item.baseType).toBe("Large Cluster Jewel");
    expect(item.itemLevel).toBe(83);
    expect(item.modifiers.slice(0, 2).map((modifier) => modifier.kind)).toEqual([
      "enchant",
      "enchant",
    ]);
    expect(item.modifiers.slice(0, 2).every((modifier) => modifier.selectedByDefault)).toBe(true);
    expect(item.modifiers).toHaveLength(2);
  });

  it("detects influences and every relevant item-state flag", () => {
    const item = parsePoeItem(influencedStatusFixture);

    expect(item.influences).toEqual(["Shaper", "Elder"]);
    expect(item).toMatchObject({
      fractured: true,
      synthesised: true,
      veiled: true,
      mirrored: true,
      split: true,
      scourged: true,
    });
    expect(item.modifiers.find((modifier) => modifier.text === "Veiled Prefix")).toMatchObject({
      kind: "veiled",
      text: "Veiled Prefix",
      normalizedText: "veiled",
    });
  });

  it("preserves named Syndicate veils as distinct catalog identities", () => {
    for (const source of ["Catarina's Veiled", "Elreon's Veiled"]) {
      const item = parsePoeItem(`Item Class: Rings
Rarity: Rare
Veiled Ring
Amethyst Ring
--------
{ Veiled Prefix Modifier "${source}" — Life, Mana }
Veiled Prefix`);
      expect(item.modifiers[0]).toMatchObject({
        kind: "veiled",
        source,
        normalizedText: source.toLowerCase(),
      });
    }
  });

  it("derives socket groups, maximum links and inventory dimensions", () => {
    const item = parsePoeItem(socketsFixture);

    expect(item.sockets).toEqual([
      { colors: ["R", "G", "B"], links: 3 },
      { colors: ["W", "W"], links: 2 },
      { colors: ["A"], links: 1 },
    ]);
    expect(item.links).toBe(3);
    expect(item.width).toBe(2);
    expect(item.height).toBe(3);
  });

  it("fails safely and preserves unsupported or malformed input", () => {
    const malformed = parsePoeItem(malformedFixture);
    const unrelated = parsePoeItem("hello from the clipboard");
    const empty = parsePoeItem("");

    expect(malformed.valid).toBe(false);
    expect(malformed.errors).toContain("Missing Item Class header.");
    expect(malformed.unknownSections.flat()).toContain("Some future section: value");
    expect(unrelated).toMatchObject({ valid: false, language: "unknown" });
    expect(unrelated.rawText).toBe("hello from the clipboard");
    expect(empty.errors).toEqual(["The clipboard does not contain an item."]);
  });

  it("normalises Windows line endings and identifies likely PoE text", () => {
    const windowsText = currencyFixture.replace(/\n/g, "\r\n") + "\r\n";
    expect(parsePoeItem(windowsText).valid).toBe(true);
    expect(isPoeItemText(windowsText)).toBe(true);
    expect(isPoeItemText("Rarity: Rare\nSomething")).toBe(false);
  });

  it("preserves Replica identity and recognises the exact Foil Unique marker", () => {
    const item = parsePoeItem(`Item Class: Boots
Rarity: Unique
Replica Alberon's Warpath
Soldier Boots
--------
Item Level: 80
--------
Foil Unique
Unidentified`);

    expect(item).toMatchObject({
      valid: true,
      name: "Replica Alberon's Warpath",
      baseType: "Soldier Boots",
      replica: true,
      foil: true,
      identified: false,
    });

    const nonUnique = parsePoeItem(`Item Class: Boots
Rarity: Rare
Storm Pace
Soldier Boots
--------
Item Level: 80
--------
Foil Unique`);
    expect(nonUnique.foil).toBe(false);
  });

  it("keeps malformed Vestigial headers explicit while retaining base identity", () => {
    const item = parsePoeItem(malformedVestigialSkyforthFixture);

    expect(item).toMatchObject({
      valid: true,
      name: "Skyforth",
      baseType: "Sorcerer Boots",
      vestigial: true,
    });
    expect(item.modifiers).toHaveLength(1);
    expect(item.modifiers[0]).toMatchObject({
      kind: "explicit",
      text: "+20(18-20)% increased Energy Shield",
      selectedByDefault: true,
      tags: [],
    });
    expect(item.modifiers[0].generation).toBeUndefined();
    expect(item.modifiers[0].source).toBeUndefined();
  });

  it("keeps a valid Vestigial Advanced header implicit with provenance", () => {
    const item = parsePoeItem(malachaisLoopVestigialFixture);

    expect(item).toMatchObject({
      valid: true,
      baseType: "Harmonic Spirit Shield",
      vestigial: true,
    });
    expect(item.modifiers[0]).toMatchObject({
      kind: "implicit",
      generation: "vestigial",
      text: "1% increased Area of Effect per Enemy killed recently, up to 25%",
      selectedByDefault: false,
    });
    expect(item.modifiers.slice(1).every((modifier) =>
      modifier.kind === "explicit" && modifier.generation === undefined
    )).toBe(true);
  });

  it("defaults every malformed corrupted Advanced header group to explicit", () => {
    const item = parsePoeItem(malformedCorruptedUniqueFixture);

    expect(item.corrupted).toBe(true);
    expect(item.modifiers.map((modifier) => ({
      kind: modifier.kind,
      generation: modifier.generation,
      source: modifier.source,
      tags: modifier.tags,
      text: modifier.text,
    }))).toEqual([
      {
        kind: "explicit",
        generation: undefined,
        source: undefined,
        tags: [],
        text: "+1 to Level of Socketed Gems",
      },
      {
        kind: "explicit",
        generation: undefined,
        source: undefined,
        tags: [],
        text: "+22(15-25)% to Cold Resistance",
      },
      {
        kind: "explicit",
        generation: undefined,
        source: undefined,
        tags: [],
        text: "Count as having maximum number of Power Charges",
      },
    ]);
  });

  it("keeps both corruption implicits on a double-corrupted unique", () => {
    const item = parsePoeItem(doubleCorruptedFledglingFixture);

    expect(item).toMatchObject({
      valid: true,
      itemClass: "Helmets",
      rarity: "unique",
      name: "The Fledgling",
      baseType: "Lacquered Helmet",
      corrupted: true,
    });
    expect(item.modifiers.slice(0, 2)).toMatchObject([
      {
        kind: "implicit",
        generation: "corrupted",
        normalizedText: "# to maximum power charges",
      },
      {
        kind: "implicit",
        generation: "corrupted",
        normalizedText: "#% increased effect of shock",
      },
    ]);
  });

  it("recognises Foulborn uniques from both the name and status line", () => {
    const prefixed = parsePoeItem(`Item Class: Belts
Rarity: Unique
Foulborn Mageblood
Heavy Belt
--------
Item Level: 86
--------
{ Foulborn Unique Modifier \u2014 Life }
+80(70-80) to maximum Life`);
    expect(prefixed).toMatchObject({
      valid: true,
      name: "Foulborn Mageblood",
      baseType: "Heavy Belt",
      foulborn: true,
    });
    expect(prefixed.modifiers[0]).toMatchObject({
      kind: "explicit",
      generation: "foulborn",
      text: "+80(70-80) to maximum Life",
      selectedByDefault: true,
    });

    const flagged = parsePoeItem(`Item Class: Belts
Rarity: Unique
Mageblood
Heavy Belt
--------
Item Level: 86
--------
Foulborn Item`);
    expect(flagged).toMatchObject({ valid: true, foulborn: true });

    const plain = parsePoeItem(foulbornWatcherEyeFixture);
    expect(plain.foulborn).toBe(true);
    expect(plain.modifiers).toEqual([]);
  });

  it("reads legacy map tier suffixes without leaving it in the base type", () => {
    const item = parsePoeItem(`Item Class: Maps
Rarity: Normal
Dunes Map (Tier 16)
--------
Item Level: 83`);
    expect(item.mapTier).toBe(16);
    expect(item.baseType).toBe("Dunes Map");
  });

  it("normalizes Awakened identity prefixes and preserves their query state", () => {
    const synthesised = parsePoeItem(`Item Class: Amulets
Rarity: Normal
Synthesised Onyx Amulet
--------
Item Level: 86
--------
Synthesised Item`);
    expect(synthesised).toMatchObject({
      name: "Onyx Amulet",
      baseType: "Onyx Amulet",
      synthesised: true,
    });

    const blighted = parsePoeItem(`Item Class: Maps
Rarity: Normal
Blighted Dunes Map
--------
Map Tier: 16`);
    expect(blighted).toMatchObject({
      name: "Dunes Map",
      baseType: "Dunes Map",
      mapBlighted: "Blighted",
    });

    const superior = parsePoeItem(`Item Class: Body Armours
Rarity: Normal
Superior Vaal Regalia
--------
Quality: +20%`);
    expect(superior).toMatchObject({
      name: "Vaal Regalia",
      baseType: "Vaal Regalia",
    });
  });

  it("treats Unmodifiable as corrupted while retaining its stronger state", () => {
    const item = parsePoeItem(`Item Class: Jewels
Rarity: Magic
Calamitous Cobalt Jewel
--------
Item Level: 84
--------
Unmodifiable`);
    expect(item).toMatchObject({
      valid: true,
      corrupted: true,
      unmodifiable: true,
    });
  });

  it("parses Heist contract job and priceless-target discriminators", () => {
    const item = parsePoeItem(`Item Class: Heist Contracts
Rarity: Rare
Smuggler's Cache
Contract: Lockpicking
--------
Area Level: 83
Requires Lockpicking (Level 5 (unmet))
Heist Target: Golden Obsidian Idol (Priceless)`);
    expect(item.heistContract).toEqual({
      requiredJob: "Lockpicking",
      jobLevel: 5,
      targetValue: "Priceless",
    });
  });

  it("keeps parenthetical reminders out of advanced modifier filters", () => {
    const item = parsePoeItem(`Item Class: Body Armours
Rarity: Rare
Ghoul Mantle
Necrotic Armour
--------
Item Level: 86
--------
{ Prefix Modifier "Chosen" (Tier: 1) — Effect }
Enemies you Kill have a 35(31-35)% chance to Explode
(Recently refers to the past 4 seconds)
Gain 1 Endurance Charge every second if you've been Hit Recently
(Recently refers to the past 4 seconds)`);

    expect(item.modifiers.map((modifier) => modifier.text)).toEqual([
      "Enemies you Kill have a 35(31-35)% chance to Explode",
      "Gain 1 Endurance Charge every second if you've been Hit Recently",
    ]);
    expect(item.reminderText).toEqual([
      "(Recently refers to the past 4 seconds)",
      "(Recently refers to the past 4 seconds)",
    ]);
  });

  it("parses Valdo, Scrying, Sentinel, Memory and Blueprint properties", () => {
    expect(parsePoeItem(`Item Class: Maps
Rarity: Rare
Dunes Map
--------
Map Tier: 16
Reward: Foil The Squire`).mapCompletionReward).toBe("The Squire");
    expect(parsePoeItem(`Item Class: Stackable Currency
Rarity: Currency
Scrying Orb
--------
Map Area: Dunes`).scryingMapArea).toBe("Dunes");
    expect(parsePoeItem(`Item Class: Sentinels
Rarity: Rare
Stalker Sentinel
--------
Charge: 12`).sentinelCharge).toBe(12);
    expect(parsePoeItem(`Item Class: Body Armours
Rarity: Rare
Memory Regalia
Vaal Regalia
--------
Memory Strands: 72`).memoryStrands).toBe(72);
    expect(parsePoeItem(`Item Class: Heist Blueprints
Rarity: Rare
Grand Scheme
Blueprint: Laboratory
--------
Heist Target: Replicas
Wings Revealed: 4`).heistBlueprint).toEqual({
      target: "Replicas",
      wingsRevealed: 4,
    });
  });

  it("recognizes suffixless Imbued Gem support sections before generic parsing", () => {
    const imbued = parsePoeItem(`Item Class: Skill Gems
Rarity: Gem
Fireball
--------
Level: 20
Quality: +20%
--------
Supported by Level 1 Faster Casting
--------
Corrupted`);
    expect(imbued.modifiers).toHaveLength(1);
    expect(imbued.modifiers[0]).toMatchObject({
      kind: "imbued",
      text: "Supported by Level 1 Faster Casting",
      normalizedText: "supported by level # faster casting",
    });
  });

  it("consumes complete Flask and Tincture base-property sections", () => {
    const flask = parsePoeItem(`Item Class: Flasks
Rarity: Magic
Chemist's Diamond Flask of the Order
Diamond Flask
--------
Quality: +20%
Lasts 6.00 Seconds
Consumes 20 of 60 Charges on use
Currently has 0 Charges
--------
{ Enchantment Modifier }
Used when Charges reach full (enchant)
--------
{ Suffix Modifier "of the Order" (Tier: 1) }
20% increased Charge Recovery (explicit)`);
    expect(flask.quality).toBe(20);
    expect(flask.modifiers.map((modifier) => modifier.text)).toEqual([
      "Used when Charges reach full",
      "20% increased Charge Recovery",
    ]);

    const tincture = parsePoeItem(`Item Class: Tinctures
Rarity: Magic
Abecedarian Ashbark Tincture
Ashbark Tincture
--------
Quality: +20%
18% increased effect for each empty Flask Slot
Mana Burn drains 1% of maximum Mana per second
--------
{ Prefix Modifier "Abecedarian" (Tier: 1) }
20% increased Charge Recovery (explicit)`);
    expect(tincture.quality).toBe(20);
    expect(tincture.modifiers.map((modifier) => modifier.text)).toEqual([
      "20% increased Charge Recovery",
    ]);
  });

  it("does not throw on oversized data", () => {
    const huge = `Item Class: Belts\nRarity: Rare\nName\n${"x".repeat(300_000)}`;
    expect(() => parsePoeItem(huge)).not.toThrow();
    expect(parsePoeItem(huge).errors).toContain("The clipboard item is too large to parse safely.");
  });
});
