import { shouldAutoSearchOfficialTrade } from "./official-trade-policy";
import { defaultOfficialTradeStatusFromPinnedItem } from "./official-trade-route";
import { isCraftableBaseType } from "./magic-base-type";
import type {
  OfficialTradeListingsResult,
  ParsedPoeItem,
  PriceCheckDashboardMode,
  PriceCheckSession,
} from "./types";

export const LOGBOOK_PRICE_CHECK_MODES = ["I", "II", "III", "IV", "V"] as const;

export function logbookPriceCheckModeIndex(mode: PriceCheckDashboardMode) {
  const index = LOGBOOK_PRICE_CHECK_MODES.indexOf(
    mode as (typeof LOGBOOK_PRICE_CHECK_MODES)[number],
  );
  return index >= 0 ? index : null;
}

export function priceCheckItemForMode(
  item: ParsedPoeItem,
  mode: PriceCheckDashboardMode,
): ParsedPoeItem {
  const index = logbookPriceCheckModeIndex(mode);
  const modifiers = index == null ? undefined : item.logbookAreas?.[index];
  return modifiers ? { ...item, modifiers } : item;
}

const EXACT_ONLY_ITEM_CLASSES = new Set([
  "captured beasts",
  "charms",
  "heist blueprints",
  "heist contracts",
  "invitations",
  "maps",
  "memories",
  "memory lines",
  "sentinels",
]);

function normalizedItemClass(item: ParsedPoeItem) {
  return item.itemClass.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isChartPriceCheckItem(item: ParsedPoeItem) {
  return /^charts?$/.test(normalizedItemClass(item));
}

function isOrdinaryIdentifiedRareMap(item: ParsedPoeItem) {
  return normalizedItemClass(item) === "maps" &&
    item.rarity === "rare" &&
    item.identified &&
    !item.mapCompletionReward;
}

/** APT's Bulk map preset omits rolled map-property thresholds. */
export function isBulkMapPriceCheckMode(
  item: ParsedPoeItem,
  mode: PriceCheckDashboardMode,
) {
  if (
    normalizedItemClass(item) !== "maps" ||
    item.rarity === "unique" ||
    item.mapCompletionReward
  ) {
    return false;
  }
  if (mode === "bulk") return true;
  // Normal, magic, and unidentified rare maps have only APT's Bulk preset;
  // this app retains its existing single Exact tab for that sole preset.
  return mode === "exact" && !isOrdinaryIdentifiedRareMap(item);
}

/** APT gives only an identified rare Chart its active Pseudo/property preset. */
export function isBulkChartPriceCheckMode(
  item: ParsedPoeItem,
  mode: PriceCheckDashboardMode,
) {
  if (item.rarity === "unique" || !isChartPriceCheckItem(item)) return false;
  if (mode === "bulk") return true;
  // Retain the same saved-session compatibility as Maps: `exact` is Pseudo
  // for an identified rare and Bulk for every other non-unique Chart.
  return mode === "exact" && !(
    item.rarity === "rare" && item.identified
  );
}

function isClusterJewel(item: ParsedPoeItem) {
  return /\bcluster jewels?\b/i.test(`${item.itemClass} ${item.baseType}`);
}

function isExactOnlyItem(item: ParsedPoeItem) {
  const itemClass = normalizedItemClass(item);
  if (!item.identified || item.rarity === "normal") return true;
  if (["currency", "divination-card", "gem"].includes(item.rarity)) return true;
  if (
    item.rarity !== "unique" &&
    !isCraftableBaseType(item.name, item.baseType, item)
  ) return true;
  if (EXACT_ONLY_ITEM_CLASSES.has(itemClass)) return true;
  return (
    item.rarity !== "unique" &&
    (
      /\b(?:flasks?|tinctures?)\b/.test(itemClass) ||
      ["sanctum relics", "idols"].includes(itemClass)
    )
  );
}

function hasCraftingValue(item: ParsedPoeItem) {
  const itemClass = normalizedItemClass(item);
  const ordinaryJewel = itemClass === "jewels" && !isClusterJewel(item);
  const abyssJewel = itemClass === "abyss jewels";
  return (
    item.synthesised ||
    item.fractured ||
    item.influences.length > 0 ||
    isClusterJewel(item) ||
    (ordinaryJewel && item.rarity === "magic") ||
    (!ordinaryJewel && !abyssJewel && (item.itemLevel ?? 0) >= 82)
  );
}

function isLikelyFinishedItem(item: ParsedPoeItem) {
  const hasMemoryStrands = Object.keys(item.properties).some(
    (key) => key.trim().toLowerCase() === "memory strands",
  );
  // Catalog hydration can replace a crafted source modifier with an Awakened
  // pseudo (for example crafted global crit multi). The original clipboard is
  // the durable authority for the finished-item decision, so Base must not
  // reappear merely because the presentation modifier changed shape.
  const hasCraftedModifier = item.modifiers.some(
    (modifier) => modifier.kind === "crafted",
  ) || item.rawText.split(/\r?\n/).some((line) =>
    /\{[^}\r\n]*\b(?:master\s+)?crafted\b[^}\r\n]*\bmodifier\b[^}\r\n]*\}/i.test(line) ||
    /\(crafted\)\s*$/i.test(line),
  );
  return (
    item.rarity === "unique" ||
    hasCraftedModifier ||
    (item.quality === 20 && !hasMemoryStrands) ||
    item.corrupted ||
    item.mirrored
  );
}

