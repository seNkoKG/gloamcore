import { officialTradeStatIds } from "./trade-stat-id";
import { armourBaseProfile, resolveMagicBaseType } from "./magic-base-type";
import type {
  ParsedPoeItem,
  ParsedPoeModifier,
  PriceCheckModifierFilter,
} from "./types";

type EquipmentPropertyReference = NonNullable<
  PriceCheckModifierFilter["equipmentProperty"]
>;

export interface EquipmentPropertyPlan {
  filters: PriceCheckModifierFilter[];
  warnings: string[];
  /** Local modifier rows represented by a calculated equipment total. */
  consumedModifierIds: string[];
}

const OFFICIAL_KEYS: Record<
  EquipmentPropertyReference["group"],
  ReadonlySet<EquipmentPropertyReference["key"]>
> = {
  armour_filters: new Set([
    "ar",
    "ev",
    "es",
    "ward",
    "block",
    "base_defence_percentile",
  ]),
  weapon_filters: new Set([
    "damage",
    "aps",
    "crit",
    "dps",
    "pdps",
    "edps",
  ]),
  map_filters: new Set(["map_iiq", "map_iir", "map_packsize", "chart_sulphur"]),
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function rounded(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function propertyValue(item: ParsedPoeItem, label: string) {
  const target = label.toLowerCase();
  return Object.entries(item.properties).find(
    ([key]) => key.trim().toLowerCase() === target,
  )?.[1];
}

function withoutAnnotations(value: string) {
  return value
    .replace(/\s+\((?:augmented|unmet|gem|implicit)\)/gi, "")
    .trim();
}

/** Strictly parses one copied scalar and rejects joined/partially understood text. */
function scalarProperty(item: ParsedPoeItem, label: string) {
  const raw = propertyValue(item, label);
  if (!raw || /[\n\r]/.test(raw)) return undefined;
  const cleaned = withoutAnnotations(raw);
  const match = /^\+?([0-9][\d,]*(?:\.\d+)?)%?$/.exec(cleaned);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ""));
  return finite(value) && value >= 0 ? value : undefined;
}

/** Returns the average hit after summing each copied damage range exactly once. */
function averageDamageProperty(item: ParsedPoeItem, label: string) {
  const raw = propertyValue(item, label);
  if (!raw || /[\n\r]/.test(raw)) return undefined;
  const ranges = withoutAnnotations(raw).split(/\s*,\s*/);
  if (!ranges.length) return undefined;
  let total = 0;
  for (const range of ranges) {
    const match = /^([0-9][\d,]*(?:\.\d+)?)\s*[\u002d\u2013\u2014]\s*([0-9][\d,]*(?:\.\d+)?)$/.exec(
      range,
    );
    if (!match) return undefined;
    const low = Number(match[1].replace(/,/g, ""));
    const high = Number(match[2].replace(/,/g, ""));
    if (![low, high].every(finite) || low < 0 || high < low) return undefined;
    total += (low + high) / 2;
  }
  return rounded(total);
}

function clampedTolerance(value: number) {
  if (!Number.isFinite(value)) return 10;
  return Math.max(0, Math.min(50, Math.round(value)));
}

function propertyDecimalPlaces(value: number, decimalPrecision: boolean) {
  if (!decimalPrecision || Math.abs(value) >= 10) return 0;
  return Math.abs(value) < 2.3 ? 2 : 1;
}

function roundedPropertyValue(value: number, decimalPrecision = false) {
  const scale = 10 ** propertyDecimalPlaces(value, decimalPrecision);
  return Math.trunc(value * scale) / scale;
}

function roundedPropertyEndpoint(
  value: number,
  method: typeof Math.floor | typeof Math.ceil,
  decimalPrecision = false,
  precisionReference = value,
) {
  const scale = 10 ** propertyDecimalPlaces(
    precisionReference,
    decimalPrecision,
  );
  return method((value + Number.EPSILON) * scale) / scale;
}

