import { describe, expect, it } from "vitest";
import {
  categories,
  categoryById,
  categoryGroups,
  defaultSource,
  supportsFaustus,
} from "./categories";

describe("economy category catalogue", () => {
  it("keeps every configured market unique and discoverable", () => {
    expect(categories).toHaveLength(43);
    expect(new Set(categories.map((category) => category.id)).size).toBe(
      categories.length,
    );
    for (const category of categories) {
      expect(categoryById[category.id]).toBe(category);
      expect(category.apiType.trim()).not.toBe("");
      expect(category.label.trim()).not.toBe("");
      expect(category.description.trim()).not.toBe("");
      expect(categoryGroups).toContain(category.group);
    }
  });

  it("selects supported defaults and keeps Faustus disabled without a backend", () => {
    for (const category of categories) {
      const expectedDefault =
        category.source === "item" ? "stash-item" : "exchange";
      expect(defaultSource(category)).toBe(expectedDefault);
      expect(supportsFaustus(category)).toBe(false);
    }
  });
});
