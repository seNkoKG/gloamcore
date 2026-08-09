import { describe, expect, it } from "vitest";
import {
  buildGroupedPoeRegex,
  buildPoeRegex,
  chunkPoeRegexQuery,
  escapePoeRegex,
  isMacroPreset,
  normalizePoeSearchText,
  shortestDistinctToken,
} from "./poe-regex";

describe("PoE regex generator", () => {
  it("escapes user syntax instead of executing it", () => {
    expect(escapePoeRegex("a+b (test)")).toBe("a\\+b \\(test\\)");
  });

  it("chooses a short fragment that is unique in the complete category", () => {
    const universe = [
      "Monsters reflect Elemental Damage",
      "Monsters reflect Physical Damage",
      "Players reflect Elemental Damage",
      "Monsters take reduced Elemental Damage",
    ];
    const token = shortestDistinctToken(universe[0], universe.slice(1));
    const expression = new RegExp(escapePoeRegex(token), "iu");
    expect(expression.test(normalizePoeSearchText(universe[0]))).toBe(true);
    expect(universe.slice(1).some((line) => expression.test(
      normalizePoeSearchText(line),
    ))).toBe(false);
  });

  it("does not optimize against only unchecked UI rows", () => {
    const result = buildPoeRegex([
      {
        id: "selected",
        label: "Monsters reflect Elemental Damage",
        selected: true,
        mode: "avoid",
      },
      {
        id: "visible-other",
        label: "Monsters reflect Physical Damage",
        selected: false,
      },
    ]);
    expect(result.expression).toBe('"!^monsters reflect elemental damage$"');
    expect(result.optimizationFallbacks).toEqual(["selected"]);
  });

  it("quotes negative AVOID terms and ORs WANT terms in Any mode", () => {
    const result = buildPoeRegex([
      {
        id: "avoid",
        label: "Monsters reflect Physical Damage",
        selected: true,
        mode: "avoid",
        optimizedToken: "re phy",
      },
      {
        id: "quantity",
        label: "increased Quantity of Items found",
        selected: true,
        mode: "want",
        optimizedToken: "quant",
      },
      {
        id: "pack",
        label: "increased Pack Size",
        selected: true,
        mode: "want",
        optimizedToken: "pack",
      },
    ]);
    expect(result.expression).toBe('"!re phy" "quant|pack"');
    expect(result.valid).toBe(true);
  });

  it("quotes every WANT term separately in All mode", () => {
    const result = buildPoeRegex([
      {
        id: "quantity",
        label: "increased Quantity of Items found",
        selected: true,
        mode: "want",
        optimizedToken: "quant",
      },
      {
        id: "pack",
        label: "increased Pack Size",
        selected: true,
        mode: "want",
        optimizedToken: "pack",
      },
    ], { wantMatch: "all" });
    expect(result.expression).toBe('"quant" "pack"');
  });

  it("ANDs required property clauses independently of WANT matching", () => {
    const result = buildPoeRegex([
      {
        id: "quantity",
        label: "increased Quantity of Items found",
        selected: true,
        mode: "want",
        optimizedToken: "quant",
      },
      {
        id: "pack",
        label: "increased Pack Size",
        selected: true,
        mode: "want",
        optimizedToken: "pack",
      },
    ], {
      requiredPatterns: ["quality: \\+20%", "rarity: rare"],
      wantMatch: "any",
    });
    expect(result.expression).toBe(
      '"quality: \\+20%" "rarity: rare" "quant|pack"',
    );
  });

  it("falls back when a supplied optimized token is not category-unique", () => {
    const universe = [
      "increased Quantity of Items found",
      "increased Quantity of Maps found",
    ];
    const result = buildPoeRegex([{
      id: "quantity",
      label: universe[0],
      selected: true,
      optimizedToken: "increased quantity",
    }], { universe });
    expect(result.expression).toBe('"^increased quantity of items found$"');
    expect(result.optimizationFallbacks).toEqual(["quantity"]);
  });

  it("reports the in-game 250 character limit and chunks at term boundaries", () => {
    const result = buildPoeRegex(
      Array.from({ length: 20 }, (_, index) => ({
        id: String(index),
        label: `Unique modifier wording ${index} ${"x".repeat(index + 3)}`,
        selected: true,
        mode: "want" as const,
      })),
      { exact: true, wantMatch: "all" },
    );
    expect(result.overflow).toBe(true);
    expect(result.characterCount).toBeGreaterThan(250);
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.every((chunk) => chunk.length <= 250)).toBe(true);
    expect(result.chunksAreLossless).toBe(false);
  });

  it("losslessly chunks WANT/Any as a union while repeating AVOID terms", () => {
    const result = chunkPoeRegexQuery({
      avoidPatterns: ["danger"],
      requiredPatterns: ["quant", "pack"],
      wantPatterns: ["alpha", "bravo", "charlie", "delta"],
      wantMatch: "any",
      limit: 35,
    });
    expect(result.lossless).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.every((chunk) =>
      chunk.startsWith('"!danger" "quant" "pack" ') && chunk.length <= 35
    )).toBe(true);
  });

  it("reports an atomic term that cannot fit instead of returning an invalid chunk", () => {
    const result = chunkPoeRegexQuery({
      avoidPatterns: [],
      wantPatterns: ["x".repeat(40)],
      wantMatch: "all",
      limit: 20,
    });
    expect(result.chunks).toEqual([]);
    expect(result.oversized).toEqual([`"${"x".repeat(40)}"`]);
    expect(result.lossless).toBe(false);
  });

  it("ANDs enabled groups and ignores disabled groups", () => {
    const result = buildGroupedPoeRegex([
      {
        id: "quality",
        label: "Quality",
        enabled: true,
        entries: [{ id: "q20", label: "+20% Quality", selected: true }],
      },
      {
        id: "links",
        label: "Links",
        enabled: false,
        entries: [{ id: "six", label: "6 Linked Sockets", selected: true }],
      },
    ]);
    expect(result.expression).toContain("(?=.*");
    expect(result.expression).not.toContain("linked");
  });

  it("recognizes saved regexes exposed as macros", () => {
    expect(
      isMacroPreset({
        id: "1",
        name: "Danger maps",
        category: "maps",
        expression: "reflect",
        tags: ["mapping", "Macro"],
        updatedAt: 1,
      }),
    ).toBe(true);
  });
});
