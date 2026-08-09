import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import actualCatalog from "../../../public/data/price-check/stats-v1.json";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogGroup,
  type TradeStatCatalogGroupMatcher,
  type TradeStatCatalogGroupStat,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import { buildPriceCheckQueryPlan } from "./query-plan";
import type {
  ParsedPoeItem,
  ParsedPoeModifier,
  PoeModifierKind,
} from "./types";

const catalog = actualCatalog as TradeStatCatalogPack;

function itemWithModifier(
  text: string,
  values: number[],
  kind: PoeModifierKind = "explicit",
  itemClass = "Rings",
): ParsedPoeItem {
  const modifier: ParsedPoeModifier = {
    id: `fixture:${createHash("sha1").update(`${kind}:${text}`).digest("hex").slice(0, 12)}`,
    kind,
    text,
    normalizedText: text
      .normalize("NFKC")
      .replace(/[-+]?\d[\d,]*(?:\.\d+)?/g, "#")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
    values,
    selectedByDefault: false,
    tags: [],
    advanced: false,
  };
  return {
    rawText: text,
    language: "en",
    valid: true,
    itemClass,
    rarity: "rare",
    name: "Resolver Fixture",
    baseType: "Resolver Base",
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
    modifiers: [modifier],
    flavourText: [],
    reminderText: [],
    unknownSections: [],
    warnings: [],
    errors: [],
  };
}

function resolved(
  text: string,
  values: number[],
  kind: PoeModifierKind = "explicit",
  itemClass = "Rings",
) {
  const source = itemWithModifier(text, values, kind, itemClass);
  // This suite isolates StatGroup selection. Split Personality is APT's
  // data-backed bypass for the earlier pseudo-consumption phase.
  source.name = "Split Personality";
  return applyTradeStatCatalog(
    source,
    catalog,
  );
}

function queryStatGroups(query: Record<string, unknown>) {
  return ((query as any).query.stats || []) as Array<{
    type: string;
    filters: Array<{
      id: string;
      value?: { min?: number; max?: number };
      disabled?: boolean;
    }>;
  }>;
}

const GROUP_KIND_PREFERENCE: PoeModifierKind[] = [
  "explicit", "implicit", "crafted", "enchant", "fractured", "pseudo",
];

function preferredGroupKind(stats: readonly TradeStatCatalogGroupStat[]) {
  return GROUP_KIND_PREFERENCE.find((kind) =>
    stats.every((stat) => kind in stat.trade.ids)
  );
}

function firstGroupKind(stat: TradeStatCatalogGroupStat) {
  return GROUP_KIND_PREFERENCE.find((kind) => kind in stat.trade.ids)!;
}

function itemClassForGroupCategory(category: string | null) {
  switch (category) {
    case "WEAPON": return "Wands";
    case "ARMOUR": return "Body Armours";
    case "HEIST_EQUIPMENT": return "Heist Tools";
    case "Tincture": return "Tinctures";
    case "Sanctum Relic": return "Relics";
    default: return "Rings";
  }
}

