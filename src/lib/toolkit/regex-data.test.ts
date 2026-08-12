/// <reference types="node" />

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isValidRegexDataPack,
  EXPECTED_REGEX_PACK_SHA256,
  regexCategoryEntries,
  searchRegexCategory,
  type RegexDataPack,
} from "./regex-data";
import { buildPoeRegex } from "./poe-regex";

const HASH = "a".repeat(64);
const fixture: RegexDataPack = {
  schema: 1,
  game: "poe1",
  generatedAt: "2026-08-08T00:00:00.000Z",
  update: {
    command: "node scripts/build-regex-data.mjs",
    sourceUpdatedAt: "2026-08-08T00:00:00.000Z",
  },
  coverage: {
    mapModifiers: {
      positiveSpawnWeightRows: 1,
      matchedPages: 1,
      matchedModifierRows: 1,
      searchableEffectLines: 1,
      discardedRewardOnlyRows: 0,
      spawnTagCounts: { low_tier_map: 1 },
    },
    bundledSources: {
      baseTypes: 1,
      itemProfiles: 1,
      uniqueProfiles: 1,
      gemProfiles: 1,
      statPatterns: 1,
    },
  },
  sources: [{
    id: "source",
    label: "Fixture",
    kind: "bundled-pack",
    inputSha256: HASH,
  }],
  limitations: ["Fixture coverage is intentionally small."],
  entries: [{
    id: "entry:one",
    label: "Monsters are Hexproof",
    searchText: "Monsters are Hexproof",
    exact: "^monsters are hexproof$",
    sourceIds: ["source"],
    tags: ["hexproof"],
  }],
  categories: [{
    id: "map-modifiers",
    label: "Map modifiers",
    kind: "modifier",
    section: "core",
    description: "Fixture map modifiers.",
    sourceIds: ["source"],
    search: {
      placeholder: "Search map modifiers...",
      aliases: ["maps"],
      defaultMode: "avoid",
      supportsWant: true,
      supportsAvoid: true,
      supportsMatchAny: true,
      supportsMatchAll: true,
      supportsExact: true,
      supportsOptimized: true,
    },
    optimization: {
      algorithm: "shortest-unique-literal-v1",
      universeSha256: HASH,
      verified: true,
      exactFallbacks: 0,
    },
    entries: [{ entryId: "entry:one", optimized: "hex" }],
  }],
};

