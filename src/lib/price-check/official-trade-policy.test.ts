import { describe, expect, it } from "vitest";
import {
  advancedRareFixture,
  currencyFixture,
  gemFixture,
  mapFixture,
  uniqueFixture,
} from "./fixtures/parser-fixtures";
import {
  shouldAutoSearchOfficialTrade,
  shouldAutoSearchOfficialTradeItemFilter,
} from "./official-trade-policy";
import { parsePoeItem } from "./parser";

describe("Awakened-style initial Trade search policy", () => {
  it("waits for an explicit search on ordinary rolled equipment", () => {
    expect(shouldAutoSearchOfficialTrade(parsePoeItem(advancedRareFixture))).toBe(false);
  });

  it.each([
    ["unique", uniqueFixture],
    ["currency", currencyFixture],
    ["gem", gemFixture],
  ])("automatically searches a copied %s", (_label, fixture) => {
    expect(shouldAutoSearchOfficialTrade(parsePoeItem(fixture))).toBe(true);
  });

  it("waits on an ordinary identified rare map's property preset", () => {
    expect(shouldAutoSearchOfficialTrade(parsePoeItem(mapFixture))).toBe(false);
  });

  it("auto-searches Valdo, normal/magic bulk, and unique maps", () => {
    const rareMap = parsePoeItem(mapFixture);
    expect(shouldAutoSearchOfficialTrade({
      ...rareMap,
      mapCompletionReward: "The Squire",
    })).toBe(true);
    expect(shouldAutoSearchOfficialTrade({ ...rareMap, rarity: "normal" })).toBe(true);
    expect(shouldAutoSearchOfficialTrade({ ...rareMap, rarity: "magic" })).toBe(true);
    expect(shouldAutoSearchOfficialTrade({ ...rareMap, rarity: "unique" })).toBe(true);
  });

  it("automatically searches unidentified or veiled equipment", () => {
    const source = parsePoeItem(advancedRareFixture);
    expect(shouldAutoSearchOfficialTrade({ ...source, identified: false })).toBe(true);
    expect(shouldAutoSearchOfficialTrade({ ...source, veiled: true })).toBe(true);
  });

  it("auto-searches listing controls but keeps ordinary item edits manual", () => {
    expect(shouldAutoSearchOfficialTradeItemFilter("listed")).toBe(true);
    expect(shouldAutoSearchOfficialTradeItemFilter("tradeCurrency")).toBe(true);
    expect(shouldAutoSearchOfficialTradeItemFilter("quality")).toBe(false);
    expect(shouldAutoSearchOfficialTradeItemFilter("links")).toBe(false);
  });
});
