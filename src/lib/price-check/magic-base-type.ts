import pack from "./base-types-v1.json";
import type { ParsedPoeItem } from "./types";

export type UniqueModifierMetadataPolicy =
  | "source-bounds-only"
  | "all-explicit-variants"
  | "non-fixed-explicit-variants";

interface MagicBaseTypePack {
  schema: number;
  source?: { commit?: string };
  baseTypes?: string[];
  itemProfiles?: Record<string, Array<{
    sourceIndex: number;
    name: string;
    icon?: string;
    disc?: PinnedVariantDiscriminator;
    craftable?: {
      category: string;
      corrupted?: true;
      uniqueOnly?: true;
    };
    armour?: {
      ar?: [number, number];
      ev?: [number, number];
      es?: [number, number];
      ward?: [number, number];
    };
  }>>;
  uniqueProfiles?: Record<string, Array<{
    sourceIndex: number;
    name: string;
    baseType?: string;
    icon?: string;
    disc?: PinnedVariantDiscriminator;
    fixedStats?: string[];
    modifierPolicy?: UniqueModifierMetadataPolicy;
  }>>;
  gemProfiles?: Record<string, {
    maxLevel?: number;
    transfigured?: boolean;
    normalVariant?: string;
    tradeDisc?: string;
  }>;
  itemTradeDiscriminators?: Record<string, string>;
  mapAreaTradeDiscriminators?: Record<string, string>;
  tradeTags?: Record<string, string>;
  exchangeableWithoutTradeTag?: string[];
}

export interface PinnedVariantDiscriminator {
  propAR?: true;
  propEV?: true;
  propES?: true;
  mapTier?: "W" | "Y" | "R";
  hasImplicit?: { ref: string };
  hasExplicit?: { ref: string };
  sectionText?: string;
}

export interface PinnedVariantSelectionContext {
  baseType?: string;
  properties?: Record<string, string>;
  mapTier?: number;
  modifiers?: ParsedPoeItem["modifiers"];
  rawText?: string;
}

interface PinnedItemVariant {
  sourceIndex: number;
  name: string;
  icon?: string;
  disc?: PinnedVariantDiscriminator;
  craftable?: {
    category: string;
    corrupted?: true;
    uniqueOnly?: true;
  };
  armour?: {
    ar?: [number, number];
    ev?: [number, number];
    es?: [number, number];
    ward?: [number, number];
  };
}

interface PinnedUniqueVariant {
  sourceIndex: number;
  name: string;
  baseType?: string;
  icon?: string;
  disc?: PinnedVariantDiscriminator;
  fixedStats?: string[];
  modifierPolicy?: UniqueModifierMetadataPolicy;
}

const EXPECTED_COMMIT = "adb6c287bd978a70701e2b65d744dd677c52fb65";
const candidatePack = pack as unknown as MagicBaseTypePack;
const baseTypes = new Set(
  candidatePack.schema === 2 &&
  candidatePack.source?.commit === EXPECTED_COMMIT &&
  Array.isArray(candidatePack.baseTypes)
    ? candidatePack.baseTypes
    : [],
);
const uniqueProfiles = candidatePack.schema === 2 &&
candidatePack.source?.commit === EXPECTED_COMMIT &&
candidatePack.uniqueProfiles &&
typeof candidatePack.uniqueProfiles === "object"
  ? candidatePack.uniqueProfiles as Record<string, PinnedUniqueVariant[]>
  : {};
const itemProfiles = candidatePack.schema === 2 &&
candidatePack.source?.commit === EXPECTED_COMMIT &&
candidatePack.itemProfiles &&
typeof candidatePack.itemProfiles === "object"
  ? candidatePack.itemProfiles as Record<string, PinnedItemVariant[]>
  : {};
const tradeTags = candidatePack.schema === 2 &&
candidatePack.source?.commit === EXPECTED_COMMIT &&
candidatePack.tradeTags &&
typeof candidatePack.tradeTags === "object"
  ? candidatePack.tradeTags
  : {};
