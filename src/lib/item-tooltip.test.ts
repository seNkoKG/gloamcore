import { describe, expect, it } from "vitest";
import {
  normalizeItemTooltip,
  plainWikiText,
  summarizeItemTooltip,
} from "./item-tooltip-data";

describe("item tooltip normalization", () => {
  it("converts wiki markup and encoded line breaks to readable text", () => {
    expect(
      plainWikiText(
        "+(30-50) to [[Dexterity]]&lt;br&gt;Magic [[Utility Flask|Utility Flasks]] constantly apply",
      ),
    ).toBe("+(30-50) to Dexterity\nMagic Utility Flasks constantly apply");
  });

  it("normalizes structured cargo item information", () => {
    const tooltip = normalizeItemTooltip(
      {
        cargoquery: [
          {
            title: {
              name: "Mirror of Kalandra",
              class: "Currency Item",
              rarity: "Normal",
              description: "Creates a mirrored copy of an item",
              "help text":
                "Right click this item then left click an equipable non-unique item.",
              "drop level": "35",
              "required level": "1",
              "frame type": "currency",
              "drop text": "Drops from a mysterious source.",
              "drop areas": "The Maven's Crucible, Absence of Mercy and Empathy",
              "drop monsters": "The Maven",
              "acquisition tags": "boss, endgame",
              "release version": "0.9.3",
              "drop enabled": "1",
              "is in game": "1",
            },
          },
        ],
      },
      { name: "Mirror of Kalandra" },
    );
    expect(tooltip).toMatchObject({
      name: "Mirror of Kalandra",
      itemClass: "Currency Item",
      description: "Creates a mirrored copy of an item",
      requiredLevel: 1,
      dropLevel: 35,
      dropText: "Drops from a mysterious source.",
      dropAreas: ["The Maven's Crucible", "Absence of Mercy and Empathy"],
      dropMonsters: ["The Maven"],
      acquisitionTags: ["boss", "endgame"],
      releaseVersion: "0.9.3",
      dropEnabled: true,
      source: "poewiki",
    });
  });

  it("prefers the matching base type when the wiki has variants", () => {
    const tooltip = normalizeItemTooltip(
      {
        cargoquery: [
          {
            title: {
              name: "Example",
              "base item": "Old Base",
              "removal version": "3.20.0",
            },
          },
          {
            title: {
              name: "Example",
              "base item": "Current Base",
              description: "Current version",
              "is in game": "1",
            },
          },
        ],
      },
      { name: "Example", baseType: "Current Base" },
    );
    expect(tooltip?.baseType).toBe("Current Base");
    expect(tooltip?.description).toBe("Current version");
  });

  it("maps Cargo frame numbers to semantic rarity themes", () => {
    const tooltip = normalizeItemTooltip(
      {
        cargoquery: [
          {
            title: {
              name: "Mageblood",
              frame_type: "3",
            },
          },
        ],
      },
      { name: "Mageblood" },
    );

    expect(tooltip?.frameType).toBe("unique");
  });

  it("builds a useful classification when prose is unavailable", () => {
    expect(
      summarizeItemTooltip({
        name: "Mageblood",
        baseType: "Heavy Belt",
        rarity: "Unique",
        frameType: "unique",
        implicitMods: [],
        explicitMods: [],
        enchantMods: [],
        dropAreas: [],
        dropMonsters: [],
        acquisitionTags: [],
        source: "poewiki",
      }),
    ).toBe("Unique Heavy Belt");
  });
});
