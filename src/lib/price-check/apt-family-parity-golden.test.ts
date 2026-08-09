import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import statCatalogJson from "../../../public/data/price-check/stats-v1.json";
import baseCatalogJson from "./base-types-v1.json";
import goldenJson from "./fixtures/apt-family-parity-v3.29.104.json";
import { buildOfficialTradeBrowserUrl } from "./official-trade-route";
import {
  pinnedCraftableItemCategory,
  resolveMagicBaseType,
} from "./magic-base-type";
import {
  defaultOfficialTradeStatusForItem,
  defaultPriceCheckModeForItem,
  priceCheckItemForMode,
  priceCheckModesForItem,
} from "./official-trade-workflow";
import { parsePoeItem } from "./parser";
import {
  buildPriceCheckQueryPlan,
  defaultActivePriceCheckItemFilters,
  priceCheckItemFilterControls,
} from "./query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "./stat-catalog";
import type {
  ParsedPoeItem,
  PriceCheckDashboardMode,
  PriceCheckModifierFilter,
  PriceCheckQueryPlan,
} from "./types";

const PINNED_COMMIT = "adb6c287bd978a70701e2b65d744dd677c52fb65";
const PINNED_APT_OUTPUTS_SHA256 = "2884ba875c10ad6bb4d0b8abb941b2f4078cef079ffd394f55e99a834e692f77";
const CONSTRUCTED_ORIGIN = "authoritative-format-constructed-from-pinned-database";
const LIVE_ORIGIN = "sanitized-live-capture";
const LEAGUE = "Allflame";

interface AptRoll {
  value?: number;
  min?: number;
  max?: number;
  bounds?: { min: number; max: number };
  tradeInvert?: boolean;
  dp?: boolean;
  isNegated?: boolean;
}

interface AptStatFilter {
  tradeId: string[];
  statRef?: string;
  text?: string;
  displayText?: string;
  tag?: string;
  oils?: string[];
  not?: boolean;
  roll?: AptRoll;
  option?: { value?: string | number } | string | number;
  hidden?: string;
  disabled?: boolean;
}

interface AptIdentityState {
  active: "exact" | "relaxed" | "sub";
  primaryLabel: string;
  subVisible: boolean;
  searches: Array<{
    key: "exact" | "relaxed" | "sub";
    label: string;
    disabled: boolean;
    query: Record<string, unknown>;
  }>;
}

interface AptPreset {
  id: string;
  itemFilters: Record<string, unknown>;
  identity: AptIdentityState & {
    alternates: Array<{
      key: "exact" | "relaxed" | "sub";
      identity: AptIdentityState;
      request: Record<string, unknown>;
      browserPayload: Record<string, unknown>;
      browserUrl: string;
    }>;
  };
  stats: AptStatFilter[];
  api: "trade" | "bulk";
  request: Record<string, unknown>;
  browserPayload: Record<string, unknown>;
  browserUrl: string;
}

interface AptGoldenCase {
  id: string;
  kind: "category" | "branch";
  category?: string;
  baseRef?: string;
  origin: typeof CONSTRUCTED_ORIGIN | typeof LIVE_ORIGIN;
  raw: string;
  apt: {
    item: {
      category?: string;
      rarity?: string;
      name?: string;
      baseType?: string;
      info: {
        refName: string;
        namespace: string;
      };
      itemLevel?: number;
      quality?: number;
      gemLevel?: number;
      mapTier?: number;
      mapBlighted?: "Blighted" | "Blight-ravaged";
      mapCompletionReward?: { name: string; refName: string; nameTrade?: string };
      mapArea?: { name: string; refName: string; tradeDisc?: string };
      areaLevel?: number;
      areaItemQuantity?: number;
      areaItemRarity?: number;
      areaPackSize?: number;
      chartSulphur?: number;
      basePercentile?: number;
      talismanTier?: number;
      sockets?: { linked?: number };
      stackSize?: { value: number; max: number };
      imbuedGem?: boolean;
      isUnidentified?: boolean;
      isCorrupted?: boolean;
      isUnmodifiable?: boolean;
      isMirrored?: boolean;
      isSplit?: boolean;
      isSynthesised?: boolean;
      isFractured?: boolean;
      isVeiled?: boolean;
      isFoil?: boolean;
      isFoulborn?: boolean;
      isVestigial?: boolean;
      influences: string[];
      parsedModifiers: Array<{
        info: { type: string; generation?: string; name?: string; tier?: number };
        stats: Array<{
          ref: string;
          matcher?: string;
          matcherValue?: number;
          negate?: boolean;
          roll?: {
            value: number;
            min: number;
            max: number;
            dp?: boolean;
            unscalable?: boolean;
            legacy?: true;
          };
        }>;
      }>;
      calculatedStats: Array<{
        ref: string;
        type: string;
        sources: Array<{
          contributes?: { value: number; min: number; max: number };
        }>;
      }>;
      unknownModifiers: Array<{ text: string; type: string }>;
    };
    active: string;
    presets: AptPreset[];
  };
}

interface AptGolden {
  schema: number;
  source: {
    project: string;
    version: string;
    commit: string;
    itemsSha256: string;
    statsSha256: string;
    clientStringsSha256: string;
    fixturesSha256: string;
    aptOutputsSha256: string;
  };
  coverage: {
    executableCategories: string[];
    currentEnumCategories: string[];
    staleEnumOnlyCategories: string[];
    categoryFixtures: number;
    branchFixtures: number;
  };
  referenceOracles: {
    statSourcesTotal: {
      origin: "direct-pinned-function-execution";
      source: string;
      executableItemInvariant: false;
      caveat: string;
      sumWithMissingContribution: {
        mode: "sum";
        inputs: Array<{ value: number; min: number; max: number } | null>;
        result: { value: number; min: number; max: number };
      };
      maxStartsAtZero: {
        mode: "max";
        inputs: Array<{ value: number; min: number; max: number }>;
        result: { value: number; min: number; max: number };
      };
    };
  };
  cases: AptGoldenCase[];
}

interface BaseCatalog {
  source: { commit: string; inputSha256: string };
  itemProfiles: Record<string, Array<{
    craftable?: { category?: string };
  }>>;
}

const golden = goldenJson as unknown as AptGolden;
const baseCatalog = baseCatalogJson as unknown as BaseCatalog;
const statCatalog = statCatalogJson as unknown as TradeStatCatalogPack;

const SPECIAL_DATABASE_CATEGORIES = [
  "Captured Beast",
  "Currency",
  "Divination Card",
  "Gem",
] as const;

const STALE_ENUM_ONLY = [
  "Charm",
  "Graft",
  "Memory Line",
  "Metamorph Sample",
  "Sentinel",
  "Voidstone",
] as const;

