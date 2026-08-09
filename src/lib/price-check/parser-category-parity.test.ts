import { describe, expect, it } from "vitest";
import {
  capturedBeastCategoryFixture,
  heistBlueprintClassFixture,
  heistContractClassFixture,
  invitationCategoryFixture,
  oneLineMagicFlaskFixture,
  oneLineMagicTinctureFixture,
  uniqueFragmentFlavourFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";

describe("pinned APT parser category and identity parity", () => {
  it("canonicalizes raw Blueprint and Contract classes before Heist metadata parsing", () => {
    const blueprint = parsePoeItem(heistBlueprintClassFixture);
    expect(blueprint).toMatchObject({
      valid: true,
      itemClass: "Heist Blueprints",
      name: "Blueprint: Bunker",
      baseType: "Blueprint: Bunker",
      itemLevel: 83,
      areaLevel: 83,
      heistBlueprint: {
        target: "Enchants",
        wingsRevealed: 4,
      },
    });
    expect(blueprint.modifiers).toEqual([]);

    const contract = parsePoeItem(heistContractClassFixture);
    expect(contract).toMatchObject({
      valid: true,
      itemClass: "Heist Contracts",
      name: "Contract: Bunker",
      baseType: "Contract: Bunker",
      itemLevel: 83,
      areaLevel: 83,
      heistContract: {
        requiredJob: "Lockpicking",
        jobLevel: 5,
      },
    });
    expect(contract.modifiers).toEqual([]);
  });

  it("resolves one-line magic Flask and Tincture names to exact pinned bases", () => {
    const flask = parsePoeItem(oneLineMagicFlaskFixture);
    expect(flask).toMatchObject({
      valid: true,
      itemClass: "Utility Flasks",
      rarity: "magic",
      name: "Chemist's Amethyst Flask of the Deer",
      baseType: "Amethyst Flask",
      quality: 20,
    });
    expect(flask.modifiers.map((modifier) => modifier.text)).toEqual([
      "20(20-20)% reduced Charges per use",
      "40(36-40)% increased Evasion Rating during Effect",
    ]);
    expect(flask.modifiers.map((modifier) => modifier.text)).not.toEqual(
      expect.arrayContaining([
        "Lasts 6.50 Seconds",
        "Consumes 30 of 60 Charges on use",
        "Currently has 60 Charges",
        "+35% to Chaos Resistance",
      ]),
    );

    const tincture = parsePoeItem(oneLineMagicTinctureFixture);
    expect(tincture).toMatchObject({
      valid: true,
      itemClass: "Tinctures",
      rarity: "magic",
      name: "Perfect Ashbark Tincture of the Oak",
      baseType: "Ashbark Tincture",
      quality: 20,
    });
    // APT keeps the suffix as an unknown explicit at parse time. The Exact
    // filter builder, not the parser, is responsible for omitting that row.
    expect(tincture.modifiers.map((modifier) => modifier.text)).toEqual([
      "20(18-20)% increased Cooldown Recovery Rate",
      "15(13-15)% increased Effect",
    ]);
  });

  it("keeps Unique Fragment lore out of modifier state", () => {
    const fragment = parsePoeItem(uniqueFragmentFlavourFixture);
    expect(fragment).toMatchObject({
      valid: true,
      itemClass: "Unique Fragments",
      rarity: "unique",
      name: "First Piece of Focus",
      baseType: "Archon Kite Shield Piece",
      modifiers: [],
      flavourText: ["The first piece of a whole long forgotten."],
    });
  });

  it("exposes canonical Beast and Invitation classes for category early returns", () => {
    const beast = parsePoeItem(capturedBeastCategoryFixture);
    expect(beast).toMatchObject({
      valid: true,
      itemClass: "Captured Beasts",
      rarity: "rare",
      name: "Farric Lynx Alpha",
      itemLevel: 83,
      modifiers: [],
    });

    const invitation = parsePoeItem(invitationCategoryFixture);
    expect(invitation).toMatchObject({
      valid: true,
      itemClass: "Invitations",
      rarity: "normal",
      name: "Incandescent Invitation",
      baseType: "Incandescent Invitation",
      itemLevel: 83,
      modifiers: [],
    });
  });
});
