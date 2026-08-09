import { describe, expect, it } from "vitest";
import {
  chartFixture,
  unidentifiedChartFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";

describe("Awakened Chart parser parity", () => {
  it("parses the required known area before generic property/modifier logic", () => {
    const parsed = parsePoeItem(chartFixture);

    expect(parsed).toMatchObject({
      valid: true,
      itemClass: "Chart",
      rarity: "rare",
      name: "Marine Dive",
      baseType: "Coral Forest Chart",
      itemLevel: 69,
      requiredLevel: 54,
      chartArea: "Undersea Groves",
      chartAreaTradeDiscriminator: "UnderseaGroves",
      areaLevel: 69,
      areaItemQuantity: 64,
      chartSulphur: 60,
      properties: {
        "Area Level": "69",
        "Item Quantity": "+64%",
        "Dead Man's Sulphur": "+60%",
        "Item Level": "69",
      },
    });
    expect(parsed.modifiers.map((modifier) => modifier.text)).not.toEqual(
      expect.arrayContaining([
        "Undersea Groves",
        "Area Level: 69",
        "Item Quantity: +64% (augmented)",
        "Dead Man's Sulphur: +60% (augmented)",
        "Voyage Modifier will be revealed once Charted",
        "Chart Shape: Corner",
      ]),
    );
  });

  it("parses an unidentified Chart's area while preserving its Bulk identity", () => {
    expect(parsePoeItem(unidentifiedChartFixture)).toMatchObject({
      valid: true,
      itemClass: "Chart",
      rarity: "magic",
      name: "Coral Forest Chart",
      baseType: "Coral Forest Chart",
      identified: false,
      itemLevel: 12,
      chartArea: "Undersea Groves",
      chartAreaTradeDiscriminator: "UnderseaGroves",
      areaLevel: 12,
    });
  });

  it("requires the pinned AREA identity when an Area Level marks a Chart section", () => {
    const parsed = parsePoeItem(chartFixture.replace(
      "Undersea Groves\nArea Level: 69",
      "Future Unknown Depths\nArea Level: 69",
    ));

    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toContain("Unknown Chart area: Future Unknown Depths.");
    expect(parsed.chartArea).toBeUndefined();
    expect(parsed.unknownSections).toContainEqual(expect.arrayContaining([
      "Future Unknown Depths",
      "Area Level: 69",
    ]));
  });
});
