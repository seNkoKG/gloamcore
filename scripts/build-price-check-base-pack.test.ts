import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("base-type pack generator", () => {
  it("preserves ordered item and unique variants with all discriminator metadata", () => {
    const temporary = mkdtempSync(resolve(tmpdir(), "poe-base-pack-"));
    const input = resolve(temporary, "items.ndjson");
    const output = resolve(temporary, "base-types.json");
    try {
      const lines = [
        {
          namespace: "ITEM",
          refName: "Crimson Jewel",
          name: "Crimson Jewel",
          craftable: { category: "Jewel" },
        },
        {
          namespace: "ITEM",
          refName: "Variant Base",
          name: "Variant Base",
          craftable: { category: "Boots" },
          armour: { ar: [10, 20] },
          disc: { propAR: true, mapTier: "W" },
        },
        {
          namespace: "ITEM",
          refName: "Variant Base",
          name: "Variant Base",
          craftable: { category: "Boots" },
          armour: {},
          disc: {
            propEV: true,
            propES: true,
            hasImplicit: { ref: "implicit ref" },
            hasExplicit: { ref: "explicit ref" },
            sectionText: "copied section",
          },
        },
        {
          namespace: "UNIQUE",
          refName: "Metadata Missing",
          unique: { base: "Crimson Jewel" },
        },
        {
          namespace: "UNIQUE",
          refName: "Metadata Empty",
          unique: { base: "Crimson Jewel", fixedStats: [] },
        },
        {
          namespace: "UNIQUE",
          refName: "Metadata Populated",
          unique: { base: "Crimson Jewel", fixedStats: ["Historic"] },
        },
        {
          namespace: "UNIQUE",
          refName: "Multi Base Unique",
          name: "Multi Base Unique",
          icon: "first.png",
          unique: { base: "Crimson Jewel" },
        },
        {
          namespace: "UNIQUE",
          refName: "Multi Base Unique",
          name: "Multi Base Unique",
          icon: "second.png",
          unique: { base: "Cobalt Jewel" },
        },
      ];
      writeFileSync(
        input,
        `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
        "utf8",
      );
      execFileSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/build-price-check-base-pack.mjs"), input, output],
        { stdio: "pipe" },
      );
      const pack = JSON.parse(readFileSync(output, "utf8")) as {
        schema: number;
        source: { commit: string; inputGitBlob: string };
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
        itemProfiles: Record<string, Array<{
          sourceIndex: number;
          armour?: Record<string, [number, number]>;
          disc?: Record<string, unknown>;
        }>>;
        uniqueProfiles: Record<string, Array<{
          sourceIndex: number;
          baseType: string;
          icon?: string;
          modifierPolicy: string;
          fixedStats?: string[];
        }>>;
      };

      expect(pack.schema).toBe(2);
      expect(pack.uniqueProfiles["Metadata Missing"][0]).toMatchObject({
        baseType: "Crimson Jewel",
        modifierPolicy: "source-bounds-only",
      });
      expect(pack.uniqueProfiles["Metadata Empty"][0]).toMatchObject({
        baseType: "Crimson Jewel",
        modifierPolicy: "all-explicit-variants",
        fixedStats: [],
      });
      expect(pack.uniqueProfiles["Metadata Populated"][0]).toMatchObject({
        baseType: "Crimson Jewel",
        modifierPolicy: "non-fixed-explicit-variants",
        fixedStats: ["Historic"],
      });
      expect(pack.itemProfiles["Variant Base"]).toMatchObject([
        {
          sourceIndex: 1,
          armour: { ar: [10, 20] },
          disc: { propAR: true, mapTier: "W" },
        },
        {
          sourceIndex: 2,
          armour: {},
          disc: {
            propEV: true,
            propES: true,
            hasImplicit: { ref: "implicit ref" },
            hasExplicit: { ref: "explicit ref" },
            sectionText: "copied section",
          },
        },
      ]);
      expect(pack.uniqueProfiles["Multi Base Unique"]).toMatchObject([
        { sourceIndex: 6, baseType: "Crimson Jewel", icon: "first.png" },
        { sourceIndex: 7, baseType: "Cobalt Jewel", icon: "second.png" },
      ]);
      expect(pack.source).toMatchObject({
        commit: "adb6c287bd978a70701e2b65d744dd677c52fb65",
        inputGitBlob: "986361944cb6107fe308eb2417ae21807739a0c8",
      });
      expect(pack.capabilities).toEqual({
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
      expect(pack.coverage).toEqual({
        itemIdentities: 2,
        itemVariants: 3,
        armourVariants: 2,
        discriminatedItemVariants: 2,
        uniqueIdentities: 4,
        uniqueVariants: 5,
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
