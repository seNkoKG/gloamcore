import { describe, expect, it } from "vitest";
import {
  buildMapRegexPropertyClauses,
  DEFAULT_MAP_REGEX_PROPERTIES,
  type MapRegexPropertySettings,
} from "./map-regex-properties";

function settings(patch: Partial<MapRegexPropertySettings> = {}): MapRegexPropertySettings {
  return {
    ...DEFAULT_MAP_REGEX_PROPERTIES,
    ...patch,
    mapRarity: {
      ...DEFAULT_MAP_REGEX_PROPERTIES.mapRarity,
      ...(patch.mapRarity || {}),
    },
    quality: {
      ...DEFAULT_MAP_REGEX_PROPERTIES.quality,
      ...(patch.quality || {}),
    },
  };
}

describe("map regex property clauses", () => {
  it("keeps yield thresholds as independent required clauses", () => {
    const result = buildMapRegexPropertyClauses(settings({
      quantity: 80,
      packSize: 30,
      moreMaps: 100,
      itemRarity: 60,
    }));
    expect(result.avoidEntries).toEqual([]);
    expect(result.requiredPatterns).toHaveLength(4);
    expect(result.requiredPatterns[0]).toMatch(/^m q\.\*/);
    expect(result.requiredPatterns[1]).toMatch(/^iz\.\*/);
    const quantity = new RegExp(result.requiredPatterns[0], "i");
    expect(quantity.test("Item Quantity: +79%")).toBe(false);
    expect(quantity.test("Item Quantity: +80%")).toBe(true);
    expect(quantity.test("Item Quantity: +129% (augmented)")).toBe(true);
  });

  it("models include and exclude map state without enabling defaults", () => {
    expect(buildMapRegexPropertyClauses(settings())).toEqual({
      requiredPatterns: [],
      avoidEntries: [],
    });
    const result = buildMapRegexPropertyClauses(settings({
      corrupted: "exclude",
      unidentified: "include",
      mapRarity: { normal: false, magic: true, rare: true, mode: "include" },
    }));
    expect(result.requiredPatterns).toEqual(["tified", "y: (m|r)"]);
    expect(result.avoidEntries.map((entry) => [entry.id, entry.exactToken])).toEqual([
      ["map-property:corrupted", "pte"],
    ]);
  });

  it("ORs quality families for Any and ANDs them for All", () => {
    const any = buildMapRegexPropertyClauses(settings({
      quality: { ...DEFAULT_MAP_REGEX_PROPERTIES.quality, regular: 20, scarab: 40, match: "any" },
    }));
    expect(any.requiredPatterns).toHaveLength(1);
    expect(any.requiredPatterns[0]).toContain("|");

    const all = buildMapRegexPropertyClauses(settings({
      quality: { ...DEFAULT_MAP_REGEX_PROPERTIES.quality, regular: 20, scarab: 40, match: "all" },
    }));
    expect(all.requiredPatterns).toHaveLength(2);
  });

  it("drops an include-all rarity constraint but can exclude all three", () => {
    const all = { normal: true, magic: true, rare: true };
    expect(buildMapRegexPropertyClauses(settings({
      mapRarity: { ...all, mode: "include" },
    })).requiredPatterns).toEqual([]);
    expect(buildMapRegexPropertyClauses(settings({
      mapRarity: { ...all, mode: "exclude" },
    })).avoidEntries[0]?.exactToken).toBe("y: (n|m|r)");
  });
});
