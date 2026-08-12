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
    expect(categories).toHaveLength(44);
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

  it("matches poe.ninja's complete current 44-type and 46-route contract", () => {
    const exchange = new Set([
      "Currency", "Fragment", "Runegraft", "AllflameEmber", "Tattoo", "Omen",
      "DjinnCoin", "Ducat", "EnshroudingCrystal", "DivinationCard", "Artifact",
      "Oil", "DeliriumOrb", "Scarab", "Astrolabe", "Fossil", "Resonator", "Essence",
    ]);
    const items = new Set([
      "Wombgift", "Incubator", "UniqueWeapon", "UniqueArmour", "UniqueAccessory",
      "UniqueFlask", "Flask", "UniqueJewel", "ForbiddenJewel", "ShrineBelt",
      "UniqueTincture", "UniqueRelic", "SkillGem", "ImbuedGem", "ClusterJewel",
      "Map", "BlightedMap", "BlightRavagedMap", "UniqueMap", "ValdoMap",
      "Invitation", "Memory", "IncursionTemple", "BaseType", "Beast", "Vial",
    ]);
    const configured = new Set(categories.map((category) => category.apiType));
    expect(configured).toEqual(new Set([...exchange, ...items]));
    expect(categories.reduce(
      (routes, category) => routes + (category.source === "dual" ? 2 : 1),
      0,
    )).toBe(46);
  });

  it("selects supported defaults and keeps Faustus disabled without a backend", () => {
    for (const category of categories) {
      const expectedDefault =
        category.source === "item" ? "stash-item" : "exchange";
      expect(defaultSource(category)).toBe(expectedDefault);
      expect(supportsFaustus(category)).toBe(false);
    }
  });

  it("enables official completed-hour Faustus data only when a native transport exists", () => {
    expect(supportsFaustus(categoryById.currency, true)).toBe(true);
    expect(supportsFaustus(categoryById.fragments, true)).toBe(true);
    expect(supportsFaustus(categoryById["unique-jewels"], true)).toBe(false);
  });
});
