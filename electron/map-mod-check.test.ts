import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  analyseMapText,
  canonicalMapModifier,
  mapModifierDefinitions,
  sanitizeMapModSettings,
} = require("./map-mod-check.cjs");

const pack = {
  entries: [{ id: "entry:aaaaaaaaaaaaaaaaaaaaaaaa", label: "Players cannot Regenerate Life, Mana or Energy Shield", exact: "^players cannot regenerate life, mana or energy shield$" }],
  categories: [{ id: "map-modifiers", entries: [{ entryId: "entry:aaaaaaaaaaaaaaaaaaaaaaaa" }] }],
};

describe("map mod check", () => {
  it("preserves signs while canonicalising numeric rolls", () => {
    expect(canonicalMapModifier("Players have -12% to maximum Resistances")).toBe("players have -#% to maximum resistances");
    expect(canonicalMapModifier("+40% Monster Resistance")).toBe("+#% monster resistance");
  });

  it("classifies exact map lines and uses the worst configured severity", () => {
    const definitions = mapModifierDefinitions(pack);
    const result = analyseMapText(`Item Class: Maps\nRarity: Rare\nDoom Trail\nStrand Map\n--------\nMap Tier: 16\n--------\nPlayers cannot Regenerate Life, Mana or Energy Shield`, definitions, {
      rules: { "entry:aaaaaaaaaaaaaaaaaaaaaaaa": "bad" },
    });
    expect(result).toMatchObject({ ok: true, name: "Doom Trail", baseType: "Strand Map", overall: "bad" });
    expect(result.results).toEqual([expect.objectContaining({ known: true, rating: "bad" })]);
  });

  it("rejects fragments and sanitises persisted ratings", () => {
    const result = analyseMapText("Item Class: Map Fragments\nRarity: Normal\nMortal Grief", mapModifierDefinitions(pack), {});
    expect(result).toMatchObject({ ok: false, itemClass: "Map Fragments" });
    expect(sanitizeMapModSettings({ rules: { "entry:aaaaaaaaaaaaaaaaaaaaaaaa": "warn", unsafe: "bad" }, customRules: { "  +12% TEST ": "good" } })).toMatchObject({
      rules: { "entry:aaaaaaaaaaaaaaaaaaaaaaaa": "warn" },
      customRules: { "+#% test": "good" },
    });
  });
});
