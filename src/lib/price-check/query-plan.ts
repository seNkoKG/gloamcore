import type {
  ParsedPoeItem,
  ParsedPoeModifier,
  PriceCheckDashboardMode,
  PriceCheckIdentityState,
  PriceCheckModifierFilter,
  PriceCheckQueryPlan,
} from "./types";
import {
  gemIdentityProfile,
  itemTradeDiscriminator,
  isCraftableBaseType,
  isFixedUniqueModifier,
  mapAreaTradeDiscriminator,
  pinnedCraftableItemCategory,
  resolveMagicBaseType,
  uniqueIdentityProfile,
  uniqueModifierMetadataPolicy,
} from "./magic-base-type";
import {
  isEquipmentPropertyFilter,
  isOfficialPriceCheckFilter,
  planEquipmentPropertyFilters,
} from "./equipment-properties";
import {
  isSelectorTradeStatId,
  officialTradeStatIds,
  sanitizePresenceOnlyPriceCheckFilter,
} from "./trade-stat-id";
import { normalizePriceCheckAvailability } from "./availability";
import {
  buildOfficialTradeBrowserUrl,
  buildOfficialTradeExchangeQuery,
  officialTradeApiToSatisfySearch,
} from "./official-trade-route";
import {
  isBulkChartPriceCheckMode,
  isBulkMapPriceCheckMode,
  isChartPriceCheckItem,
  priceCheckItemForMode,
} from "./official-trade-workflow";

export interface BuildPriceCheckQueryOptions {
  rollTolerance?: number;
  onlineOnly?: boolean;
  status?: PriceCheckQueryPlan["status"];
  filters?: PriceCheckModifierFilter[];
  identity?: "exact" | "base";
  itemFilters?: Record<string, string | number | boolean>;
  /** Awakened contextual preset represented by this app's styled tabs. */
  mode?: PriceCheckPresetMode;
}

export type PriceCheckPresetMode = PriceCheckDashboardMode;

function clampTolerance(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 10;
  return Math.max(0, Math.min(50, Math.round(value)));
}

function effectivePresetTolerance(
  item: ParsedPoeItem,
  mode: PriceCheckPresetMode | undefined,
  configured: number,
) {
  if (!mode || mode === "similar") return configured;
  const editableRareAreaProperties = mode === "exact" &&
    item.rarity === "rare" &&
    item.identified &&
    (
      (/\bmaps?\b/i.test(item.itemClass) && !item.mapCompletionReward) ||
      isChartPriceCheckItem(item)
    );
  return editableRareAreaProperties
    ? configured
    : Math.min(2, configured);
}

function isExactPresetMode(mode: PriceCheckPresetMode | undefined) {
  return mode != null && mode !== "similar";
}

function rounded(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function officialStatId(modifier: ParsedPoeModifier) {
  return officialTradeStatIds(modifier).length > 0;
}

function firstFiniteRoll(modifier: ParsedPoeModifier) {
  return modifier.values.find((value) => Number.isFinite(value));
}

function isTimelessSeedModifier(modifier: ParsedPoeModifier) {
  return (
    /^explicit\.pseudo_timeless_jewel_/i.test(modifier.tradeId || modifier.id) ||
    modifier.tags.some((tag) => tag.toLowerCase() === "seed") ||
    /^(?:bathed in the blood of|commanded leadership over|denoted service of|commissioned|carved to glorify|remembrancing|subjugating|binding)\b/i.test(
      modifier.text.trim(),
    )
  );
}

function isUniqueVariantModifier(modifier: ParsedPoeModifier) {
  const text = `${modifier.source || ""} ${modifier.tags.join(" ")} ${modifier.text}`;
  return /\b(?:foulborn|vestigial|variant)\b/i.test(text);
}

function isClusterJewel(item: ParsedPoeItem) {
  return /\bcluster jewel\b/i.test(`${item.itemClass} ${item.baseType}`);
}

function normalizedItemClass(item: ParsedPoeItem) {
  return item.itemClass.trim().toLowerCase().replace(/\s+/g, " ");
}

function isClusterPassiveCount(modifier: ParsedPoeModifier) {
  return /^adds # passive skills$/i.test(modifier.normalizedText.trim());
}

function isClusterJewelSocketStat(modifier: ParsedPoeModifier) {
  return /^# added passive skills? (?:are|is(?: a)?) jewel sockets?$/i.test(
    modifier.normalizedText.trim(),
  );
}

/** Mirrors Awakened's discrete optimal-count buckets for ordinary clusters. */
function clusterPassiveCountRange(value: number) {
  const copied = Math.round(value);
  if (copied === 4) return { mode: "range" as const, max: 5 };
  if (copied === 5) return { mode: "exact" as const, min: 5, max: 5 };
  if ([3, 6, 10, 11, 12].includes(copied)) {
    return { mode: "range" as const, min: copied };
  }
  if ([2, 8, 9].includes(copied)) {
    return { mode: "range" as const, max: copied };
  }
  // Seven is not a current Cluster Jewel passive count. If malformed/future
  // text reaches us, exact is the only non-broadening behaviour.
  return { mode: "exact" as const, min: copied, max: copied };
}

function isProvenClusterPassiveCount(value: number) {
  return [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].includes(Math.round(value));
}

function clusterItemLevelBracket(value: number) {
  if (value >= 84) return { min: 84, max: 100 };
  if (value >= 75) return { min: 75, max: 100 };
  if (value >= 68) return { min: 68, max: 74 };
  if (value >= 50) return { min: 50, max: 67 };
  return { min: 1, max: 49 };
}

function isWatcherEyeEffect(item: ParsedPoeItem, modifier: ParsedPoeModifier) {
  return (
    /^watcher's eye$/i.test(item.name.trim()) &&
    /\bwhile affected by\b/i.test(modifier.text)
  );
}

function isThreadOfHopeResistance(
  item: ParsedPoeItem,
  modifier: ParsedPoeModifier,
) {
  return (
    /^thread of hope$/i.test(item.name.trim()) &&
    /\bto all elemental resistances\b/i.test(modifier.normalizedText)
  );
}

function isPriceDefiningUniqueImplicit(modifier: ParsedPoeModifier) {
  if (modifier.kind !== "implicit") return false;
  const provenance = `${modifier.source || ""} ${modifier.tags.join(" ")}`;
  // Item-level state only says that at least one special implicit may exist.
  // A corrupted item can still retain an ordinary base implicit, so select a
  // price-defining implicit only when its own parsed provenance proves it.
  return /\b(?:corrupted|synthesi[sz]ed|vestigial|searing exarch|eater of worlds)\b/i.test(
    provenance,
  );
}

function tradeIdNote(modifier: ParsedPoeModifier, available: boolean) {
  if (available) return ".";
  if ((modifier.tradeIdCandidates?.length || 0) > 1) {
    return "; multiple Trade stat IDs match, so none was guessed.";
  }
  return "; official Trade stat ID is unavailable.";
}

function importantText(modifier: ParsedPoeModifier) {
  return `${modifier.normalizedText} ${modifier.text} ${modifier.tags.join(" ")}`.toLowerCase();
}

function modifierImportance(
  modifier: ParsedPoeModifier,
): PriceCheckModifierFilter["importance"] {
  const text = importantText(modifier);
  if (
    modifier.kind === "fractured" ||
    /(?:\+\d+ to level|maximum resistance|spell suppression|additional curse|reservation efficiency|movement speed|critical strike multiplier|damage over time multiplier|all skill gems|projectile)/.test(
      text,
    ) ||
    /(?:maximum life|maximum energy shield|chaos resistance)/.test(text)
  ) {
    return "key";
  }
  if (
    modifier.selectedByDefault ||
    modifier.kind === "implicit" ||
    /(?:resistance|attribute|attack speed|cast speed|critical strike|physical damage|elemental damage|spell damage)/.test(
      text,
    )
  ) {
    return "useful";
  }
  return "optional";
}

function tradeDecimalPlaces(value: number, decimalPrecision: boolean) {
  if (!decimalPrecision || Math.abs(value) >= 10) return 0;
  return Math.abs(value) < 2.3 ? 2 : 1;
}

function roundedTradeRoll(value: number, decimalPrecision: boolean) {
  const scale = 10 ** tradeDecimalPlaces(value, decimalPrecision);
  return Math.trunc(value * scale) / scale;
}

function modifierUsesDecimalPrecision(modifier: ParsedPoeModifier) {
  if (modifier.tradeDecimalPrecision != null) {
    return modifier.tradeDecimalPrecision;
  }
  // Catalog hydration is authoritative, including an explicit `false` for
  // averaged integer-token stats. Direct parser/test consumers can still
  // provide an already-semantic non-integer roll without catalog metadata.
  const sourceValues = modifier.sourceValues ?? modifier.values;
  return sourceValues.some(
    (value) => Number.isFinite(value) && !Number.isInteger(value),
  );
}

function roundedTradeEndpoint(
  value: number,
  method: typeof Math.floor | typeof Math.ceil,
  decimalPrecision: boolean,
  precisionReference = value,
) {
  const scale = 10 ** tradeDecimalPlaces(precisionReference, decimalPrecision);
  return method((value + Number.EPSILON) * scale) / scale;
}

function rollBounds(
  value: number,
  tolerance: number,
  possibleSpan?: number,
  decimalPrecision = false,
) {
  const delta = (possibleSpan ?? Math.abs(value)) * (tolerance / 100);
  const minimum = Math.min(value - delta, value + delta);
  const maximum = Math.max(value - delta, value + delta);
  return {
    min: roundedTradeEndpoint(minimum, Math.floor, decimalPrecision, value),
    max: roundedTradeEndpoint(maximum, Math.ceil, decimalPrecision, value),
  };
}

function canonicalCopiedRollBounds(
  modifier: ParsedPoeModifier,
  semanticValue: number,
) {
  if ((modifier.sourceValues?.length ?? modifier.values.length) > 1) {
    return undefined;
  }
  const match = /([-+]?\d[\d,]*(?:\.\d+)?)\s*\(\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*[\u002d\u2013\u2014\u2212]\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*\)/.exec(
    modifier.text,
  );
  if (!match) return undefined;
  const copiedValue = Number(match[1].replace(/,/g, ""));
  let left = Number(match[2].replace(/,/g, ""));
  let right = Number(match[3].replace(/,/g, ""));
  if (![copiedValue, left, right].every(Number.isFinite)) return undefined;

  // Catalog matcher semantics can negate a positive copied display roll
  // (for example "20% reduced"). Keep its possible range in the same
  // canonical numeric space as modifier.values.
  if (Math.abs(semanticValue + copiedValue) < 1e-9) {
    left *= -1;
    right *= -1;
  }
  return {
    min: Math.min(left, right, semanticValue),
    max: Math.max(left, right, semanticValue),
  };
}

function canonicalTradePresentationBounds(
  bounds: { min: number; max: number } | undefined,
  inverted: boolean | undefined,
) {
  if (!bounds || !inverted) return bounds;
  if (bounds.max <= 0) return { min: -bounds.max, max: -bounds.min };
  if (bounds.min >= 0) return bounds;
  return { min: 0, max: Math.max(-bounds.min, bounds.max) };
}

function clampToPossibleBounds(
  range: { min: number; max: number },
  possible?: { min: number; max: number },
  decimalPrecision = false,
) {
  if (!possible) return range;
  return {
    min: Math.max(
      range.min,
      roundedTradeEndpoint(possible.min, Math.floor, decimalPrecision),
    ),
    max: Math.min(
      range.max,
      roundedTradeEndpoint(possible.max, Math.ceil, decimalPrecision),
    ),
  };
}

function modifierMetadata(
  modifier: ParsedPoeModifier,
  possibleRollBounds?: { min: number; max: number },
  presentationTag?: PriceCheckModifierFilter["tag"],
) {
  return {
    ...(modifier.tradeDisplayText || modifier.tradeLabel
      ? { label: modifier.tradeDisplayText || modifier.tradeLabel }
      : {}),
    ...(modifier.tradeIdTransforms
      ? { tradeIdTransforms: modifier.tradeIdTransforms }
      : {}),
    ...(possibleRollBounds ? { bounds: possibleRollBounds } : {}),
    ...(modifier.tradeDirection != null
      ? { direction: modifier.tradeDirection }
      : {}),
    ...(modifier.tradeInverted != null
      ? { tradeInverted: modifier.tradeInverted }
      : {}),
    ...(modifier.tradeOption != null
      ? { tradeOption: modifier.tradeOption }
      : {}),
    ...(modifier.anointmentOils
      ? { anointmentOils: modifier.anointmentOils }
      : {}),
    ...(modifier.tradeStatRef ? { statRef: modifier.tradeStatRef } : {}),
    ...(presentationTag ? { tag: presentationTag } : {}),
  };
}

function modifierPresentationTag(
  item: ParsedPoeItem,
  modifier: ParsedPoeModifier,
  declaredExplicitVariant: boolean,
  foulbornExplicit: boolean,
): PriceCheckModifierFilter["tag"] {
  if (
    /\bexpedition logbooks?\b/i.test(item.itemClass) &&
    item.logbookAreas?.some((area) => area === item.modifiers)
  ) return "variant";
  if (declaredExplicitVariant) return "variant";
  if (foulbornExplicit) return "foulborn";
  if (
    modifier.generation === "vestigial" ||
    (
      modifier.kind === "implicit" &&
      /\bvestigial\b/i.test(
        `${modifier.source || ""} ${modifier.tags.join(" ")}`,
      )
    )
  ) return "vestigial";
  return modifier.kind === "unknown" ? undefined : modifier.kind;
}

const ATZOATL_DEFAULT_ROOMS = new Set([
  "apex of atzoatl",
  "locus of corruption (tier 3)",
  "doryani's institute (tier 3)",
  "apex of ascension (tier 3)",
  "wealth of the vaal (tier 3)",
]);

const ATZOATL_EXPLOSIVES_ROOMS = new Set([
  "explosives room (tier 1)",
  "demolition lab (tier 2)",
  "shrine of unmaking (tier 3)",
]);

const ATZOATL_REMOVED_ROOMS = new Set([
  "banquet hall", "antechamber", "passageways", "cloister", "tunnels",
  "cellar", "chasm", "halls", "tombs", "pits",
  "shrine of empowerment (tier 1)", "sanctum of unity (tier 2)",
  "temple nexus (tier 3)", ...ATZOATL_EXPLOSIVES_ROOMS,
  "corruption chamber (tier 1)", "catalyst of corruption (tier 2)",
  "gemcutter's workshop (tier 1)", "department of thaumaturgy (tier 2)",
  "sacrificial chamber (tier 1)", "hall of offerings (tier 2)",
  "storage room (tier 1)", "guardhouse (tier 1)", "workshop (tier 1)",
  "royal meeting room (tier 1)", "torment cells (tier 1)",
  "strongbox chamber (tier 1)", "jeweller's workshop (tier 1)",
  "splinter research lab (tier 1)",
  "tempest generator (tier 1)", "hurricane engine (tier 2)",
  "armourer's workshop (tier 1)", "armoury (tier 2)",
  "sparring room (tier 1)", "arena of valour (tier 2)",
  "poison garden (tier 1)", "cultivar chamber (tier 2)",
  "hatchery (tier 1)", "automaton lab (tier 2)",
  "trap workshop (tier 1)", "temple defense workshop (tier 2)",
  "flame workshop (tier 1)", "omnitect forge (tier 2)",
  "lightning workshop (tier 1)", "omnitect reactor plant (tier 2)",
  "pools of restoration (tier 1)", "sanctum of vitality (tier 2)",
]);

