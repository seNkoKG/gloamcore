import { describe, expect, it } from "vitest";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  expeditionLogbookFixture,
  golemSpellKineticWandFixture,
  malachaisLoopVestigialFixture,
  mapFixture,
  timelessJewelFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import {
  buildPriceCheckQueryPlan,
  planModifierFilters,
} from "./query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import { officialTradeStatIds } from "./trade-stat-id";
import type {
  ParsedPoeItem,
  ParsedPoeModifier,
  PriceCheckDashboardMode,
  PriceCheckQueryPlan,
} from "./types";

const catalog = actualCatalog as unknown as TradeStatCatalogPack;

function hydrate(rawText: string): ParsedPoeItem {
  const parsed = parsePoeItem(rawText);
  const hydrated = applyTradeStatCatalog(parsed, catalog);
  if (!parsed.logbookAreas?.length) return hydrated;
  return {
    ...hydrated,
    logbookAreas: parsed.logbookAreas.map((modifiers) =>
      applyTradeStatCatalog(
        { ...parsed, modifiers, warnings: [] },
        catalog,
      ).modifiers
    ),
  };
}

function decodedBrowserPayload(plan: PriceCheckQueryPlan) {
  const encoded = new URL(plan.tradeUrl).searchParams.get("q");
  expect(encoded).not.toBeNull();
  if (!encoded) throw new Error("Expected an official Trade browser payload");
  const decoded = JSON.parse(encoded) as Record<string, unknown>;
  expect(decoded).toEqual(plan.tradeQuery);
  return decoded as any;
}

function realSerializedStats(plan: PriceCheckQueryPlan) {
  const query = (plan.tradeQuery as any).query;
  return (query.stats || []).flatMap((group: any) => group.filters || [])
    .filter((filter: any) =>
      typeof filter.id === "string" &&
      !filter.id.startsWith("pseudo.pseudo_number_of_")
    ) as Array<{ id: string; disabled?: boolean }>;
}

function expectedStatSignatures(plan: PriceCheckQueryPlan) {
  return plan.filters.flatMap((filter) =>
    filter.emptyModifier == null
      ? officialTradeStatIds(filter).map((id) =>
          `${id}|${filter.enabled ? "active" : "disabled"}`
        )
      : []
  ).sort();
}

function actualStatSignatures(plan: PriceCheckQueryPlan) {
  return realSerializedStats(plan).map((filter) =>
    `${filter.id}|${filter.disabled ? "disabled" : "active"}`
  ).sort();
}

function planFor(
  item: ParsedPoeItem,
  mode: PriceCheckDashboardMode,
  filters?: PriceCheckQueryPlan["filters"],
) {
  return buildPriceCheckQueryPlan(item, "Allflame", {
    mode,
    status: "onlineleague",
    ...(filters ? { filters } : {}),
  });
}

function disableFirstRealStat(
  item: ParsedPoeItem,
  mode: PriceCheckDashboardMode,
) {
  const initial = planFor(item, mode);
  const target = initial.filters.find((filter) =>
    filter.enabled &&
    filter.emptyModifier == null &&
    officialTradeStatIds(filter).length > 0
  );
  expect(target).toBeDefined();
  if (!target) throw new Error("Expected an enabled official stat");
  return planFor(
    item,
    mode,
    initial.filters.map((filter) =>
      filter.modifierId === target.modifierId
        ? { ...filter, enabled: false }
        : filter
    ),
  );
}

function syntheticModifier(
  index: number,
  patch: Partial<ParsedPoeModifier> = {},
): ParsedPoeModifier {
  const id = `explicit.stat_${1_000_000_000 + index}`;
  return {
    id,
    tradeId: id,
    kind: "explicit",
    text: `+${index + 1} to maximum Life`,
    normalizedText: "+# to maximum life",
    values: [index + 1],
    selectedByDefault: false,
    tags: ["life"],
    advanced: true,
    tradeDirection: 1,
    ...patch,
  };
}

function syntheticItem(modifiers: ParsedPoeModifier[]): ParsedPoeItem {
  return {
    rawText: "Item Class: Wands\nRarity: Rare\nLong Query\nImbued Wand",
    language: "en",
    valid: true,
    itemClass: "Wands",
    rarity: "rare",
    name: "Long Query",
    baseType: "Imbued Wand",
    itemLevel: 86,
    sockets: [],
    influences: [],
    corrupted: false,
    mirrored: false,
    split: false,
    identified: true,
    fractured: false,
    synthesised: false,
    veiled: false,
    foil: false,
    foulborn: false,
    replica: false,
    scourged: false,
    properties: {},
    requirements: {},
    modifiers,
    flavourText: [],
    reminderText: [],
    unknownSections: [],
    warnings: [],
    errors: [],
  };
}

function mappedMapItem() {
  const parsed = hydrate(mapFixture);
  return {
    ...parsed,
    modifiers: [syntheticModifier(100, {
      id: "pseudo.pseudo_total_elemental_resistance",
      kind: "pseudo" as const,
      text: "40% total Elemental Resistance",
      normalizedText: "#% total elemental resistance",
      values: [40],
      tradeId: "pseudo.pseudo_total_elemental_resistance",
      tradeIds: ["pseudo.pseudo_total_elemental_resistance"],
      tradeDirection: 1 as const,
      selectedByDefault: true,
      tags: ["derived", "pseudo"],
    })],
  };
}