function rangeMinimum(
  value: number,
  tolerance: number,
  decimalPrecision = false,
  toleranceDelta = Math.abs(value),
) {
  return roundedPropertyEndpoint(
    Math.max(0, value - Math.abs(toleranceDelta) * tolerance / 100),
    Math.floor,
    decimalPrecision,
    value,
  );
}

const LOCAL_DEFENCE_PATTERNS = {
  armour: {
    flat: new Set(["# to armour"]),
    increased: new Set([
      "#% increased armour",
      "#% increased armour and energy shield",
      "#% increased armour and evasion",
      "#% increased armour, evasion and energy shield",
    ]),
  },
  evasion: {
    flat: new Set(["# to evasion rating"]),
    increased: new Set([
      "#% increased evasion rating",
      "#% increased armour and evasion",
      "#% increased evasion and energy shield",
      "#% increased armour, evasion and energy shield",
    ]),
  },
  energyShield: {
    flat: new Set(["# to maximum energy shield"]),
    increased: new Set([
      "#% increased energy shield",
      "#% increased armour and energy shield",
      "#% increased evasion and energy shield",
      "#% increased armour, evasion and energy shield",
    ]),
  },
  ward: {
    flat: new Set(["# to ward"]),
    increased: new Set(["#% increased ward"]),
  },
} as const;

function localPropertyPattern(modifier: ParsedPoeModifier) {
  return modifier.normalizedText.trim().toLowerCase().replace(/^\+/, "");
}

interface PropertyRollBounds {
  min: number;
  max: number;
}

interface InlineAdvancedRoll extends PropertyRollBounds {
  value: number;
  decimal: boolean;
  ranged: boolean;
}

function parsedNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return finite(parsed) ? parsed : undefined;
}

/**
 * Extracts only endpoints copied by Path of Exile's Advanced Description.
 * Catalog guesses are deliberately excluded: calculated-property clamping is
 * safe only when the clipboard proves every contributing local roll.
 */
function inlineAdvancedRolls(modifier: ParsedPoeModifier) {
  if (!modifier.advanced) return [];
  const matches = modifier.text.matchAll(
    /([-+]?\d[\d,]*(?:\.\d+)?)(?:\s*\(\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*[\u002d\u2013\u2014\u2212]\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*\))?/g,
  );
  const rolls: InlineAdvancedRoll[] = [];
  for (const match of matches) {
    const value = parsedNumber(match[1]);
    const left = match[2] == null ? value : parsedNumber(match[2]);
    const right = match[3] == null ? value : parsedNumber(match[3]);
    if (![value, left, right].every(finite)) return [];
    rolls.push({
      value: value!,
      min: Math.min(value!, left!, right!),
      max: Math.max(value!, left!, right!),
      decimal: [match[1], match[2], match[3]].some(
        (token) => token?.includes("."),
      ),
      ranged: match[2] != null && match[3] != null,
    });
  }
  return rolls;
}

function copiedRollBounds(
  modifier: ParsedPoeModifier,
  value: number,
  averagePair = false,
): PropertyRollBounds | undefined {
  const rolls = inlineAdvancedRolls(modifier);
  const expected = averagePair ? 2 : 1;
  if (rolls.length !== expected) return undefined;
  const copied = averagePair
    ? (rolls[0].value + rolls[1].value) / 2
    : rolls[0].value;
  if (Math.abs(copied - value) > 1e-7) return undefined;
  if (averagePair) {
    return {
      min: (rolls[0].min + rolls[1].min) / 2,
      max: (rolls[0].max + rolls[1].max) / 2,
    };
  }
  return { min: rolls[0].min, max: rolls[0].max };
}

function increasedRoll(value: number, percent: number, decimal: boolean) {
  const scale = decimal ? 100 : 1;
  return Math.trunc(
    (value + value * percent / 100 + Number.EPSILON) * scale,
  ) / scale;
}