const ATZOATL_HIDDEN_ROOMS = new Set([
  "vault (tier 1)",
  "surveyor's study (tier 1)",
  "hall of mettle (tier 1)",
  "warehouses (tier 2)",
  "barracks (tier 2)",
  "engineering department (tier 2)",
  "hall of lords (tier 2)",
  "torture cages (tier 2)",
  "hall of locks (tier 2)",
  "jewellery forge (tier 2)",
  "breach containment chamber (tier 2)",
  "storm of corruption (tier 3)",
  "chamber of iron (tier 3)",
  "hall of champions (tier 3)",
  "toxic grove (tier 3)",
  "hybridisation chamber (tier 3)",
  "defense research lab (tier 3)",
  "crucible of flame (tier 3)",
  "conduit of lightning (tier 3)",
  "sanctum of immortality (tier 3)",
]);

const REFLECTION_RULES = new Map<string, {
  enabled?: boolean;
  presenceOnly?: boolean;
}>([
  ["reflection of the breachlord (difficulty #)", {}],
  ["reflection of delirium (difficulty #)", { presenceOnly: true }],
  ["reflection of tyranny (difficulty #)", {}],
  ["reflection of the trove (difficulty #)", {}],
  ["reflection of thralldom (difficulty #)", {}],
  ["reflection of phaaryl (difficulty #)", {}],
  ["reflection of perverted faith (difficulty #)", {}],
  ["reflection of kalandra (difficulty #)", { enabled: true }],
  ["reflection of experimentation (difficulty #)", {}],
  ["reflection of the sun (difficulty #)", { enabled: true }],
  ["reflection of the monolith (difficulty #)", {}],
  ["reflection of the nightmare (difficulty #)", {}],
  ["reflection of azurite (difficulty #)", {}],
  ["reflection of paradise (difficulty #)", { enabled: true }],
  ["reflection of angling (difficulty #)", { enabled: true }],
]);

const FRACTURED_EXPLICIT_COUNTERPART_SUFFIX = ":explicit-counterpart";

function explicitCounterpartTradeId(modifier: ParsedPoeModifier) {
  if (modifier.kind !== "fractured") return undefined;
  const selectedIds = new Set([
    modifier.tradeId,
    ...(modifier.tradeIds || []),
  ].filter((id): id is string => Boolean(id)));
  return modifier.tradeIdCandidates?.find((id) =>
    id.startsWith("explicit.") && !selectedIds.has(id)
  );
}

/**
 * APT presents a clean Fractured modifier twice in Similar: the comparable
 * Explicit Trade stat first, followed by the true Fractured crafting stat as
 * a hidden/disabled row. The catalog only exposes an Explicit candidate after
 * proving that it has the same canonical ref and roll semantics.
 */
function withFracturedComparableRows(
  item: ParsedPoeItem,
  modifiers: readonly ParsedPoeModifier[],
) {
  if (item.corrupted || item.mirrored) return [...modifiers];
  const deferredFractured: ParsedPoeModifier[] = [];
  const primary = modifiers.map((modifier) => {
    const explicitTradeId = explicitCounterpartTradeId(modifier);
    if (modifier.tags.includes("pseudo-consumed-source")) {
      return explicitTradeId
        ? {
            ...modifier,
            tags: [...new Set([
              ...modifier.tags,
              "upstream-hidden",
              "fractured-source-row",
            ])],
          }
        : modifier;
    }
    if (!explicitTradeId) return modifier;
    deferredFractured.push({
      ...modifier,
      tags: [...new Set([
        ...modifier.tags,
        "upstream-hidden",
        "fractured-source-row",
      ])],
    });
    const transform = modifier.tradeIdTransforms?.[explicitTradeId];
    return {
      ...modifier,
      id: `${modifier.id}${FRACTURED_EXPLICIT_COUNTERPART_SUFFIX}`,
      kind: "explicit" as const,
      tradeId: explicitTradeId,
      tradeIds: [explicitTradeId],
      tradeIdCandidates: [explicitTradeId],
      ...(transform
        ? { tradeIdTransforms: { [explicitTradeId]: transform } }
        : { tradeIdTransforms: undefined }),
      tags: [...new Set([
        ...modifier.tags.filter((tag) => tag !== "upstream-hidden"),
        "fractured-explicit-counterpart",
      ])],
    };
  });
  return [...primary, ...deferredFractured];
}

function sourceModifierId(modifierId: string) {
  return modifierId.endsWith(FRACTURED_EXPLICIT_COUNTERPART_SUFFIX)
    ? modifierId.slice(0, -FRACTURED_EXPLICIT_COUNTERPART_SUFFIX.length)
    : modifierId;
}

function isFracturedComparableFilter(
  item: ParsedPoeItem,
  filter: Pick<PriceCheckModifierFilter, "modifierId">,
) {
  if (item.corrupted || item.mirrored) return false;
  const sourceId = sourceModifierId(filter.modifierId);
  const source = item.modifiers.find((modifier) => modifier.id === sourceId);
  return Boolean(source && explicitCounterpartTradeId(source));
}

/** Awakened's item-specific pruning/default pass, applied after catalog mapping. */
function awakenedComparableModifiers(item: ParsedPoeItem) {
  // APT never presents Veiled placeholder stats as ordinary modifier rows.
  // One logical VEILED item control serializes their official alternatives.
  const sourceModifiers = item.modifiers.filter(
    (modifier) => modifier.kind !== "veiled",
  );
  if (/^chronicle of atzoatl$/i.test((item.name || item.baseType).trim())) {
    const rooms = sourceModifiers.filter((modifier) =>
      modifier.tags.includes("atzoatl-room")
    );
    const hasExplosives = rooms.some((modifier) =>
      modifier.roomState === 1 &&
      ATZOATL_EXPLOSIVES_ROOMS.has(modifier.text.trim().toLowerCase())
    );
    return withFracturedComparableRows(item, sourceModifiers.flatMap((modifier) => {
      if (!modifier.tags.includes("atzoatl-room")) return [modifier];
      const room = modifier.text.trim().toLowerCase();
      if (
        ATZOATL_REMOVED_ROOMS.has(room) ||
        (modifier.roomState === 2 && !hasExplosives)
      ) return [];
      const anyRoomState = modifier.roomState === 2 && hasExplosives;
      return [{
        ...modifier,
        ...(ATZOATL_HIDDEN_ROOMS.has(room)
          ? { tags: [...new Set([...modifier.tags, "upstream-hidden"])] }
          : {}),
        selectedByDefault: ATZOATL_DEFAULT_ROOMS.has(room),
        ...(anyRoomState
          ? { values: [], tradeOption: undefined, roomState: undefined }
          : {}),
      }];
    }));
  }

  if (/^mirrored tablet$/i.test((item.name || item.baseType).trim())) {
    return withFracturedComparableRows(item, sourceModifiers.flatMap((modifier) => {
      const pattern = modifier.normalizedText.trim().toLowerCase();
      if (!pattern.startsWith("reflection of ")) return [modifier];
      const rule = REFLECTION_RULES.get(pattern);
      const difficulty = firstFiniteRoll(modifier);
      if (!rule && difficulty != null && difficulty < 8) return [];
      return [{
        ...modifier,
        ...(!rule
          ? { tags: [...new Set([...modifier.tags, "upstream-hidden"])] }
          : {}),
        selectedByDefault: rule?.enabled === true,
        ...(rule?.presenceOnly ? { values: [] } : {}),
      }];
    }));
  }

  return withFracturedComparableRows(item, sourceModifiers);
}

function isHiddenCheapAnointment(
  item: ParsedPoeItem,
  modifier: ParsedPoeModifier,
) {
  if (!modifier.anointmentOils?.length || item.talismanTier != null) return false;
  if (!/\b(?:amulets?|rings?)\b/i.test(item.itemClass)) return false;
  if (item.corrupted || item.mirrored) return false;
  const highestOil = modifier.anointmentOils[0];
  return highestOil !== "Golden Oil" && highestOil !== "Silver Oil";
}

function hasEnkindlingFlaskEnchant(item: ParsedPoeItem) {
  if (!/\bflasks?\b/i.test(item.itemClass)) return false;
  return item.modifiers.some((modifier) =>
    modifier.kind === "enchant" &&
    modifier.tradeStatRef === "Gains no Charges during Flask Effect"
  );
}

function isHiddenOrdinaryFlaskEnchant(
  item: ParsedPoeItem,
  modifier: ParsedPoeModifier,
) {
  return /\bflasks?\b/i.test(item.itemClass) &&
    modifier.kind === "enchant" &&
    !hasEnkindlingFlaskEnchant(item);
}