const REQUIRED_BRANCHES = [
  "branch-unique-mageblood-advanced",
  "branch-unidentified-watcher-eye",
  "branch-unidentified-unique-heavy-belt",
  "branch-magic-body-armour",
  "branch-advanced-rare-body-armour",
  "branch-rare-weapon",
  "branch-golem-spell-kinetic-wand",
  "branch-cluster-jewel-policy",
  "branch-magic-cobalt-jewel",
  "branch-influence-state",
  "branch-synthesised-state",
  "branch-fractured-state",
  "branch-corrupted-state",
  "branch-mirrored-state",
  "branch-split-state",
  "branch-corrupted-unique",
  "branch-map-completion-reward",
  "branch-unique-map",
  "branch-flask-instilling-enchantment",
  "branch-flask-enkindling-enchantment",
  "branch-anoint-low-oil-ring",
  "branch-anoint-high-oil-ring",
  "branch-anoint-low-oil-talisman",
  "branch-foil-unique",
  "branch-foulborn-watcher-eye",
  "branch-foulborn-mageblood",
  "branch-vestigial-skyforth",
  "branch-vestigial-malachais-loop",
  "branch-vaal-gem-singleton",
  "branch-split-cannot-use-nameplate",
  "branch-mirrored-tablet-eight-lines",
  "branch-flask-properties",
  "branch-tincture-properties",
  "branch-3-link-sockets",
  "branch-4-link-sockets",
  "branch-5-link-sockets",
  "branch-6-link-sockets",
  "branch-chart-properties",
  "branch-imbued-gem",
  "branch-veiled-word-is-not-state",
  "branch-synthesised-word-is-not-state",
  "branch-fractured-word-is-not-state",
  "branch-resolver-transforms",
  "branch-resolver-select-weapon",
  "branch-label-advanced-canonical",
  "branch-label-multi-placeholder",
  "branch-label-multiline",
  "branch-label-singular-plural",
  "branch-label-decimal-rounding",
  "branch-label-zero-value",
  "branch-label-aggregate-sum",
  "branch-label-mirrored-tablet-max",
] as const;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hydrate(rawText: string): ParsedPoeItem {
  const parsed = parsePoeItem(rawText);
  const hydrated = applyTradeStatCatalog(parsed, statCatalog);
  if (!parsed.logbookAreas?.length) return hydrated;
  return {
    ...hydrated,
    logbookAreas: parsed.logbookAreas.map((modifiers) =>
      applyTradeStatCatalog(
        { ...parsed, modifiers, warnings: [] },
        statCatalog,
      ).modifiers
    ),
  };
}

function modeForPreset(
  item: ParsedPoeItem,
  presetId: string,
): PriceCheckDashboardMode {
  if (/^I{1,3}$|^IV$|^V$/.test(presetId)) {
    return presetId as PriceCheckDashboardMode;
  }
  if (presetId === "filters.preset_base_item") return "base";
  if (presetId === "filters.preset_bulk") return "bulk";
  if (presetId === "filters.preset_exact") return "exact";
  if (presetId === "filters.preset_pseudo") {
    return /^(?:maps?|charts?)$/i.test(item.itemClass.trim()) ? "exact" : "similar";
  }
  throw new Error(`Unknown pinned APT preset: ${presetId}`);
}

function planFor(
  item: ParsedPoeItem,
  preset: AptPreset,
  itemFilters?: Record<string, string | number | boolean>,
) {
  return buildPriceCheckQueryPlan(item, LEAGUE, {
    mode: modeForPreset(item, preset.id),
    status: defaultOfficialTradeStatusForItem(item),
    itemFilters,
  });
}

function browserPayload(plan: PriceCheckQueryPlan) {
  const url = buildOfficialTradeBrowserUrl({
    league: plan.league,
    tradeQuery: plan.tradeQuery,
    api: plan.tradeApi,
  });
  expect(url).toBe(plan.tradeUrl);
  const encoded = new URL(url).searchParams.get("q");
  if (!encoded) throw new Error("Expected a browser q payload.");
  return JSON.parse(encoded) as Record<string, unknown>;
}

const PROPERTY_TRADE_IDS: Record<
  NonNullable<PriceCheckModifierFilter["equipmentProperty"]>["key"],
  string
> = {
  ar: "item.armour",
  ev: "item.evasion_rating",
  es: "item.energy_shield",
  ward: "item.ward",
  block: "item.block",
  damage: "item.total_dps",
  aps: "item.aps",
  crit: "item.crit",
  dps: "item.total_dps",
  pdps: "item.physical_dps",
  edps: "item.elemental_dps",
  map_iiq: "item.map_item_quantity",
  map_iir: "item.map_item_rarity",
  map_packsize: "item.map_pack_size",
  chart_sulphur: "item.chart_sulphur",
  base_defence_percentile: "item.base_percentile",
};

const PROPERTY_STAT_REFS: Partial<Record<
  NonNullable<PriceCheckModifierFilter["equipmentProperty"]>["key"],
  string
>> = {
  ar: "Armour: #",
  ev: "Evasion Rating: #",
  es: "Energy Shield: #",
  ward: "Ward: #",
  block: "Block: #%",
  aps: "Attacks per Second: #",
  crit: "Critical Strike Chance: #%",
  dps: "Total DPS: #",
  pdps: "Physical DPS: #",
  edps: "Elemental DPS: #",
  map_iiq: "Item Quantity: +#%",
  map_iir: "Item Rarity: +#%",
  map_packsize: "Monster Pack Size: +#%",
  chart_sulphur: "Dead Man's Sulphur: +#%",
  base_defence_percentile: "Base Percentile: #%",
};

function decoratedTradeIds(filter: PriceCheckModifierFilter) {
  const rawIds = filter.tradeIds?.length
    ? filter.tradeIds
    : filter.tradeId
      ? [filter.tradeId]
      : filter.equipmentProperty
        ? [PROPERTY_TRADE_IDS[filter.equipmentProperty.key]]
        : [];
  const prefix = {
    empty: "{empty}",
    "empty-if-100": "{empty_if_100}",
    "div-by-100": "{div_by_100}",
  } as const;
  return rawIds.map((id) => {
    const transform = filter.tradeIdTransforms?.[id];
    return transform ? `${prefix[transform]}${id}` : id;
  });
}

function definedRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

/** Browser layout preserves intentional newlines but not terminal whitespace. */
function renderedDisplayText(value: string | undefined) {
  return value
    ?.replace(/\r\n/g, "\n")
    .replace(/[ \t]+(?=\n|$)/g, "");
}

function copiedPropertyNumber(item: ParsedPoeItem, label: string) {
  const value = Object.entries(item.properties).find(
    ([key]) => key.trim().toLowerCase() === label.toLowerCase(),
  )?.[1];
  const match = value && /[-+]?\d[\d,]*(?:\.\d+)?/.exec(value);
  if (!match) return undefined;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function localCanonicalCategory(item: ParsedPoeItem) {
  if (item.rarity === "gem") return "Gem";
  if (item.rarity === "currency") return "Currency";
  if (item.rarity === "divination-card") return "Divination Card";
  if (/^captured beasts?$/i.test(item.itemClass.trim())) return "Captured Beast";
  const pinnedCategory = pinnedCraftableItemCategory(item.name, item.baseType);
  if (pinnedCategory) return pinnedCategory;
  const categories = [...new Set(
    [item.baseType, item.name]
      .filter(Boolean)
      .flatMap((identity) => baseCatalog.itemProfiles[identity] || [])
      .flatMap((profile) => profile.craftable?.category || []),
  )];
  return categories.length === 1 ? categories[0] : undefined;
}

function expectedLocalRarity(fixture: AptGoldenCase) {
  const aptRarity = fixture.apt.item.rarity?.toLowerCase();
  if (aptRarity) return aptRarity;
  if (fixture.apt.item.category === "Gem") return "gem";
  if (fixture.apt.item.category === "Currency") return "currency";
  if (fixture.apt.item.category === "Divination Card") return "divination-card";
  return undefined;
}

function assertParsedIdentity(fixture: AptGoldenCase, item: ParsedPoeItem) {
  const apt = fixture.apt.item;
  const localDisplayName = apt.isFoulborn && apt.name
    ? `Foulborn ${apt.name}`
    : apt.name;
  expect(item.rarity).toBe(expectedLocalRarity(fixture));
  if (apt.category) expect(localCanonicalCategory(item)).toBe(apt.category);

  if (apt.rarity === "Magic") {
    // APT replaces an affixed magic name with its canonical database base.
    expect(resolveMagicBaseType(item.name)).toBe(apt.name);
  } else if (apt.baseType) {
    expect(item).toMatchObject({ name: localDisplayName, baseType: apt.baseType });
  } else if (apt.name) {
    // Gems intentionally keep the copied Vaal display name locally while
    // their canonical searchable base remains APT's GEM identity.
    expect([item.name, item.baseType]).toContain(apt.name);
  }
  const canonicalLocalIdentities = [
    item.name,
    item.baseType,
    item.rarity === "magic" ? resolveMagicBaseType(item.name) : undefined,
  ].filter((identity): identity is string => Boolean(identity)).map((identity) =>
    apt.isFoulborn ? identity.replace(/^Foulborn\s+/i, "") : identity
  );
  expect(canonicalLocalIdentities).toContain(apt.info.refName);
}

/**
 * Remove only JSON forms that the official Trade service interprets
 * identically. Complete row enabled/value state is compared independently.
 */
function semanticTradePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticTradePayload);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key === "disabled" && entry === false) continue;
    const normalized = semanticTradePayload(entry);
    if (
      key === "value" &&
      normalized &&
      typeof normalized === "object" &&
      !Array.isArray(normalized) &&
      Object.keys(normalized).length === 0
    ) continue;
    result[key] = normalized;
  }
  if (
    Object.keys(result).length === 1 &&
    result.filters &&
    typeof result.filters === "object" &&
    !Array.isArray(result.filters) &&
    Object.keys(result.filters as Record<string, unknown>).length === 0
  ) return undefined;
  return Object.fromEntries(
    Object.entries(result).filter(([, entry]) => entry !== undefined),
  );
}

