import type { GGGStashItem, PoeStashRealm, PoeStashTabDetail } from "../../types";
import { classifyStashItem, isStackableItem, STASH_FAMILY_ORDER } from "./stash-classify";
import { findPricedRow, type StashPriceIndex } from "./stash-pricing";
import type {
  StashFamily,
  StashFamilyValue,
  StashItemValuation,
  StashSnapshot,
  StashTabSummaryValue,
  StashTabValuation,
  StashTopItem,
} from "./stash-types";

export const TOP_ITEMS_LIMIT = 40;

function emptyFamilyValue(): StashFamilyValue {
  return { chaos: 0, divine: 0, count: 0 };
}

function addFamilyValue(
  families: Partial<Record<StashFamily, StashFamilyValue>>,
  family: StashFamily,
  chaos: number,
  divine: number,
  count: number,
) {
  const current = families[family] || emptyFamilyValue();
  families[family] = {
    chaos: current.chaos + chaos,
    divine: current.divine + divine,
    count: current.count + count,
  };
}

function itemQuantity(item: GGGStashItem) {
  const stack = Number(item?.stackSize);
  return Number.isFinite(stack) && stack > 0 ? stack : 1;
}

function itemQuality(item: GGGStashItem) {
  const quality = (item?.properties || []).find(
    (property) => String(property?.name || "").toLowerCase() === "quality",
  );
  const raw = String(quality?.values?.[0]?.[0] || "").replace(/[^0-9-]/g, "");
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function itemReason(family: StashFamily, frameType: number, rowFound: boolean) {
  if (rowFound) return "matched" as const;
  if (family === "other") {
    if (frameType === 2) return "rare" as const;
    if (frameType === 1) return "magic" as const;
    return "normal" as const;
  }
  return "unmatched" as const;
}

export function valueStashItem(
  item: GGGStashItem,
  index: StashPriceIndex,
): StashItemValuation {
  const family = classifyStashItem(item);
  const frameType = Number(item?.frameType);
  const quantity = itemQuantity(item);
  const stackable = isStackableItem(item);
  const row = findPricedRow(index, family, item, stackable);
  const unitChaos = row?.chaosValue && row.chaosValue > 0 ? row.chaosValue : 0;
  const unitDivine = row?.divineValue && row.divineValue > 0 ? row.divineValue : 0;
  const isUnique = frameType === 3;
  const identity = String(
    isUnique ? item?.name : item?.typeLine || item?.baseType || item?.name || item?.id || "Unknown item",
  );
  return {
    identity,
    family,
    quantity,
    unitChaos,
    unitDivine,
    chaos: unitChaos * quantity,
    divine: unitDivine * quantity,
    priced: row != null,
    reason: itemReason(family, frameType, row != null),
    corrupted: Boolean(item?.corrupted),
    quality: itemQuality(item),
  };
}

export interface StashValuationResult {
  tabs: StashTabValuation[];
  chaos: number;
  divine: number;
  pricedChaos: number;
  itemCount: number;
  pricedItemCount: number;
  unpricedItemCount: number;
  families: Partial<Record<StashFamily, StashFamilyValue>>;
  topItems: StashTopItem[];
  pricesAt: number;
  pricesStale: boolean;
  overviewCount: number;
}

export function valueStashTabs(
  tabs: PoeStashTabDetail[],
  index: StashPriceIndex,
): StashValuationResult {
  const families: Partial<Record<StashFamily, StashFamilyValue>> = {};
  const pricedItemCounts = new Map<string, number>();
  const perTabItemCounts = new Map<string, number>();
  const pricedEntries: Array<{ chaos: number; item: StashItemValuation }> = [];

  const tabValues = tabs.map((tab) => {
    let chaos = 0;
    let divine = 0;
    let pricedChaos = 0;
    let itemCount = 0;
    let pricedItemCount = 0;
    const tabFamilies: Partial<Record<StashFamily, StashFamilyValue>> = {};
    const items: StashItemValuation[] = [];
    for (const item of Array.isArray(tab.items) ? tab.items : []) {
      const valuation = valueStashItem(item, index);
      items.push(valuation);
      itemCount += 1;
      chaos += valuation.chaos;
      divine += valuation.divine;
      if (valuation.priced) {
        pricedItemCount += 1;
        pricedChaos += valuation.chaos;
        pricedEntries.push({ chaos: valuation.chaos, item: valuation });
      }
      addFamilyValue(tabFamilies, valuation.family, valuation.chaos, valuation.divine, valuation.quantity);
      addFamilyValue(families, valuation.family, valuation.chaos, valuation.divine, valuation.quantity);
    }
    perTabItemCounts.set(tab.id, itemCount);
    pricedItemCounts.set(tab.id, pricedItemCount);
    return {
      id: tab.id,
      name: tab.name,
      type: tab.type,
      index: tab.index,
      path: tab.path || [],
      itemCount,
      pricedItemCount,
      unpricedItemCount: itemCount - pricedItemCount,
      chaos,
      divine,
      pricedChaos,
      families: tabFamilies,
      items,
    };
  });

  const topItems = [...pricedEntries]
    .sort((a, b) => b.chaos - a.chaos)
    .slice(0, TOP_ITEMS_LIMIT)
    .map(({ item }) => {
      const ranked: StashTopItem = {
        name: item.identity,
        family: item.family,
        quantity: item.quantity,
        unitChaos: item.unitChaos,
        chaos: item.chaos,
        divine: item.divine,
      };
      return ranked;
    });

  const itemCount = [...perTabItemCounts.values()].reduce((sum, count) => sum + count, 0);
  const pricedItemCount = [...pricedItemCounts.values()].reduce((sum, count) => sum + count, 0);

  return {
    tabs: tabValues,
    chaos: tabValues.reduce((sum, tab) => sum + tab.chaos, 0),
    divine: tabValues.reduce((sum, tab) => sum + tab.divine, 0),
    pricedChaos: tabValues.reduce((sum, tab) => sum + tab.pricedChaos, 0),
    itemCount,
    pricedItemCount,
    unpricedItemCount: itemCount - pricedItemCount,
    families,
    topItems,
    pricesAt: index.pricesAt,
    pricesStale: index.pricesStale,
    overviewCount: index.availableCategories.size,
  };
}

export function tabSummaryValue(tab: StashTabValuation): StashTabSummaryValue {
  return {
    id: tab.id,
    name: tab.name,
    path: tab.path,
    itemCount: tab.itemCount,
    pricedItemCount: tab.pricedItemCount,
    unpricedItemCount: tab.unpricedItemCount,
    chaos: tab.chaos,
    divine: tab.divine,
    families: tab.families,
  };
}

export function buildSnapshot(
  result: StashValuationResult,
  league: string,
  realm: PoeStashRealm,
  createdAt = Date.now(),
): StashSnapshot {
  return {
    version: 1,
    createdAt,
    league,
    realm,
    tabCount: result.tabs.length,
    itemCount: result.itemCount,
    pricedItemCount: result.pricedItemCount,
    unpricedItemCount: result.unpricedItemCount,
    chaos: result.chaos,
    divine: result.divine,
    pricedChaos: result.pricedChaos,
    tabs: result.tabs.map(tabSummaryValue),
    families: result.families,
    topItems: result.topItems,
    metadata: {
      pricesAt: result.pricesAt,
      pricesStale: result.pricesStale,
      overviewCount: result.overviewCount,
    },
  };
}

export interface SnapshotDelta {
  chaos: number;
  divine: number;
  hours: number;
  chaosPerHour: number | null;
  divinePerHour: number | null;
}

/**
 * Wealth change between two snapshots. Returns null per-hour rates when the
 * snapshots are too close together to estimate a run rate.
 */
export function snapshotDelta(previous: StashSnapshot, latest: StashSnapshot): SnapshotDelta {
  const chaos = latest.chaos - previous.chaos;
  const divine = latest.divine - previous.divine;
  const hours = (latest.createdAt - previous.createdAt) / (60 * 60 * 1000);
  const rateable = hours >= 1 / 12 && Number.isFinite(hours);
  return {
    chaos,
    divine,
    hours,
    chaosPerHour: rateable ? chaos / hours : null,
    divinePerHour: rateable ? divine / hours : null,
  };
}

export function orderedFamilies(families: Partial<Record<StashFamily, StashFamilyValue>>) {
  return STASH_FAMILY_ORDER.filter((family) => {
    const value = families[family];
    return value != null && (value.chaos > 0 || value.count > 0);
  });
}