function renderedGroupMatcher(
  matcher: TradeStatCatalogGroupMatcher,
  replacement = 37,
) {
  // APT renders every placeholder from the same resolved scalar. Equal source
  // tokens keep this resolver corpus independent from the separate rounding
  // and repeated-placeholder golden tests.
  const text = matcher.text.replace(/#/g, String(replacement));
  const values = [...text.matchAll(/(?<!\d|\))[+-]?\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => Number(match[0].replace(/,/g, "")));
  expect(values, matcher.text).toHaveLength(matcher.semantics.tokenCount);
  return { text, values };
}

function aptRenderedStatText(
  stat: TradeStatCatalogGroupStat,
  roll: number | undefined,
  decimalPrecision = Boolean(stat.dp),
) {
  const matchers = stat.displayMatchers || stat.matchers.map((matcher) => ({
    text: matcher.displayText || matcher.text,
    ...(matcher.semantics.negate ? { negate: true as const } : {}),
    ...(Number.isFinite(matcher.semantics.constant)
      ? { value: matcher.semantics.constant }
      : {}),
  }));
  const selected = roll == null
    ? matchers.find((matcher) => matcher.value == null) || matchers[0]
    : matchers.find((matcher) => matcher.value === roll) ||
      matchers.find((matcher) =>
        matcher.value == null && Boolean(matcher.negate) === (roll < 0)
      ) ||
      matchers.find((matcher) => matcher.value == null) ||
      matchers[0];
  if (roll == null) return selected.text;
  const displayRoll = selected.negate ? -roll : roll;
  const places = !decimalPrecision || Math.abs(displayRoll) >= 10
    ? 0
    : Math.abs(displayRoll) < 2.3
      ? 2
      : 1;
  const scale = 10 ** places;
  const rounded = Math.trunc(displayRoll * scale) / scale;
  return selected.text.replace(/(?<!#)[+-]?#/g, String(rounded));
}

function expectGroupScenario(
  group: TradeStatCatalogGroup,
  selectedStat: TradeStatCatalogGroupStat,
  matcher: TradeStatCatalogGroupMatcher,
  kind: PoeModifierKind,
  itemClass: string,
  expectedIds: readonly string[],
  expectedTransforms?: Record<string, "empty" | "empty-if-100" | "div-by-100">,
  replacement?: number,
) {
  const fixture = renderedGroupMatcher(matcher, replacement);
  const groupCatalog: TradeStatCatalogPack = {
    ...catalog,
    entries: catalog.entries
      .filter((entry) => entry.groupIds?.includes(group.id))
      .map((entry) => ({
        ...entry,
        candidates: entry.candidates.filter((candidate) => candidate.groupId === group.id),
      })),
  };
  const fixtureItem = itemWithModifier(fixture.text, fixture.values, kind, itemClass);
  // Split Personality is the one APT item whose source modifiers deliberately
  // bypass pseudo aggregation, which lets this corpus isolate StatGroup logic.
  fixtureItem.name = "Split Personality";
  const result = applyTradeStatCatalog(
    fixtureItem,
    groupCatalog,
  );
  const modifier = result.modifiers.find((candidate) =>
    candidate.tradeIds?.length === expectedIds.length &&
    candidate.tradeIds.every((id, index) => id === expectedIds[index])
  );
  expect(
    modifier,
    `StatGroup ${group.id}: ${selectedStat.ref} via ${matcher.text} (${kind}/${itemClass}) -> ${JSON.stringify(result.modifiers.map((candidate) => ({ ref: candidate.tradeStatRef, ids: candidate.tradeIds })))}`,
  ).toBeDefined();
  expect(modifier?.tradeIds, `StatGroup ${group.id}: ${matcher.text}`).toEqual(expectedIds);
  expect(
    modifier?.tradeDisplayText,
    `StatGroup ${group.id}: ${matcher.text} rendered label`,
  ).toBe(aptRenderedStatText(
    selectedStat,
    modifier?.values[0],
    modifier?.tradeDecimalPrecision,
  ));
  expect(
    modifier?.tradeIdTransforms,
    `StatGroup ${group.id}: ${matcher.text} transforms`,
  ).toEqual(expectedTransforms);
}

describe("Awakened StatGroup resolver parity", () => {
  it("pins and makes reachable the exact metadata for all 95 APT groups", () => {
    expect(catalog.groups).toHaveLength(95);
    expect(catalog.coverage).toEqual({
      resolverGroups: 95,
      resolverStrategies: {
        "flag-merge": 5,
        "percent-merge": 11,
        select: 41,
        "trivial-merge": 38,
      },
    });
    const digest = createHash("sha256")
      .update(JSON.stringify(catalog.groups))
      .digest("hex");
    expect(digest).toBe("93f60aa7ffef512e2440fec85309c272f0f0d704a7ce332c936af2876c3dca06");
    expect(catalog.source.resolverGroupsSha256).toBe(digest);
    expect(catalog.groups.flatMap((group) => group.stats).filter((stat) => stat.dp))
      .toHaveLength(16);

    const entries = new Map(catalog.entries.map((entry) => [entry.pattern, entry]));
    for (const [index, group] of catalog.groups.entries()) {
      expect(group.id).toBe(index);
      expect(group.stats.length).toBeGreaterThanOrEqual(2);
      for (const [statIndex, stat] of group.stats.entries()) {
        for (const matcher of stat.matchers) {
          const entry = entries.get(matcher.pattern);
          expect(entry?.groupIds, `${group.id}:${matcher.text}`).toContain(group.id);
          expect(entry?.candidates.some((candidate) =>
            candidate.groupId === group.id && candidate.statIndex === statIndex
          ), `${group.id}:${statIndex}:${matcher.text}`).toBe(true);
        }
      }
    }
  });

  it("resolves a source-derived golden scenario for every one of the 95 groups", () => {
    const covered = new Set<number>();
    for (const group of catalog.groups) {
      const { resolve, stats } = group;
      if (resolve.strat === "select") {
        for (const [statIndex, stat] of stats.entries()) {
          const kind = firstGroupKind(stat);
          expectGroupScenario(
            group,
            stat,
            stat.matchers[0],
            kind,
            itemClassForGroupCategory(resolve.test[statIndex]),
            stat.trade.ids[kind],
          );
        }
        covered.add(group.id);
        continue;
      }

      const commonKind = preferredGroupKind(stats);
      if (resolve.strat === "trivial-merge") {
        const commonMatcher = commonKind && stats[0].matchers.find((matcher) =>
          stats[1].matchers.some((candidate) => candidate.text === matcher.text)
        );
        if (commonKind && commonMatcher) {
          const matchingStats = stats.filter((stat) =>
            commonKind in stat.trade.ids &&
            stat.matchers.some((matcher) => matcher.text === commonMatcher.text)
          );
          const expectedIds = [...matchingStats[0].trade.ids[commonKind]];
          for (const stat of matchingStats.slice(1)) {
            const sourceId = stat.trade.ids[commonKind][0];
            if (!expectedIds.includes(sourceId)) expectedIds.push(sourceId);
          }
          expectGroupScenario(
            group,
            matchingStats[0],
            commonMatcher,
            commonKind,
            "Rings",
            expectedIds,
          );
        } else {
          const stat = stats[0];
          const kind = firstGroupKind(stat);
          expectGroupScenario(
            group,
            stat,
            stat.matchers[0],
            kind,
            "Rings",
            stat.trade.ids[kind],
          );
        }
        covered.add(group.id);
        continue;
      }

      if (resolve.strat === "percent-merge" && commonKind) {
        const percent = stats[resolve.kind.indexOf("percent")];
        const value = stats[resolve.kind.indexOf("value")];
        const matcher = percent.matchers.find((candidate) =>
          candidate.semantics.constant === 100
        );
        expect(matcher, `StatGroup ${group.id} 100% matcher`).toBeDefined();
        const sourceId = value.trade.ids[commonKind][0];
        const expectedIds = [...percent.trade.ids[commonKind]];
        if (!expectedIds.includes(sourceId)) expectedIds.push(sourceId);
        const flag = value.matchers.length === 1 && !value.matchers[0].text.includes("#");
        expectGroupScenario(
          group,
          percent,
          matcher!,
          commonKind,
          "Rings",
          expectedIds,
          { [sourceId]: flag ? "empty-if-100" : "div-by-100" },
        );
        covered.add(group.id);
        continue;
      }

      if (resolve.strat === "flag-merge" && commonKind) {
        const value = stats[resolve.kind.indexOf("value")];
        const flag = stats[resolve.kind.indexOf("flag")];
        const flagRoll = flag.matchers[0].semantics.constant;
        expect(flagRoll, `StatGroup ${group.id} flag roll`).toBeTypeOf("number");
        const sourceId = flag.trade.ids[commonKind][0];
        const expectedIds = [...value.trade.ids[commonKind]];
        if (!expectedIds.includes(sourceId)) expectedIds.push(sourceId);
        expectGroupScenario(
          group,
          value,
          value.matchers[0],
          commonKind,
          "Rings",
          expectedIds,
          { [sourceId]: "empty" },
          flagRoll,
        );
        covered.add(group.id);
        continue;
      }

      // Some percent/flag groups intentionally have disjoint modifier kinds;
      // APT's single-kind fast path returns that source stat without merging.
      const stat = stats[0];
      const kind = firstGroupKind(stat);
      expectGroupScenario(
        group,
        stat,
        stat.matchers[0],
        kind,
        "Rings",
        stat.trade.ids[kind],
      );
      covered.add(group.id);
    }
    expect([...covered]).toEqual(catalog.groups.map((group) => group.id));
  });

  it("ports select resolution for every category instead of one text workaround", () => {
    expect(resolved("+25 to maximum Energy Shield", [25], "explicit", "Body Armours")
      .modifiers[0]).toMatchObject({
        tradeId: "explicit.stat_4052037485",
        tradeIds: ["explicit.stat_4052037485"],
        tradeStatRef: "+# to maximum Energy Shield",
        values: [25],
      });
    expect(resolved("20% increased Cooldown Recovery Rate", [20], "explicit", "Tinctures")
      .modifiers[0].tradeId).toBe("explicit.stat_239144");
    expect(resolved("20% increased Cooldown Recovery Rate", [20], "explicit", "Rings")
      .modifiers[0].tradeId).toBe("explicit.stat_1004011302");
    expect(resolved("Guards take 20% increased Damage", [20], "explicit", "Relics")
      .modifiers[0].tradeId).toBe("sanctum.stat_408585189");
    expect(resolved("Guards take 20% increased Damage", [20], "explicit", "Rings")
      .modifiers[0].tradeId).toBe("explicit.stat_873692616");

    expect(resolved("20% increased Attack Speed", [20], "explicit", "Wands")
      .modifiers[0].tradeId).toBe("explicit.stat_210067635");
  });

  it("merges trivial duplicate Trade IDs in APT source order", () => {
    expect(resolved("35% chance to Avoid being Frozen during Effect", [35])
      .modifiers[0]).toMatchObject({
        tradeId: "explicit.stat_475518267",
        tradeIds: ["explicit.stat_475518267", "explicit.stat_2872815301"],
        tradeStatRef: "#% chance to Avoid being Frozen during Effect",
        values: [35],
      });
  });

  it("retains only source-compatible Explicit counterparts for fractured rows", () => {
    expect(resolved(
      "35% chance to Avoid being Frozen during Effect",
      [35],
      "fractured",
    ).modifiers[0]).toMatchObject({
      tradeId: "fractured.stat_475518267",
      tradeIds: ["fractured.stat_475518267"],
      tradeIdCandidates: [
        "fractured.stat_475518267",
        "explicit.stat_475518267",
        "explicit.stat_2872815301",
      ],
      tradeStatRef: "#% chance to Avoid being Frozen during Effect",
    });
  });

  it("merges the fixed Vulnerability flag with APT's empty-if-100 payload", () => {
    const item = resolved("Curse Enemies with Vulnerability on Hit", []);
    expect(item.modifiers[0]).toMatchObject({
      tradeId: "explicit.stat_2213584313",
      tradeIds: ["explicit.stat_2213584313", "explicit.stat_3967845372"],
      tradeIdTransforms: {
        "explicit.stat_3967845372": "empty-if-100",
      },
      tradeStatRef: "#% chance to Curse Enemies with Vulnerability on Hit",
      tradeLabel: "100% chance to Curse Enemies with Vulnerability on Hit",
      tradeDisplayText: "Curse Enemies with Vulnerability on Hit",
      values: [100],
    });

    const plan = buildPriceCheckQueryPlan(item, "Allflame");
    expect(plan.filters.find((filter) =>
      filter.tradeIds?.includes("explicit.stat_2213584313")
    )).toMatchObject({
      copiedValue: 100,
      tradeIdTransforms: {
        "explicit.stat_3967845372": "empty-if-100",
      },
    });
    const alternatives = queryStatGroups(plan.tradeQuery).find((group) =>
      group.type === "count" &&
      group.filters.some((filter) => filter.id === "explicit.stat_2213584313")
    );
    expect(alternatives?.filters).toEqual([
      {
        id: "explicit.stat_2213584313",
        value: { min: 100 },
        disabled: true,
      },
      { id: "explicit.stat_3967845372", disabled: true },
    ]);
    expect(JSON.parse(new URL(plan.tradeUrl).searchParams.get("q") || "null"))
      .toEqual(plan.tradeQuery);
  });

  it("uses div-by-100 only for the alternate charge-value ID", () => {
    const item = resolved("Gain a Flask Charge when you deal a Critical Strike", []);
    expect(item.modifiers[0]).toMatchObject({
      tradeId: "explicit.stat_3738001379",
      tradeIds: ["explicit.stat_3738001379", "explicit.stat_1546046884"],
      tradeIdTransforms: {
        "explicit.stat_1546046884": "div-by-100",
      },
      tradeDisplayText: "Gain a Flask Charge when you deal a Critical Strike",
      values: [100],
    });
    const plan = buildPriceCheckQueryPlan(item, "Allflame");
    const alternatives = queryStatGroups(plan.tradeQuery).find((group) =>
      group.filters.some((filter) => filter.id === "explicit.stat_3738001379")
    );
    expect(alternatives?.filters).toEqual([
      {
        id: "explicit.stat_3738001379",
        value: { min: 100 },
        disabled: true,
      },
      {
        id: "explicit.stat_1546046884",
        value: { min: 1 },
        disabled: true,
      },
    ]);
  });

  it("uses an empty payload for the fixed 20% Frozen-damage alternate", () => {
    const item = resolved("Enemies Frozen by you take 20% increased Damage", [20]);
    expect(item.modifiers[0]).toMatchObject({
      tradeId: "explicit.stat_1588094148",
      tradeIds: ["explicit.stat_1588094148", "explicit.stat_849085925"],
      tradeIdTransforms: { "explicit.stat_849085925": "empty" },
      tradeStatRef: "Enemies Frozen by you take #% increased Damage",
      tradeLabel: "Enemies Frozen by you take 20% increased Damage",
      tradeDisplayText: "Enemies Frozen by you take 20% increased Damage",
      values: [20],
    });
    const plan = buildPriceCheckQueryPlan(item, "Allflame");
    const alternatives = queryStatGroups(plan.tradeQuery).find((group) =>
      group.filters.some((filter) => filter.id === "explicit.stat_1588094148")
    );
    expect(alternatives?.filters).toEqual([
      {
        id: "explicit.stat_1588094148",
        value: { min: 20 },
        disabled: true,
      },
      { id: "explicit.stat_849085925", disabled: true },
    ]);
  });
});