function aptStatView(stat: AptStatFilter) {
  const option = typeof stat.option === "object" && stat.option !== null
    ? stat.option.value
    : stat.option;
  return definedRecord({
    ids: stat.tradeId,
    enabled: !stat.disabled,
    hidden: Boolean(stat.hidden),
    copiedValue: stat.roll?.value,
    min: stat.roll?.min,
    max: stat.roll?.max,
    bounds: stat.roll?.bounds,
    option,
    text: renderedDisplayText(stat.displayText ?? stat.text ?? stat.statRef),
    statRef: stat.statRef,
    tag: stat.tag,
    decimal: Boolean(stat.roll?.dp),
    sourceNegated: Boolean(stat.roll?.isNegated),
    negated: Boolean(stat.not),
    inverted: Boolean(stat.roll?.tradeInvert),
    oils: stat.oils,
  });
}

function localStatView(
  filter: PriceCheckModifierFilter,
  item?: ParsedPoeItem,
) {
  const modifier = item?.modifiers.find((entry) => entry.id === filter.modifierId);
  const ids = decoratedTradeIds(filter);
  const firstId = ids[0]?.replace(/^\{[^}]+\}/, "");
  const internalRef = /^item\.heist_(?:job_|target_)/.test(firstId || "")
    ? firstId
    : firstId === "pseudo.pseudo_number_of_enchant_mods"
      ? "# Enchant Modifiers"
      : undefined;
  const internalProperty = Boolean(
    firstId?.startsWith("item.") && firstId !== "item.has_empty_modifier",
  );
  const variant = /^expedition logbook$/i.test((item?.baseType || item?.name || "").trim());
  return definedRecord({
    ids,
    enabled: filter.enabled,
    hidden: Boolean(filter.advancedOnly),
    copiedValue: filter.copiedValue,
    min: filter.min,
    max: filter.max,
    bounds: filter.bounds,
    option: filter.tradeOption,
    text: renderedDisplayText(filter.label || modifier?.text || filter.modifierId),
    statRef: filter.statRef || (filter.equipmentProperty
      ? PROPERTY_STAT_REFS[filter.equipmentProperty.key]
      : modifier?.tradeStatRef || internalRef),
    tag: filter.tag || (filter.equipmentProperty
      ? "property"
      : internalProperty
        ? "property"
      : variant && modifier
        ? "variant"
        : modifier?.kind === "unknown"
          ? undefined
          : modifier?.kind || (firstId?.startsWith("pseudo.") ? "pseudo" : undefined)),
    decimal: Boolean(
      modifier?.tradeDecimalPrecision ||
      filter.equipmentProperty?.key === "aps" ||
      filter.equipmentProperty?.key === "crit"
    ),
    sourceNegated: Boolean(modifier?.values.some((value) => value < 0)),
    negated: Boolean(filter.negated),
    inverted: Boolean(filter.tradeInverted),
    oils: filter.anointmentOils,
  });
}

type JsonObject = Record<string, unknown>;

const APT_ITEM_FILTER_KEYS = new Set([
  "searchExact",
  "searchRelaxed",
  "trade",
  "rarity",
  "linkedSockets",
  "whiteSockets",
  "corrupted",
  "fractured",
  "imbuedGem",
  "mirrored",
  "split",
  "foil",
  "foulborn",
  "vestigial",
  "influences",
  "quality",
  "gemLevel",
  "mapTier",
  "mapBlighted",
  "mapCompletionReward",
  "scryingMapArea",
  "itemLevel",
  "stackSize",
  "unidentified",
  "veiled",
  "areaLevel",
  "heistWingsRevealed",
  "sentinelCharge",
]);

function jsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function aptIdentityState(identity: AptIdentityState) {
  return {
    active: identity.active,
    primaryLabel: identity.primaryLabel,
    subVisible: identity.subVisible,
    searches: identity.searches,
  };
}

function localIdentityState(
  item: ParsedPoeItem,
  plan: PriceCheckQueryPlan,
  exactItemFilters: boolean,
) {
  const { exact, relaxed } = plan.identityState;
  const active = !relaxed || relaxed.disabled
    ? "exact"
    : relaxed.sub && !relaxed.sub.disabled
      ? "sub"
      : "relaxed";
  const identityControlKeys = priceCheckItemFilterControls(item, {
    exact: exactItemFilters,
    itemFilters: plan.itemFilters,
  }).map((control) => control.key);
  return {
    active,
    primaryLabel: active === "exact" ? exact.label : relaxed!.label,
    subVisible: identityControlKeys.includes("identitySub"),
    searches: [
      {
        key: "exact",
        label: exact.label,
        disabled: false,
        query: definedRecord(exact.query),
      },
      ...(relaxed ? [{
        key: "relaxed" as const,
        label: relaxed.label,
        disabled: relaxed.disabled,
        query: definedRecord(relaxed.query),
      }] : []),
      ...(relaxed?.sub ? [{
        key: "sub" as const,
        label: relaxed.sub.label,
        disabled: relaxed.sub.disabled,
        query: definedRecord(relaxed.sub.query),
      }] : []),
    ],
  };
}