/** Plans user-visible modifier filters without hiding why each one was chosen. */
export function planModifierFilters(
  item: ParsedPoeItem,
  rollTolerance = 10,
): PriceCheckModifierFilter[] {
  const tolerance = clampTolerance(rollTolerance);
  const comparableModifiers = awakenedComparableModifiers(item);
  const uniqueMetadataPolicy = item.rarity === "unique"
    ? uniqueModifierMetadataPolicy(item.name, item)
    : "source-bounds-only";
  const ordinaryCluster = item.rarity !== "unique" && isClusterJewel(item);
  return comparableModifiers.map((modifier) => {
    const sourcePrimaryValue = firstFiniteRoll(modifier);
    const decimalPrecision = modifierUsesDecimalPrecision(modifier);
    // APT calculated stats preserve matcher-negated source rolls, but its UI
    // filter projects final-inverted Trade stats back to a canonical positive
    // value. The serializer is the only layer that emits the negative bound.
    const canonicalPrimaryValue = sourcePrimaryValue == null
      ? undefined
      : modifier.tradeInverted
        ? Math.abs(sourcePrimaryValue)
        : sourcePrimaryValue;
    const primaryValue = canonicalPrimaryValue == null
      ? undefined
      : roundedTradeRoll(canonicalPrimaryValue, decimalPrecision);
    const sourceRollBounds = sourcePrimaryValue == null
      ? undefined
      : modifier.tradeBounds ||
        canonicalCopiedRollBounds(modifier, sourcePrimaryValue);
    const possibleRollBounds = canonicalTradePresentationBounds(
      sourceRollBounds,
      modifier.tradeInverted,
    );
    // APT keeps copied source endpoints for threshold clamping, but exposes a
    // slider domain only for a genuinely variable, comparable Unique roll.
    // Non-unique Advanced ranges and fixed/non-comparable Unique ranges are
    // internal calculation evidence, not UI bounds.
    const exposedRollBounds = item.rarity === "unique" &&
        possibleRollBounds != null &&
        possibleRollBounds.min !== possibleRollBounds.max &&
        (modifier.tradeDirection === -1 || modifier.tradeDirection === 1)
      ? possibleRollBounds
      : undefined;
    const hasOfficialId = officialStatId(modifier);
    const resolvedTradeId = modifier.tradeId || modifier.id;
    const selectorTradeStat = isSelectorTradeStatId(resolvedTradeId);
    const optionTradeStat = modifier.tradeOption != null;
    const discreteTradeStat = optionTradeStat ||
      (selectorTradeStat && primaryValue == null);
    const timelessSeed = item.rarity === "unique" && isTimelessSeedModifier(modifier);
    const fixedUniqueStat = modifier.kind === "explicit" &&
      uniqueMetadataPolicy === "non-fixed-explicit-variants" &&
      isFixedUniqueModifier(item.name, modifier.tradeStatRef, item);
    const declaredExplicitVariant =
      uniqueMetadataPolicy !== "source-bounds-only" &&
      modifier.kind === "explicit" &&
      !fixedUniqueStat;
    const foulbornExplicit = item.foulborn && modifier.kind === "explicit";
    const presentationTag = modifierPresentationTag(
      item,
      modifier,
      declaredExplicitVariant,
      foulbornExplicit && !fixedUniqueStat,
    );
    const sourceBackedVariableRoll = possibleRollBounds != null &&
      possibleRollBounds.max > possibleRollBounds.min;
    const clusterPassiveCount = ordinaryCluster && isClusterPassiveCount(modifier);
    const clusterJewelSockets = ordinaryCluster && isClusterJewelSocketStat(modifier);
    const provenClusterPassiveCount = clusterPassiveCount &&
      primaryValue != null &&
      isProvenClusterPassiveCount(primaryValue);
    const vestigialModifier = modifier.generation === "vestigial" ||
      presentationTag === "vestigial";
    const uniqueKeyEffect = item.rarity === "unique" && (
      timelessSeed ||
      isWatcherEyeEffect(item, modifier) ||
      isThreadOfHopeResistance(item, modifier) ||
      isUniqueVariantModifier(modifier) ||
      isPriceDefiningUniqueImplicit(modifier) ||
      vestigialModifier ||
      selectorTradeStat
    );
    const importance = uniqueKeyEffect || selectorTradeStat || clusterPassiveCount
      ? "key"
      : modifierImportance(modifier);
    // Awakened starts ordinary comparable source modifiers disabled. Only
    // option/non-comparable variants and explicitly selected pseudos opt in;
    // provenance such as enchant/fractured/implicit/crafted is not itself a
    // reason to constrain a Similar search.
    const hasItemSpecificDefault = modifier.tags.includes("atzoatl-room") ||
      /^mirrored tablet$/i.test((item.name || item.baseType).trim());
    const ordinaryVariantDefault = hasItemSpecificDefault
      ? modifier.selectedByDefault
      : optionTradeStat ||
        selectorTradeStat ||
        (modifier.tradeDirection === 0 && !modifier.anointmentOils?.length);
    // Awakened keeps invariant unique boilerplate available behind its hidden
    // filter toggle. `advancedOnly` is the equivalent presentation contract:
    // the detailed editor and serializer retain the filter, while the compact
    // overlay does not spend a row on a constant stat.
    const invariantUniqueStat = item.rarity === "unique" &&
      ["implicit", "explicit", "pseudo"].includes(modifier.kind) &&
      !(modifier.kind === "implicit" && /\bjewels?\b/i.test(item.itemClass)) &&
      !sourceBackedVariableRoll &&
      !declaredExplicitVariant &&
      !foulbornExplicit &&
      !uniqueKeyEffect &&
      !ordinaryVariantDefault &&
      !modifier.anointmentOils?.length;
    const upstreamHiddenStat = modifier.tags.includes("upstream-hidden") &&
      !foulbornExplicit;
    const hiddenCheapAnointment = isHiddenCheapAnointment(item, modifier);
    const hiddenOrdinaryFlaskEnchant = isHiddenOrdinaryFlaskEnchant(item, modifier);
    const compactHiddenStat = invariantUniqueStat ||
      clusterJewelSockets ||
      upstreamHiddenStat ||
      hiddenCheapAnointment ||
      hiddenOrdinaryFlaskEnchant;
    const compactPresentation = compactHiddenStat
      ? { advancedOnly: true as const }
      : {};
    // Without an Advanced range, Awakened parses a unique roll as
    // min=max=current. A visible row therefore reaches its perfect-roll pass
    // at zero tolerance. Hidden invariant boilerplate is excluded because
    // Awakened clears its editable threshold in the subsequent hiding pass.
    const fixedVisibleUniqueRoll = item.rarity === "unique" &&
      possibleRollBounds == null &&
      !compactHiddenStat &&
      !foulbornExplicit;
    // Explicit fixed-stat metadata tells us which lines are invariant
    // boilerplate. Its presence (including an empty array) makes every other
    // explicit a declared variant. When that declaration is absent, only an
    // Advanced Description range can prove a numeric line is variable. This
    // avoids enabling one-to-three constant unique lines just because the
    // parser happened to map them to official Trade IDs.
    const enabled = item.veiled
      ? false
      : ordinaryCluster
      ? hasOfficialId && !clusterJewelSockets && (
          clusterPassiveCount
            ? provenClusterPassiveCount
            : modifier.kind === "enchant"
        )
      : item.rarity === "unique"
        ? hasOfficialId && (
            (modifier.kind === "pseudo" && modifier.selectedByDefault) ||
            foulbornExplicit ||
            declaredExplicitVariant ||
            (!fixedUniqueStat && uniqueKeyEffect)
          )
        : modifier.anointmentOils
          ? hasOfficialId && item.talismanTier != null && !hiddenCheapAnointment
          : hiddenOrdinaryFlaskEnchant
            ? false
            : hasOfficialId && (
            ordinaryVariantDefault ||
            (modifier.kind === "pseudo" && modifier.selectedByDefault)
          );

    if (clusterPassiveCount && primaryValue != null) {
      return {
        modifierId: modifier.id,
        tradeId: modifier.tradeId,
        tradeIds: modifier.tradeIds,
        enabled,
        copiedValue: primaryValue,
        ...clusterPassiveCountRange(primaryValue),
        ...modifierMetadata(modifier, exposedRollBounds, presentationTag),
        ...compactPresentation,
        importance,
        explanation: `Price-defining Cluster Jewel passive-count bucket${tradeIdNote(modifier, hasOfficialId)}`,
      };
    }

    // Some selector-qualified Trade IDs are pure choices (Thread of Hope,
    // Forbidden jewels), while others also carry a real numeric roll. Only
    // value-less selectors are presence-only; numeric selectors keep their
    // editable exact/range payload.
    const foulbornExplicitWithoutVariableBounds = foulbornExplicit &&
      primaryValue != null &&
      !sourceBackedVariableRoll;
    if (
      primaryValue == null ||
      discreteTradeStat ||
      foulbornExplicitWithoutVariableBounds
    ) {
      return {
        modifierId: modifier.id,
        tradeId: modifier.tradeId,
        tradeIds: modifier.tradeIds,
        enabled,
        mode: "presence",
        ...modifierMetadata(modifier, exposedRollBounds, presentationTag),
        ...compactPresentation,
        importance,
        explanation: `${importance === "key" ? "Price-defining" : importance === "useful" ? "Useful comparable" : "Optional detail"}; ${optionTradeStat ? `exact ${modifier.roomState === 1 ? "open" : "obstructed"} room state` : discreteTradeStat ? "exact selected variant" : foulbornExplicitWithoutVariableBounds ? "retained Foulborn explicit stat presence" : "match presence only"}${tradeIdNote(modifier, hasOfficialId)}`,
      };
    }

    // APT retains invariant Unique rows in the complete editor, but its
    // hide-constant pass clears their active threshold. `copiedValue` is
    // still useful UI evidence; omitting min/max prevents an unchecked fixed
    // line from silently constraining the official Trade request.
    if (invariantUniqueStat) {
      return {
        modifierId: modifier.id,
        tradeId: modifier.tradeId,
        tradeIds: modifier.tradeIds,
        enabled,
        mode: "range",
        copiedValue: primaryValue,
        ...modifierMetadata(modifier, exposedRollBounds, presentationTag),
        ...compactPresentation,
        importance,
        explanation: `Invariant Unique modifier retained as an advanced disabled row${tradeIdNote(modifier, hasOfficialId)}`,
      };
    }

    const perfectComparableRoll = (
      item.rarity === "unique" ||
      (item.rarity === "magic" && /\bjewels?\b/i.test(item.itemClass))
    ) &&
      possibleRollBounds != null &&
      (modifier.tradeDirection === 1
        ? canonicalPrimaryValue! >= possibleRollBounds.max
        : modifier.tradeDirection === -1
          ? canonicalPrimaryValue! <= possibleRollBounds.min
          : false);
    const exactMagicRoll = item.rarity === "magic" &&
      (item.unmodifiable || item.corrupted || item.mirrored);
    const tierOneFracturedRoll =
      modifier.tags.includes("fractured-explicit-counterpart") &&
      Number(modifier.tier) === 1;
    const resolverTransformedRoll = Object.keys(
      modifier.tradeIdTransforms || {},
    ).length > 0;
    const exactTabletDifficulty = /^mirrored tablet$/i.test(
      (item.name || item.baseType).trim(),
    ) && modifier.normalizedText.trim().toLowerCase().startsWith("reflection of ");
    // Awakened treats a zero tolerance (and a perfect unique roll) as a
    // one-sided threshold when the Trade catalog says which direction is
    // better. Equality is reserved for genuinely non-comparable/discrete
    // rolls such as Timeless Jewel seeds.
    if (timelessSeed || modifier.tradeDirection === 0) {
      return {
        modifierId: modifier.id,
        tradeId: modifier.tradeId,
        tradeIds: modifier.tradeIds,
        enabled,
        mode: "exact",
        copiedValue: primaryValue,
        min: rounded(primaryValue),
        max: rounded(primaryValue),
        ...modifierMetadata(modifier, exposedRollBounds, presentationTag),
        importance,
        explanation: `${importance === "key" ? "Price-defining" : importance === "useful" ? "Useful comparable" : "Optional detail"}; ${timelessSeed ? "exact Timeless Jewel seed" : "exact copied roll"}${tradeIdNote(modifier, hasOfficialId)}`,
      };
    }

    const bounds = clampToPossibleBounds(
      rollBounds(
        canonicalPrimaryValue!,
        perfectComparableRoll ||
            exactMagicRoll ||
            tierOneFracturedRoll ||
            resolverTransformedRoll ||
            exactTabletDifficulty ||
            fixedVisibleUniqueRoll
          ? 0
          : tolerance,
        item.rarity === "unique" && possibleRollBounds
          ? possibleRollBounds.max - possibleRollBounds.min
          : undefined,
        decimalPrecision,
      ),
      possibleRollBounds,
      decimalPrecision,
    );
    return {
      modifierId: modifier.id,
      tradeId: modifier.tradeId,
      tradeIds: modifier.tradeIds,
      enabled,
      mode: "range",
      copiedValue: primaryValue,
      ...(modifier.tradeDirection === -1
        ? { max: bounds.max }
        : modifier.tradeDirection === 1
          ? { min: bounds.min }
          : bounds),
      ...modifierMetadata(modifier, exposedRollBounds, presentationTag),
      ...compactPresentation,
      importance,
      explanation: `${importance === "key" ? "Price-defining" : importance === "useful" ? "Useful comparable" : "Optional detail"}; ±${tolerance}% around the copied roll${tradeIdNote(modifier, hasOfficialId)}`,
    };
  });
}

function orderAwakenedGeneratedFilters(
  item: ParsedPoeItem,
  filters: PriceCheckModifierFilter[],
) {
  const ordered = [...filters];
  const moveAfter = (movingId: string, anchorId: string) => {
    const movingIndex = ordered.findIndex((filter) => filter.modifierId === movingId);
    if (movingIndex < 0) return;
    const [moving] = ordered.splice(movingIndex, 1);
    const anchorIndex = ordered.findIndex((filter) => filter.modifierId === anchorId);
    if (anchorIndex < 0) {
      ordered.splice(movingIndex, 0, moving);
      return;
    }
    ordered.splice(anchorIndex + 1, 0, moving);
  };

  const chargeRecovery = item.modifiers.find((modifier) =>
    modifier.normalizedText.trim().toLowerCase() ===
      "#% increased charge recovery"
  );
  if (chargeRecovery) {
    moveAfter("special:not-increased-effect", chargeRecovery.id);
  }

  const blueprintNoEnchantIndex = ordered.findIndex(
    (filter) => filter.modifierId === "special:blueprint-no-enchant",
  );
  if (blueprintNoEnchantIndex >= 0) {
    const [blueprintNoEnchant] = ordered.splice(blueprintNoEnchantIndex, 1);
    ordered.push(blueprintNoEnchant);
  }
  return ordered;
}

function applyUniqueVisibleFilterDefaults(
  item: ParsedPoeItem,
  filters: PriceCheckModifierFilter[],
) {
  if (item.rarity !== "unique") return filters;
  const visibleCount = filters.filter((filter) => !filter.advancedOnly).length;
  if (visibleCount > 3) return filters;
  return filters.map((filter) =>
    filter.advancedOnly || filter.enabled
      ? filter
      : { ...filter, enabled: true }
  );
}

/** Complete editable filter list: calculated equipment properties first. */
export function planPriceCheckFilters(
  item: ParsedPoeItem,
  rollTolerance = 10,
): PriceCheckModifierFilter[] {
  const equipmentPlan = planEquipmentPropertyFilters(item, rollTolerance);
  const consumed = new Set(equipmentPlan.consumedModifierIds);
  const filters = orderAwakenedGeneratedFilters(item, [
    ...equipmentPlan.filters,
    ...planAwakenedNegativeFilters(item),
    ...planMapPropertyFilters(item, rollTolerance),
    ...planChartPropertyFilters(item, rollTolerance),
    ...planHeistContractPropertyFilters(item),
    ...planMemoryStrandsFilter(item, rollTolerance, false),
    ...planModifierFilters(item, rollTolerance).filter(
      (filter) =>
        !consumed.has(sourceModifierId(filter.modifierId)) ||
        isFracturedComparableFilter(item, filter),
    ),
    ...planEmptyOrCraftedModifierFilter(item),
  ]);
  return applyUniqueVisibleFilterDefaults(item, filters);
}

function planEmptyOrCraftedModifierFilter(
  item: ParsedPoeItem,
): PriceCheckModifierFilter[] {
  if (item.rarity !== "rare" || item.corrupted || item.mirrored) return [];
  const randomKinds = new Set(["explicit", "fractured", "veiled", "crafted"]);
  const groups = new Map<string, {
    kind: ParsedPoeModifier["kind"];
    generation?: ParsedPoeModifier["generation"];
  }>();
  for (const modifier of item.modifiers) {
    if (!randomKinds.has(modifier.kind) || !modifier.advanced || !modifier.generation) {
      continue;
    }
    const key = [
      modifier.kind,
      modifier.generation,
      modifier.source || modifier.id,
      modifier.tier || "",
    ].join("|");
    groups.set(key, { kind: modifier.kind, generation: modifier.generation });
  }
  const randomModifiers = [...groups.values()];
  const crafted = randomModifiers.find((modifier) => modifier.kind === "crafted");
  if (
    !(
      (randomModifiers.length === 5 && !crafted) ||
      (randomModifiers.length === 6 && crafted)
    )
  ) return [];

  let prefixes = randomModifiers.filter((modifier) => modifier.generation === "prefix").length;
  let suffixes = randomModifiers.filter((modifier) => modifier.generation === "suffix").length;
  if (crafted?.generation === "prefix") prefixes -= 1;
  if (crafted?.generation === "suffix") suffixes -= 1;
  const emptyModifier = prefixes === 2 ? 1 : suffixes === 2 ? 2 : undefined;
  if (emptyModifier == null) return [];
  return [{
    modifierId: "special:empty-or-crafted-modifier",
    tradeId: "item.has_empty_modifier",
    tradeIds: ["item.has_empty_modifier"],
    tradeOption: emptyModifier,
    statRef: "1 Empty or Crafted Modifier",
    tag: "pseudo",
    label: "1 Empty or Crafted Modifier",
    enabled: false,
    mode: "presence",
    emptyModifier,
    advancedOnly: true,
    importance: "optional",
    explanation: "Awakened's hidden crafting filter for an open or replaceable affix slot.",
  }];
}

function planMemoryStrandsFilter(
  item: ParsedPoeItem,
  tolerance: number,
  exactPreset: boolean,
): PriceCheckModifierFilter[] {
  const copiedValue = item.memoryStrands;
  if (copiedValue == null || !Number.isFinite(copiedValue)) return [];
  const cappedTolerance = exactPreset
    ? Math.min(2, clampTolerance(tolerance))
    : clampTolerance(tolerance);
  return [{
    modifierId: "property:memory-strands",
    tradeId: "item.memory_strands",
    label: `MEMORY STRANDS: ${copiedValue}`,
    copiedValue,
    enabled: exactPreset && copiedValue >= 60,
    mode: "range",
    min: Math.floor(copiedValue * (1 - cappedTolerance / 100) + Number.EPSILON),
    direction: 1,
    ...(exactPreset ? {} : { advancedOnly: true as const }),
    importance: copiedValue >= 60 ? "key" : "useful",
    explanation: exactPreset
      ? "Awakened exact/base Memory Strand threshold."
      : "Awakened retains Memory Strands as a hidden disabled Similar row.",
  }];
}

const HEIST_JOB_INTERNAL_IDS: Record<
  NonNullable<ParsedPoeItem["heistContract"]>["requiredJob"] & string,
  string
> = {
  Lockpicking: "item.heist_job_lockpicking",
  "Brute Force": "item.heist_job_bruteforce",
  Perception: "item.heist_job_perception",
  Demolition: "item.heist_job_demolition",
  "Counter-Thaumaturgy": "item.heist_job_counterthaumaturgy",
  "Trap Disarmament": "item.heist_job_trapdisarmament",
  Agility: "item.heist_job_agility",
  Deception: "item.heist_job_deception",
  Engineering: "item.heist_job_engineering",
};

const HEIST_INTERNAL_API_KEYS: Record<string, string> = {
  "item.heist_job_lockpicking": "heist_lockpicking",
  "item.heist_job_bruteforce": "heist_brute_force",
  "item.heist_job_perception": "heist_perception",
  "item.heist_job_demolition": "heist_demolition",
  "item.heist_job_counterthaumaturgy": "heist_counter_thaumaturgy",
  "item.heist_job_trapdisarmament": "heist_trap_disarmament",
  "item.heist_job_agility": "heist_agility",
  "item.heist_job_deception": "heist_deception",
  "item.heist_job_engineering": "heist_engineering",
};

function planHeistContractPropertyFilters(
  item: ParsedPoeItem,
): PriceCheckModifierFilter[] {
  if (
    item.rarity === "unique" ||
    !/^heist contracts?$/.test(normalizedItemClass(item))
  ) return [];
  const filters: PriceCheckModifierFilter[] = [];
  const requiredJob = item.heistContract?.requiredJob;
  const jobLevel = item.heistContract?.jobLevel;
  if (requiredJob && jobLevel != null && Number.isFinite(jobLevel)) {
    const tradeId = HEIST_JOB_INTERNAL_IDS[requiredJob];
    if (tradeId) {
      filters.push({
        modifierId: `property:${tradeId}`,
        tradeId,
        label: `Requires ${requiredJob} (Level ${jobLevel})`,
        copiedValue: jobLevel,
        enabled: true,
        mode: "range",
        min: jobLevel,
        direction: 1,
        importance: "key",
        explanation: "Awakened exact Heist Contract job-level property.",
      });
    }
  }
  if (item.heistContract?.targetValue === "Priceless") {
    filters.push({
      modifierId: "property:item.heist_target_priceless",
      tradeId: "item.heist_target_priceless",
      label: "Heist Target: Priceless",
      enabled: true,
      mode: "presence",
      importance: "key",
      explanation: "Awakened exact priceless Heist target property.",
    });
  }
  return filters;
}