/**
 * Awakened exposes one Exact preset for fixed/non-craftable item kinds, one
 * Similar preset for finished items, and adds Base only when an unfinished
 * item still has meaningful crafting value.
 */
export function priceCheckModesForItem(
  item: ParsedPoeItem,
): readonly PriceCheckDashboardMode[] {
  if (
    /^expedition logbook$/i.test((item.baseType || item.name).trim()) &&
    item.logbookAreas?.length
  ) {
    return LOGBOOK_PRICE_CHECK_MODES.slice(
      0,
      Math.min(LOGBOOK_PRICE_CHECK_MODES.length, item.logbookAreas.length),
    );
  }
  if (normalizedItemClass(item) === "maps") {
    if (item.rarity === "unique" || item.mapCompletionReward) return ["exact"];
    if (isOrdinaryIdentifiedRareMap(item)) return ["exact", "bulk"];
    return ["bulk"];
  }
  if (isChartPriceCheckItem(item)) {
    if (item.rarity === "unique") return ["exact"];
    if (item.rarity === "rare" && item.identified) return ["exact", "bulk"];
    return ["bulk"];
  }
  if (isExactOnlyItem(item)) return ["exact"];
  if (isLikelyFinishedItem(item) || !hasCraftingValue(item)) return ["similar"];
  return ["similar", "base"];
}

export function defaultPriceCheckModeForItem(item: ParsedPoeItem) {
  return priceCheckModesForItem(item)[0];
}

/** Awakened starts ordinary item searches in instant-buyout-only mode. */
export function defaultOfficialTradeStatusForItem(
  item: ParsedPoeItem,
  onlineOnly = true,
): "securable" | "available" | "any" {
  return defaultOfficialTradeStatusFromPinnedItem(item, onlineOnly);
}

/**
 * True while the current query is deliberately waiting for Search. The
 * fallback keeps restored/older sessions compatible with smart initial search.
 */
export function officialTradeNeedsExplicitSearch(session: PriceCheckSession) {
  if (session.status !== "ready" || !session.item || !session.query) return false;
  if (session.officialTradeNeedsSearch != null) {
    return session.officialTradeNeedsSearch;
  }
  return (
    !shouldAutoSearchOfficialTrade(session.item) &&
    !session.officialTradeLoading &&
    !session.officialTrade
  );
}

/**
 * Keeps verified cached evidence visible after a failed refresh. A first
 * request failure has no stale evidence and must remain ERROR, while a prior
 * valid zero-result search is still correctly marked STALE.
 */
export function officialTradeFailureResult(
  reason: unknown,
  previous?: OfficialTradeListingsResult,
): OfficialTradeListingsResult {
  const error = reason instanceof Error ? reason.message : String(reason);
  const hasCachedEvidence = Boolean(
    previous && (previous.stale || !previous.error),
  );
  return {
    api: previous?.api,
    listings: previous?.listings || [],
    total: previous?.total || 0,
    searchId: previous?.searchId || "",
    fetchedAt: previous?.fetchedAt || Date.now(),
    stale: hasCachedEvidence,
    error: error.replace(/^Error invoking remote method '[^']+':\s*/, "").slice(0, 240),
  };
}