function aptVisibleItemControls(filters: JsonObject) {
  const controls: JsonObject[] = [];
  const numeric = (sourceKey: string, key = sourceKey) => {
    const source = jsonObject(filters[sourceKey]);
    if (!source || typeof source.value !== "number") return;
    const upper = typeof source.max === "number" ? source.max : undefined;
    controls.push(definedRecord({
      key,
      kind: upper == null ? "number" : "number-range",
      copiedValue: source.value,
      copiedUpperValue: upper,
      disabled: source.disabled === true,
      hidden: false,
    }));
  };
  const logical = (
    key: string,
    copiedValue: string | boolean,
    disabled = false,
    readonly = false,
  ) => controls.push(definedRecord({
    key,
    kind: typeof copiedValue === "boolean" ? "boolean" : "string",
    copiedValue,
    disabled,
    hidden: false,
    readonly: readonly || undefined,
  }));

  // FiltersBlock.vue fixes this presentation order; corruption lives in the
  // adjacent FilterName control and is ordered with the logical state chips.
  numeric("linkedSockets", "links");
  numeric("mapTier");
  const reward = jsonObject(filters.mapCompletionReward);
  if (reward && typeof reward.name === "string") {
    logical("mapCompletionReward", reward.name, false, true);
  }
  if (typeof filters.scryingMapArea === "string") {
    logical("scryingMapArea", filters.scryingMapArea, false, true);
  }
  numeric("areaLevel");
  numeric("heistWingsRevealed", "heistWings");
  numeric("sentinelCharge");
  const blighted = jsonObject(filters.mapBlighted);
  if (blighted && typeof blighted.value === "string") {
    logical("mapBlighted", blighted.value, false, true);
  }
  numeric("itemLevel");
  numeric("stackSize");
  numeric("whiteSockets");
  numeric("gemLevel");
  numeric("quality");
  if (Array.isArray(filters.influences)) {
    for (const entry of filters.influences) {
      const influence = jsonObject(entry);
      if (!influence || typeof influence.value !== "string") continue;
      logical(
        `influence:${influence.value.toLowerCase()}`,
        true,
        influence.disabled === true,
      );
    }
  }
  const rarity = jsonObject(filters.rarity);
  if (rarity?.value === "magic") {
    logical("rarity", "magic", rarity.disabled === true);
  }
  const corrupted = jsonObject(filters.corrupted);
  if (corrupted && typeof corrupted.value === "boolean") {
    logical("corrupted", corrupted.value);
  }
  const unidentified = jsonObject(filters.unidentified);
  if (unidentified) logical("identified", false, unidentified.disabled === true);
  const veiled = jsonObject(filters.veiled);
  if (veiled) logical("veiled", true, veiled.disabled === true);
  const foil = jsonObject(filters.foil);
  if (foil) logical("foil", true, foil.disabled === true);
  const mirrored = jsonObject(filters.mirrored);
  if (mirrored && mirrored.hidden !== true) {
    logical("mirrored", mirrored.disabled !== true, mirrored.disabled === true);
  }
  const split = jsonObject(filters.split);
  if (split && split.hidden !== true) {
    logical("split", split.disabled !== true, split.disabled === true);
  }
  return controls;
}

function localVisibleItemControls(
  item: ParsedPoeItem,
  plan: PriceCheckQueryPlan,
  exact: boolean,
) {
  return priceCheckItemFilterControls(item, {
    exact,
    league: LEAGUE,
    itemFilters: plan.itemFilters,
  })
    .filter((control) =>
      control.key !== "identityRelaxed" && control.key !== "identitySub"
    ).map((control) => {
    const enabled = Object.hasOwn(plan.itemFilters, control.key) && (
      control.kind !== "number-range" || Object.hasOwn(plan.itemFilters, control.upperKey)
    );
    return definedRecord({
      key: control.key,
      kind: control.kind,
      copiedValue: control.copiedValue,
      copiedUpperValue: control.kind === "number-range"
        ? control.copiedUpperValue
        : undefined,
      disabled: !enabled,
      hidden: false,
      readonly: control.kind === "string" && control.readonly || undefined,
    });
    });
}

const HIDDEN_ITEM_STATE_ORDER = [
  "fractured",
  "imbuedGem",
  "foulborn",
  "vestigial",
  "mirrored",
  "split",
] as const;

function aptHiddenItemState(filters: JsonObject) {
  const values = new Map<string, boolean>();
  if (jsonObject(filters.fractured)?.value === false) values.set("fractured", false);
  if (jsonObject(filters.imbuedGem)?.disabled === true) values.set("imbuedGem", false);
  const foulborn = jsonObject(filters.foulborn);
  if (typeof foulborn?.value === "boolean") values.set("foulborn", foulborn.value);
  const vestigial = jsonObject(filters.vestigial);
  if (typeof vestigial?.value === "boolean") values.set("vestigial", vestigial.value);
  const mirrored = jsonObject(filters.mirrored);
  if (mirrored?.hidden === true && mirrored.disabled === true) values.set("mirrored", false);
  const split = jsonObject(filters.split);
  if (split?.hidden === true && split.disabled === true) values.set("split", false);
  return HIDDEN_ITEM_STATE_ORDER.flatMap((key) =>
    values.has(key) ? [{ key, value: values.get(key), hidden: true }] : []
  );
}

function localHiddenItemState(
  plan: PriceCheckQueryPlan,
  visibleControls: ReadonlyArray<JsonObject>,
) {
  const visible = new Set(visibleControls.map((control) => String(control.key)));
  return HIDDEN_ITEM_STATE_ORDER.flatMap((key) =>
    !visible.has(key) && Object.hasOwn(plan.itemFilters, key)
      ? [{ key, value: plan.itemFilters[key], hidden: true }]
      : []
  );
}

function aptTradeState(filters: JsonObject) {
  const trade = jsonObject(filters.trade);
  if (!trade) throw new Error("APT preset is missing trade state.");
  return definedRecord({
    league: trade.league,
    status: trade.offline === true
      ? "any"
      : trade.merchantOnly === true
        ? "securable"
        : "available",
    currency: trade.currency,
    listed: trade.listed,
    collapseListings: trade.collapseListings,
    collapseMerchant: trade.collapseMerchant,
    merchantOnly: trade.merchantOnly,
    offline: trade.offline,
    onlineInLeague: trade.onlineInLeague,
  });
}

function localTradeState(plan: PriceCheckQueryPlan) {
  const merchantOnly = plan.status === "securable";
  return definedRecord({
    league: plan.league,
    status: plan.status,
    currency: plan.itemFilters.tradeCurrency,
    listed: plan.itemFilters.listed,
    // These three settings are fixed harness inputs whose serialized effects
    // are compared again against the exact request below.
    collapseListings: "api",
    collapseMerchant: Boolean(plan.itemFilters.tradeCurrency),
    merchantOnly,
    offline: plan.status === "any",
    onlineInLeague: false,
  });
}

function presetUsesExactItemFilters(item: ParsedPoeItem, preset: AptPreset) {
  return modeForPreset(item, preset.id) !== "similar";
}

function branch(id: (typeof REQUIRED_BRANCHES)[number]) {
  const fixture = golden.cases.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`Golden is missing ${id}.`);
  return fixture;
}

describe("pinned APT all-current-family golden provenance", () => {
  it("is bound to the same APT commit and source databases as both local catalogs", () => {
    expect(golden).toMatchObject({
      schema: 4,
      source: {
        project: "Awakened PoE Trade",
        version: "3.29.104",
        commit: PINNED_COMMIT,
      },
    });
    expect(baseCatalog.source).toMatchObject({
      commit: golden.source.commit,
      inputSha256: golden.source.itemsSha256,
    });
    expect(statCatalog.source).toMatchObject({
      commit: golden.source.commit,
      inputSha256: golden.source.statsSha256,
    });
    expect(golden.source.clientStringsSha256).toMatch(/^[a-f0-9]{64}$/);

    const fixtureProjection = golden.cases.map(({ apt: _apt, ...fixture }) => fixture);
    expect(sha256(JSON.stringify(fixtureProjection)))
      .toBe(golden.source.fixturesSha256);
    const aptProjection = {
      cases: golden.cases.map(({ id, apt }) => ({ id, apt })),
      referenceOracles: golden.referenceOracles,
    };
    expect(sha256(JSON.stringify(aptProjection))).toBe(PINNED_APT_OUTPUTS_SHA256);
    expect(golden.source.aptOutputsSha256).toBe(PINNED_APT_OUTPUTS_SHA256);
  });

  it("covers every executable pinned database category exactly once", () => {
    const craftable = Object.values(baseCatalog.itemProfiles)
      .flat()
      .flatMap((profile) => profile.craftable?.category || [])
      .filter((category, index, categories) => categories.indexOf(category) === index);
    const executable = [...new Set([
      ...craftable,
      ...SPECIAL_DATABASE_CATEGORIES,
    ])].sort();
    const categoryCases = golden.cases.filter((entry) => entry.kind === "category");

    expect(executable).toEqual(golden.coverage.executableCategories);
    expect(executable).toHaveLength(47);
    expect(golden.coverage.currentEnumCategories)
      .toEqual(executable.filter((category) => category !== "Unique Fragment"));
    expect(golden.coverage.executableCategories).toContain("Unique Fragment");
    expect(golden.coverage.staleEnumOnlyCategories).toEqual([...STALE_ENUM_ONLY]);
    expect(categoryCases).toHaveLength(47);
    expect(categoryCases.map((entry) => entry.category).sort()).toEqual(executable);
    expect(new Set(categoryCases.map((entry) => entry.category)).size).toBe(47);
    expect(categoryCases.every((entry) => entry.origin === CONSTRUCTED_ORIGIN)).toBe(true);
    expect(categoryCases.every((entry) => entry.apt.item.category === entry.category)).toBe(true);
  });

  it("covers every requested parser/resolver branch with honest fixture origins", () => {
    const branches = golden.cases.filter((entry) => entry.kind === "branch");
    expect(branches.map((entry) => entry.id)).toEqual([...REQUIRED_BRANCHES]);
    expect(branches).toHaveLength(REQUIRED_BRANCHES.length);
    const recoveredLive = new Set([
      "branch-chart-properties",
      "branch-golem-spell-kinetic-wand",
      "branch-vestigial-malachais-loop",
    ]);
    expect(branches.filter((entry) => recoveredLive.has(entry.id))
      .every((entry) => entry.origin === LIVE_ORIGIN)).toBe(true);
    expect(branches.filter((entry) => !recoveredLive.has(entry.id))
      .every((entry) => entry.origin === CONSTRUCTED_ORIGIN)).toBe(true);
  });
});