function propertySourceRoll(
  modifier: ParsedPoeModifier,
  averagePair: boolean,
) {
  const value = averageModifierValue(modifier);
  if (!finite(value)) return undefined;
  const rolls = inlineAdvancedRolls(modifier);
  const expected = averagePair ? 2 : 1;
  let bounds = modifier.tradeBounds || copiedRollBounds(
    modifier,
    value,
    averagePair,
  );
  const resolved = Boolean(modifier.tradeId || modifier.tradeIds?.length);
  if (
    resolved &&
    !bounds &&
    rolls.length === expected &&
    rolls.every((roll) => !roll.ranged)
  ) {
    bounds = { min: value, max: value };
  }
  if (resolved || !modifier.rollIncr || modifier.unscalable) {
    return { value, bounds };
  }
  const decimal = Boolean(modifier.tradeDecimalPrecision) ||
    rolls.some((roll) => roll.decimal);
  return {
    value: increasedRoll(value, modifier.rollIncr, decimal),
    bounds: bounds && {
      min: increasedRoll(bounds.min, modifier.rollIncr, decimal),
      max: increasedRoll(bounds.max, modifier.rollIncr, decimal),
    },
  };
}

interface PropertyProjection {
  value: number;
  base: number;
  bounds?: PropertyRollBounds;
  consumedModifierIds: string[];
}

/**
 * Reconstructs the local base Energy Shield from copied advanced local rolls,
 * then projects their proven roll endpoints at Trade's comparison quality.
 * This is the same information Awakened uses to keep a calculated ES search
 * inside the attainable range instead of applying tolerance to the total only.
 */
function projectLocalProperty(
  item: ParsedPoeItem,
  copiedTotal: number,
  patterns: {
    flat: ReadonlySet<string>;
    increased: ReadonlySet<string>;
  },
  atMaximumQuality: boolean,
): PropertyProjection | undefined {
  const sources = item.modifiers.flatMap((modifier) => {
    if (!modifier.advanced) return [];
    const pattern = localPropertyPattern(modifier);
    const kind = patterns.flat.has(pattern)
      ? "flat"
      : patterns.increased.has(pattern)
        ? "increased"
        : undefined;
    if (!kind) return [];
    const averagePair = pattern.startsWith("adds # to # ");
    const roll = propertySourceRoll(modifier, averagePair);
    if (!roll) return [];
    return [{
      modifier,
      kind,
      value: roll.value,
      bounds: roll.bounds,
    }];
  });
  const sumValue = (kind: "flat" | "increased") =>
    sources
      .filter((source) => source.kind === kind)
      .reduce((total, source) => total + source.value, 0);
  const sumBound = (
    kind: "flat" | "increased",
    key: keyof PropertyRollBounds,
  ) => sources
    .filter((source) => source.kind === kind)
    .reduce((total, source) => total + source.bounds![key], 0);
  const currentFlat = sumValue("flat");
  const currentIncreased = sumValue("increased");
  const currentQuality = atMaximumQuality
    ? Math.max(0, item.quality || 0)
    : 0;
  const targetQuality = atMaximumQuality
    ? Math.max(20, currentQuality)
    : 0;
  const currentIncreasedFactor = 1 + currentIncreased / 100;
  if (currentIncreasedFactor <= 0) return undefined;
  const base = copiedTotal /
    (1 + currentQuality / 100) /
    currentIncreasedFactor -
    currentFlat;
  // Copied integer properties can reconstruct a slightly negative base when
  // the game rounded the displayed total. Awakened accepts every finite base
  // here and applies the copied local endpoints to that same reconstruction.
  if (!finite(base)) return undefined;

  const project = (flat: number, increased: number) =>
    (base + flat) *
    (1 + increased / 100) *
    (1 + targetQuality / 100);
  const projectedValue = project(currentFlat, currentIncreased);
  if (!finite(projectedValue)) return undefined;
  // In a complete Advanced Description, the absence of a contributing local
  // stat is itself exact evidence: Awakened gives that component min=max at
  // the copied property. A present source still requires copied endpoints.
  // APT's forced Advanced copy makes the absence of contributing local mods
  // exact evidence. A base-only defence therefore projects min=max at Q20.
  const allSourcesBounded = sources.length === 0 ||
    sources.every((source) => source.bounds != null);
  const projectedMinimum = allSourcesBounded
    ? project(sumBound("flat", "min"), sumBound("increased", "min"))
    : undefined;
  const projectedMaximum = allSourcesBounded
    ? project(sumBound("flat", "max"), sumBound("increased", "max"))
    : undefined;
  const hasFiniteBounds = finite(projectedMinimum) && finite(projectedMaximum);
  return {
    value: projectedValue,
    base,
    ...(hasFiniteBounds
      ? {
          bounds: {
            min: Math.min(projectedMinimum, projectedMaximum),
            max: Math.max(projectedMinimum, projectedMaximum),
          },
        }
      : {}),
    consumedModifierIds: sources.map(({ modifier }) => modifier.id),
  };
}

