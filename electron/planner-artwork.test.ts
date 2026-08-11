import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const artwork = require("./planner-artwork.cjs");

describe("planner artwork resolution", () => {
  it("builds current item metadata from decoded authoritative Wiki rows", () => {
    const metadata = artwork.currentWikiItemMetadataByName([
      {
        title: {
          name: "Awakener&#039;s Orb",
          "metadata id": "Metadata/Items/Currency/CurrencyConquerorExaltedOrb",
          "is in game": "1",
        },
      },
      {
        title: {
          name: "Removed Orb",
          "metadata id": "Metadata/Items/Currency/RemovedOrb",
          "removal version": "3.0.0",
        },
      },
      {
        title: {
          name: "Invalid Orb",
          "metadata id": "2DItems/Currency/InvalidOrb",
        },
      },
    ]);

    expect(metadata.get("awakener's orb")).toBe(
      "Metadata/Items/Currency/CurrencyConquerorExaltedOrb",
    );
    expect(metadata.has("removed orb")).toBe(false);
    expect(metadata.has("invalid orb")).toBe(false);
  });

  it("matches unique names after decoding Wiki apostrophe entities", () => {
    const rows = [
      { name: "Prismatic Jewel", "inventory icon": "File:Prismatic Jewel inventory icon.png" },
      { name: "Watcher&#039;s Eye", "inventory icon": "File:Watcher&#039;s Eye inventory icon.png" },
    ];
    expect(artwork.selectPlannerArtworkRow(rows, { name: "Watcher's Eye", baseType: "Prismatic Jewel" })).toBe(rows[1]);
    expect(artwork.normalizedWikiArtworkTitle(rows[1]["inventory icon"])).toBe("file:watcher's eye inventory icon.png");
  });

  it("falls back only to the generic base record and avoids broad base-item queries", () => {
    const rows = [
      { name: "Bound By Destiny", "base item": "Prismatic Jewel" },
      { name: "Prismatic Jewel", "inventory icon": "File:Prismatic Jewel inventory icon.png" },
    ];
    expect(artwork.selectPlannerArtworkRow(rows, { name: "Rare Name", baseType: "Prismatic Jewel" })).toBe(rows[1]);
    const where = new URL(artwork.plannerArtworkCargoUrl("https://wiki.test/api", ["Rare Name", "Prismatic Jewel"])).searchParams.get("where");
    expect(where).toContain("name IN");
    expect(where).not.toContain("base_item IN");
    expect(new URL(artwork.plannerArtworkCargoUrl("https://wiki.test/api", ["Divinarius"])).searchParams.get("fields")).toContain("size_x,size_y");
  });

  it("accepts only valid authoritative inventory-cell dimensions", () => {
    expect(artwork.plannerArtworkDimensions({ "size x": "1", "size y": "3" })).toEqual({ width: 1, height: 3 });
    expect(artwork.plannerArtworkDimensions({ size_x: "2", size_y: "4" })).toEqual({ width: 2, height: 4 });
    expect(artwork.plannerArtworkDimensions({ "size x": "0", "size y": "3" })).toBeNull();
    expect(artwork.plannerArtworkDimensions({ "size x": "2.5", "size y": "3" })).toBeNull();
  });

  it("resolves gems by exact transfigured name before their shared metadata id", () => {
    const rows = [
      { name: "Firestorm", "metadata id": "Metadata/Items/Gems/SkillGemFirestorm", "inventory icon": "File:Firestorm inventory icon.png" },
      { name: "Firestorm of Pelting", "metadata id": "Metadata/Items/Gems/SkillGemFirestorm", "inventory icon": "File:Firestorm of Pelting inventory icon.png" },
    ];
    const item = {
      name: "Firestorm of Pelting",
      metadataId: "Metadata/Items/Gems/SkillGemFirestorm",
    };
    expect(artwork.selectPlannerArtworkRow(rows, item)).toBe(rows[1]);
    const url = new URL(artwork.plannerArtworkCargoUrl("https://wiki.test/api", [item]));
    expect(url.searchParams.get("fields")).toContain("metadata_id");
    expect(url.searchParams.get("where")).toContain("metadata_id IN");
  });
});