describe("pinned APT branch evidence", () => {
  it("executes canonical advanced, repeated-placeholder, multiline, and value-selected labels", () => {
    const advanced = branch("branch-label-advanced-canonical");
    expect(advanced.raw).toContain(
      "to Level of all Fireball(Fireball-Mana-Infused Staff) Gems",
    );
    expect(advanced.apt.item.parsedModifiers[0].stats[0]).toMatchObject({
      ref: "+# to Level of all Fireball Gems (Random Skill Gem)",
      matcher: "# to Level of all Fireball Gems",
      roll: { value: 1 },
    });
    expect(advanced.apt.presets[0].stats[0]).toMatchObject({
      text: "# to Level of all Fireball Gems",
      displayText: "1 to Level of all Fireball Gems",
    });

    const repeated = branch("branch-label-multi-placeholder");
    expect(repeated.apt.item.parsedModifiers[0].stats[0].roll).toMatchObject({
      value: 1.5,
      min: 1.5,
      max: 1.5,
    });
    expect(repeated.apt.presets[0].stats[0]).toMatchObject({
      text: "Adds # to # Physical Damage",
      displayText: "Adds 1 to 1 Physical Damage",
      roll: { value: 1 },
    });

    const multiline = branch("branch-label-multiline");
    const multilineTemplate = "# Lightning Damage taken per second per Power Charge if\n" +
      "your Skills have dealt a Critical Strike Recently";
    expect(multiline.apt.presets[0].stats[0]).toMatchObject({
      statRef: multilineTemplate,
      text: multilineTemplate,
      displayText: multilineTemplate.replace("#", "20"),
    });

    const grammar = branch("branch-label-singular-plural").apt.presets[0].stats;
    expect(grammar.map((stat) => ({
      id: stat.tradeId[0],
      text: stat.text,
      displayText: stat.displayText,
      value: stat.roll?.value,
    }))).toEqual([
      {
        id: "enchant.stat_4079888060",
        text: "# Added Passive Skills are Jewel Sockets",
        displayText: "2 Added Passive Skills are Jewel Sockets",
        value: 2,
      },
      {
        id: "explicit.stat_4079888060",
        text: "1 Added Passive Skill is a Jewel Socket",
        displayText: "1 Added Passive Skill is a Jewel Socket",
        value: 1,
      },
    ]);
    expect(branch("branch-resolver-transforms").apt.presets[0].stats.slice(0, 2)
      .map((stat) => stat.text)).toEqual([
      "Curse Enemies with Vulnerability on Hit",
      "Gain a Flask Charge when you deal a Critical Strike",
    ]);
  });

  it("executes negation, round buckets, matcher value zero, and source aggregation", () => {
    const negated = branch("branch-flask-properties");
    expect(negated.apt.item.parsedModifiers[0].stats[0]).toMatchObject({
      matcher: "#% reduced Charges per use",
      negate: true,
      roll: { value: -20, min: -20, max: -20 },
    });
    expect(negated.apt.presets[0].stats[0]).toMatchObject({
      text: "#% reduced Charges per use",
      displayText: "20% reduced Charges per use",
      roll: { value: 20, min: 20, tradeInvert: true, isNegated: true },
    });

    const rounded = branch("branch-label-decimal-rounding").apt.presets[0].stats;
    expect(rounded.map((stat) => ({
      value: stat.roll?.value,
      displayText: stat.displayText,
    }))).toEqual([
      { value: 2.29, displayText: "2.29% of Attack Damage Leeched as Life" },
      { value: 2.3, displayText: "2.3% of Attack Damage Leeched as Life against Bleeding Enemies" },
      { value: 9.9, displayText: "9.9% of Attack Damage Leeched as Life against Chilled Enemies" },
      { value: 10, displayText: "10% of Attack Damage Leeched as Life against Maimed Enemies" },
    ]);

    const zero = branch("branch-label-zero-value");
    expect(zero.apt.item.parsedModifiers[0].stats[0]).toMatchObject({
      matcher: "Wild Rogue Exiles in your Maps have Soul Eater",
      matcherValue: 0,
    });
    expect(zero.apt.item.parsedModifiers[0].stats[0]).not.toHaveProperty("roll");
    expect(zero.apt.presets[0].stats[0]).toMatchObject({
      text: "Wild Rogue Exiles in your Maps are Possessed by a Tormented Spirit\n" +
        "Wild Rogue Exiles in your Maps have #% chance to have Soul Eater",
      displayText: "Wild Rogue Exiles in your Maps are Possessed by a Tormented Spirit\n" +
        "Wild Rogue Exiles in your Maps have #% chance to have Soul Eater",
    });
    expect(zero.apt.presets[0].stats[0]).not.toHaveProperty("roll");

    const summed = branch("branch-label-aggregate-sum");
    expect(summed.apt.item.calculatedStats).toEqual([
      expect.objectContaining({
        ref: "#% chance to gain a Flask Charge when you deal a Critical Strike",
        type: "explicit",
        sources: [
          expect.objectContaining({ contributes: { value: 40, min: 40, max: 40 } }),
          expect.objectContaining({ contributes: { value: 60, min: 60, max: 60 } }),
        ],
      }),
    ]);
    expect(summed.apt.presets[0].stats[0]).toMatchObject({
      text: "Gain a Flask Charge when you deal a Critical Strike",
      displayText: "Gain a Flask Charge when you deal a Critical Strike",
      roll: { value: 100, min: 100 },
    });

    const tablet = branch("branch-label-mirrored-tablet-max");
    expect(tablet.apt.item.calculatedStats[0]).toMatchObject({
      ref: "Reflection of Abyss (Difficulty #)",
      type: "pseudo",
      sources: [
        { contributes: { value: 5, min: 5, max: 5 } },
        { contributes: { value: 8, min: 8, max: 8 } },
      ],
    });
    expect(tablet.apt.presets[0].stats[0]).toMatchObject({
      displayText: "Reflection of Abyss (Difficulty 8)",
      roll: { value: 8, min: 8 },
    });

    expect(golden.referenceOracles.statSourcesTotal).toMatchObject({
      origin: "direct-pinned-function-execution",
      source: "renderer/src/parser/modifiers.ts#statSourcesTotal",
      executableItemInvariant: false,
      sumWithMissingContribution: {
        mode: "sum",
        inputs: [{ value: 20, min: 18, max: 22 }, null],
        result: { value: 21, min: 19, max: 23 },
      },
      maxStartsAtZero: {
        mode: "max",
        result: { value: 0, min: 0, max: 0 },
      },
    });
  });

  it("records the requested nameplate, singleton, Tablet, property, link, and state branches", () => {
    expect(branch("branch-vaal-gem-singleton").apt.item).toMatchObject({
      category: "Gem",
      name: "Fireball",
      isCorrupted: true,
    });
    expect(branch("branch-split-cannot-use-nameplate").apt.item).toMatchObject({
      category: "Body Armour",
      name: "Doom Shell",
      baseType: "Vaal Regalia",
    });
    expect(branch("branch-mirrored-tablet-eight-lines").raw
      .split(/\r?\n/).filter((line) => line.startsWith("Reflection of "))).toHaveLength(8);
    expect(branch("branch-mirrored-tablet-eight-lines").apt.presets[0].stats).toHaveLength(6);
    expect(branch("branch-flask-properties").apt.presets[0].stats).toHaveLength(2);
    const advancedTincture = golden.cases.find(
      (entry) => entry.id === "category-tincture",
    );
    expect(advancedTincture?.apt.item).toMatchObject({
      parsedModifiers: [
        { info: { type: "explicit", name: "Perfect" }, stats: [{ ref: "#% increased Cooldown Recovery Rate" }] },
        { info: { type: "explicit", name: "of the Oak" }, stats: [] },
      ],
      calculatedStats: [{ ref: "#% increased Cooldown Recovery Rate", type: "explicit" }],
      unknownModifiers: [{
        text: "15(13-15)% increased Effect",
        type: "explicit",
      }],
    });
    const tinctureBase = branch("branch-tincture-properties");
    expect(tinctureBase.raw).toContain("40% increased Elemental Damage with Melee Weapons");
    expect(tinctureBase.raw).toContain(
      "Mana Burn causes you to lose 1% of your maximum Mana per second",
    );
    expect(tinctureBase.apt.item).toMatchObject({
      name: "Fulgurite Tincture",
      parsedModifiers: [{
        info: { type: "explicit", name: "of the Order" },
        stats: [{ ref: "#% increased Cooldown Recovery Rate" }],
      }],
      unknownModifiers: [],
    });
    expect(tinctureBase.apt.presets[0].stats).toHaveLength(1);
    expect(branch("branch-flask-properties").apt.item.calculatedStats[0])
      .toMatchObject({
        ref: "#% increased Charges per use",
        sources: [{ contributes: { value: -20, min: -20, max: -20 } }],
      });
    expect(branch("branch-flask-properties").apt.presets[0].stats[0])
      .toMatchObject({
        roll: { value: 20, min: 20, tradeInvert: true, isNegated: true },
      });
    const uniqueFragment = golden.cases.find((entry) => entry.id === "category-unique-fragment");
    expect(uniqueFragment?.apt.item).toMatchObject({
      parsedModifiers: [],
      calculatedStats: [],
      unknownModifiers: [],
    });
    for (const links of [3, 4, 5, 6] as const) {
      expect(branch(`branch-${links}-link-sockets`).apt.item.sockets?.linked)
        .toBe(links >= 5 ? links : undefined);
    }
    expect(branch("branch-chart-properties").apt.item).toMatchObject({
      category: "Chart",
      areaItemQuantity: 64,
      chartSulphur: 60,
    });
    expect(branch("branch-imbued-gem").apt.item.imbuedGem).toBe(true);
    expect(branch("branch-imbued-gem").apt.presets[0].stats[0].tradeId)
      .toEqual(["imbued.pseudo_built_in_support|2554120916"]);
    expect(branch("branch-veiled-word-is-not-state").apt.item.isVeiled).not.toBe(true);
    expect(branch("branch-synthesised-word-is-not-state").apt.item.isSynthesised).not.toBe(true);
    expect(branch("branch-fractured-word-is-not-state").apt.item.isFractured).not.toBe(true);
    expect(branch("branch-resolver-transforms").apt.presets[0].stats.map((stat) => stat.tradeId))
      .toEqual([
        ["explicit.stat_2213584313", "{empty_if_100}explicit.stat_3967845372"],
        ["explicit.stat_3738001379", "{div_by_100}explicit.stat_1546046884"],
        ["explicit.stat_1588094148", "{empty}explicit.stat_849085925"],
      ]);
  });

  it("records resolved-unique, unidentified, and craftable preset policy branches", () => {
    const mageblood = branch("branch-unique-mageblood-advanced");
    expect(mageblood.apt.presets.map((preset) => preset.id))
      .toEqual(["filters.preset_pseudo"]);
    expect(mageblood.apt.presets[0].itemFilters).toMatchObject({
      searchExact: {
        name: "Mageblood",
        nameTrade: "Mageblood",
        baseTypeTrade: "Heavy Belt",
      },
    });
    expect(mageblood.apt.presets[0].itemFilters).not.toHaveProperty("searchRelaxed");
    expect(mageblood.apt.presets[0].stats).toHaveLength(7);

    for (const id of [
      "branch-unidentified-watcher-eye",
      "branch-unidentified-unique-heavy-belt",
    ] as const) {
      const fixture = branch(id);
      expect(fixture.apt.item.isUnidentified).toBe(true);
      expect(fixture.apt.presets.map((preset) => preset.id))
        .toEqual(["filters.preset_exact"]);
      expect(fixture.apt.presets[0]).toMatchObject({
        itemFilters: { unidentified: { value: true } },
        stats: [],
      });
      expect(fixture.apt.presets[0].itemFilters).toHaveProperty("searchRelaxed");
    }

    expect(branch("branch-magic-body-armour").apt.presets.map((preset) => preset.id))
      .toEqual(["filters.preset_pseudo", "filters.preset_base_item"]);
    expect(branch("branch-advanced-rare-body-armour").apt.presets.map((preset) => preset.id))
      .toEqual(["filters.preset_pseudo"]);
    expect(branch("branch-cluster-jewel-policy").apt.presets.map((preset) => preset.id))
      .toEqual(["filters.preset_pseudo", "filters.preset_base_item"]);
    expect(branch("branch-magic-cobalt-jewel").apt.presets.map((preset) => preset.id))
      .toEqual(["filters.preset_pseudo", "filters.preset_base_item"]);
  });

  it("records each parser state independently instead of relying on false-trigger words", () => {
    expect(branch("branch-influence-state").apt.item.influences)
      .toEqual(["Shaper", "Elder"]);
    expect(branch("branch-synthesised-state").apt.item.isSynthesised).toBe(true);
    expect(branch("branch-fractured-state").apt.item.isFractured).toBe(true);
    expect(branch("branch-corrupted-state").apt.item.isCorrupted).toBe(true);
    expect(branch("branch-mirrored-state").apt.item.isMirrored).toBe(true);
    expect(branch("branch-split-state").apt.item.isSplit).toBe(true);
    expect(branch("branch-corrupted-unique").apt.item).toMatchObject({
      name: "Ralakesh's Impatience",
      isCorrupted: true,
    });
  });

  it("records map completion, unique-map, Flask enchant, and anointment policy branches", () => {
    const completion = branch("branch-map-completion-reward");
    expect(completion.apt.item.mapCompletionReward).toMatchObject({ name: "The Squire" });
    expect(completion.apt.presets).toHaveLength(1);
    expect(completion.apt.presets[0]).toMatchObject({
      id: "filters.preset_exact",
      itemFilters: { mapCompletionReward: { name: "The Squire" } },
    });
    expect(branch("branch-unique-map").apt.presets[0]).toMatchObject({
      id: "filters.preset_exact",
      itemFilters: {
        searchExact: { name: "Whakawairua Tuahu", discriminatorTrade: "map" },
        mapTier: { value: 16, disabled: false },
      },
    });

    expect(branch("branch-flask-instilling-enchantment").apt.presets[0].stats)
      .toMatchObject([{
        tradeId: ["enchant.stat_3287581721"],
        hidden: "hide_harvest_and_instilling",
        disabled: true,
      }]);
    expect(branch("branch-flask-enkindling-enchantment").apt.presets[0].stats)
      .toMatchObject([
        {
          tradeId: ["enchant.stat_2448920197"],
          hidden: "hide_harvest_and_instilling",
          disabled: true,
        },
        {
          tradeId: ["enchant.stat_4123533923"],
          hidden: "hide_harvest_and_instilling",
          disabled: true,
        },
      ]);

    expect(branch("branch-anoint-low-oil-ring").apt.presets[0].stats[0])
      .toMatchObject({
        oils: ["Violet Oil", "Violet Oil"],
        hidden: "filters.hide_anointment",
        disabled: true,
      });
    expect(branch("branch-anoint-high-oil-ring").apt.presets[0].stats[0])
      .toMatchObject({ oils: ["Golden Oil", "Golden Oil"], disabled: true });
    expect(branch("branch-anoint-high-oil-ring").apt.presets[0].stats[0].hidden)
      .toBeUndefined();
    expect(branch("branch-anoint-low-oil-talisman").apt.presets[0].stats[0])
      .toMatchObject({
        oils: ["Violet Oil", "Violet Oil"],
        disabled: false,
      });
    expect(branch("branch-anoint-low-oil-talisman").apt.presets[0].stats[0].hidden)
      .toBeUndefined();
  });

  it("records Foil, Foulborn, Vestigial, shield, and reported wand regressions", () => {
    expect(branch("branch-foil-unique").apt.item).toMatchObject({
      name: "Replica Alberon's Warpath",
      isFoil: true,
    });
    expect(branch("branch-foulborn-watcher-eye").apt.item).toMatchObject({
      name: "Watcher's Eye",
      isFoulborn: true,
    });
    expect(branch("branch-foulborn-mageblood").apt).toMatchObject({
      item: { name: "Mageblood", isFoulborn: true },
      presets: [{ stats: [{ disabled: false }] }],
    });
    expect(branch("branch-vestigial-skyforth").apt).toMatchObject({
      item: { name: "Skyforth", baseType: "Sorcerer Boots", isVestigial: true },
      presets: [{ stats: [{ disabled: false }] }],
    });

    const malachai = branch("branch-vestigial-malachais-loop");
    expect(malachai.apt.item).toMatchObject({
      name: "Malachai's Loop",
      baseType: "Harmonic Spirit Shield",
      isVestigial: true,
    });
    expect(malachai.apt.presets[0].stats).toHaveLength(8);
    expect(malachai.apt.presets[0].stats.filter((stat) => !stat.hidden)).toHaveLength(3);
    expect(malachai.apt.presets[0].stats.filter((stat) => stat.disabled === false)).toHaveLength(3);

    const wand = branch("branch-golem-spell-kinetic-wand").apt.presets[0].stats;
    expect(wand).toHaveLength(10);
    expect(wand.filter((stat) => !stat.hidden)).toHaveLength(9);
    expect(wand.map((stat) => stat.tradeId)).toEqual([
      ["item.physical_dps"],
      ["item.aps"],
      ["item.crit"],
      ["pseudo.pseudo_total_strength"],
      ["pseudo.pseudo_total_intelligence"],
      ["pseudo.pseudo_global_critical_strike_multiplier"],
      ["enchant.stat_1335369947"],
      ["implicit.stat_4082780964"],
      ["explicit.stat_691932474"],
      ["item.has_empty_modifier"],
    ]);
  });

  it("hides a Chart sub chip under exact identity and restores its retained state", () => {
    const fixture = branch("branch-chart-properties");
    const preset = fixture.apt.presets[0];
    const exactAlternate = preset.identity.alternates.find(
      (alternate) => alternate.key === "exact",
    );
    if (!exactAlternate) throw new Error("Chart oracle is missing its exact alternate.");
    expect(preset.identity).toMatchObject({
      active: "sub",
      subVisible: true,
      searches: [
        { key: "exact", disabled: false },
        { key: "relaxed", disabled: false },
        { key: "sub", disabled: false },
      ],
    });
    expect(exactAlternate.identity).toMatchObject({
      active: "exact",
      subVisible: false,
      searches: [
        { key: "exact", disabled: false },
        { key: "relaxed", disabled: true },
        { key: "sub", disabled: false },
      ],
    });

    const item = hydrate(fixture.raw);
    const exactItemFilters = presetUsesExactItemFilters(item, preset);
    const initial = planFor(item, preset);
    const switchedExact = planFor(item, preset, {
      ...initial.itemFilters,
      identityRelaxed: false,
    });
    expect(switchedExact.itemFilters.identitySub).toBe(true);
    expect(localIdentityState(item, switchedExact, exactItemFilters))
      .toEqual(aptIdentityState(exactAlternate.identity));

    const restored = planFor(item, preset, {
      ...switchedExact.itemFilters,
      identityRelaxed: true,
    });
    expect(localIdentityState(item, restored, exactItemFilters))
      .toEqual(localIdentityState(item, initial, exactItemFilters));
    expect(semanticTradePayload(restored.tradeQuery))
      .toEqual(semanticTradePayload(initial.tradeQuery));
    expect(browserPayload(restored)).toEqual(browserPayload(initial));
  });
});