function projectEnergyShield(item: ParsedPoeItem, copiedTotal: number) {
  return projectLocalProperty(
    item,
    copiedTotal,
    LOCAL_DEFENCE_PATTERNS.energyShield,
    true,
  );
}

function projectDefence(
  item: ParsedPoeItem,
  copiedTotal: number,
  patterns: {
    flat: ReadonlySet<string>;
    increased: ReadonlySet<string>;
  },
) {
  return projectLocalProperty(item, copiedTotal, patterns, true);
}

function equipmentFilter({
  item,
  id,
  label,
  value,
  group,
  key,
  enabled,
  importance,
  tolerance,
  explanation,
  bounds,
  advancedOnly,
  decimalPrecision,
}: {
  item: ParsedPoeItem;
  id: string;
  label: string;
  value: number;
  group: EquipmentPropertyReference["group"];
  key: EquipmentPropertyReference["key"];
  enabled: boolean;
  importance: PriceCheckModifierFilter["importance"];
  tolerance: number;
  explanation: string;
  bounds?: PropertyRollBounds;
  advancedOnly?: boolean;
  decimalPrecision?: boolean;
}): PriceCheckModifierFilter {
  const copiedValue = roundedPropertyValue(value, decimalPrecision);
  const normalizedBounds = bounds
    ? {
        min: roundedPropertyEndpoint(bounds.min, Math.floor, decimalPrecision),
        max: roundedPropertyEndpoint(bounds.max, Math.ceil, decimalPrecision),
      }
    : undefined;
  const variableBounds = bounds != null &&
    Math.abs(bounds.max - bounds.min) > 1e-7;
  const uniqueRollSpan = item.rarity === "unique" && bounds
    ? Math.max(0, bounds.max - bounds.min)
    : undefined;
  const perfectUniqueRoll = item.rarity === "unique" && bounds != null &&
    value >= bounds.max;
  // Awakened creates calculated properties as pseudo stats first. Its unique
  // invariant pass hides a property whenever the proven roll has no variable
  // span, before the row is retagged as a Property. Keep the row in the query
  // model (and preserve its upstream enabled default), but mark it advanced so
  // compact editors expose the same non-hidden set and total denominator.
  const invariantUniqueProperty = item.rarity === "unique" && !variableBounds;
  const exposedBounds = item.rarity === "unique" &&
      variableBounds && normalizedBounds
    ? normalizedBounds
    : undefined;
  const fixedMagicRoll = item.rarity === "magic" &&
    Boolean(item.unmodifiable || item.corrupted || item.mirrored);
  const effectiveTolerance = perfectUniqueRoll || fixedMagicRoll
    ? 0
    : tolerance;
  const toleranceMinimum = rangeMinimum(
    value,
    effectiveTolerance,
    decimalPrecision,
    uniqueRollSpan,
  );
  const minimum = normalizedBounds
    ? Math.max(toleranceMinimum, normalizedBounds.min)
    : toleranceMinimum;
  const displayedValue = key === "block" ||
      key === "base_defence_percentile" || key === "crit"
    ? `${copiedValue}%`
    : String(copiedValue);
  return {
    modifierId: `property:${id}`,
    label: `${label}: ${displayedValue}`,
    copiedValue,
    equipmentProperty: { group, key },
    enabled,
    mode: "range",
    ...(!invariantUniqueProperty ? { min: minimum } : {}),
    ...(exposedBounds ? { bounds: exposedBounds } : {}),
    ...(advancedOnly || invariantUniqueProperty ? { advancedOnly: true } : {}),
    direction: 1,
    importance,
    explanation,
  };
}