export function supportsCompactModifierEditor(
  item: ParsedPoeItem,
  filters: readonly PriceCheckModifierFilter[],
  exactItemFilters = false,
) {
  return priceCheckItemFilterControls(item, { exact: exactItemFilters }).length > 0 ||
    filters.some((filter) => !filter.advancedOnly);
}

function canonicalBaseType(item: ParsedPoeItem) {
  let candidate = (item.baseType || item.name).trim();
  if (item.rarity !== "unique" && /\bmaps?\b/i.test(item.itemClass)) {
    candidate = candidate.replace(/^(?:Blight-ravaged|Blighted)\s+/i, "").trim();
  }
  return item.rarity === "unique"
    ? candidate.replace(/^Vestigial\s+/i, "").trim()
    : candidate;
}

function searchableBaseType(item: ParsedPoeItem) {
  const candidate = canonicalBaseType(item);
  if (item.rarity === "magic") {
    // Magic nameplates include affixes. The pinned item corpus resolves the
    // canonical base even when copied baseType/name happen to be identical.
    return resolveMagicBaseType(item.name) || candidate;
  }
  return candidate;
}

function gemSearchType(item: ParsedPoeItem) {
  const copiedName = (item.name || item.baseType).trim();
  const profile = gemIdentityProfile(copiedName);
  if (
    profile?.transfigured &&
    profile.normalVariant &&
    profile.tradeDisc
  ) {
    return {
      discriminator: profile.tradeDisc,
      option: profile.normalVariant,
    };
  }
  return copiedName;
}

function specialSearchType(item: ParsedPoeItem) {
  if (item.scryingMapArea) {
    return {
      discriminator: itemTradeDiscriminator("Scrying Orb") || "scrying_orb",
      option: mapAreaTradeDiscriminator(item.scryingMapArea) || item.scryingMapArea,
    };
  }
  const baseType = canonicalBaseType(item);
  if (baseType === "Map") {
    return {
      discriminator: itemTradeDiscriminator("Map") || "map",
      option: baseType,
    };
  }
  return undefined;
}

const TRADE_CATEGORY_BY_CLASS: Array<[RegExp, string]> = [
  [/^charts?$/, "chart"],
  [/^(?:utility )?flasks?$/, "flask"],
  [/^abyss jewels?$/, "jewel.abyss"],
  [/^amulets?$/, "accessory.amulet"],
  [/^belts?$/, "accessory.belt"],
  [/^body armours?$/, "armour.chest"],
  [/^boots?$/, "armour.boots"],
  [/^bows?$/, "weapon.bow"],
  [/^claws?$/, "weapon.claw"],
  [/^daggers?$/, "weapon.dagger"],
  [/^fishing rods?$/, "weapon.rod"],
  [/^flasks?$/, "flask"],
  [/^gloves?$/, "armour.gloves"],
  [/^helmets?$/, "armour.helmet"],
  [/^jewels?$/, "jewel"],
  [/^one hand axes?$/, "weapon.oneaxe"],
  [/^one hand maces?$/, "weapon.onemace"],
  [/^one hand swords?$/, "weapon.onesword"],
  [/^quivers?$/, "armour.quiver"],
  [/^rings?$/, "accessory.ring"],
  [/^rune daggers?$/, "weapon.runedagger"],
  [/^sceptres?$/, "weapon.sceptre"],
  [/^shields?$/, "armour.shield"],
  [/^staves?$/, "weapon.staff"],
  [/^two hand axes?$/, "weapon.twoaxe"],
  [/^two hand maces?$/, "weapon.twomace"],
  [/^two hand swords?$/, "weapon.twosword"],
  [/^wands?$/, "weapon.wand"],
  [/^warstaves?$/, "weapon.warstaff"],
  [/^heist blueprints?$/, "heistmission.blueprint"],
  [/^heist contracts?$/, "heistmission.contract"],
  [/^heist tools?$/, "heistequipment.heisttool"],
  [/^heist brooches?$/, "heistequipment.heistreward"],
  [/^heist gear$/, "heistequipment.heistweapon"],
  [/^heist cloaks?$/, "heistequipment.heistutility"],
  [/^trinkets?$/, "accessory.trinket"],
  [/^sanctum relics?$/, "sanctum.relic"],
  [/^tinctures?$/, "tincture"],
  [/^charms?$/, "azmeri.charm"],
  [/^idols?$/, "idol"],
  [/^grafts?$/, "graft"],
];

function tradeCategoryFor(item: ParsedPoeItem) {
  if (isClusterJewel(item)) return "jewel.cluster";
  const itemClass = normalizedItemClass(item);
  return TRADE_CATEGORY_BY_CLASS.find(([pattern]) => pattern.test(itemClass))?.[1];
}

function tradeCategoryLabel(item: ParsedPoeItem) {
  const category = pinnedCraftableItemCategory(item.name, item.baseType) ||
    item.itemClass.replace(/s$/i, "").trim();
  return `Category: ${category}`;
}

function identityFor(
  item: ParsedPoeItem,
  override?: BuildPriceCheckQueryOptions["identity"],
) {
  const itemName = item.name.replace(/^Foulborn\s+/i, "").trim();
  const specialType = specialSearchType(item);
  // PoE does not expose a unique's name in copied text while it is
  // unidentified. Searching the base type is the only truthful identity.
  if (item.rarity === "unique" && !item.identified) {
    const baseType = canonicalBaseType(item);
    return {
      identity: "base" as const,
      query: baseType ? { type: baseType } : {},
    };
  }
  if (override === "base") {
    const baseType = searchableBaseType(item);
    return {
      identity: "base" as const,
      query: baseType ? { type: baseType } : {},
    };
  }
  if (override === "exact") {
    if (item.rarity === "unique" && itemName) {
      const baseType = canonicalBaseType(item);
      const discriminator = /\bmaps?\b/i.test(item.itemClass)
        ? itemTradeDiscriminator(baseType) || "map"
        : undefined;
      const value = (option: string) => discriminator
        ? { discriminator, option }
        : option;
      return {
        identity: "exact" as const,
        query: {
          name: value(itemName),
          ...(baseType && baseType !== item.name ? { type: value(baseType) } : {}),
        },
      };
    }
    const exactType = specialType || (
      item.rarity === "rare" || item.rarity === "magic" || item.rarity === "normal"
        ? searchableBaseType(item)
        : item.rarity === "gem"
          ? gemSearchType(item)
          : item.name || item.baseType
    );
    return {
      identity: "exact" as const,
      query: exactType ? { type: exactType } : {},
    };
  }
  if (item.rarity === "rare" || item.rarity === "magic" || item.rarity === "normal") {
    const baseType = searchableBaseType(item);
    return {
      identity: "base" as const,
      query: baseType ? { type: baseType } : {},
    };
  }
  if (item.rarity === "unique" && itemName) {
    const baseType = canonicalBaseType(item);
    const discriminator = /\bmaps?\b/i.test(item.itemClass)
      ? itemTradeDiscriminator(baseType) || "map"
      : undefined;
    const value = (option: string) => discriminator
      ? { discriminator, option }
      : option;
    return {
      identity: "exact" as const,
      query: {
        name: value(itemName),
        ...(baseType && baseType !== item.name ? { type: value(baseType) } : {}),
      },
    };
  }
  const exactType = specialType || (
    item.rarity === "gem"
      ? gemSearchType(item)
      : item.name || item.baseType
  );
  return {
    identity: "exact" as const,
    query: exactType ? { type: exactType } : {},
  };
}

function identityQueryLabel(query: Record<string, unknown>, fallback: string) {
  const value = query.name ?? query.type;
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "option" in value) {
    const option = (value as { option?: unknown }).option;
    if (typeof option === "string" && option) return option;
  }
  return fallback;
}

function hasResolvedUniqueIdentity(item: ParsedPoeItem) {
  return item.rarity === "unique" && item.identified && Boolean(
    uniqueIdentityProfile(item.name, item),
  );
}

function usesExactOnlyIdentity(item: ParsedPoeItem) {
  const itemClass = normalizedItemClass(item);
  const identity = itemIdentityText(item);
  return item.rarity === "gem" ||
    item.rarity === "currency" ||
    item.rarity === "divination-card" ||
    /^(?:captured beasts?|invitations?|maps?)$/.test(itemClass) ||
    /\bexpedition logbook\b/i.test(identity) ||
    Boolean(item.scryingMapArea) ||
    hasResolvedUniqueIdentity(item);
}

function identityStateForPreset(
  item: ParsedPoeItem,
  mode: PriceCheckPresetMode,
  itemFilters?: Readonly<Record<string, PriceCheckItemFilterValue>>,
): PriceCheckIdentityState {
  const exactQuery = identityFor(item, "exact").query;
  const exact = {
    label: identityQueryLabel(exactQuery, canonicalBaseType(item) || item.name),
    query: exactQuery,
  };
  const category = tradeCategoryFor(item);
  if (usesExactOnlyIdentity(item) || !category) {
    return { exact, active: "exact" };
  }

  let relaxedDisabled = isExactPresetMode(mode);
  if (["jewel.cluster", "idol", "graft"].includes(category)) {
    relaxedDisabled = true;
  } else if ([
    "sanctum.relic",
    "azmeri.charm",
    "heistmission.contract",
  ].includes(category)) {
    relaxedDisabled = false;
  }
  if (/^heist blueprints?$/.test(normalizedItemClass(item))) {
    relaxedDisabled = true;
  }
  if (isChartPriceCheckItem(item)) relaxedDisabled = false;
  if (typeof itemFilters?.identityRelaxed === "boolean") {
    relaxedDisabled = !itemFilters.identityRelaxed;
  }

  const relaxed: NonNullable<PriceCheckIdentityState["relaxed"]> = {
    label: tradeCategoryLabel(item),
    query: { category },
    disabled: relaxedDisabled,
  };
  if (isChartPriceCheckItem(item) && item.chartArea) {
    const type = {
      discriminator: itemTradeDiscriminator(canonicalBaseType(item)) || "chart",
      option: item.chartAreaTradeDiscriminator ||
        mapAreaTradeDiscriminator(item.chartArea) || item.chartArea,
    };
    relaxed.sub = {
      label: item.chartArea,
      query: { type },
      disabled: typeof itemFilters?.identitySub === "boolean"
        ? !itemFilters.identitySub
        : false,
    };
  }
  return {
    exact,
    relaxed,
    active: relaxed.disabled ? "exact" : "base",
  };
}

function activeIdentitySearch(state: PriceCheckIdentityState) {
  if (!state.relaxed || state.relaxed.disabled) return state.exact;
  return state.relaxed.sub && !state.relaxed.sub.disabled
    ? state.relaxed.sub
    : state.relaxed;
}

function identityStateWithoutPreset(
  item: ParsedPoeItem,
  override?: BuildPriceCheckQueryOptions["identity"],
): PriceCheckIdentityState {
  const exactQuery = identityFor(item, "exact").query;
  const exact = {
    label: identityQueryLabel(exactQuery, canonicalBaseType(item) || item.name),
    query: exactQuery,
  };
  const selected = identityFor(item, override);
  if (selected.identity === "exact") return { exact, active: "exact" };
  return {
    exact,
    relaxed: {
      label: identityQueryLabel(selected.query, canonicalBaseType(item)),
      query: selected.query,
      disabled: false,
    },
    active: "base",
  };
}

export type PriceCheckItemFilterValue = string | number | boolean;

export type PriceCheckItemFilterControl =
  | {
      key: string;
      label: string;
      copiedValue: number;
      kind: "number";
      maximum?: number;
    }
  | {
      key: string;
      upperKey: string;
      label: string;
      copiedValue: number;
      copiedUpperValue: number;
      kind: "number-range";
      maximum?: number;
    }
  | {
      key: string;
      label: string;
      copiedValue: boolean;
      kind: "boolean";
    }
  | {
      key: "identityRelaxed" | "identitySub";
      label: string;
      copiedValue: boolean;
      /** Identity choices store an explicit boolean; false is selected state,
       * not absence/disabled like ordinary logical item filters. */
      kind: "identity";
    }
  | {
      key: string;
      label: string;
      copiedValue: string;
      kind: "string";
      /** APT renders semantic identity constraints as always-active chips. */
      readonly?: boolean;
      /** Optional secondary value for long reward/area identities. */
      displayValue?: string;
    };

interface DefaultPriceCheckItemFilterOptions {
  /** Awakened's exact/base-item preset enables stricter base-state filters. */
  exact?: boolean;
  league?: string;
  mode?: PriceCheckPresetMode;
  itemFilters?: Readonly<Record<string, PriceCheckItemFilterValue>>;
}

function copiedLinks(item: ParsedPoeItem) {
  const links = item.links ??
    (item.sockets.length
      ? Math.max(...item.sockets.map((group) => group.links), 0) || undefined
      : undefined);
  return links === 5 || links === 6 ? links : undefined;
}

function supportsCorruptionState(item: ParsedPoeItem) {
  return !item.unmodifiable &&
    ["normal", "magic", "rare", "unique", "gem"].includes(item.rarity);
}

function usesExactCorruptionState(item: ParsedPoeItem) {
  return item.rarity === "magic" &&
    /\bjewels?\b/i.test(item.itemClass) &&
    !isClusterJewel(item);
}

function isAdornedMagicJewel(item: ParsedPoeItem) {
  return item.rarity === "magic" &&
    /^(?:abyss )?jewels?$/.test(normalizedItemClass(item)) &&
    !isClusterJewel(item);
}

function supportsItemLevelState(item: ParsedPoeItem) {
  if (item.itemLevel == null || item.rarity === "unique") return false;
  const identity = `${item.itemClass} ${item.baseType}`;
  if (/\bcluster jewels?\b/i.test(identity)) return true;
  // Abyss Jewels use item level as a real affix-pool discriminator. They are
  // the exception to APT's ordinary Jewel early-return policy.
  if (/^abyss jewels?$/.test(normalizedItemClass(item))) return true;
  // Heist equipment bases can contain category-looking words (for example
  // "Charm") that are unrelated to the early-return Charm family.
  if (/^heist (?:tools?|brooches?|gear|cloaks?)$/.test(normalizedItemClass(item))) {
    return true;
  }
  return !/\b(?:maps?|charts?|jewels?|heist blueprints?|heist contracts?|memories|sanctum relics?|charms?|idols?|expedition logbooks?)\b/i.test(
    identity,
  );
}

function itemIdentityText(item: ParsedPoeItem) {
  return `${item.itemClass} ${item.name} ${item.baseType}`;
}

function isFlaskOrTincture(item: ParsedPoeItem) {
  return /\b(?:flasks?|tinctures?)\b/i.test(item.itemClass);
}