function renderedTemplate(value: string) {
  return value.toLowerCase()
    .replace(/\+#/g, "+42")
    .replace(/-#/g, "-42")
    .replace(/#/g, "42");
}

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function numericSkeleton(value: string) {
  return normalized(value)
    .replace(/[+-]?\d[\d,]*(?:\.\d+)?/g, "#")
    .replace(/[+-]?#/g, "#");
}

function templateWitnesses(value: string) {
  const clean = normalized(value);
  return [0, 1, 42, 999].map((number) => clean
    .replace(/\+#/g, `+${number}`)
    .replace(/-#/g, `-${number}`)
    .replace(/#/g, String(number)));
}

const FIXED_TOOLTIP_TEMPLATES = [
  "Item Class: Maps", "Item Class: Currency", "Rarity: Normal", "Rarity: Magic",
  "Rarity: Rare", "Rarity: Unique", "Map Tier: #", "Item Level: #", "Level: #",
  "Quality: +#%", "Quality: +#% (augmented)", "Armour: #", "Armour: # (augmented)",
  "Evasion Rating: #", "Evasion Rating: # (augmented)", "Energy Shield: #",
  "Energy Shield: # (augmented)", "Ward: #", "Ward: # (augmented)",
  "Physical Damage: #-#", "Physical Damage: #-# (augmented)", "Elemental Damage: #-#",
  "Elemental Damage: #-# (augmented)", "Chaos Damage: #-#", "Chaos Damage: #-# (augmented)",
  "Critical Strike Chance: #%", "Critical Strike Chance: #% (augmented)",
  "Attacks per Second: #", "Attacks per Second: # (augmented)", "Weapon Range: #",
  "Chance to Block: #%", "Chance to Block: #% (augmented)", "Item Quantity: +#%",
  "Item Quantity: +#% (augmented)", "Item Rarity: +#%", "Item Rarity: +#% (augmented)",
  "Monster Pack Size: +#%", "Monster Pack Size: +#% (augmented)", "More Maps: +#%",
  "Stack Size: #/#", "Experience: #/#", "Str: #", "Dex: #", "Int: #", "Radius: Small",
  "Radius: Medium", "Radius: Large", "Radius: Variable", "Sockets: R-R-R", "Requirements:", "Corrupted",
  "Unidentified", "Mirrored", "Split", "Fractured Item", "Synthesised Item", "Scourged",
  "Foulborn", "Vestigial", "Blighted", "Blight-ravaged",
];

describe("regex data pack", () => {
  it("validates references and materializes engine entries", () => {
    expect(isValidRegexDataPack(fixture)).toBe(true);
    const materialized = regexCategoryEntries(
      fixture,
      "map-modifiers",
      new Set(["entry:one"]),
    );
    expect(materialized).toEqual([{
      id: "entry:one",
      label: "Monsters are Hexproof",
      text: "Monsters are Hexproof",
      exactToken: "^monsters are hexproof$",
      compactToken: "hex",
      selected: true,
      mode: "avoid",
    }]);
    expect(buildPoeRegex(materialized).expression).toBe('"!^monsters are hexproof$"');
    expect(buildPoeRegex(materialized, {
      optimization: "compact",
      universe: materialized,
    }).expression).toBe('"!hex"');
    expect(isValidRegexDataPack({
      ...fixture,
      categories: [{ ...fixture.categories[0], entries: [{ entryId: "missing", optimized: "x" }] }],
    })).toBe(false);
    expect(() => isValidRegexDataPack({ ...fixture, entries: [null] })).not.toThrow();
    expect(isValidRegexDataPack({ ...fixture, entries: [null] })).toBe(false);
    expect(isValidRegexDataPack({
      ...fixture,
      categories: [{
        ...fixture.categories[0],
        search: {
          ...fixture.categories[0].search,
          defaultMode: "avoid",
          supportsAvoid: false,
        },
      }],
    })).toBe(false);
    expect(isValidRegexDataPack({
      ...fixture,
      categories: [{ ...fixture.categories[0], sourceIds: [] }],
    })).toBe(false);
  });

  it("exposes only v2 full-tooltip-proven fragments to the safe engine path", () => {
    const category = fixture.categories[0];
    const v2: RegexDataPack = {
      ...fixture,
      categories: [{
        ...category,
        optimization: {
          algorithm: "shortest-full-tooltip-literal-v2",
          corpusSha256: HASH,
          corpusLines: 123,
          verified: true,
          exactFallbacks: 0,
        },
      }],
    };
    expect(isValidRegexDataPack(v2)).toBe(true);
    const materialized = regexCategoryEntries(v2, "map-modifiers", new Set(["entry:one"]));
    expect(materialized[0]).toMatchObject({ optimizedToken: "hex" });
    expect(materialized[0]).not.toHaveProperty("compactToken");
    expect(buildPoeRegex(materialized).expression).toBe('"!hex"');
  });

  it("searches labels, text, and tags within a category", () => {
    expect(searchRegexCategory(fixture, "map-modifiers", "HEX")).toHaveLength(1);
    expect(searchRegexCategory(fixture, "map-modifiers", "reflect")).toEqual([]);
  });

  it("pins one local Awakened source snapshot and excludes undocumented endpoint provenance", () => {
    const data = JSON.parse(readFileSync(
      resolve(process.cwd(), "public/data/toolkit/regex-v1.json"),
      "utf8",
    )) as RegexDataPack;
    const bundled = data.sources.filter((source) => source.kind === "bundled-pack");
    expect(bundled.map((source) => source.id).sort()).toEqual([
      "price-check-base-types",
      "price-check-stats",
    ]);
    expect(new Set(bundled.map((source) => source.upstream?.project)))
      .toEqual(new Set(["Awakened PoE Trade"]));
    expect(new Set(bundled.map((source) => source.upstream?.repository)))
      .toEqual(new Set(["https://github.com/SnosMe/awakened-poe-trade"]));
    expect(new Set(bundled.map((source) => source.upstream?.commit)).size).toBe(1);
    expect(JSON.stringify(data)).not.toMatch(/\/api\/trade\/data\//i);
    expect(JSON.stringify(data)).not.toMatch(/ggg-trade-(?:items|stats|static)/i);
  });

  it("ships current core categories whose exact and optimized tokens have no category false positives", { timeout: 120_000 }, () => {
    const bytes = readFileSync(resolve(process.cwd(), "public/data/toolkit/regex-v1.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(EXPECTED_REGEX_PACK_SHA256);
    const electronMain = readFileSync(resolve(process.cwd(), "electron/main.cjs"), "utf8");
    expect(electronMain).toContain(
      `const REGEX_DATA_SHA256 = "${EXPECTED_REGEX_PACK_SHA256}";`,
    );
    const pack = JSON.parse(bytes.toString("utf8")) as unknown;
    expect(isValidRegexDataPack(pack)).toBe(true);
    const data = pack as RegexDataPack;
    const byId = new Map(data.entries.map((entry) => [entry.id, entry]));
    for (const categoryId of ["map-modifiers", "items", "map-names", "gems"]) {
      const category = data.categories.find((entry) => entry.id === categoryId);
      expect(category, categoryId).toBeDefined();
      expect(category!.entries.length, categoryId).toBeGreaterThan(50);
      const universe = category!.entries.map((reference) => ({
        reference,
        entry: byId.get(reference.entryId)!,
      }));
      for (const current of universe) {
        const own = renderedTemplate(current.entry.searchText);
        for (const pattern of [current.entry.exact, current.reference.optimized]) {
          const expression = new RegExp(pattern, "iu");
          expect(expression.test(own), `${categoryId}: ${current.entry.label}`).toBe(true);
          expect(universe.some((other) =>
            other.entry.id !== current.entry.id &&
            expression.test(renderedTemplate(other.entry.searchText))
          ), `${categoryId}: ${current.entry.label} -> ${pattern}`).toBe(false);
        }
      }
    }
  });

  it("pins the v2 corpus hash and prevents map-modifier collisions across full tooltip lines", { timeout: 120_000 }, () => {
    const data = JSON.parse(readFileSync(
      resolve(process.cwd(), "public/data/toolkit/regex-v1.json"),
      "utf8",
    )) as RegexDataPack;
    const rows = [
      ...data.entries.flatMap((entry) => templateWitnesses(entry.searchText).map((text) => ({
        family: numericSkeleton(entry.searchText),
        text,
      }))),
      ...FIXED_TOOLTIP_TEMPLATES.flatMap((template) => templateWitnesses(template).map((text) => ({
        family: numericSkeleton(template),
        text,
      }))),
    ];
    const corpus = [...new Map(rows.map((row) => [`${row.family}\0${row.text}`, row])).values()]
      .sort((left, right) => left.family.localeCompare(right.family) || left.text.localeCompare(right.text));
    const corpusHash = createHash("sha256").update(
      corpus.map((row) => `${row.family}\0${row.text}`).join("\n"),
    ).digest("hex");
    const category = data.categories.find((entry) => entry.id === "map-modifiers")!;
    expect(category.optimization).toMatchObject({
      algorithm: "shortest-full-tooltip-literal-v2",
      corpusSha256: corpusHash,
      corpusLines: corpus.length,
      verified: true,
    });
    const byId = new Map(data.entries.map((entry) => [entry.id, entry]));
    for (const reference of category.entries) {
      const entry = byId.get(reference.entryId)!;
      const family = numericSkeleton(entry.searchText);
      const expression = new RegExp(reference.optimized, "iu");
      expect(templateWitnesses(entry.searchText).some((line) => expression.test(line))).toBe(true);
      expect(corpus.some((line) => line.family !== family && expression.test(line.text)), `${entry.label} -> ${reference.optimized}`).toBe(false);
    }
  });
});