// Awakened intentionally treats local physical DPS as price-defining only on
// these attack-focused weapon families; caster and niche weapon classes keep
// the option visible without enabling it automatically.
function physicalDamageIsDefault(item: ParsedPoeItem) {
  return /(?:axes|swords|bows|warstaves)/i.test(item.itemClass);
}

const LOCAL_WEAPON_PROPERTY_PATTERNS = new Set([
  "adds # to # physical damage",
  "#% increased physical damage",
  "#% increased physical damage and accuracy rating",
  "#% increased attack speed",
  "#% increased critical strike chance",
  "adds # to # fire damage",
  "adds # to # cold damage",
  "adds # to # lightning damage",
]);

const LOCAL_PHYSICAL_DAMAGE_PATTERNS = {
  flat: new Set(["adds # to # physical damage"]),
  increased: new Set([
    "#% increased physical damage",
    "#% increased physical damage and accuracy rating",
  ]),
} as const;

const LOCAL_ELEMENTAL_DAMAGE_PATTERNS = {
  flat: new Set([
    "adds # to # fire damage",
    "adds # to # cold damage",
    "adds # to # lightning damage",
  ]),
  increased: new Set<string>(),
} as const;

const LOCAL_ATTACK_SPEED_PATTERNS = {
  flat: new Set<string>(),
  increased: new Set(["#% increased attack speed"]),
} as const;

const LOCAL_CRITICAL_CHANCE_PATTERNS = {
  flat: new Set<string>(),
  increased: new Set(["#% increased critical strike chance"]),
} as const;

const LOCAL_BLOCK_PATTERNS = {
  flat: new Set(["#% chance to block"]),
  increased: new Set<string>(),
} as const;

const LOCAL_ARMOUR_PROPERTY_PATTERNS = new Set([
  ...LOCAL_DEFENCE_PATTERNS.armour.flat,
  ...LOCAL_DEFENCE_PATTERNS.armour.increased,
  ...LOCAL_DEFENCE_PATTERNS.evasion.flat,
  ...LOCAL_DEFENCE_PATTERNS.evasion.increased,
  ...LOCAL_DEFENCE_PATTERNS.energyShield.flat,
  ...LOCAL_DEFENCE_PATTERNS.energyShield.increased,
  ...LOCAL_DEFENCE_PATTERNS.ward.flat,
  ...LOCAL_DEFENCE_PATTERNS.ward.increased,
  ...LOCAL_BLOCK_PATTERNS.flat,
]);

function averageModifierValue(modifier: ParsedPoeModifier) {
  const values = modifier.values.filter(finite);
  if (!values.length) return undefined;
  return values.length >= 2
    ? (values[0] + values[1]) / 2
    : values[0];
}

function projectPhysicalDamage(
  item: ParsedPoeItem,
  copiedTotal: number,
) {
  return projectLocalProperty(
    item,
    copiedTotal,
    LOCAL_PHYSICAL_DAMAGE_PATTERNS,
    true,
  );
}

function multipliedBounds(
  left: PropertyProjection | undefined,
  right: PropertyProjection | undefined,
) {
  if (!left?.bounds || !right?.bounds) return undefined;
  return {
    min: left.bounds.min * right.bounds.min,
    max: left.bounds.max * right.bounds.max,
  };
}

function summedBounds(
  left: PropertyRollBounds | undefined,
  right: PropertyRollBounds | undefined,
) {
  if (!left || !right) return undefined;
  return {
    min: left.min + right.min,
    max: left.max + right.max,
  };
}

/**
 * Plans only values that match GGG's calculated equipment-filter semantics.
 * Defence and physical weapon totals are projected to at least 20% quality,
 * matching Awakened's calculated-property comparison semantics.
 */