describe("Awakened disabled official-stat serialization", () => {
  it("keeps every Malachai modifier row in API/browser JSON without inventing disabled properties", () => {
    const plan = planFor(hydrate(malachaisLoopVestigialFixture), "similar");
    expect(plan.filters).toHaveLength(8);
    expect(plan.filters.filter((filter) => !filter.enabled)).toHaveLength(5);
    expect(actualStatSignatures(plan)).toEqual(expectedStatSignatures(plan));

    const query = (plan.tradeQuery as any).query;
    expect(query.filters.armour_filters.filters).toHaveProperty("es");
    expect(query.filters.armour_filters.filters).not.toHaveProperty("block");
    expect(realSerializedStats(plan).filter((filter) => filter.disabled))
      .toHaveLength(4);
    decodedBrowserPayload(plan);
  });

  it("round-trips the real wand, including its disabled empty-or-crafted groups", () => {
    const plan = planFor(hydrate(golemSpellKineticWandFixture), "similar");
    expect(actualStatSignatures(plan)).toEqual(expectedStatSignatures(plan));
    expect(realSerializedStats(plan).some((filter) => filter.disabled)).toBe(true);

    const groups = ((plan.tradeQuery as any).query.stats || []) as any[];
    const emptyGroups = groups.filter((group) =>
      group.type === "count" &&
      group.filters?.some((filter: any) =>
        String(filter.id).startsWith("pseudo.pseudo_number_of_empty_")
      )
    );
    expect(emptyGroups).toHaveLength(2);
    expect(emptyGroups.every((group) =>
      group.disabled === true &&
      group.filters.every((filter: any) => filter.disabled === true)
    )).toBe(true);
    decodedBrowserPayload(plan);
  });

  it.each([
    ["rare map Property", mappedMapItem(), "exact" as const],
    ["rare map Bulk", mappedMapItem(), "bulk" as const],
    ["logbook area", hydrate(expeditionLogbookFixture), "I" as const],
  ])("retains a user-unchecked %s stat without changing active rows", (_label, item, mode) => {
    const plan = disableFirstRealStat(item, mode);
    expect(actualStatSignatures(plan)).toEqual(expectedStatSignatures(plan));
    expect(realSerializedStats(plan).some((filter) => filter.disabled)).toBe(true);
    decodedBrowserPayload(plan);
  });

  it("retains Timeless seed and invariant rows with their planned defaults", () => {
    const item = hydrate(timelessJewelFixture);
    const initial = planFor(item, "similar");
    expect(realSerializedStats(initial).some((filter) => !filter.disabled)).toBe(true);
    const plan = disableFirstRealStat(item, "similar");
    expect(actualStatSignatures(plan)).toEqual(expectedStatSignatures(plan));
    expect(realSerializedStats(plan).some((filter) => filter.disabled)).toBe(true);
    decodedBrowserPayload(plan);
  });

  it("marks unchecked simple, OR, and NOT filters at every official schema level", () => {
    const source = syntheticItem([
      syntheticModifier(1),
      syntheticModifier(2, {
        tradeIds: [
          "explicit.stat_1000000002",
          "explicit.stat_1000000102",
        ],
      }),
      syntheticModifier(3),
    ]);
    const planned = planModifierFilters(source);
    const plan = buildPriceCheckQueryPlan(source, "Allflame", {
      filters: planned.map((filter, index) => ({
        ...filter,
        enabled: index === 0,
        negated: index === 2,
      })),
    });
    const groups = (plan.tradeQuery as any).query.stats as any[];

    expect(groups[0].filters).toContainEqual(expect.objectContaining({
      id: "explicit.stat_1000000001",
    }));
    const alternative = groups.find((group) => group.type === "count");
    expect(alternative).toMatchObject({
      disabled: true,
      filters: [
        { id: "explicit.stat_1000000002", disabled: true },
        { id: "explicit.stat_1000000102", disabled: true },
      ],
    });
    const negated = groups.find((group) => group.type === "not");
    expect(negated.filters).toContainEqual(expect.objectContaining({
      id: "explicit.stat_1000000003",
      disabled: true,
    }));
    decodedBrowserPayload(plan);
  });

  it("does not truncate a browser payload beyond the conventional 8 KiB URL edge", () => {
    const source = syntheticItem(
      Array.from({ length: 96 }, (_, index) => syntheticModifier(index + 10)),
    );
    const planned = planModifierFilters(source);
    const plan = buildPriceCheckQueryPlan(source, "Allflame", {
      filters: planned.map((filter, index) => ({
        ...filter,
        enabled: index < 3,
      })),
    });
    const serialized = realSerializedStats(plan);

    expect(serialized).toHaveLength(96);
    expect(serialized.filter((filter) => !filter.disabled)).toHaveLength(3);
    expect(serialized.filter((filter) => filter.disabled)).toHaveLength(93);
    expect(plan.tradeUrl.length).toBeGreaterThan(8_192);
    expect(new TextEncoder().encode(JSON.stringify(plan.tradeQuery)).length)
      .toBeLessThan(128 * 1024);
    decodedBrowserPayload(plan);
  });
});