describe("local all-current-family differential against pinned APT", () => {
  it.each(golden.cases)("$id parses and exposes the same preset set/active preset", (fixture) => {
    const item = hydrate(fixture.raw);
    const expectedModes = fixture.apt.presets.map((preset) => modeForPreset(item, preset.id));
    const aptStack = fixture.apt.item.stackSize;

    expect(item.valid, item.errors.join("; ")).toBe(true);
    assertParsedIdentity(fixture, item);
    expect(priceCheckModesForItem(item)).toEqual(expectedModes);
    expect(defaultPriceCheckModeForItem(item))
      .toBe(modeForPreset(item, fixture.apt.active));
    expect(item).toMatchObject(definedRecord({
      itemLevel: fixture.apt.item.itemLevel,
      quality: fixture.apt.item.quality,
      gemLevel: fixture.apt.item.gemLevel,
      mapTier: fixture.apt.item.mapTier,
      mapBlighted: fixture.apt.item.mapBlighted,
      mapCompletionReward: fixture.apt.item.mapCompletionReward?.name,
      chartArea: fixture.apt.item.category === "Chart"
        ? fixture.apt.item.mapArea?.name
        : undefined,
      chartAreaTradeDiscriminator: fixture.apt.item.category === "Chart"
        ? fixture.apt.item.mapArea?.tradeDisc
        : undefined,
      talismanTier: fixture.apt.item.talismanTier,
      stackSize: aptStack?.value,
      maxStackSize: aptStack?.max,
      identified: !fixture.apt.item.isUnidentified,
      corrupted: Boolean(fixture.apt.item.isCorrupted),
      unmodifiable: fixture.apt.item.isUnmodifiable,
      mirrored: Boolean(fixture.apt.item.isMirrored),
      split: Boolean(fixture.apt.item.isSplit),
      synthesised: Boolean(fixture.apt.item.isSynthesised),
      fractured: Boolean(fixture.apt.item.isFractured),
      veiled: Boolean(fixture.apt.item.isVeiled),
      foil: Boolean(fixture.apt.item.isFoil),
      foulborn: Boolean(fixture.apt.item.isFoulborn),
      vestigial: Boolean(fixture.apt.item.isVestigial),
      influences: fixture.apt.item.influences,
    }));
    expect(item.areaLevel ?? copiedPropertyNumber(item, "Area Level"))
      .toBe(fixture.apt.item.areaLevel);
    expect(item.areaItemQuantity ?? copiedPropertyNumber(item, "Item Quantity"))
      .toBe(fixture.apt.item.areaItemQuantity);
    expect(item.areaItemRarity ?? copiedPropertyNumber(item, "Item Rarity"))
      .toBe(fixture.apt.item.areaItemRarity);
    expect(item.areaPackSize ?? copiedPropertyNumber(item, "Monster Pack Size"))
      .toBe(fixture.apt.item.areaPackSize);
    expect(item.chartSulphur ?? copiedPropertyNumber(item, "Dead Man's Sulphur"))
      .toBe(fixture.apt.item.chartSulphur);
    expect(item.links && item.links >= 5 ? item.links : undefined)
      .toBe(fixture.apt.item.sockets?.linked);
    expect(item.modifiers.some((modifier) => modifier.kind === "imbued"))
      .toBe(Boolean(fixture.apt.item.imbuedGem));
  });

  it.each(golden.cases)("$id exposes the same complete ordered item-filter state", (fixture) => {
    const item = hydrate(fixture.raw);
    for (const preset of fixture.apt.presets) {
      const aptFilters = preset.itemFilters;
      const unknownKeys = Object.keys(aptFilters).filter((key) => !APT_ITEM_FILTER_KEYS.has(key));
      expect.soft(unknownKeys, `${preset.id}: unprojected APT item-filter fields`).toEqual([]);

      const plan = planFor(item, preset);
      const exact = presetUsesExactItemFilters(item, preset);
      const aptControls = aptVisibleItemControls(aptFilters);
      const localControls = localVisibleItemControls(item, plan, exact);
      const localIdentity = localIdentityState(item, plan, exact);
      const aptIdentity = aptIdentityState(preset.identity);
      expect.soft(
        localIdentity,
        `${preset.id}: exact/relaxed/sub identity source and rendered state: ${JSON.stringify({
          local: localIdentity,
          apt: aptIdentity,
        })}`,
      ).toEqual(aptIdentity);
      expect.soft(localTradeState(plan), `${preset.id}: trade source state`)
        .toEqual(aptTradeState(aptFilters));
      expect.soft(localControls, `${preset.id}: ordered visible item controls`)
        .toEqual(aptControls);
      expect.soft(
        localHiddenItemState(plan, localControls),
        `${preset.id}: hidden item constraints`,
      ).toEqual(aptHiddenItemState(aptFilters));
    }
  });

  it.each(golden.cases)("$id produces the same ordered complete filter state", (fixture) => {
    const item = hydrate(fixture.raw);
    for (const preset of fixture.apt.presets) {
      const plan = planFor(item, preset);
      const plannedItem = priceCheckItemForMode(item, modeForPreset(item, preset.id));
      const localViews = plan.filters.map((filter) => localStatView(filter, plannedItem));
      expect(
        plan.filters,
        `${preset.id}: ${JSON.stringify({ local: localViews, apt: preset.stats.map(aptStatView) })}`,
      ).toHaveLength(preset.stats.length);
      expect(
        localViews,
        `${preset.id}: ${JSON.stringify({
          local: localViews,
          apt: preset.stats.map(aptStatView),
        })}`,
      ).toEqual(preset.stats.map(aptStatView));
    }
  });

  it.each(golden.cases)("$id produces the same API request and browser q", (fixture) => {
    const item = hydrate(fixture.raw);
    for (const preset of fixture.apt.presets) {
      const plan = planFor(item, preset);
      expect(plan.tradeApi, preset.id).toBe(preset.api === "bulk" ? "exchange" : "trade");
      const localApiPayload = semanticTradePayload(plan.tradeQuery);
      const aptApiPayload = semanticTradePayload(preset.request);
      expect(localApiPayload, `${preset.id}: ${JSON.stringify({
        local: localApiPayload,
        apt: aptApiPayload,
      })}`).toEqual(aptApiPayload);
      const localBrowserPayload = browserPayload(plan);
      const aptBrowserUrl = new URL(preset.browserUrl);
      const localBrowserUrl = new URL(plan.tradeUrl);
      expect(
        {
          origin: localBrowserUrl.origin,
          pathname: localBrowserUrl.pathname,
          parameters: [...localBrowserUrl.searchParams.keys()],
        },
        `${preset.id}: actual APT browser route`,
      ).toEqual({
        origin: aptBrowserUrl.origin,
        pathname: aptBrowserUrl.pathname,
        parameters: [...aptBrowserUrl.searchParams.keys()],
      });
      expect(
        JSON.parse(aptBrowserUrl.searchParams.get("q") || "null"),
        `${preset.id}: APT browser URL q`,
      ).toEqual(preset.browserPayload);
      expect(localBrowserPayload, `${preset.id}: local q must exactly carry the local API body`)
        .toEqual(plan.tradeApi === "exchange"
          ? { exchange: (plan.tradeQuery as { query: unknown }).query }
          : plan.tradeQuery);
      expect(semanticTradePayload(localBrowserPayload), preset.id)
        .toEqual(semanticTradePayload(preset.browserPayload));
    }
  });

  it.each(golden.cases)("$id rebuilds every APT identity alternate and browser route", (fixture) => {
    const item = hydrate(fixture.raw);
    for (const preset of fixture.apt.presets) {
      const exact = presetUsesExactItemFilters(item, preset);
      const hasSub = preset.identity.searches.some((search) => search.key === "sub");
      const defaultPlan = planFor(item, preset);
      for (const alternate of preset.identity.alternates) {
        const itemFilters: Record<string, string | number | boolean> = {
          ...defaultPlan.itemFilters,
          identityRelaxed: alternate.key !== "exact",
        };
        // Selecting the exact parent only hides the child identity in APT; it
        // does not clear the child's retained enabled state. A relaxed
        // alternate represents the child-off state, while the sub alternate
        // represents the child-on state.
        if (hasSub && alternate.key !== "exact") {
          itemFilters.identitySub = alternate.key === "sub";
        }
        const plan = planFor(item, preset, itemFilters);
        const localIdentity = localIdentityState(item, plan, exact);
        const aptIdentity = aptIdentityState(alternate.identity);

        expect.soft(
          localIdentity,
          `${preset.id}/${alternate.key}: complete toggled identity source and rendered state: ${JSON.stringify({
            local: localIdentity,
            apt: aptIdentity,
          })}`,
        ).toEqual(aptIdentity);
        expect.soft(plan.tradeApi, `${preset.id}/${alternate.key}`).toBe("trade");
        expect.soft(
          semanticTradePayload(plan.tradeQuery),
          `${preset.id}/${alternate.key}: ${JSON.stringify({
            local: semanticTradePayload(plan.tradeQuery),
            apt: semanticTradePayload(alternate.request),
          })}`,
        ).toEqual(semanticTradePayload(alternate.request));

        const localUrl = new URL(plan.tradeUrl);
        const aptUrl = new URL(alternate.browserUrl);
        expect.soft({
          origin: localUrl.origin,
          pathname: localUrl.pathname,
          parameters: [...localUrl.searchParams.keys()],
        }, `${preset.id}/${alternate.key}: actual toggled APT browser route`).toEqual({
          origin: aptUrl.origin,
          pathname: aptUrl.pathname,
          parameters: [...aptUrl.searchParams.keys()],
        });
        expect.soft(JSON.parse(aptUrl.searchParams.get("q") || "null"))
          .toEqual(alternate.browserPayload);
        expect.soft(semanticTradePayload(browserPayload(plan)))
          .toEqual(semanticTradePayload(alternate.browserPayload));
      }
    }
  });
});