export function planEquipmentPropertyFilters(
  item: ParsedPoeItem,
  rollTolerance = 10,
  includeBasePercentile = /^emperor's vigilance$/i.test(item.name.trim()),
): EquipmentPropertyPlan {
  const tolerance = clampedTolerance(rollTolerance);
  const filters: PriceCheckModifierFilter[] = [];
  const warnings: string[] = [];
  const consumedModifierIds: string[] = [];
  const armour = scalarProperty(item, "Armour");
  const armourProjection = finite(armour)
    ? projectDefence(item, armour, LOCAL_DEFENCE_PATTERNS.armour)
    : undefined;
  const evasion = scalarProperty(item, "Evasion Rating");
  const evasionProjection = finite(evasion)
    ? projectDefence(item, evasion, LOCAL_DEFENCE_PATTERNS.evasion)
    : undefined;
  const energyShield = scalarProperty(item, "Energy Shield");
  const energyShieldProjection = finite(energyShield)
    ? projectEnergyShield(item, energyShield)
    : undefined;
  const ward = scalarProperty(item, "Ward");
  const wardProjection = finite(ward)
    ? projectDefence(item, ward, LOCAL_DEFENCE_PATTERNS.ward)
    : undefined;
  const block = scalarProperty(item, "Chance to Block");
  const blockProjection = finite(block)
    ? projectLocalProperty(item, block, LOCAL_BLOCK_PATTERNS, false)
    : undefined;
  const defences = [armour, evasion, energyShield, ward].filter(finite);
  const hasCopiedDefence = defences.length > 0;

  if (hasCopiedDefence) {
    const singleDefence = defences.length === 1;
    const addDefence = (
      id: string,
      label: string,
      value: number | undefined,
      key: EquipmentPropertyReference["key"],
      bounds?: { min: number; max: number },
    ) => {
      if (!finite(value)) return;
      filters.push(equipmentFilter({
        item,
        id,
        label,
        value,
        group: "armour_filters",
        key,
        enabled: singleDefence,
        importance: singleDefence ? "key" : "useful",
        tolerance,
        bounds,
        explanation: singleDefence
          ? "Primary defence projected to Awakened's maximum-quality comparison."
          : "Hybrid defence projected to maximum quality; optional to avoid over-constraining the search.",
      }));
    };
    addDefence(
      "armour",
      "Armour",
      armourProjection?.value ?? armour,
      "ar",
      armourProjection?.bounds,
    );
    addDefence(
      "evasion",
      "Evasion Rating",
      evasionProjection?.value ?? evasion,
      "ev",
      evasionProjection?.bounds,
    );
    addDefence(
      "energy-shield",
      "Energy Shield",
      energyShieldProjection?.value ?? energyShield,
      "es",
      energyShieldProjection?.bounds,
    );
    addDefence(
      "ward",
      "Ward",
      wardProjection?.value ?? ward,
      "ward",
      wardProjection?.bounds,
    );
    for (const projection of [
      armourProjection,
      evasionProjection,
      energyShieldProjection,
      wardProjection,
    ]) {
      if (projection) consumedModifierIds.push(...projection.consumedModifierIds);
    }
  }

  if (finite(block)) {
    filters.push(equipmentFilter({
      item,
      id: "block",
      label: "Block",
      value: blockProjection?.value ?? block,
      group: "armour_filters",
      key: "block",
      enabled: false,
      importance: "optional",
      tolerance,
      bounds: blockProjection?.bounds,
      explanation: "Copied local block total; available but disabled by default.",
    }));
    if (blockProjection) {
      consumedModifierIds.push(...blockProjection.consumedModifierIds);
    }
  }
  if (hasCopiedDefence || finite(block)) {
    consumedModifierIds.push(...item.modifiers
      .filter((modifier) =>
        LOCAL_ARMOUR_PROPERTY_PATTERNS.has(localPropertyPattern(modifier))
      )
      .map((modifier) => modifier.id));
  }
  if (hasCopiedDefence) {
    const copiedBaseType = item.rarity === "magic" &&
        (!item.baseType || item.baseType === item.name)
      ? resolveMagicBaseType(item.name)
      : item.baseType;
    const profile = armourBaseProfile(copiedBaseType || item.name, item);
    const candidates: Array<[
      PropertyProjection | undefined,
      [number, number] | undefined,
    ]> = [
      [armourProjection, profile?.ar],
      [evasionProjection, profile?.ev],
      [energyShieldProjection, profile?.es],
      [wardProjection, profile?.ward],
    ];
    const base = candidates.find(([projection, bounds]) => projection && bounds);
    if (includeBasePercentile && base?.[0] && base[1]) {
      const [minimum, maximum] = base[1];
      const percentile = maximum === minimum
        ? 100
        : Math.max(0, Math.min(100, Math.round(
            ((base[0].base - minimum) / (maximum - minimum)) * 100,
          )));
      filters.push(equipmentFilter({
        item,
        id: "base-percentile",
        label: "Base Percentile",
        value: percentile,
        group: "armour_filters",
        key: "base_defence_percentile",
        enabled: percentile >= 50,
        importance: percentile >= 50 ? "useful" : "optional",
        tolerance,
        bounds: { min: 0, max: 100 },
        explanation: "Base defence roll percentile reconstructed from Awakened's pinned base range.",
      }));
    }
  }

  const aps = scalarProperty(item, "Attacks per Second");
  const crit = scalarProperty(item, "Critical Strike Chance");
  const physical = averageDamageProperty(item, "Physical Damage");
  const elemental = averageDamageProperty(item, "Elemental Damage");
  const apsProjection = finite(aps)
    ? projectLocalProperty(item, aps, LOCAL_ATTACK_SPEED_PATTERNS, false)
    : undefined;
  const critProjection = finite(crit)
    ? projectLocalProperty(item, crit, LOCAL_CRITICAL_CHANCE_PATTERNS, false)
    : undefined;
  const physicalProjection = finite(physical)
    ? projectPhysicalDamage(item, physical)
    : undefined;
  const elementalProjection = finite(elemental)
    ? projectLocalProperty(
        item,
        elemental,
        LOCAL_ELEMENTAL_DAMAGE_PATTERNS,
        false,
      )
    : undefined;
  const safePhysical = physicalProjection?.value;
  const safeElemental = elementalProjection?.value;
  for (const projection of [
    apsProjection,
    critProjection,
    physicalProjection,
    elementalProjection,
  ]) {
    if (projection) {
      consumedModifierIds.push(...projection.consumedModifierIds);
    }
  }
  if ([aps, crit, physical, elemental].some(finite)) {
    consumedModifierIds.push(...item.modifiers
      .filter((modifier) =>
        LOCAL_WEAPON_PROPERTY_PATTERNS.has(localPropertyPattern(modifier))
      )
      .map((modifier) => modifier.id));
  }

  if (finite(aps)) {
    filters.push(equipmentFilter({
      item,
      id: "weapon-aps",
      label: "Attacks per Second",
      value: apsProjection?.value ?? aps,
      group: "weapon_filters",
      key: "aps",
      enabled: false,
      importance: "useful",
      tolerance,
      bounds: apsProjection?.bounds,
      decimalPrecision: true,
      explanation: "Copied local attack rate; available but disabled by default.",
    }));
  }
  if (finite(crit)) {
    filters.push(equipmentFilter({
      item,
      id: "weapon-crit",
      label: "Critical Strike Chance",
      value: critProjection?.value ?? crit,
      group: "weapon_filters",
      key: "crit",
      enabled: false,
      importance: "useful",
      tolerance,
      bounds: critProjection?.bounds,
      decimalPrecision: true,
      explanation: "Copied local critical chance; available but disabled by default.",
    }));
  }

  const hasSafePhysical = finite(safePhysical);
  const hasElemental = finite(safeElemental);
  const safeAps = apsProjection?.value ?? aps;
  const physicalDps = hasSafePhysical && finite(safeAps)
    ? safePhysical * safeAps
    : undefined;
  const elementalDps = hasElemental && finite(safeAps)
    ? safeElemental * safeAps
    : undefined;
  // Awakened exposes Total DPS only for genuinely hybrid weapons. Pure
  // physical and pure elemental weapons use their dedicated DPS row instead.
  // Copied chaos damage is intentionally not part of Awakened's weapon DPS
  // property model and does not suppress the physical/elemental comparison.
  const totalDps = hasSafePhysical && hasElemental && finite(safeAps)
    ? (safePhysical + safeElemental) * safeAps
    : undefined;
  const physicalDpsBounds = multipliedBounds(
    physicalProjection,
    apsProjection,
  );
  const elementalDpsBounds = multipliedBounds(
    elementalProjection,
    apsProjection,
  );
  const totalDpsBounds = summedBounds(
    physicalDpsBounds,
    elementalDpsBounds,
  );

  if (finite(totalDps)) {
    filters.push(equipmentFilter({
      item,
      id: "weapon-dps",
      label: "Total DPS",
      value: totalDps,
      group: "weapon_filters",
      key: "dps",
      enabled: hasSafePhysical && hasElemental,
      importance: hasSafePhysical && hasElemental ? "key" : "useful",
      tolerance,
      bounds: totalDpsBounds,
      explanation: "Physical plus elemental average hit multiplied by copied attacks per second.",
    }));
  }
  if (finite(physicalDps)) {
    const share = finite(totalDps) && totalDps > 0 ? physicalDps / totalDps : 1;
    const enabled = physicalDamageIsDefault(item) && share >= 0.67;
    filters.push(equipmentFilter({
      item,
      id: "weapon-physical-dps",
      label: "Physical DPS",
      value: physicalDps,
      group: "weapon_filters",
      key: "pdps",
      enabled,
      importance: enabled ? "key" : "useful",
      tolerance,
      bounds: physicalDpsBounds,
      advancedOnly: share < 0.67,
      explanation: "Maximum-quality physical average hit multiplied by copied attacks per second.",
    }));
  }
  if (finite(elementalDps)) {
    const share = finite(totalDps) && totalDps > 0 ? elementalDps / totalDps : 1;
    const enabled = share >= 0.67;
    filters.push(equipmentFilter({
      item,
      id: "weapon-elemental-dps",
      label: "Elemental DPS",
      value: elementalDps,
      group: "weapon_filters",
      key: "edps",
      enabled,
      importance: enabled ? "key" : "useful",
      tolerance,
      bounds: elementalDpsBounds,
      advancedOnly: share < 0.67,
      explanation: "Summed elemental average hit multiplied by copied attacks per second.",
    }));
  }

  const weaponPropertyOrder = new Map<EquipmentPropertyReference["key"], number>([
    ["dps", 0],
    ["edps", 1],
    ["pdps", 2],
    ["aps", 3],
    ["crit", 4],
  ]);
  const orderedFilters = [
    ...filters.filter((filter) => filter.equipmentProperty?.group !== "weapon_filters"),
    ...filters
      .filter((filter) => filter.equipmentProperty?.group === "weapon_filters")
      .sort((left, right) =>
        (weaponPropertyOrder.get(left.equipmentProperty!.key) ?? Number.MAX_SAFE_INTEGER) -
        (weaponPropertyOrder.get(right.equipmentProperty!.key) ?? Number.MAX_SAFE_INTEGER)
      ),
  ];
  return {
    filters: orderedFilters,
    warnings,
    consumedModifierIds: [...new Set(consumedModifierIds)],
  };
}

export function isEquipmentPropertyFilter(
  filter: PriceCheckModifierFilter,
): filter is PriceCheckModifierFilter & {
  equipmentProperty: EquipmentPropertyReference;
} {
  const reference = filter.equipmentProperty;
  return Boolean(
    reference && OFFICIAL_KEYS[reference.group]?.has(reference.key),
  );
}

export function isOfficialPriceCheckFilter(filter: PriceCheckModifierFilter) {
  if (filter.emptyModifier != null) return true;
  if (isEquipmentPropertyFilter(filter)) {
    return filter.mode !== "presence" &&
      (finite(filter.min) || finite(filter.max));
  }
  return officialTradeStatIds(filter).length > 0;
}
