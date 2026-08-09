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
    officialRetrievedAt: "2026-08-08T00:00:00.000Z",
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
    officialTrade: { itemGroups: 1, statGroups: 1, staticGroups: 1 },
  },
  sources: [{
    id: "source",
    label: "Fixture",
    kind: "official-endpoint",
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
      optimizedToken: "hex",
      selected: true,
      mode: "avoid",
    }]);
    expect(buildPoeRegex(materialized).expression).toBe('"!hex"');
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

  it("searches labels, text, and tags within a category", () => {
    expect(searchRegexCategory(fixture, "map-modifiers", "HEX")).toHaveLength(1);
    expect(searchRegexCategory(fixture, "map-modifiers", "reflect")).toEqual([]);
  });

  it("pins the audited 2026-08-09 official Trade drift in generated provenance", () => {
    const data = JSON.parse(readFileSync(
      resolve(process.cwd(), "public/data/toolkit/regex-v1.json"),
      "utf8",
    )) as RegexDataPack;
    expect(data.entries).toHaveLength(19_672);
    expect(data.sources.find((source) => source.id === "ggg-trade-stats"))
      .toMatchObject({
        inputSha256: "53b7100397d5297bd887df9aadfec7b3bfc5305e41b4292580ef9b03c849aeb7",
        upstream: { lastModified: "Sun, 09 Aug 2026 04:34:19 GMT" },
      });
    expect(data.entries.find((entry) =>
      entry.sourceRefs?.includes("implicit.stat_689723685")
    )).toMatchObject({
      label: "While a Pinnacle Atlas Boss is in your Presence, Bone Offering has #% increased Effect",
      sourceIds: ["ggg-trade-stats"],
      sourceRefs: ["implicit.stat_689723685"],
      tags: ["implicit"],
    });
    const barrelOrder = [
      "explicit.stat_2343561786",
      "fractured.stat_2343561786",
      "enchant.stat_1207515735",
      "enchant.stat_4019701925",
      "enchant.stat_1669553893",
      "enchant.stat_1080470148",
    ];
    for (const label of [
      "Area contains # additional Clusters of Mysterious Barrels",
      "Your Maps contain # additional Clusters of Mysterious Barrels",
    ]) {
      expect(data.entries.find((entry) => entry.label === label)?.sourceRefs)
        .toEqual(barrelOrder);
    }
  });

  it("ships current core categories whose exact and optimized tokens have no category false positives", { timeout: 120_000 }, () => {
    const bytes = readFileSync(resolve(process.cwd(), "public/data/toolkit/regex-v1.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(EXPECTED_REGEX_PACK_SHA256);
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
});