const gemProfiles = candidatePack.schema === 2 &&
candidatePack.source?.commit === EXPECTED_COMMIT &&
candidatePack.gemProfiles &&
typeof candidatePack.gemProfiles === "object"
  ? candidatePack.gemProfiles
  : {};
const itemTradeDiscriminators = candidatePack.schema === 2 &&
candidatePack.source?.commit === EXPECTED_COMMIT &&
candidatePack.itemTradeDiscriminators &&
typeof candidatePack.itemTradeDiscriminators === "object"
  ? candidatePack.itemTradeDiscriminators
  : {};
const mapAreaTradeDiscriminators = candidatePack.schema === 2 &&
candidatePack.source?.commit === EXPECTED_COMMIT &&
candidatePack.mapAreaTradeDiscriminators &&
typeof candidatePack.mapAreaTradeDiscriminators === "object"
  ? candidatePack.mapAreaTradeDiscriminators
  : {};
const exchangeableWithoutTradeTag = new Set(
  candidatePack.schema === 2 &&
  candidatePack.source?.commit === EXPECTED_COMMIT &&
  Array.isArray(candidatePack.exchangeableWithoutTradeTag)
    ? candidatePack.exchangeableWithoutTradeTag
    : [],
);

function cleanItemIdentity(value: string | undefined) {
  return String(value || "")
    .replace(/^Foulborn\s+/i, "")
    .trim();
}

function candidateItemIdentities(...values: Array<string | undefined>) {
  return [...new Set(values.map(cleanItemIdentity).filter(Boolean))];
}

function propertyIsPresent(
  context: PinnedVariantSelectionContext,
  label: string,
) {
  return Object.entries(context.properties || {}).some(
    ([key, value]) => key.trim().toLowerCase() === label && Boolean(value),
  );
}

/**
 * Applies Awakened's source-ordered variant resolver. Copied base filtering is
 * performed first, then every matching discriminator replaces the selection,
 * so the last matching source record wins exactly as it does upstream.
 */
export function pickCorrectPinnedVariant<
  T extends { disc?: PinnedVariantDiscriminator; baseType?: string },
>(
  variants: readonly T[],
  context: PinnedVariantSelectionContext = {},
  copiedBase = context.baseType,
): T | undefined {
  const cleanBase = cleanItemIdentity(copiedBase);
  const candidates = cleanBase && variants.some((variant) => variant.baseType != null)
    ? variants.filter((variant) => cleanItemIdentity(variant.baseType) === cleanBase)
    : [...variants];
  let selected = candidates[0];
  if (!selected?.disc) return selected;

  for (const variant of candidates) {
    const condition = variant.disc;
    if (!condition) continue;
    if (condition.propAR && !propertyIsPresent(context, "armour")) continue;
    if (condition.propEV && !propertyIsPresent(context, "evasion rating")) continue;
    if (condition.propES && !propertyIsPresent(context, "energy shield")) continue;
    if (condition.mapTier) {
      const tier = context.mapTier;
      if (!tier) continue;
      if (condition.mapTier === "W" && !(tier <= 5)) continue;
      if (condition.mapTier === "Y" && !(tier >= 6 && tier <= 10)) continue;
      if (condition.mapTier === "R" && !(tier >= 11)) continue;
    }
    if (
      condition.hasImplicit &&
      !context.modifiers?.some((modifier) =>
        modifier.kind === "implicit" &&
        modifier.tradeStatRef === condition.hasImplicit!.ref
      )
    ) continue;
    if (
      condition.hasExplicit &&
      !context.modifiers?.some((modifier) =>
        modifier.kind === "explicit" &&
        modifier.tradeStatRef === condition.hasExplicit!.ref
      )
    ) continue;
    if (
      condition.sectionText &&
      !context.rawText?.includes(condition.sectionText)
    ) continue;
    selected = variant;
  }
  return selected;
}