function usesIdentityTradeOnlyState(item: ParsedPoeItem) {
  return /^(?:captured beasts?|invitations?)$/.test(normalizedItemClass(item));
}

function hasImbuedGemModifier(item: ParsedPoeItem) {
  return item.rarity === "gem" && item.modifiers.some((modifier) =>
    modifier.kind === "imbued" ||
    officialTradeStatIds(modifier).some((id) => id.startsWith("imbued."))
  );
}

function isConsumableCraftableItem(item: ParsedPoeItem) {
  return /\b(?:maps?|charts?|heist blueprints?|heist contracts?|invitations?|memories|memory lines?|expedition logbooks?)\b/i.test(
    itemIdentityText(item),
  );
}

function supportsExactMagicRarityControl(item: ParsedPoeItem) {
  if (item.rarity !== "magic" || isAdornedMagicJewel(item)) return false;
  if (isConsumableCraftableItem(item)) return false;
  return !/\b(?:flasks?|tinctures?|voidstones?|sanctum relics?|charms?)\b/.test(
    normalizedItemClass(item),
  );
}

function defaultsToChaosDivinePrice(item: ParsedPoeItem) {
  return item.rarity !== "unique" && (
    !isCraftableBaseType(item.name, item.baseType, item) ||
    isConsumableCraftableItem(item)
  );
}

function shouldActivateGemLevel(item: ParsedPoeItem) {
  if (item.gemLevel == null) return false;
  const profile = gemIdentityProfile(item.name || item.baseType);
  if (profile) return item.gemLevel >= profile.maxLevel;
  if (/^(?:empower|enlighten|enhance) support$/i.test(item.name.trim())) {
    return item.gemLevel >= 3;
  }
  if (/^awakened\b/i.test(item.name.trim())) return item.gemLevel >= 5;
  return item.gemLevel >= 20;
}

function shouldActivateGemQuality(item: ParsedPoeItem, quality: number) {
  const profile = gemIdentityProfile(item.name || item.baseType);
  if (!profile) return quality >= 20;
  if (profile.maxLevel === 1) return quality > 0;
  if (profile.maxLevel === 20 && !profile.transfigured) return quality >= 16;
  return quality >= 20;
}

