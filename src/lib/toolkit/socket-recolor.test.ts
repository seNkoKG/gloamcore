import { describe, expect, it } from "vitest";
import {
  baseSocketColourChances,
  calculateSocketRecipes,
  socketColourChances,
  whiteSocketChance,
} from "./socket-recolor";

describe("3.29 socket recolor model", () => {
  it("keeps base RGB chances normalized", () => {
    const requirements: Array<readonly [number, number, number]> = [
      [0, 0, 194],
      [114, 122, 0],
      [66, 66, 66],
    ];
    for (const [strength, dexterity, intelligence] of requirements) {
      const chances = baseSocketColourChances(strength, dexterity, intelligence);
      expect(chances.r + chances.g + chances.b).toBeCloseTo(1, 10);
    }
  });

  it("makes high-level quality items less likely to roll white", () => {
    expect(whiteSocketChance(86, 30)).toBeLessThan(whiteSocketChance(40, 0));
  });

  it("includes white dilution in final per-socket chances", () => {
    const chances = socketColourChances({
      requirementStrength: 0,
      requirementDexterity: 0,
      requirementIntelligence: 194,
      itemLevel: 86,
      quality: 20,
      sockets: 6,
      red: 1,
      green: 1,
      blue: 4,
    });
    expect(chances.r + chances.g + chances.b + chances.w).toBeCloseTo(1, 10);
    expect(chances.b).toBeGreaterThan(chances.r);
    expect(chances.w).toBeGreaterThan(0);
  });

  it("does not display a plausible white chance without intrinsic base requirements", () => {
    expect(socketColourChances({
      requirementStrength: 0,
      requirementDexterity: 0,
      requirementIntelligence: 0,
      itemLevel: 86,
      quality: 20,
      sockets: 6,
      red: 1,
      green: 1,
      blue: 4,
    })).toEqual({ r: 0, g: 0, b: 0, w: 0 });
  });

  it("prices all applicable craft methods and puts priced rows first", () => {
    const rows = calculateSocketRecipes(
      {
        requirementStrength: 0,
        requirementDexterity: 0,
        requirementIntelligence: 194,
        itemLevel: 86,
        quality: 20,
        sockets: 6,
        red: 2,
        green: 1,
        blue: 3,
      },
      { chromaticChaos: 0.25, trichromatismChaos: 100 },
    );
    expect(rows.some((row) => row.key === "chromatic")).toBe(true);
    expect(rows.some((row) => row.key === "trichromatism")).toBe(true);
    expect(rows.at(-1)?.key).toBe("natural");
    expect(rows[0]?.chance).toBeGreaterThan(0);
  });

  it("refuses plausible-looking results when required item facts are missing", () => {
    expect(
      calculateSocketRecipes({
        requirementStrength: 0,
        requirementDexterity: 0,
        requirementIntelligence: 0,
        itemLevel: 0,
        quality: 0,
        sockets: 6,
        red: 1,
        green: 1,
        blue: 4,
      }),
    ).toEqual([]);
    expect(calculateSocketRecipes({
      requirementStrength: -10,
      requirementDexterity: 0,
      requirementIntelligence: 20,
      itemLevel: 86,
      quality: 20,
      sockets: 2.5,
      red: 1,
      green: 0,
      blue: 1,
    })).toEqual([]);
    expect(socketColourChances({
      requirementStrength: 100,
      requirementDexterity: 0,
      requirementIntelligence: 0,
      itemLevel: 0,
      quality: 20,
      sockets: 1,
      red: 1,
      green: 0,
      blue: 0,
    })).toEqual({ r: 0, g: 0, b: 0, w: 0 });
  });

  it.each([
    {
      note: "mono intelligence, one blue",
      input: { requirementStrength: 0, requirementDexterity: 0, requirementIntelligence: 194, itemLevel: 86, quality: 20, sockets: 6, red: 0, green: 0, blue: 1 },
      expected: { natural: 0.85831703807798, chromatic: 0.97451191324173, trichromatism: 1, "nonwhite-2": 0.9945155715875, "nonwhite-3": 0.99892095826037, "nonwhite-4": 0.99978770238423 },
    },
    {
      note: "mono intelligence, two blues suppresses the one-colour guarantee",
      input: { requirementStrength: 0, requirementDexterity: 0, requirementIntelligence: 194, itemLevel: 86, quality: 20, sockets: 6, red: 0, green: 0, blue: 2 },
      expected: { natural: 0.53103674639835, chromatic: 0.53983508446424, trichromatism: 0.62359202728685, "nonwhite-2": 0.91982361937596, "nonwhite-3": 0.97812416046894, "nonwhite-4": 0.99449557343659 },
    },
    {
      note: "dual requirement base",
      input: { requirementStrength: 114, requirementDexterity: 122, requirementIntelligence: 0, itemLevel: 86, quality: 20, sockets: 4, red: 2, green: 0, blue: 0 },
      expected: { natural: 0.097868303000456, chromatic: 0.10437474617543, trichromatism: 0.14085762711864, "nonwhite-2": 0.32405029043634, "nonwhite-3": 0.46137254396309, "nonwhite-4": 0.58384158564053 },
    },
    {
      note: "tri-requirement guaranteed trichromatism",
      input: { requirementStrength: 66, requirementDexterity: 66, requirementIntelligence: 66, itemLevel: 100, quality: 30, sockets: 4, red: 1, green: 1, blue: 1 },
      expected: { natural: 0.051772589339859, chromatic: 0.053075635190505, trichromatism: 1, "nonwhite-2": 0.18633333333333, "nonwhite-3": 0.31538888888889, "nonwhite-4": 0.44444444444444 },
    },
  ])("matches the public Siveran reference: $note", ({ input, expected }) => {
    const rows = calculateSocketRecipes(input, { chromaticChaos: 1, trichromatismChaos: 1 });
    expect(rows.map((row) => row.key).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, chance] of Object.entries(expected)) {
      expect(rows.find((row) => row.key === key)?.chance, key).toBeCloseTo(chance, 12);
    }
  });
});