function itemProfile(
  identity: string,
  context: PinnedVariantSelectionContext = {},
) {
  return pickCorrectPinnedVariant(itemProfiles[cleanItemIdentity(identity)] || [], context);
}

function uniqueProfile(
  itemName: string,
  context: PinnedVariantSelectionContext = {},
) {
  const variants = uniqueProfiles[cleanItemIdentity(itemName)] || [];
  if (!context.baseType && new Set(variants.map((variant) => variant.baseType)).size > 1) {
    return undefined;
  }
  return pickCorrectPinnedVariant(variants, context);
}

/** Returns Awakened's pinned item.info.tradeTag for an exact item identity. */
export function resolveTradeTag(
  itemName: string | undefined,
  baseType?: string,
) {
  for (const identity of candidateItemIdentities(itemName, baseType)) {
    const tag = tradeTags[identity];
    if (typeof tag === "string" && tag) return tag;
  }
  return undefined;
}

/** True when the pinned Awakened record marks this item exchangeable. */
export function isExchangeableItem(
  itemName: string | undefined,
  baseType?: string,
) {
  for (const identity of candidateItemIdentities(itemName, baseType)) {
    if (tradeTags[identity] || exchangeableWithoutTradeTag.has(identity)) return true;
  }
  return false;
}

export function tradeTagCatalogSize() {
  return Object.keys(tradeTags).length;
}

export interface PinnedUniqueIdentityProfile {
  name: string;
  baseType: string;
  icon: string;
}

export interface PinnedGemIdentityProfile {
  maxLevel: number;
  transfigured: boolean;
  normalVariant?: string;
  tradeDisc?: string;
}

export function uniqueIdentityProfile(
  itemName: string,
  context: PinnedVariantSelectionContext = {},
): PinnedUniqueIdentityProfile | undefined {
  const identity = cleanItemIdentity(itemName);
  const profile = uniqueProfile(identity, context);
  if (!profile?.baseType) return undefined;
  return {
    name: identity,
    baseType: profile.baseType,
    icon: profile.icon || "",
  };
}

export function uniqueIdentityProfilesForBase(
  baseType: string,
  context: PinnedVariantSelectionContext = {},
): PinnedUniqueIdentityProfile[] {
  const cleanBase = cleanItemIdentity(baseType);
  return Object.entries(uniqueProfiles).flatMap(([name, variants]) => {
    const profile = pickCorrectPinnedVariant(
      variants,
      { ...context, baseType: cleanBase },
      cleanBase,
    );
    return profile?.baseType
      ? [{ name, baseType: cleanBase, icon: profile.icon || "" }]
      : [];
  });
}

export function gemIdentityProfile(
  gemName: string,
): PinnedGemIdentityProfile | undefined {
  const profile = gemProfiles[cleanItemIdentity(gemName)];
  if (!profile || !Number.isFinite(profile.maxLevel)) return undefined;
  return {
    maxLevel: Number(profile.maxLevel),
    transfigured: Boolean(profile.transfigured),
    ...(profile.normalVariant ? { normalVariant: profile.normalVariant } : {}),
    ...(profile.tradeDisc ? { tradeDisc: profile.tradeDisc } : {}),
  };
}

export function itemTradeDiscriminator(itemName: string) {
  const value = itemTradeDiscriminators[cleanItemIdentity(itemName)];
  return typeof value === "string" && value ? value : undefined;
}

export function mapAreaTradeDiscriminator(areaName: string) {
  const value = mapAreaTradeDiscriminators[areaName.trim()];
  return typeof value === "string" && value ? value : undefined;
}

export function armourBaseProfile(
  baseType: string,
  context: PinnedVariantSelectionContext = {},
) {
  return itemProfile(baseType, context)?.armour;
}

