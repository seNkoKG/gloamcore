import { describe, expect, it } from "vitest";
import {
  armourModifierParityFixture,
  golemSpellKineticWandFixture,
  lowQualityWeaponFixture,
  magicFixture,
  malachaisLoopVestigialFixture,
  rareDefenceFixture,
  rareWeaponFixture,
} from "./fixtures/parser-fixtures";
import {
  isEquipmentPropertyFilter,
  isOfficialPriceCheckFilter,
  planEquipmentPropertyFilters,
} from "./equipment-properties";
import { parsePoeItem } from "./parser";
import { buildPriceCheckQueryPlan, planPriceCheckFilters } from "./query-plan";
import { armourBaseProfile } from "./magic-base-type";

function queryFilters(plan: ReturnType<typeof buildPriceCheckQueryPlan>) {
  return (plan.tradeQuery as any).query.filters;
}

describe("calculated equipment property filters", () => {
  it("plans every copied defence and block filter without auto-selecting a hybrid total", () => {
    const item = parsePoeItem(rareDefenceFixture);
    expect(item.valid).toBe(true);
    expect(item.properties).toMatchObject({
      Armour: "1,200",
      "Evasion Rating": "700",
      "Energy Shield": "300",
      "Chance to Block": "25%",
    });

    const plan = planEquipmentPropertyFilters(item, 10);
    expect(plan.filters.map((filter) => filter.equipmentProperty?.key)).toEqual([
      "ar",
      "ev",
      "es",
      "block",
    ]);
    expect(plan.filters.every(isEquipmentPropertyFilter)).toBe(true);
    expect(plan.filters.every(isOfficialPriceCheckFilter)).toBe(true);
    expect(plan.filters.map((filter) => filter.enabled)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(plan.filters[0]).toMatchObject({
      label: "Armour: 1200",
      copiedValue: 1200,
      mode: "range",
      min: 1200,
    });
    expect(plan.warnings.join(" ")).not.toContain("Base defence percentile is omitted");
  });

  it("enables a single defence and keeps zero-tolerance properties directional", () => {
    const parsed = parsePoeItem(rareDefenceFixture);
    const item = {
      ...parsed,
      properties: {
        Ward: "640 (augmented)",
        "Chance to Block": "29%",
      },
      quality: 20,
    };
    const planned = planEquipmentPropertyFilters(item, 0);
    expect(planned.filters).toMatchObject([
      {
        label: "Ward: 640",
        enabled: true,
        mode: "range",
        min: 640,
        equipmentProperty: { group: "armour_filters", key: "ward" },
      },
      {
        label: "Block: 29%",
        enabled: false,
        equipmentProperty: { group: "armour_filters", key: "block" },
      },
    ]);

    const plan = buildPriceCheckQueryPlan(item, "Allflame", {
      rollTolerance: 0,
      filters: planned.filters.map((filter) => ({ ...filter, enabled: true })),
    });
    expect(queryFilters(plan).armour_filters.filters).toEqual({
      ward: { min: 640 },
      block: { min: 29 },
    });
    expect((plan.tradeQuery as any).query.stats[0].filters).toEqual([]);
  });

  it("projects advanced local Energy Shield bounds and consumes their source rows", () => {
    const item = parsePoeItem(armourModifierParityFixture);
    const plan = planEquipmentPropertyFilters(item, 10);
    const energyShield = plan.filters.find(
      (filter) => filter.equipmentProperty?.key === "es",
    );
    const localSource = item.modifiers.find(
      (modifier) => modifier.normalizedText === "#% increased energy shield",
    );

    expect(energyShield).toMatchObject({
      modifierId: "property:energy-shield",
      copiedValue: 753,
      enabled: true,
      mode: "range",
      min: 677,
    });
    expect(energyShield?.bounds).toBeUndefined();
    expect(plan.consumedModifierIds).toEqual([localSource?.id]);
  });

  it("collapses a source-free magic armour property to APT's exact Q20 total", () => {
    const item = parsePoeItem(magicFixture);
    const plan = planEquipmentPropertyFilters(item, 10);
    const energyShield = plan.filters.find(
      (filter) => filter.equipmentProperty?.key === "es",
    );

    expect(energyShield).toMatchObject({
      label: "Energy Shield: 210",
      copiedValue: 210,
      enabled: true,
      min: 210,
    });
    expect(plan.consumedModifierIds).toEqual([]);

    expect(planEquipmentPropertyFilters(item, 2, true).filters.find(
      (filter) => filter.equipmentProperty?.key === "base_defence_percentile",
    )).toMatchObject({
      label: "Base Percentile: 15%",
      copiedValue: 15,
      enabled: false,
      min: 14,
    });

    const query = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "similar",
    });
    expect(queryFilters(query).armour_filters.filters.es).toEqual({ min: 210 });
  });

  it("keeps variable Malachai ES bounded while hiding its fixed Block row", () => {
    const item = parsePoeItem(malachaisLoopVestigialFixture);
    const byKey = new Map(planEquipmentPropertyFilters(item, 10).filters.map(
      (filter) => [filter.equipmentProperty?.key, filter],
    ));

    expect(byKey.get("es")).toMatchObject({
      label: "Energy Shield: 240",
      copiedValue: 240,
      enabled: true,
      min: 237,
      bounds: { min: 230, max: 261 },
    });
    expect(byKey.get("block")).toMatchObject({
      label: "Block: 23%",
      copiedValue: 23,
      enabled: false,
      advancedOnly: true,
      equipmentProperty: { group: "armour_filters", key: "block" },
    });
    expect(byKey.get("block")).not.toHaveProperty("min");
    expect(byKey.get("block")).not.toHaveProperty("bounds");
  });

  it("reconstructs Awakened's exact/base defence percentile from pinned bases", () => {
    const item = parsePoeItem(`Item Class: Body Armours
Rarity: Rare
Vengeance Mantle
Vaal Regalia
--------
Quality: +20%
Energy Shield: 230.4
--------
Item Level: 86`);
    expect(item).toMatchObject({
      name: "Vengeance Mantle",
      baseType: "Vaal Regalia",
      quality: 20,
      properties: { "Energy Shield": "230.4" },
    });
    expect(armourBaseProfile(item.baseType)).toEqual({ es: [171, 197] });
    expect(planEquipmentPropertyFilters(item, 2, true).filters.find(
      (filter) => filter.equipmentProperty?.key === "base_defence_percentile",
    )).toBeDefined();
    const plan = buildPriceCheckQueryPlan(item, "Allflame", { mode: "exact" });
    const percentile = plan.filters.find(
      (filter) => filter.equipmentProperty?.key === "base_defence_percentile",
    );

    expect(percentile).toMatchObject({
      copiedValue: 81,
      enabled: true,
      equipmentProperty: {
        group: "armour_filters",
        key: "base_defence_percentile",
      },
    });
    expect(queryFilters(plan).armour_filters.filters.base_defence_percentile)
      .toEqual({ min: 79 });

    const unique = planEquipmentPropertyFilters({
      ...item,
      rarity: "unique",
      name: "Emperor's Vigilance",
    }, 10).filters.find(
      (filter) => filter.equipmentProperty?.key === "base_defence_percentile",
    );
    expect(unique).toMatchObject({
      copiedValue: 81,
      min: 71,
      bounds: { min: 0, max: 100 },
    });
  });

  it("calculates Awakened's hybrid weapon DPS rows exactly once", () => {
    const item = parsePoeItem(rareWeaponFixture);
    expect(item.valid).toBe(true);
    const plan = planEquipmentPropertyFilters(item, 10);
    expect(plan.filters.map((filter) => filter.equipmentProperty?.key)).toEqual([
      "dps",
      "edps",
      "pdps",
      "aps",
      "crit",
    ]);
    const byKey = new Map(
      plan.filters.map((filter) => [filter.equipmentProperty?.key, filter]),
    );
    expect(byKey.has("damage")).toBe(false);
    expect(byKey.get("aps")?.copiedValue).toBe(1.5);
    expect(byKey.get("crit")?.copiedValue).toBe(6.5);
    expect(byKey.get("dps")?.copiedValue).toBe(322);
    expect(byKey.get("pdps")?.copiedValue).toBe(225);
    expect(byKey.get("edps")?.copiedValue).toBe(97);
    expect(byKey.get("dps")?.min).toBe(322);
    expect(byKey.get("pdps")?.min).toBe(225);
    expect(byKey.get("edps")?.min).toBe(97);
    expect(byKey.get("dps")?.enabled).toBe(true);
    expect(byKey.get("pdps")?.enabled).toBe(true);
    expect(byKey.get("edps")?.enabled).toBe(false);
    expect(byKey.get("edps")?.advancedOnly).toBe(true);

    const exact = planEquipmentPropertyFilters(item, 0).filters.map(
      (filter) => ({ ...filter, enabled: true }),
    );
    const queryPlan = buildPriceCheckQueryPlan(item, "Allflame", {
      filters: exact,
      rollTolerance: 0,
    });
    const query = queryFilters(queryPlan);
    expect(query.weapon_filters.filters).toEqual({
      aps: { min: 1.5 },
      crit: { min: 6.5 },
      dps: { min: 322 },
      pdps: { min: 225 },
      edps: { min: 97 },
    });
    const browserPayload = JSON.parse(
      new URL(queryPlan.tradeUrl).searchParams.get("q") || "null",
    );
    expect(browserPayload).toEqual(queryPlan.tradeQuery);
  });

  it("keeps the reported pure-physical wand compact and pDPS optional", () => {
    const item = parsePoeItem(golemSpellKineticWandFixture);
    const plan = planEquipmentPropertyFilters(item, 10);
    const keys = plan.filters.map((filter) => filter.equipmentProperty?.key);

    expect(keys).toEqual(["pdps", "aps", "crit"]);
    expect(plan.filters.find((filter) => filter.equipmentProperty?.key === "aps"))
      .toMatchObject({
        copiedValue: 1.9,
        enabled: false,
        min: 1.86,
      });
    expect(plan.filters.find((filter) => filter.equipmentProperty?.key === "crit"))
      .toMatchObject({
        copiedValue: 11,
        enabled: false,
        min: 10,
      });
    expect(plan.filters.filter((filter) => filter.bounds != null)).toHaveLength(0);
    expect(plan.filters.find((filter) => filter.equipmentProperty?.key === "pdps"))
      .toMatchObject({
        copiedValue: 756,
        enabled: false,
        importance: "useful",
        min: 680,
      });
    expect(plan.filters.some((filter) => filter.label?.startsWith("Weapon Damage")))
      .toBe(false);
    expect(plan.filters.some((filter) => filter.label?.startsWith("Total DPS")))
      .toBe(false);

    const selected = plan.filters.map((filter) => ({
      ...filter,
      enabled: true,
    }));
    const official = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "similar",
      rollTolerance: 10,
      filters: selected,
    });
    expect(queryFilters(official).weapon_filters.filters).toEqual({
      aps: { min: 1.86 },
      crit: { min: 10 },
      pdps: { min: 680 },
    });
    expect(JSON.parse(new URL(official.tradeUrl).searchParams.get("q") || "null"))
      .toEqual(official.tradeQuery);
  });

  it("treats an Advanced fixed property source as exact", () => {
    const item = parsePoeItem(golemSpellKineticWandFixture.replace(
      "19(17-19)% increased Attack Speed",
      "19% increased Attack Speed",
    ));
    const plan = planEquipmentPropertyFilters(item, 10);
    const aps = plan.filters.find(
      (filter) => filter.equipmentProperty?.key === "aps",
    );
    const physicalDps = plan.filters.find(
      (filter) => filter.equipmentProperty?.key === "pdps",
    );

    expect(aps).toMatchObject({ copiedValue: 1.9, min: 1.9 });
    expect(aps).not.toHaveProperty("bounds");
    expect(physicalDps).toMatchObject({ copiedValue: 756, min: 686 });
    expect(physicalDps).not.toHaveProperty("bounds");
  });

  it("projects proven armour, evasion, and Energy Shield roll endpoints", () => {
    const item = parsePoeItem(`Item Class: Body Armours
Rarity: Rare
Triumphant Shelter
Full Dragonscale
--------
Quality: +20% (augmented)
Armour: 480 (augmented)
Evasion Rating: 360 (augmented)
Energy Shield: 240 (augmented)
--------
Item Level: 86
--------
{ Prefix Modifier "Unassailable" (Tier: 1) — Defences }
100(80-100)% increased Armour, Evasion and Energy Shield`);
    const byKey = new Map(planEquipmentPropertyFilters(item, 10).filters.map(
      (filter) => [filter.equipmentProperty?.key, filter],
    ));

    expect(byKey.get("ar")).toMatchObject({
      copiedValue: 480,
      enabled: false,
    });
    expect(byKey.get("ev")).toMatchObject({
      copiedValue: 360,
      enabled: false,
    });
    expect(byKey.get("es")).toMatchObject({
      copiedValue: 240,
      enabled: false,
    });
    expect([...byKey.values()].every((filter) => filter.bounds == null)).toBe(true);
  });

  it("uses roll-span tolerance for uniques and fixed-roll tolerance for immutable magic items", () => {
    const source = parsePoeItem(`Item Class: Body Armours
Rarity: Rare
Measured Shelter
Twilight Regalia
--------
Quality: +20% (augmented)
Energy Shield: 228 (augmented)
--------
Item Level: 86
--------
{ Prefix Modifier "Unassailable" (Tier: 1) — Defences, Energy Shield }
90(80-100)% increased Energy Shield`);
    const rare = planEquipmentPropertyFilters(source, 10).filters[0];
    const uniqueItem = { ...source, rarity: "unique" as const };
    const unique = planEquipmentPropertyFilters(uniqueItem, 10).filters[0];
    const magic = planEquipmentPropertyFilters({
      ...source,
      rarity: "magic" as const,
      corrupted: true,
    }, 10).filters[0];
    const perfectUnique = planEquipmentPropertyFilters({
      ...uniqueItem,
      rawText: uniqueItem.rawText.replace(
        "Energy Shield: 228",
        "Energy Shield: 240",
      ).replace(
        "90(80-100)% increased Energy Shield",
        "100(80-100)% increased Energy Shield",
      ),
      properties: { ...uniqueItem.properties, "Energy Shield": "240" },
      modifiers: uniqueItem.modifiers.map((modifier) => ({
        ...modifier,
        text: modifier.text.replace(
          "90(80-100)% increased Energy Shield",
          "100(80-100)% increased Energy Shield",
        ),
        values: [100],
      })),
    }, 10).filters[0];

    expect(rare).toMatchObject({
      copiedValue: 228,
      min: 216,
    });
    expect(rare.bounds).toBeUndefined();
    expect(unique).toMatchObject({
      copiedValue: 228,
      min: 225,
      bounds: { min: 216, max: 240 },
    });
    expect(magic).toMatchObject({ copiedValue: 228, min: 228 });
    expect(perfectUnique).toMatchObject({ copiedValue: 240, min: 240 });

    const selected = [{ ...unique, enabled: true }];
    const query = buildPriceCheckQueryPlan(uniqueItem, "Allflame", {
      mode: "similar",
      rollTolerance: 10,
      filters: selected,
    });
    expect(queryFilters(query).armour_filters.filters.es).toEqual({ min: 225 });
    expect(JSON.parse(new URL(query.tradeUrl).searchParams.get("q") || "null"))
      .toEqual(query.tradeQuery);
  });

  it("keeps finite rounded-base reconstructions and consumes their local source", () => {
    const item = parsePoeItem(`Item Class: Body Armours
Rarity: Rare
Rounded Shelter
Simple Robe
--------
Quality: +20% (augmented)
Energy Shield: 117 (augmented)
--------
Item Level: 86
--------
{ Prefix Modifier "Hale" (Tier: 1) — Defences, Energy Shield }
+98(98-98) to maximum Energy Shield`);
    const local = item.modifiers.find(
      (modifier) => modifier.normalizedText === "+# to maximum energy shield" ||
        modifier.normalizedText === "# to maximum energy shield",
    );
    const equipment = planEquipmentPropertyFilters(item, 10);

    expect(equipment.filters[0]).toMatchObject({
      copiedValue: 117,
      min: 117,
    });
    expect(equipment.filters[0].bounds).toBeUndefined();
    expect(equipment.consumedModifierIds).toContain(local?.id);
    expect(planPriceCheckFilters(item, 10).filter(
      (filter) => filter.modifierId === local?.id,
    )).toHaveLength(0);
  });

  it("projects proven local block endpoints without enabling block by default", () => {
    const item = parsePoeItem(`Item Class: Shields
Rarity: Rare
Guarding Bulwark
Cardinal Round Shield
--------
Chance to Block: 29% (augmented)
--------
Item Level: 86
--------
{ Prefix Modifier "Barricade" (Tier: 1) — Block }
+5(3-5)% Chance to Block`);
    const block = planEquipmentPropertyFilters(item, 10).filters.find(
      (filter) => filter.equipmentProperty?.key === "block",
    );

    expect(block).toMatchObject({
      label: "Block: 29%",
      copiedValue: 29,
      enabled: false,
      min: 27,
    });
    expect(block?.bounds).toBeUndefined();
  });

  it("projects proven elemental and hybrid weapon DPS endpoints", () => {
    const item = parsePoeItem(`Item Class: Bows
Rarity: Rare
Measured Flight
Spine Bow
--------
Quality: +20% (augmented)
Physical Damage: 120-240 (augmented)
Elemental Damage: 20-40 (augmented)
Critical Strike Chance: 6.50%
Attacks per Second: 1.50 (augmented)
--------
Item Level: 86
--------
{ Prefix Modifier "Flaring" (Tier: 1) — Damage, Physical, Attack }
Adds 20(10-20) to 40(30-40) Physical Damage
{ Prefix Modifier "Merciless" (Tier: 1) — Damage, Physical, Attack }
100(80-100)% increased Physical Damage
{ Prefix Modifier "Flaming" (Tier: 1) — Damage, Elemental, Fire, Attack }
Adds 20(10-20) to 40(30-40) Fire Damage
{ Suffix Modifier "of Acclaim" (Tier: 1) — Attack, Speed }
20(10-20)% increased Attack Speed`);
    const byKey = new Map(planEquipmentPropertyFilters(item, 10).filters.map(
      (filter) => [filter.equipmentProperty?.key, filter],
    ));

    expect(byKey.get("aps")).toMatchObject({
      copiedValue: 1.5,
    });
    expect(byKey.get("pdps")).toMatchObject({
      copiedValue: 270,
    });
    expect(byKey.get("edps")).toMatchObject({
      copiedValue: 45,
    });
    expect(byKey.get("dps")).toMatchObject({
      copiedValue: 315,
    });
    expect([...byKey.values()].every((filter) => filter.bounds == null)).toBe(true);
  });

  it("treats a source-free weapon component as exact in a complete Advanced Description", () => {
    const item = parsePoeItem(`Item Class: Bows
Rarity: Unique
Measured Arc
Spine Bow
--------
Quality: +20% (augmented)
Physical Damage: 95-190 (augmented)
Critical Strike Chance: 6.50%
Attacks per Second: 1.25
--------
Item Level: 86
--------
{ Prefix Modifier "Cruel" (Tier: 1) — Damage, Physical, Attack }
90(80-100)% increased Physical Damage`);
    const byKey = new Map(planEquipmentPropertyFilters(item, 10).filters.map(
      (filter) => [filter.equipmentProperty?.key, filter],
    ));

    expect(byKey.get("aps")).toMatchObject({
      copiedValue: 1.25,
      advancedOnly: true,
    });
    expect(byKey.get("aps")).not.toHaveProperty("min");
    expect(byKey.get("aps")).not.toHaveProperty("bounds");
    expect(byKey.get("pdps")).toMatchObject({
      copiedValue: 178,
      min: 176,
      bounds: { min: 168, max: 188 },
    });
  });

  it("keeps dominant pDPS optional on caster weapon families like Awakened", () => {
    const bow = parsePoeItem(rareWeaponFixture);
    const wand = { ...bow, itemClass: "Wands", baseType: "Imbued Wand" };
    const physical = planEquipmentPropertyFilters(wand, 10).filters.find(
      (filter) => filter.equipmentProperty?.key === "pdps",
    );
    expect(physical).toMatchObject({
      copiedValue: 225,
      enabled: false,
      importance: "useful",
    });
  });

  it("projects copied physical damage below 20 quality like Awakened", () => {
    const item = parsePoeItem(lowQualityWeaponFixture);
    const plan = planEquipmentPropertyFilters(item, 10);
    const keys = plan.filters.map((filter) => filter.equipmentProperty?.key);
    expect(keys).toContain("edps");
    expect(keys).toContain("pdps");
    expect(keys).not.toContain("damage");
    expect(keys).toContain("dps");
    expect(plan.filters.find((filter) => filter.equipmentProperty?.key === "pdps")?.copiedValue)
      .toBe(245);
    expect(plan.warnings.join(" ")).not.toContain("below 20% quality");
  });

  it("ignores copied chaos damage in Awakened's physical/elemental DPS model", () => {
    const item = parsePoeItem(rareWeaponFixture.replace(
      "Critical Strike Chance: 6.50%",
      "Chaos Damage: 20-40 (augmented)\nCritical Strike Chance: 6.50%",
    ));
    expect(item.properties["Chaos Damage"]).toBe("20-40");
    const plan = planEquipmentPropertyFilters(item, 10);
    const keys = plan.filters.map((filter) => filter.equipmentProperty?.key);
    expect(keys).toContain("pdps");
    expect(keys).toContain("edps");
    expect(keys).not.toContain("damage");
    expect(keys).toContain("dps");
    expect(plan.warnings.join(" ")).not.toContain("chaos damage");
  });

  it("keeps calculated properties in the combined plan and ignores them in base mode", () => {
    const item = parsePoeItem(rareWeaponFixture);
    const combined = planPriceCheckFilters(item, 10);
    expect(combined.some(isEquipmentPropertyFilter)).toBe(true);
    expect(combined.every(isEquipmentPropertyFilter)).toBe(true);

    const base = buildPriceCheckQueryPlan(item, "Allflame", {
      identity: "base",
      filters: combined,
    });
    expect(queryFilters(base)).not.toHaveProperty("weapon_filters");
    expect(base.warnings.join(" ")).toContain("calculated property filters");
  });

  it("replans property tolerance while preserving explicit availability status", () => {
    const item = parsePoeItem(rareWeaponFixture);
    const ten = planPriceCheckFilters(item, 10).find(
      (filter) => filter.equipmentProperty?.key === "dps",
    );
    const twenty = planPriceCheckFilters(item, 20).find(
      (filter) => filter.equipmentProperty?.key === "dps",
    );
    expect(ten?.min).toBe(322);
    expect(twenty?.min).toBe(322);

    const query = buildPriceCheckQueryPlan(item, "Allflame", {
      status: "securable",
      filters: twenty ? [twenty] : [],
    });
    expect((query.tradeQuery as any).query.status).toEqual({ option: "securable" });
    expect(queryFilters(query).weapon_filters.filters.dps).toEqual({ min: 322 });
  });

  it("never counts a value-less property presence mode as an applied filter", () => {
    const item = parsePoeItem(rareWeaponFixture);
    const source = planEquipmentPropertyFilters(item, 10).filters.find(
      (filter) => filter.equipmentProperty?.key === "dps",
    )!;
    const invalid = {
      ...source,
      mode: "presence" as const,
      min: undefined,
      max: undefined,
      enabled: true,
    };
    expect(isEquipmentPropertyFilter(invalid)).toBe(true);
    expect(isOfficialPriceCheckFilter(invalid)).toBe(false);
    const query = buildPriceCheckQueryPlan(item, "Allflame", {
      filters: [invalid],
    });
    expect(queryFilters(query)).not.toHaveProperty("weapon_filters");
    expect(query.warnings.join(" ")).toContain("needs an exact value or numeric range");
  });
});
