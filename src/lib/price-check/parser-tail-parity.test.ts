import { describe, expect, it } from "vitest";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  cannotUseSplitFixture,
  flaskBasePropertiesFixture,
  imbuedGemFixture,
  mirroredTabletFixture,
  statusWordModifierFixture,
  tinctureBasePropertiesFixture,
  vaalGemSingletonFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import { buildPriceCheckQueryPlan } from "./query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";

describe("Awakened parser tail parity", () => {
  it("rejoins the exact unmet-requirement header split before parsing identity", () => {
    const parsed = parsePoeItem(cannotUseSplitFixture);

    expect(parsed).toMatchObject({
      valid: true,
      itemClass: "Wands",
      rarity: "rare",
      name: "Doom Needle",
      baseType: "Imbued Wand",
      itemLevel: 86,
    });
    expect(parsed.unknownSections.flat()).not.toContain(
      "You cannot use this item. Its stats will be ignored",
    );
  });

  it("uses the pinned GEM namespace to replace a Vaal gem singleton identity", () => {
    const parsed = parsePoeItem(vaalGemSingletonFixture);
    const plan = buildPriceCheckQueryPlan(parsed, "Allflame", { mode: "exact" });

    expect(parsed).toMatchObject({
      valid: true,
      rarity: "gem",
      name: "Vaal Fireball",
      baseType: "Fireball",
      gemLevel: 20,
    });
    expect((plan.tradeQuery.query as { type?: unknown }).type).toBe("Vaal Fireball");
  });

  it("consumes complete Flask and Tincture base-effect blocks without losing affixes", () => {
    const cases = [
      {
        raw: flaskBasePropertiesFixture,
        baseLines: [
          "Lasts 5.00 Seconds",
          "Consumes 20 of 50 Charges on use",
          "Currently has 0 Charges",
          "+40% to Fire Resistance",
        ],
        affix: "20% increased Charge Recovery",
      },
      {
        raw: tinctureBasePropertiesFixture,
        baseLines: [
          "40% increased Elemental Damage with Melee Weapons",
          "Mana Burn causes you to lose 1% of your maximum Mana per second",
        ],
        affix: "20% increased Cooldown Recovery Rate",
      },
    ];

    for (const current of cases) {
      const parsed = parsePoeItem(current.raw);
      expect(parsed.valid).toBe(true);
      expect(parsed.modifiers.map((modifier) => modifier.text)).toEqual([
        current.affix,
      ]);
      expect(parsed.unknownSections.flat()).not.toEqual(
        expect.arrayContaining(current.baseLines),
      );
    }
  });

  it("derives status flags only from nameplates, standalone markers, or modifier kind", () => {
    const parsed = parsePoeItem(statusWordModifierFixture);

    expect(parsed.modifiers).toHaveLength(3);
    expect(parsed.modifiers.every((modifier) => modifier.kind === "explicit"))
      .toBe(true);
    expect(parsed).toMatchObject({
      fractured: false,
      veiled: false,
      scourged: false,
    });
  });

  it("keeps a suffixless built-in support as an exact Imbued gem stat", () => {
    const parsed = applyTradeStatCatalog(
      parsePoeItem(imbuedGemFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const imbued = parsed.modifiers.find((modifier) => modifier.kind === "imbued");
    const plan = buildPriceCheckQueryPlan(parsed, "Allflame", { mode: "exact" });

    expect(imbued).toMatchObject({
      text: "Supported by Level 1 Added Fire Damage",
      tradeId: "imbued.pseudo_built_in_support|2554120916",
    });
    expect(plan.filters).toContainEqual(expect.objectContaining({
      modifierId: imbued!.id,
      tradeId: "imbued.pseudo_built_in_support|2554120916",
      enabled: true,
      mode: "presence",
    }));
    expect(plan.itemFilters).not.toHaveProperty("imbuedGem");
    expect(
      (plan.tradeQuery.query as any).filters.misc_filters.filters,
    ).not.toHaveProperty("gem_imbued");
  });

  it("parses every eight-line Mirrored Tablet section as Pseudo before catalog planning", () => {
    const parsed = parsePoeItem(mirroredTabletFixture);
    expect(parsed.modifiers).toHaveLength(8);
    expect(parsed.modifiers.every((modifier) =>
      modifier.kind === "pseudo" && modifier.tags.includes("mirrored-tablet")
    )).toBe(true);

    const hydrated = applyTradeStatCatalog(
      parsed,
      actualCatalog as TradeStatCatalogPack,
    );
    const plan = buildPriceCheckQueryPlan(hydrated, "Allflame", { mode: "exact" });
    const filtersByText = new Map(plan.filters.map((filter) => [
      hydrated.modifiers.find((modifier) => modifier.id === filter.modifierId)?.text,
      filter,
    ]));

    expect(filtersByText.get("Reflection of Kalandra (Difficulty 12)"))
      .toMatchObject({ enabled: true });
    expect(filtersByText.get("Reflection of the Sun (Difficulty 11)"))
      .toMatchObject({ enabled: true });
    expect(filtersByText.get("Reflection of Delirium (Difficulty 9)"))
      .toMatchObject({ mode: "presence" });
    // Neither row exists in the pinned 3.29.104 stat database.
    expect(filtersByText.has("Reflection of Future Worlds (Difficulty 9)"))
      .toBe(false);
    expect(filtersByText.has("Reflection of Minor Worlds (Difficulty 7)"))
      .toBe(false);
  });
});