function propertyNumber(item: ParsedPoeItem, label: string) {
  const entry = Object.entries(item.properties).find(
    ([key]) => key.trim().toLowerCase() === label.toLowerCase(),
  );
  if (!entry) return undefined;
  const match = /[-+]?\d[\d,]*(?:\.\d+)?/.exec(entry[1]);
  if (!match) return undefined;
  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function floorToBracket(value: number, brackets: readonly number[]) {
  let result = brackets[0];
  for (const bracket of brackets) {
    if (bracket > value) break;
    result = bracket;
  }
  return result;
}

function isResolvedUnidentifiedWatchersEye(item: ParsedPoeItem) {
  return item.itemLevel != null &&
    item.rarity === "unique" &&
    !item.identified &&
    /^watcher's eye$/i.test(item.name.replace(/^Foulborn\s+/i, "").trim());
}

function agnerodItemLevelVariant(item: ParsedPoeItem) {
  if (
    item.rarity !== "unique" ||
    item.itemLevel == null ||
    item.itemLevel < 75 ||
    !/^(?:agnerod|agnerod east|agnerod north|agnerod south|agnerod west)$/i.test(
      item.name.trim(),
    )
  ) return undefined;
  if (item.itemLevel >= 82) return 82;
  if (item.itemLevel >= 80) return 80;
  if (item.itemLevel >= 78) return 78;
  return 75;
}

function supportsHiddenNotFracturedBaseline(item: ParsedPoeItem) {
  const unresolvedUniqueBase = item.rarity === "unique" &&
    !hasResolvedUniqueIdentity(item);
  if (
    (!unresolvedUniqueBase && !["normal", "magic", "rare"].includes(item.rarity)) ||
    item.corrupted ||
    item.mirrored ||
    item.fractured
  ) {
    return false;
  }
  return isCraftableBaseType(item.name, item.baseType, item);
}

function supportsHiddenNotMirroredBaseline(item: ParsedPoeItem) {
  // Awakened ties this baseline to base craftability, not to whether the item
  // is fractured, synthesised or influenced. Those states make splitting
  // impossible, but they do not make an unmirrored search meaningless.
  const unresolvedUniqueBase = item.rarity === "unique" &&
    !hasResolvedUniqueIdentity(item);
  if (
    (!unresolvedUniqueBase && !["normal", "magic", "rare"].includes(item.rarity)) ||
    item.corrupted ||
    item.mirrored
  ) {
    return false;
  }
  return isCraftableBaseType(item.name, item.baseType, item);
}

function supportsHiddenNotSplitBaseline(
  item: ParsedPoeItem,
  options: DefaultPriceCheckItemFilterOptions,
) {
  return supportsHiddenNotFracturedBaseline(item) &&
    !item.split &&
    !item.synthesised &&
    !item.influences.length &&
    (options.exact || options.league?.trim().toLowerCase() !== "standard");
}

/**
 * Copied values for item-state controls that are genuinely relevant to this
 * item. Corruption is intentionally visible with an explicit label, while
 * generic negative states such as Not Veiled, Not Synthesised, Not Mirrored
 * and Not Split remain hidden. Hidden constraints are planned separately and
 * therefore never masquerade as selected UI chips.
 */
export function defaultPriceCheckItemFilters(item: ParsedPoeItem) {
  const itemFilters: Record<string, PriceCheckItemFilterValue> = {};
  const itemClass = normalizedItemClass(item);
  const defaultCurrency = () => {
    if (defaultsToChaosDivinePrice(item)) {
      itemFilters.tradeCurrency = "chaos_divine";
    }
  };
  // APT's category branches return before generic state construction. Beasts
  // have exact identity only; Invitations may additionally expose stock; the
  // retained historical Metamorph branch uses the raw copied item level.
  if (/^captured beasts?$/.test(itemClass)) {
    defaultCurrency();
    return itemFilters;
  }
  if (/^invitations?$/.test(itemClass)) {
    if (item.stackSize != null) itemFilters.stackSize = item.stackSize;
    defaultCurrency();
    return itemFilters;
  }
  if (/^metamorph samples?$/.test(itemClass)) {
    if (item.stackSize != null) itemFilters.stackSize = item.stackSize;
    if (item.itemLevel != null) itemFilters.itemLevel = item.itemLevel;
    defaultCurrency();
    return itemFilters;
  }
  if (supportsItemLevelState(item)) {
    if (isClusterJewel(item)) {
      const bracket = clusterItemLevelBracket(item.itemLevel!);
      itemFilters.itemLevel = bracket.min;
      itemFilters.itemLevelMax = bracket.max;
    } else {
      // The official affix pool has no further useful breakpoint above 86.
      itemFilters.itemLevel = Math.min(item.itemLevel!, 86);
    }
  } else if (isResolvedUnidentifiedWatchersEye(item)) {
    // Preserve Awakened's discriminator only after an unidentified-unique
    // resolver has established the Watcher's Eye identity. Prismatic Jewel is
    // shared by unrelated uniques and is not sufficient evidence on its own.
    itemFilters.itemLevel = item.itemLevel!;
  } else {
    const agnerodLevel = agnerodItemLevelVariant(item);
    if (agnerodLevel != null) itemFilters.itemLevel = agnerodLevel;
  }
  if (
    item.quality != null &&
    item.quality > 0 &&
    (item.rarity === "gem" || item.quality >= 20) &&
    (item.rarity !== "unique" || isFlaskOrTincture(item))
  ) {
    itemFilters.quality = item.quality;
  }
  if (item.gemLevel != null) itemFilters.gemLevel = item.gemLevel;
  const effectiveLinks = copiedLinks(item);
  if (effectiveLinks != null) itemFilters.links = effectiveLinks;
  if (item.mapTier != null) itemFilters.mapTier = item.mapTier;
  if (item.mapCompletionReward) {
    itemFilters.mapCompletionReward = item.mapCompletionReward;
  }
  if (item.scryingMapArea) itemFilters.scryingMapArea = item.scryingMapArea;
  if (item.sentinelCharge != null) itemFilters.sentinelCharge = item.sentinelCharge;

  const mirroredTablet = /^mirrored tablet$/i.test(
    (item.name || item.baseType).trim(),
  );
  const areaLevel = mirroredTablet
    ? undefined
    : propertyNumber(item, "Area Level");
  if (areaLevel != null) {
    const identity = itemIdentityText(item);
    if (/\bchronicle of atzoatl\b/i.test(identity)) {
      itemFilters.areaLevel = floorToBracket(areaLevel, [1, 68, 73, 75, 78, 80]);
    } else if (/\bexpedition logbook\b/i.test(identity)) {
      itemFilters.areaLevel = floorToBracket(areaLevel, [1, 68, 73, 78, 81, 83]);
    } else {
      itemFilters.areaLevel = areaLevel;
      if (/\bforbidden tome\b/i.test(identity) && areaLevel < 83) {
        itemFilters.areaLevelMax = areaLevel;
      }
    }
  }
  const heistWings = propertyNumber(item, "Wings Revealed");
  if (heistWings != null) itemFilters.heistWings = heistWings;
  if (item.stackSize != null) itemFilters.stackSize = item.stackSize;
  if (defaultsToChaosDivinePrice(item)) {
    itemFilters.tradeCurrency = "chaos_divine";
  }

  if (item.mapBlighted === "Blight-ravaged" || /^blight-ravaged\s+/i.test(item.baseType)) {
    itemFilters.mapBlighted = "Blight-ravaged";
  } else if (item.mapBlighted === "Blighted" || /^blighted\s+/i.test(item.baseType)) {
    itemFilters.mapBlighted = "Blighted";
  }

  // This is the user-facing version of Awakened's corruption filter. Clean
  // items intentionally copy `false` ("NOT CORRUPTED"); magic non-cluster
  // jewels can also make the positive state exact.
  if (supportsCorruptionState(item)) itemFilters.corrupted = item.corrupted;
  if (isAdornedMagicJewel(item)) itemFilters.rarity = "magic";

  // Awakened only exposes these state buttons when the copied item actually
  // carries the state. Their ordinary false values are neither useful buttons
  // nor default negative Trade constraints.
  if (item.mirrored) itemFilters.mirrored = true;
  if (item.split) itemFilters.split = true;
  if (item.veiled) itemFilters.veiled = true;
  if (item.rarity === "unique") {
    if (item.foil) itemFilters.foil = true;
  }
  if (!item.identified) itemFilters.identified = false;
  if (item.influences.length <= 2) {
    for (const influence of item.influences) {
      const normalized = influence.trim().toLowerCase();
      if (normalized) itemFilters[`influence:${normalized}`] = true;
    }
  }
  return itemFilters;
}

/** Awakened-style selected defaults; visibility is handled independently. */
export function defaultActivePriceCheckItemFilters(
  item: ParsedPoeItem,
  options: DefaultPriceCheckItemFilterOptions = {},
) {
  const copied = defaultPriceCheckItemFilters(item);
  const active: Record<string, PriceCheckItemFilterValue> = {};
  const copy = (key: string) => {
    if (Object.hasOwn(copied, key)) active[key] = copied[key];
  };

  // These APT category branches return immediately after identity/trade
  // construction. Preserve optional stock/currency controls, but never let
  // generic rarity, corruption or crafting baselines leak in later.
  if (usesIdentityTradeOnlyState(item)) {
    copy("stackSize");
    copy("tradeCurrency");
    return active;
  }

  // Clean items are constrained to clean listings; corrupted items are
  // constrained only for magic Jewel/Abyss Jewel searches.
  if (supportsCorruptionState(item)) active.corrupted = item.corrupted;
  copy("links");
  copy("mapTier");
  copy("mapCompletionReward");
  copy("scryingMapArea");
  copy("sentinelCharge");
  copy("areaLevel");
  copy("areaLevelMax");
  copy("heistWings");
  copy("heistPriceless");
  copy("mapBlighted");
  copy("rarity");
  copy("tradeCurrency");
  if (shouldActivateGemLevel(item)) copy("gemLevel");
  if (
    typeof copied.quality === "number" &&
    (
      (item.rarity === "gem" && shouldActivateGemQuality(item, copied.quality)) ||
      (item.rarity !== "gem" &&
        copied.quality > 20 &&
        (options.exact || isFlaskOrTincture(item)))
    )
  ) copy("quality");

  const exactBaseState = Boolean(options.exact);
  if (
    exactBaseState ||
    item.veiled ||
    isResolvedUnidentifiedWatchersEye(item) ||
    agnerodItemLevelVariant(item) != null
  ) {
    if (!isFlaskOrTincture(item)) {
      copy("itemLevel");
      copy("itemLevelMax");
    }
  }
  if (exactBaseState) {
    for (const key of Object.keys(copied)) {
      if (key.startsWith("influence:")) copy(key);
    }
  }

  for (const key of [
    "mirrored",
    "split",
    "veiled",
    "foil",
  ]) {
    copy(key);
  }
  if (!item.identified && item.rarity === "unique") copy("identified");

  // These unique variants are exact identity discriminators in Awakened even
  // when false, but they are intentionally hidden unless present on the item.
  if (item.rarity === "unique") {
    active.foulborn = item.foulborn;
    active.vestigial = Boolean(item.vestigial);
  }
  // Awakened silently constrains eligible ordinary crafting bases to items
  // that are not fractured. Keep the constraint without showing a checked
  // generic "NOT FRACTURED" button.
  if (supportsHiddenNotFracturedBaseline(item)) active.fractured = false;
  if (supportsHiddenNotMirroredBaseline(item)) active.mirrored = false;
  if (supportsHiddenNotSplitBaseline(item, options)) active.split = false;
  if (
    item.rarity === "gem" &&
    item.corrupted &&
    (item.gemLevel ?? 0) >= 20 &&
    !hasImbuedGemModifier(item)
  ) {
    active.imbuedGem = false;
  }
  return active;
}

/**
 * APT builds item controls in a fixed semantic sequence.  Object insertion
 * order is not a durable substitute because the copied defaults are assembled
 * from several category branches.  Keep this ordering in one place so the
 * compact and dashboard editors present the same cross-family sequence.
 */
export function orderedPriceCheckItemFilterEntries(
  values: Readonly<Record<string, PriceCheckItemFilterValue>>,
) {
  const priority = (key: string) => {
    if (key === "identityRelaxed") return 0;
    if (key === "identitySub") return 1;
    if (key === "links") return 100;
    if (key === "mapTier") return 200;
    if (key === "mapCompletionReward") return 300;
    if (key === "scryingMapArea") return 400;
    if (key === "areaLevel") return 500;
    if (key === "areaLevelMax") return 501;
    if (key === "heistWings") return 600;
    if (key.startsWith("heistJob:")) return 610;
    if (key === "heistPriceless") return 620;
    if (key === "sentinelCharge") return 700;
    if (key === "mapBlighted") return 800;
    if (key === "itemLevel") return 900;
    if (key === "itemLevelMax") return 901;
    if (key === "stackSize") return 1000;
    if (key === "whiteSockets") return 1100;
    if (key === "gemLevel") return 1200;
    if (key === "quality") return 1300;
    if (key.startsWith("influence:")) return 1400;
    if (key === "rarity") return 1425;
    // Corruption is an app-visible APT state control and sits beside the
    // remaining item-state toggles, before identification/variant controls.
    if (key === "corrupted") return 1450;
    if (key === "identified") return 1500;
    if (key === "veiled") return 1600;
    if (key === "foulborn") return 1650;
    if (key === "vestigial") return 1651;
    if (key === "foil") return 1700;
    if (key === "mirrored") return 1800;
    if (key === "split") return 1900;
    // Market-only controls are not part of APT's item-filter sequence, but a
    // stable tail keeps restored sessions deterministic wherever they appear.
    if (key === "tradeCurrency") return 10_000;
    if (key === "listed") return 10_001;
    return 9_000;
  };
  return Object.entries(values)
    .map(([key, value], index) => ({ key, value, index }))
    .sort((left, right) =>
      priority(left.key) - priority(right.key) || left.index - right.index
    )
    .map(({ key, value }) => [key, value] as const);
}

export function priceCheckItemFilterControls(
  item: ParsedPoeItem,
  options: DefaultPriceCheckItemFilterOptions = {},
): PriceCheckItemFilterControl[] {
  const identityState = identityStateForPreset(
    item,
    options.mode ?? (options.exact ? "exact" : "similar"),
    options.itemFilters,
  );
  const relaxedSelected = Boolean(
    identityState.relaxed && !identityState.relaxed.disabled,
  );
  const identityControls: PriceCheckItemFilterControl[] = identityState.relaxed
    ? [{
        key: "identityRelaxed" as const,
        // APT's FilterName button displays the selected search, not a static
        // label for the alternate action.
        label: relaxedSelected
          ? identityState.relaxed.label
          : identityState.exact.label,
        copiedValue: relaxedSelected,
        kind: "identity" as const,
      }, ...(relaxedSelected && identityState.relaxed.sub
        ? [{
            key: "identitySub" as const,
            label: identityState.relaxed.sub.label,
            copiedValue: !identityState.relaxed.sub.disabled,
            kind: "identity" as const,
          }]
        : [])]
    : [];
  const values = { ...defaultPriceCheckItemFilters(item) };
  if (options.exact && supportsExactMagicRarityControl(item)) {
    values.rarity = "magic";
  }
  // Awakened does not create a quality control for ordinary weapon/armour
  // Similar searches. It appears in the exact/base preset (and remains
  // contextual for gems, flasks and tinctures).
  if (
    !options.exact &&
    item.rarity !== "gem" &&
    !isFlaskOrTincture(item)
  ) {
    delete values.quality;
  }
  const booleanLabel = (key: string, value: boolean) => {
    const labels: Record<string, [string, string]> = {
      mirrored: ["NOT MIRRORED", "MIRRORED"],
      split: ["NOT SPLIT", "SPLIT"],
      fractured: ["NOT FRACTURED", "FRACTURED"],
      synthesised: ["NOT SYNTH", "SYNTH"],
      veiled: ["NOT VEILED", "VEILED"],
      foulborn: ["NOT FOULBORN", "FOULBORN"],
      vestigial: ["NOT VESTIGIAL", "VESTIGIAL"],
      foil: ["NOT FOIL", "FOIL"],
      identified: ["UNIDENTIFIED", "IDENTIFIED"],
      corrupted: ["NOT CORRUPTED", "CORRUPTED"],
      heistPriceless: ["NOT PRICELESS", "PRICELESS"],
    };
    if (key.startsWith("influence:")) {
      return key.slice("influence:".length).toUpperCase();
    }
    return labels[key]?.[value ? 1 : 0] || key.toUpperCase();
  };
  const numericLabels: Record<string, [string, number?]> = {
    itemLevel: ["ILVL", 100],
    itemLevelMax: ["ILVL MAX", 100],
    mapTier: ["TIER", 18],
    links: ["LINKS", 6],
    quality: ["QUALITY", 30],
    gemLevel: ["LEVEL"],
    areaLevel: ["AREA", 100],
    areaLevelMax: ["AREA MAX", 100],
    heistWings: ["WINGS"],
    sentinelCharge: ["CHARGE"],
    stackSize: ["STOCK"],
  };
  const stringControl = (
    key: string,
    copiedValue: string,
  ): PriceCheckItemFilterControl | undefined => {
    if (key === "mapCompletionReward") {
      return {
        key,
        label: "FOIL REWARD",
        copiedValue,
        displayValue: copiedValue,
        kind: "string",
        readonly: true,
      };
    }
    if (key === "scryingMapArea") {
      return {
        key,
        label: "SCRYING",
        copiedValue,
        displayValue: copiedValue,
        kind: "string",
        readonly: true,
      };
    }
    if (key === "mapBlighted") {
      return {
        key,
        label: copiedValue.toUpperCase(),
        copiedValue,
        kind: "string",
        readonly: true,
      };
    }
    if (key === "rarity" && copiedValue === "magic") {
      return {
        key,
        label: "MAGIC",
        copiedValue,
        kind: "string",
      };
    }
    return undefined;
  };

  return [
    ...identityControls,
    ...orderedPriceCheckItemFilterEntries(values).flatMap<PriceCheckItemFilterControl>(
    ([key, copiedValue]): PriceCheckItemFilterControl[] => {
      if (typeof copiedValue === "number") {
        const definition = numericLabels[key] || (key.startsWith("heistJob:")
          ? [`${key.slice("heistJob:".length).toUpperCase()} LEVEL`, 5] as [string, number]
          : undefined);
        if (!definition) return [];
        if (key === "itemLevelMax" && typeof values.itemLevel === "number") {
          return [];
        }
        if (key === "itemLevel" && typeof values.itemLevelMax === "number") {
          return [{
            key,
            upperKey: "itemLevelMax",
            label: definition[0],
            copiedValue,
            copiedUpperValue: values.itemLevelMax,
            kind: "number-range" as const,
            ...(definition[1] != null ? { maximum: definition[1] } : {}),
          }];
        }
        return [{
          key,
          label: definition[0],
          copiedValue,
          kind: "number" as const,
          ...(definition[1] != null ? { maximum: definition[1] } : {}),
        }];
      }
      if (typeof copiedValue === "string") {
        const control = stringControl(key, copiedValue);
        return control ? [control] : [];
      }
      if (typeof copiedValue !== "boolean") return [];
      return [{
        key,
        label: booleanLabel(key, copiedValue),
        copiedValue,
        kind: "boolean" as const,
      }];
    },
  ),
  ];
}

function buildStateFilters(
  item: ParsedPoeItem,
  override?: Record<string, string | number | boolean>,
  options: DefaultPriceCheckItemFilterOptions = {},
) {
  const rawItemFilters = override
    ? { ...override }
    : defaultActivePriceCheckItemFilters(item, options);
  const itemFilters = Object.fromEntries(Object.entries(rawItemFilters).filter(
    ([key]) =>
      !key.startsWith("heistJob:") &&
      key !== "heistPriceless" &&
      (
        !usesIdentityTradeOnlyState(item) ||
        key === "stackSize" ||
        key === "tradeCurrency" ||
        key === "listed"
      ),
  ));
  const identityTradeOnly = usesIdentityTradeOnlyState(item);
  const misc: Record<string, unknown> = {};

  if (
    !identityTradeOnly &&
    supportsCorruptionState(item) &&
    itemFilters.corrupted === false
  ) {
    misc.corrupted = { option: "false" };
  } else if (
    !identityTradeOnly &&
    itemFilters.corrupted === true &&
    usesExactCorruptionState(item)
  ) {
    misc.corrupted = { option: "true" };
  }
  if (!identityTradeOnly && itemFilters.foulborn === false) {
    misc.foulborn_item = { option: "false" };
  }
  if (!identityTradeOnly && itemFilters.vestigial === false) {
    misc.vestigial = { option: "false" };
  }
  if (!identityTradeOnly && itemFilters.identified === false) {
    misc.identified = { option: "false" };
  }
  const itemLevel = Number(itemFilters.itemLevel);
  const maximumItemLevel = Number(itemFilters.itemLevelMax);
  if (!identityTradeOnly && (
    Number.isFinite(itemLevel) || Number.isFinite(maximumItemLevel)
  )) {
    misc.ilvl = {
      ...(Number.isFinite(itemLevel) ? { min: itemLevel } : {}),
      ...(Number.isFinite(maximumItemLevel) &&
      (!Number.isFinite(itemLevel) || maximumItemLevel >= itemLevel)
        ? { max: maximumItemLevel }
        : {}),
    };
  }
  const numericMisc: Array<[string, string]> = [
    ["quality", "quality"],
    ["gemLevel", "gem_level"],
  ];
  for (const [itemKey, apiKey] of numericMisc) {
    const value = Number(itemFilters[itemKey]);
    if (identityTradeOnly || !Number.isFinite(value)) continue;
    misc[apiKey] = { min: value };
  }
  const stackSize = Number(itemFilters.stackSize);
  if (Number.isFinite(stackSize)) {
    misc.stack_size = { min: stackSize };
  }
  if (!identityTradeOnly && itemFilters.imbuedGem === false) {
    misc.gem_imbued = { option: "false" };
  }
  const booleanMisc: Array<[string, string]> = [
    ["mirrored", "mirrored"],
    ["split", "split"],
    ["fractured", "fractured_item"],
  ];
  for (const [itemKey, apiKey] of booleanMisc) {
    // Awakened only emits these as hidden negative crafting-base baselines.
    // Positive copied states are descriptive and are not direct Trade fields.
    if (!identityTradeOnly && itemFilters[itemKey] === false) {
      misc[apiKey] = { option: "false" };
    }
  }

  const filters: Record<string, unknown> = {
    misc_filters: { filters: misc },
  };
  if (!identityTradeOnly && item.rarity === "unique" && itemFilters.foil === true) {
    filters.type_filters = {
      filters: {
        rarity: { option: "uniquefoil" },
      },
    };
  } else if (!identityTradeOnly && itemFilters.rarity === "magic") {
    filters.type_filters = {
      filters: { rarity: { option: "magic" } },
    };
  } else if (!identityTradeOnly && ["normal", "magic", "rare"].includes(item.rarity)) {
    filters.type_filters = {
      filters: { rarity: { option: "nonunique" } },
    };
  }
  const links = Number(itemFilters.links);
  if (Number.isFinite(links)) {
    filters.socket_filters = {
      filters: { links: { min: links } },
    };
  }
  const mapTier = Number(itemFilters.mapTier);
  if (Number.isFinite(mapTier)) {
    filters.map_filters = {
      filters: { map_tier: { min: mapTier, max: mapTier } },
    };
  }
  if (
    typeof itemFilters.mapCompletionReward === "string" &&
    itemFilters.mapCompletionReward.trim()
  ) {
    const mapFilters = (filters.map_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    mapFilters.filters.map_completion_reward = {
      option: itemFilters.mapCompletionReward.trim(),
    };
  }

  const sentinelCharge = Number(itemFilters.sentinelCharge);
  if (Number.isFinite(sentinelCharge)) {
    filters.sentinel_filters = {
      filters: { sentinel_durability: { min: sentinelCharge } },
    };
  }

  const areaLevel = Number(itemFilters.areaLevel);
  const areaLevelMax = Number(itemFilters.areaLevelMax);
  if (Number.isFinite(areaLevel) || Number.isFinite(areaLevelMax)) {
    const mapFilters = (filters.map_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    mapFilters.filters.area_level = {
      ...(Number.isFinite(areaLevel) ? { min: areaLevel } : {}),
      ...(Number.isFinite(areaLevelMax) ? { max: areaLevelMax } : {}),
    };
  }
  const heistWings = Number(itemFilters.heistWings);
  if (Number.isFinite(heistWings)) {
    filters.heist_filters = {
      filters: { heist_wings: { min: heistWings } },
    };
  }
  const heistApiKeys: Record<string, string> = {
    lockpicking: "heist_lockpicking",
    "brute force": "heist_brute_force",
    perception: "heist_perception",
    demolition: "heist_demolition",
    "counter-thaumaturgy": "heist_counter_thaumaturgy",
    "trap disarmament": "heist_trap_disarmament",
    agility: "heist_agility",
    deception: "heist_deception",
    engineering: "heist_engineering",
  };
  for (const [key, rawValue] of Object.entries(itemFilters)) {
    if (!key.startsWith("heistJob:")) continue;
    const apiKey = heistApiKeys[key.slice("heistJob:".length)];
    const value = Number(rawValue);
    if (!apiKey || !Number.isFinite(value)) continue;
    const heistFilters = (filters.heist_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    heistFilters.filters[apiKey] = { min: value };
  }
  if (itemFilters.heistPriceless === true) {
    const heistFilters = (filters.heist_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    heistFilters.filters.heist_objective_value = { option: "priceless" };
  }
  if (itemFilters.mapBlighted === "Blighted" || itemFilters.mapBlighted === "Blight-ravaged") {
    const mapFilters = (filters.map_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    mapFilters.filters[
      itemFilters.mapBlighted === "Blighted" ? "map_blighted" : "map_uberblighted"
    ] = { option: "true" };
  }

  const trade: Record<string, unknown> = {};
  if (
    typeof itemFilters.tradeCurrency === "string" &&
    itemFilters.tradeCurrency.trim()
  ) {
    trade.price = { option: itemFilters.tradeCurrency.trim() };
  }
  if (
    typeof itemFilters.listed === "string" &&
    itemFilters.listed.trim()
  ) {
    trade.indexed = { option: itemFilters.listed.trim() };
  }
  if (Object.keys(trade).length) {
    filters.trade_filters = { filters: trade };
  }

  return { itemFilters, filters };
}

function serializedTradeValue(
  filter: PriceCheckModifierFilter,
  valueTransform?: "empty" | "empty-if-100" | "div-by-100",
) {
  const option = typeof filter.tradeOption === "string"
    ? filter.tradeOption.trim() || undefined
    : typeof filter.tradeOption === "number" && Number.isFinite(filter.tradeOption)
      ? filter.tradeOption
      : undefined;
  if (
    valueTransform === "empty" ||
    (valueTransform === "empty-if-100" && filter.copiedValue === 100)
  ) {
    return option == null ? undefined : { option };
  }
  if (filter.mode === "presence") {
    return option == null ? undefined : { option };
  }

  let min: number | undefined;
  let max: number | undefined;
  if (filter.mode === "exact") {
    const exact = [filter.min, filter.max].find(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (exact == null) return undefined;
    min = exact;
    max = exact;
  } else {
    min = typeof filter.min === "number" && Number.isFinite(filter.min)
      ? filter.min
      : undefined;
    max = typeof filter.max === "number" && Number.isFinite(filter.max)
      ? filter.max
      : undefined;
  }

  // The editor keeps human-readable/canonical values. Only the official
  // Trade payload uses the catalog's inverted numeric representation.
  if (filter.tradeInverted) {
    const canonicalMin = min;
    min = max == null ? undefined : rounded(-max);
    max = canonicalMin == null ? undefined : rounded(-canonicalMin);
  }
  if (valueTransform === "div-by-100") {
    min = min == null ? undefined : rounded(min / 100);
    max = max == null ? undefined : rounded(max / 100);
  }
  if (min == null && max == null) return undefined;
  return {
    ...(option != null ? { option } : {}),
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
  };
}

function filtersForExactPreset(
  item: ParsedPoeItem,
  filters: PriceCheckModifierFilter[],
) {
  const identity = itemIdentityText(item);
  if (
    item.mapBlighted ||
    /^(?:blight-ravaged|blighted)\s+/i.test(item.baseType) ||
    /\binvitation\b/i.test(identity) ||
    (item.rarity === "unique" && !item.identified && !item.synthesised)
  ) {
    return [];
  }
  const modifiers = new Map(
    item.modifiers.map((modifier) => [modifier.id, modifier] as const),
  );
  const chart = isChartPriceCheckItem(item);
  const map = /\bmaps?\b/i.test(item.itemClass);
  const flask = /\bflasks?\b/i.test(item.itemClass);
  const tincture = /\btinctures?\b/i.test(item.itemClass);
  const idol = /\bidols?\b/i.test(item.itemClass);
  const enableAllCategory = /\b(?:memory lines?|sanctum relics?|charms?)\b/i.test(
    item.itemClass,
  );
  const magicExplicit = item.rarity === "magic" &&
    !/\b(?:cluster jewels?|maps?|charts?|heist contracts?|heist blueprints?|sentinels?)\b/i.test(
      identity,
    );
  const rareIdolExplicit = item.rarity === "rare" && idol;
  const keepImplicit = !item.influences.length &&
    !item.fractured &&
    !chart &&
    !tincture &&
    !idol;

  const exactFilters = filters.flatMap((filter) => {
    if (chart) {
      return filter.modifierId.startsWith("chart:") ? [{ ...filter }] : [];
    }
    // Awakened's exact-stat preset does not carry the pseudo preset's generic
    // armour/DPS property filters. It builds only its dedicated base/map
    // properties, which this data model represents separately.
    if (filter.modifierId.startsWith("map:")) return [{ ...filter }];
    if (filter.modifierId === "property:memory-strands") {
      return [{ ...filter }];
    }
    if (filter.tradeId?.startsWith("item.heist_")) {
      return [{ ...filter }];
    }
    if (
      filter.tag === "pseudo" &&
      modifiers.get(filter.modifierId)?.tags.includes("derived-from-fractured")
    ) return [];
    if (filter.negated) return [{ ...filter }];
    if (isEquipmentPropertyFilter(filter)) {
      return filter.equipmentProperty.group === "map_filters" ||
        filter.equipmentProperty.key === "base_defence_percentile"
        ? [{ ...filter }]
        : [];
    }
    // APT keeps unresolved copied lines in `unknownModifiers`; they are never
    // promoted into selectable exact-preset stat rows.
    if (!isOfficialPriceCheckFilter(filter)) return [];
    const modifier = modifiers.get(filter.modifierId);
    if (!modifier) return [];
    const keep = ["pseudo", "fractured", "enchant", "imbued", "rune"].includes(
      modifier.kind,
    ) ||
      (modifier.kind === "implicit" && keepImplicit) ||
      (modifier.kind === "explicit" && (magicExplicit || rareIdolExplicit)) ||
      (modifier.kind === "crafted" && flask);
    if (!keep) return [];

    const preservePlannedEnabled =
      modifier.tags.includes("atzoatl-room") ||
      /^mirrored tablet$/i.test((item.name || item.baseType).trim()) ||
      (map && modifier.kind === "pseudo") ||
      (isClusterJewel(item) && isClusterJewelSocketStat(modifier)) ||
      isHiddenOrdinaryFlaskEnchant(item, modifier);
    let enabled = preservePlannedEnabled ? filter.enabled : true;
    if (!preservePlannedEnabled && !map && modifier.kind === "explicit") {
      const tier = Number(modifier.tier);
      enabled = Number.isFinite(tier) && tier <= 2;
    }
    const result = { ...filter, enabled };
    if (
      !modifier.tags.includes("atzoatl-room") &&
      !/^mirrored tablet$/i.test((item.name || item.baseType).trim()) &&
      !(isClusterJewel(item) && isClusterJewelSocketStat(modifier)) &&
      !isHiddenOrdinaryFlaskEnchant(item, modifier)
    ) {
      delete result.advancedOnly;
    }
    if (modifier.tradeStatRef === "# uses remaining") {
      const copiedValue = firstFiniteRoll(modifier);
      if (copiedValue != null) {
        result.copiedValue = copiedValue;
        result.mode = "exact";
        result.min = copiedValue;
        result.max = copiedValue;
      }
    }
    return [result];
  });

  if (enableAllCategory) {
    return exactFilters.map((filter) =>
      filter.advancedOnly || filter.modifierId === "property:memory-strands"
        ? filter
        : { ...filter, enabled: true }
    );
  }
  if (idol) {
    return exactFilters.map((filter) => {
      if (filter.advancedOnly) return filter;
      const sourceModifier = modifiers.get(filter.modifierId);
      const copiedValue = filter.copiedValue ??
        (sourceModifier ? firstFiniteRoll(sourceModifier) : undefined);
      // APT uses the copied modifier's canonical roll domain to decide Idol
      // goodness, even though non-unique rows do not expose that domain as an
      // interactive slider. Keep presentation bounds and scoring bounds
      // separate so removing an invented slider cannot enable every Idol row.
      const goodnessBounds = filter.bounds ?? sourceModifier?.tradeBounds;
      if (
        filter.mode === "presence" ||
        filter.direction === 0 ||
        copiedValue == null ||
        !goodnessBounds
      ) {
        return { ...filter, enabled: true };
      }
      const span = goodnessBounds.max - goodnessBounds.min;
      const goodness = span === 0
        ? 1
        : filter.direction === -1
          ? 1 - (copiedValue - goodnessBounds.min) / span
          : (copiedValue - goodnessBounds.min) / span;
      return goodness >= 0.66 ? { ...filter, enabled: true } : filter;
    });
  }
  return exactFilters;
}

function planMapPropertyFilters(
  item: ParsedPoeItem,
  tolerance: number,
  bulk = false,
): PriceCheckModifierFilter[] {
  if (
    !/\bmaps?\b/i.test(item.itemClass) ||
    item.rarity === "unique" ||
    item.mapBlighted ||
    /^(?:blight-ravaged|blighted)\s+/i.test(item.baseType) ||
    Object.keys(item.properties).some(
      (key) => key.trim().toLowerCase() === "reward",
    )
  ) {
    return [];
  }

  const moreDropProperties = [
    ["More Maps", "pseudo.pseudo_map_more_map_drops", "More Maps"],
    ["More Scarabs", "pseudo.pseudo_map_more_scarab_drops", "More Scarabs"],
    ["More Currency", "pseudo.pseudo_map_more_currency_drops", "More Currency"],
    ["More Divination Cards", "pseudo.pseudo_map_more_card_drops", "More Divination Cards"],
  ] as const;
  const moreDrops = moreDropProperties.flatMap(([property, tradeId, label]) => {
    const value = propertyNumber(item, property);
    return value == null
      ? []
      : [{ property, tradeId, label, value }];
  });

  const minimum = (value: number, exactTolerance = tolerance) =>
    Math.floor(value * (1 - exactTolerance / 100) + Number.EPSILON);
  const propertyFilter = (
    id: string,
    label: string,
    value: number,
    key: "map_iiq" | "map_iir" | "map_packsize",
    enabled = true,
  ): PriceCheckModifierFilter => ({
    modifierId: `map:${id}`,
    label: `${label}: ${value}%`,
    copiedValue: value,
    equipmentProperty: { group: "map_filters", key },
    enabled,
    mode: "range",
    min: minimum(value),
    direction: 1,
    importance: enabled ? "key" : "useful",
    explanation: "Awakened map-property threshold from the copied map.",
  });
  const filters: PriceCheckModifierFilter[] = [];
  if (!bulk) {
    const quantity = propertyNumber(item, "Item Quantity");
    const rarity = propertyNumber(item, "Item Rarity");
    const packSize = propertyNumber(item, "Monster Pack Size");
    const hasValuableDrops = moreDrops.some(({ property }) =>
      property !== "More Maps"
    );
    if (quantity != null) {
      filters.push(propertyFilter("quantity", "Item Quantity", quantity, "map_iiq"));
    }
    if (rarity != null) {
      filters.push(propertyFilter(
        "rarity",
        "Item Rarity",
        rarity,
        "map_iir",
        !hasValuableDrops,
      ));
    }
    if (packSize != null) {
      filters.push(propertyFilter(
        "pack-size",
        "Monster Pack Size",
        packSize,
        "map_packsize",
      ));
    }
    for (const { property, tradeId, label, value } of moreDrops) {
      const enabled = property !== "More Maps";
      filters.push({
        modifierId: `map:${tradeId}`,
        tradeId,
        label: `${label}: ${value}%`,
        copiedValue: value,
        enabled,
        mode: "range",
        min: minimum(value),
        direction: 1,
        importance: enabled ? "key" : "useful",
        explanation: "Awakened map-reward threshold from the copied map.",
      });
    }
  }
  // Advanced copy splits a single multi-line affix into one modifier per
  // searchable stat. APT's eight-mod discriminator counts the original
  // prefix/suffix affixes (`newMods`), not those rendered stat rows.
  const randomAffixes = new Set(item.modifiers.flatMap((modifier) => {
    if (
      !modifier.advanced ||
      !modifier.generation ||
      modifier.kind === "crafted" ||
      modifier.kind === "fractured"
    ) {
      return [];
    }
    return [[
      modifier.generation,
      modifier.source || modifier.id,
      modifier.tier || "",
    ].join("|")];
  }));
  if (randomAffixes.size === 8) {
    filters.push({
      modifierId: "map:explicit-count",
      tradeId: "pseudo.pseudo_number_of_affix_mods",
      label: "8 Modifiers",
      copiedValue: 8,
      enabled: true,
      mode: "range",
      min: 8,
      direction: 1,
      importance: "key",
      explanation: "Awakened exact eight-mod map discriminator.",
    });
  }
  return filters;
}

function planChartPropertyFilters(
  item: ParsedPoeItem,
  tolerance: number,
  bulk = false,
): PriceCheckModifierFilter[] {
  if (!isChartPriceCheckItem(item) || item.rarity === "unique" || bulk) return [];
  const minimum = (value: number) =>
    Math.floor(value * (1 - tolerance / 100) + Number.EPSILON);
  const properties: Array<[
    string,
    string,
    number | undefined,
    "map_iiq" | "map_iir" | "map_packsize" | "chart_sulphur",
  ]> = [
    ["quantity", "Item Quantity", item.areaItemQuantity, "map_iiq"],
    ["rarity", "Item Rarity", item.areaItemRarity, "map_iir"],
    ["pack-size", "Monster Pack Size", item.areaPackSize, "map_packsize"],
    ["sulphur", "Dead Man's Sulphur", item.chartSulphur, "chart_sulphur"],
  ];
  return properties.flatMap(([id, label, value, key]) =>
    value == null
      ? []
      : [{
          modifierId: `chart:${id}`,
          label: `${label}: ${value}%`,
          copiedValue: value,
          equipmentProperty: { group: "map_filters" as const, key },
          enabled: true,
          mode: "range" as const,
          min: minimum(value),
          direction: 1 as const,
          importance: "key" as const,
          explanation: "Awakened Chart-property threshold from the copied Chart.",
        }],
  );
}

function planAwakenedNegativeFilters(item: ParsedPoeItem): PriceCheckModifierFilter[] {
  const filters: PriceCheckModifierFilter[] = [];
  const patterns = new Set(item.modifiers.map((modifier) =>
    modifier.normalizedText.trim().toLowerCase()
  ));

  if (
    item.mapCompletionReward &&
    !patterns.has("players who die in area are sent to the void")
  ) {
    filters.push({
      modifierId: "map:valdo-not-void",
      tradeId: "explicit.stat_1095765106",
      tradeIds: ["explicit.stat_1095765106"],
      negated: true,
      statRef: "Players who Die in area are sent to the Void",
      tag: "explicit",
      label: "Players who Die in area are sent to the Void",
      enabled: true,
      mode: "presence",
      importance: "key",
      explanation: "Awakened excludes Valdo maps with the lethal Void modifier unless the copied map already has it.",
    });
  }

  if (
    item.rarity === "magic" &&
    patterns.has("#% increased charge recovery") &&
    !patterns.has("#% increased effect")
  ) {
    const tincture = /\btinctures?\b/i.test(item.itemClass);
    const tradeId = tincture
      ? "explicit.stat_3529940209"
      : "explicit.stat_2448920197";
    filters.push({
      modifierId: "special:not-increased-effect",
      tradeId,
      tradeIds: [tradeId],
      negated: true,
      label: "NOT INCREASED EFFECT",
      enabled: true,
      mode: "presence",
      importance: "key",
      explanation: "Awakened excludes the hybrid increased-effect variant when only Charge Recovery was copied.",
    });
  }

  if (
    item.rarity !== "unique" &&
    /\bheist blueprints?\b/i.test(item.itemClass) &&
    !item.modifiers.some((modifier) => modifier.kind === "enchant")
  ) {
    filters.push({
      modifierId: "special:blueprint-no-enchant",
      tradeId: "pseudo.pseudo_number_of_enchant_mods",
      tradeIds: ["pseudo.pseudo_number_of_enchant_mods"],
      negated: true,
      label: "# Enchant Modifiers",
      enabled: true,
      mode: "presence",
      importance: "key",
      explanation: "Awakened excludes enchanted Blueprints when the copied Blueprint has no enchant modifier.",
    });
  }

  return filters;
}

/** Builds a validated Trade comparison plan and user-clicked browser handoff. */
export function buildPriceCheckQueryPlan(
  item: ParsedPoeItem,
  league: string,
  options: BuildPriceCheckQueryOptions = {},
): PriceCheckQueryPlan {
  const plannedItem = options.mode
    ? priceCheckItemForMode(item, options.mode)
    : item;
  const configuredTolerance = clampTolerance(options.rollTolerance);
  const rollTolerance = effectivePresetTolerance(
    item,
    options.mode,
    configuredTolerance,
  );
  const status = normalizePriceCheckAvailability(
    options.status ?? (options.onlineOnly === false ? "any" : "available"),
  );
  const exactPreset = isExactPresetMode(options.mode) ||
    (!options.mode && (options.identity === "base" || rollTolerance === 0));
  const equipmentPlan = planEquipmentPropertyFilters(
    plannedItem,
    rollTolerance,
    exactPreset || /^emperor's vigilance$/i.test(item.name.trim()),
  );
  const consumedEquipmentSources = new Set(equipmentPlan.consumedModifierIds);
  const bulkMapPreset = options.mode != null &&
    isBulkMapPriceCheckMode(item, options.mode);
  const bulkChartPreset = options.mode != null &&
    isBulkChartPriceCheckMode(item, options.mode);
  const allPlannedFilters = orderAwakenedGeneratedFilters(plannedItem, [
    ...equipmentPlan.filters,
    ...planAwakenedNegativeFilters(plannedItem),
    ...planMapPropertyFilters(
      plannedItem,
      rollTolerance,
      bulkMapPreset,
    ),
    ...planChartPropertyFilters(
      plannedItem,
      rollTolerance,
      bulkChartPreset,
    ),
    ...planHeistContractPropertyFilters(plannedItem),
    ...planMemoryStrandsFilter(plannedItem, rollTolerance, exactPreset),
    ...planModifierFilters(plannedItem, rollTolerance).filter(
      (filter) =>
        !consumedEquipmentSources.has(sourceModifierId(filter.modifierId)) ||
        isFracturedComparableFilter(plannedItem, filter),
    ),
    ...planEmptyOrCraftedModifierFilter(plannedItem),
  ]);
  const plannedFilters = isExactPresetMode(options.mode)
      ? filtersForExactPreset(plannedItem, allPlannedFilters)
      : applyUniqueVisibleFilterDefaults(plannedItem, allPlannedFilters);
  const plannedModifierIds = new Set(
    plannedFilters.map((filter) => filter.modifierId),
  );
  const inputFilters = (
    options.filters
      ? options.filters.map((filter) => ({ ...filter }))
      : plannedFilters
  ).filter((filter) =>
    (
      !consumedEquipmentSources.has(sourceModifierId(filter.modifierId)) ||
      isFracturedComparableFilter(plannedItem, filter)
    ) &&
    (!(bulkMapPreset || bulkChartPreset) || plannedModifierIds.has(filter.modifierId))
  );
  const plannedByModifierId = new Map(
    plannedFilters.map((filter) => [filter.modifierId, filter] as const),
  );
  const modifiersById = new Map(
    awakenedComparableModifiers(plannedItem).map(
      (modifier) => [modifier.id, modifier] as const,
    ),
  );
  // Treat parsed/planned semantics as the authority. Edited filters may change
  // values, but cannot invent numeric capability for a value-less official
  // stat (for example a Megalomaniac notable) through stale or direct state.
  const filters = inputFilters.map((filter) => {
    const trusted = plannedByModifierId.get(filter.modifierId);
    const candidate = { ...filter };
    if (trusted?.bounds) candidate.bounds = trusted.bounds;
    else delete candidate.bounds;
    if (trusted?.copiedValue != null) candidate.copiedValue = trusted.copiedValue;
    else delete candidate.copiedValue;
    if (trusted?.tradeOption != null) candidate.tradeOption = trusted.tradeOption;
    else delete candidate.tradeOption;
    return sanitizePresenceOnlyPriceCheckFilter(
      candidate,
      modifiersById.get(filter.modifierId),
    );
  });
  const warnings: string[] = [
    "poe.ninja market values are aggregate estimates, not completed sales.",
    "Official Trade opens with selected mapped filters prefilled; review current listings before pricing.",
    ...equipmentPlan.warnings,
  ];
  const identityState = options.mode
    ? identityStateForPreset(item, options.mode, options.itemFilters)
    : identityStateWithoutPreset(item, options.identity);
  const identity = activeIdentitySearch(identityState);
  const state = buildStateFilters(item, options.itemFilters, {
    exact: isExactPresetMode(options.mode) ||
      (!options.mode && (rollTolerance === 0 || options.identity === "base")),
    league,
  });
  if (identityState.relaxed) {
    state.itemFilters.identityRelaxed = !identityState.relaxed.disabled;
    if (identityState.relaxed.sub) {
      state.itemFilters.identitySub = !identityState.relaxed.sub.disabled;
    }
  }
  const baseOnly = !options.mode && options.identity === "base";
  const identityCategory = typeof identity.query.category === "string"
    ? identity.query.category
    : undefined;
  if (identityCategory) {
    const typeFilters = (state.filters.type_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    typeFilters.filters.category = { option: identityCategory };
  }
  const identityQuery = Object.fromEntries(
    Object.entries(identity.query).filter(([key]) => key !== "category"),
  );

  if (!item.name && !item.baseType) {
    warnings.push("No searchable item identity was parsed; review the Trade search before using it.");
  }
  if (item.rarity === "magic" && !("type" in identityQuery)) {
    warnings.push(
      "The magic item's base type could not be isolated safely, so the prefilled search uses its state and modifiers without a guessed item type.",
    );
  }

  const enabled = filters.filter((filter) => filter.enabled);
  // Awakened keeps unchecked real stats in the official Trade payload with a
  // `disabled` marker so the website can reconstruct the complete editor.
  // Internal item/property filters are different: its serializer omits those
  // while disabled because their grouped Trade schema has no stat toggle.
  const emptyModifierFilters = (baseOnly ? [] : filters).filter(
    (filter) => filter.emptyModifier != null,
  );
  const serializableOfficialStats = (baseOnly ? [] : filters).filter((filter) =>
    filter.emptyModifier == null &&
    !filter.tradeId?.startsWith("item.") &&
    officialTradeStatIds(filter).length > 0,
  );
  const enabledOfficialStats = serializableOfficialStats.filter(
    (filter) => filter.enabled,
  );
  const propertyCandidates = (baseOnly ? [] : enabled).filter(
    isEquipmentPropertyFilter,
  );
  const officialProperties = propertyCandidates.filter(
    isOfficialPriceCheckFilter,
  );
  const invalidProperties = propertyCandidates.filter(
    (filter) => !isOfficialPriceCheckFilter(filter),
  );
  const missing = (baseOnly ? [] : enabled).filter(
    (filter) =>
      !isEquipmentPropertyFilter(filter) &&
      filter.emptyModifier == null &&
      filter.tradeId !== "item.memory_strands" &&
      officialTradeStatIds(filter).length === 0,
  );
  if (invalidProperties.length) {
    warnings.push(
      `${invalidProperties.length} selected calculated equipment filter${invalidProperties.length === 1 ? " needs" : "s need"} an exact value or numeric range before it can be applied.`,
    );
  }
  if (missing.length) {
    warnings.push(
      `${missing.length} selected modifier${missing.length === 1 ? " has" : "s have"} no official Trade stat ID and cannot be applied automatically. Review the search before pricing.`,
    );
  }
  if (
    !baseOnly &&
    (item.rarity === "rare" || item.rarity === "magic") &&
    !enabledOfficialStats.length &&
    !officialProperties.length
  ) {
    warnings.push(
      "This rare/magic search contains only item state and base type; add comparable modifiers on the official Trade page.",
    );
  }
  if (baseOnly && enabled.length) {
    warnings.push("Base search mode intentionally ignores modifier filters and calculated property filters.");
  }
  if (item.scourged) warnings.push("Scourged state is not encoded automatically; verify it on the Trade page.");

  // APT serializes the stat array in its filter-creation/presentation order.
  // Keep unchecked rows in place and mark them disabled; sorting by selection,
  // importance, or modifier ID changes the website editor's row order.
  const tradeStats = serializableOfficialStats.map((filter) => {
      const ids = officialTradeStatIds(filter);
      return {
        ids,
        negated: Boolean(filter.negated),
        disabled: !filter.enabled,
        values: ids.map((id) => serializedTradeValue(
          filter,
          filter.tradeIdTransforms?.[id],
        )),
      };
    });
  const veiledLogicalStats = baseOnly || !item.veiled
    ? []
    : item.modifiers.flatMap((modifier) => {
        if (modifier.kind !== "veiled") return [];
        const ids = officialTradeStatIds(modifier);
        if (!ids.length) return [];
        return [{
          ids,
          disabled: state.itemFilters.veiled !== true,
        }];
      });
  const influenceTradeIds: Record<string, string> = {
    shaper: "pseudo.pseudo_has_shaper_influence",
    elder: "pseudo.pseudo_has_elder_influence",
    crusader: "pseudo.pseudo_has_crusader_influence",
    redeemer: "pseudo.pseudo_has_redeemer_influence",
    hunter: "pseudo.pseudo_has_hunter_influence",
    warlord: "pseudo.pseudo_has_warlord_influence",
  };
  const influenceStats = baseOnly
    ? []
    : Object.entries(defaultPriceCheckItemFilters(item)).flatMap(
        ([key, copiedValue]) => {
          if (!key.startsWith("influence:") || copiedValue !== true) return [];
          const id = influenceTradeIds[key.slice("influence:".length)];
          return id
            ? [{
                id,
                ...(state.itemFilters[key] === true ? {} : { disabled: true }),
              }]
            : [];
        },
      );

  const propertyGroups: Partial<Record<
    "armour_filters" | "weapon_filters" | "map_filters",
    { filters: Record<string, unknown> }
  >> = {};
  const usedPropertyKeys = new Set<string>();
  for (const filter of officialProperties) {
    const reference = filter.equipmentProperty;
    if (!reference) continue;
    const identity = `${reference.group}.${reference.key}`;
    if (usedPropertyKeys.has(identity)) {
      warnings.push(`Duplicate calculated ${filter.label || identity} filter was ignored.`);
      continue;
    }
    const value = serializedTradeValue(filter);
    if (!value) continue;
    usedPropertyKeys.add(identity);
    const group = propertyGroups[reference.group] ||= { filters: {} };
    group.filters[reference.key] = value;
  }
  for (const [groupKey, propertyGroup] of Object.entries(propertyGroups)) {
    if (!propertyGroup) continue;
    const target = (state.filters[groupKey] ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    Object.assign(target.filters, propertyGroup.filters);
  }
  const enabledHeistProperties = (baseOnly ? [] : filters).filter((filter) =>
    filter.enabled && filter.tradeId?.startsWith("item.heist_")
  );
  for (const filter of enabledHeistProperties) {
    const tradeId = filter.tradeId!;
    const heistFilters = (state.filters.heist_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    if (tradeId === "item.heist_target_priceless") {
      heistFilters.filters.heist_objective_value = { option: "priceless" };
      continue;
    }
    const apiKey = HEIST_INTERNAL_API_KEYS[tradeId];
    const value = serializedTradeValue(filter);
    if (apiKey && value) heistFilters.filters[apiKey] = value;
  }
  const memoryStrandsFilter = (baseOnly ? [] : filters).find((filter) =>
    filter.tradeId === "item.memory_strands" && filter.enabled
  );
  if (
    memoryStrandsFilter &&
    typeof memoryStrandsFilter.min === "number" &&
    Number.isFinite(memoryStrandsFilter.min)
  ) {
    const miscFilters = (state.filters.misc_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    miscFilters.filters.memory_level = { min: memoryStrandsFilter.min };
  }
  if (
    status !== "securable" ||
    defaultsToChaosDivinePrice(item)
  ) {
    // APT's default API-collapse is independent of listing status for every
    // non-unique noncraftable/consumable family. This includes securable Maps,
    // Charts, Heist items, Invitations, Memories and Logbooks.
    const tradeFilters = (state.filters.trade_filters ||= { filters: {} }) as {
      filters: Record<string, unknown>;
    };
    tradeFilters.filters.collapse = { option: "true" };
  }

  const andStats = tradeStats.flatMap((stat) =>
    !stat.negated && stat.ids.length === 1
      ? [{
          id: stat.ids[0],
          ...(stat.values[0] ? { value: stat.values[0] } : {}),
          ...(stat.disabled ? { disabled: true } : {}),
        }]
      : [],
  );
  const alternativeStats = tradeStats.flatMap((stat) =>
    !stat.negated && stat.ids.length > 1
      ? [{
          type: "count",
          value: { min: 1 },
          ...(stat.disabled ? { disabled: true } : {}),
          filters: stat.ids.map((id, index) => ({
            id,
            ...(stat.values[index] ? { value: stat.values[index] } : {}),
            ...(stat.disabled ? { disabled: true } : {}),
          })),
        }]
      : [],
  );
  const veiledAndStats = veiledLogicalStats.flatMap((stat) =>
    stat.ids.length === 1
      ? [{
          id: stat.ids[0],
          ...(stat.disabled ? { disabled: true } : {}),
        }]
      : [],
  );
  const veiledAlternativeStats = veiledLogicalStats.flatMap((stat) =>
    stat.ids.length > 1
      ? [{
          type: "count",
          value: { min: 1 },
          ...(stat.disabled ? { disabled: true } : {}),
          filters: stat.ids.map((id) => ({
            id,
            ...(stat.disabled ? { disabled: true } : {}),
          })),
        }]
      : [],
  );
  const negatedStats = tradeStats.flatMap((stat) =>
    stat.negated
        ? stat.ids.map((id, index) => ({
          id,
          ...(stat.values[index] ? { value: stat.values[index] } : {}),
          ...(stat.disabled ? { disabled: true } : {}),
        }))
      : [],
  );
  const emptyAffixStats = emptyModifierFilters.flatMap((filter) => {
    const disabled = !filter.enabled;
    const option = filter.emptyModifier ?? 0;
    const emptyId = option === 1
      ? "pseudo.pseudo_number_of_empty_prefix_mods"
      : option === 2
        ? "pseudo.pseudo_number_of_empty_suffix_mods"
        : "pseudo.pseudo_number_of_empty_affix_mods";
    const craftedId = option === 1
      ? "pseudo.pseudo_number_of_crafted_prefix_mods"
      : option === 2
        ? "pseudo.pseudo_number_of_crafted_suffix_mods"
        : "pseudo.pseudo_number_of_crafted_mods";
    return [
      {
        type: "count",
        value: { min: 1, max: 1 },
        ...(disabled ? { disabled: true } : {}),
        filters: [
          {
            id: emptyId,
            value: { min: 1, max: 1 },
            ...(disabled ? { disabled: true } : {}),
          },
          {
            id: craftedId,
            value: { min: 1 },
            ...(disabled ? { disabled: true } : {}),
          },
        ],
      },
      {
        type: "count",
        value: { min: 1, max: 1 },
        ...(disabled ? { disabled: true } : {}),
        filters: [
          {
            id: emptyId,
            value: { min: 1, max: 1 },
            ...(disabled ? { disabled: true } : {}),
          },
          {
            id: "pseudo.pseudo_number_of_affix_mods",
            value: { min: 6 },
            ...(disabled ? { disabled: true } : {}),
          },
        ],
      },
    ];
  });
  const ordinaryQuery = {
    query: {
      status: { option: status },
      ...identityQuery,
      stats: [
        {
          type: "and",
          filters: [
            ...andStats,
            ...veiledAndStats,
            ...influenceStats,
          ],
        },
        ...emptyAffixStats,
        ...alternativeStats,
        ...veiledAlternativeStats,
        ...(negatedStats.length ? [{ type: "not", filters: negatedStats }] : []),
      ],
      filters: state.filters,
    },
    sort: { price: "asc" },
  };
  const requestedApi = officialTradeApiToSatisfySearch(item, filters);
  const activeStock = Number(state.itemFilters.stackSize);
  const exchangeQuery = requestedApi === "exchange"
    ? buildOfficialTradeExchangeQuery(
        item,
        status,
        Number.isSafeInteger(activeStock) && activeStock > 0
          ? activeStock
          : undefined,
      )
    : undefined;
  const tradeApi = exchangeQuery ? "exchange" as const : "trade" as const;
  const query = exchangeQuery || ordinaryQuery;
  const tradeUrl = buildOfficialTradeBrowserUrl({
    league,
    tradeQuery: query,
    api: tradeApi,
  });

  return {
    identity: identityState.active,
    identityState,
    league,
    status,
    rollTolerance,
    filters,
    itemFilters: state.itemFilters,
    tradeQuery: query,
    tradeUrl,
    tradeApi,
    warnings,
  };
}

export const planPriceCheckQuery = buildPriceCheckQueryPlan;
