import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const artwork = require("./planner-artwork.cjs");

describe("planner artwork resolution", () => {
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
  });
});