/**
 * Finds the longest contiguous craftable base name inside an affixed magic
 * item name. This mirrors Awakened PoE Trade's data-backed name resolution
 * without guessing that the whole affixed display name is a Trade base type.
 */
export function resolveMagicBaseType(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let best = "";
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= words.length; end += 1) {
      const candidate = words.slice(start, end).join(" ");
      if (candidate.length > best.length && baseTypes.has(candidate)) {
        best = candidate;
      }
    }
  }
  return best || undefined;
}

/**
 * Returns the craftable category attached to an exact pinned ITEM identity.
 * Affixed magic display names are resolved through the same longest-base
 * catalog used by Awakened before the category lookup. This lets the parser
 * distinguish game clipboard classes that are intentionally broad (for
 * example `Misc Map Items`) without branching on individual item names.
 */
export function pinnedCraftableItemCategory(
  itemName: string | undefined,
  baseType?: string,
) {
  const identities = candidateItemIdentities(baseType, itemName);
  const resolvedMagicBase = itemName
    ? resolveMagicBaseType(cleanItemIdentity(itemName))
    : undefined;
  if (resolvedMagicBase && !identities.includes(resolvedMagicBase)) {
    identities.unshift(resolvedMagicBase);
  }
  for (const identity of identities) {
    const category = itemProfile(identity)?.craftable?.category;
    if (category) return category;
  }
  return undefined;
}

export function magicBaseTypeCatalogSize() {
  return baseTypes.size;
}

/** True when the pinned Awakened ITEM record marks this base craftable. */
export function isCraftableBaseType(
  itemName: string | undefined,
  baseType?: string,
  context: PinnedVariantSelectionContext = {},
) {
  for (const identity of candidateItemIdentities(baseType, itemName)) {
    const variants = itemProfiles[identity];
    if (variants?.length) {
      return Boolean(pickCorrectPinnedVariant(variants, context)?.craftable);
    }
  }
  return resolveMagicBaseType(cleanItemIdentity(itemName)) != null;
}

export function isFixedUniqueModifier(
  itemName: string,
  canonicalStatRef: string | undefined,
  context: PinnedVariantSelectionContext = {},
) {
  const profile = uniqueProfile(itemName, context);
  if (
    !canonicalStatRef ||
    !Array.isArray(profile?.fixedStats) ||
    !profile.fixedStats.length
  ) return false;
  return profile.fixedStats.includes(canonicalStatRef);
}

/**
 * True only when the pinned source explicitly supplied fixed-stat metadata.
 * An empty array is meaningful: it declares every explicit stat a variant.
 */
export function hasUniqueFixedStatMetadata(
  itemName: string,
  context: PinnedVariantSelectionContext = {},
) {
  const profile = uniqueProfile(itemName, context);
  return profile != null && Object.prototype.hasOwnProperty.call(profile, "fixedStats");
}

/**
 * Describes the strongest modifier-selection rule supported by the pinned
 * unique record. Missing legacy metadata is derived from fixedStats so a
 * partially generated pack cannot silently broaden a Trade query.
 */
export function uniqueModifierMetadataPolicy(
  itemName: string,
  context: PinnedVariantSelectionContext = {},
): UniqueModifierMetadataPolicy {
  const profile = uniqueProfile(itemName, context);
  if (profile?.modifierPolicy) return profile.modifierPolicy;
  if (!profile || !Object.prototype.hasOwnProperty.call(profile, "fixedStats")) {
    return "source-bounds-only";
  }
  return profile.fixedStats?.length
    ? "non-fixed-explicit-variants"
    : "all-explicit-variants";
}

/** True when the pinned item data knows this exact unique identity. */
export function hasUniqueModifierProfile(itemName: string) {
  return Boolean(uniqueProfiles[cleanItemIdentity(itemName)]?.length);
}

export function uniqueModifierProfileCount() {
  return Object.values(uniqueProfiles).reduce(
    (total, variants) => total + variants.length,
    0,
  );
}
