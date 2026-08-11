import type {
  CategoryDefinition,
  DataSource,
  EconomyRow,
  FilterState,
  NormalizedOverview,
  RawExchangeOverview,
  RawItemOverview,
  RawStashCurrencyOverview,
  SortState,
  ValueDisplay,
} from "../types";
import { displayPrice } from "./format";

export const emptyFilters: FilterState = {
  query: "",
  foulborn: "all",
  gemType: "all",
  itemType: "all",
  level: "all",
  links: "all",
  corruption: "all",
  gemLevel: "all",
  gemQuality: "all",
  variant: "all",
  mapTier: "all",
  trend: "all",
  includeLowConfidence: false,
  minPrice: "",
  maxPrice: "",
};

export function defaultFiltersForSource(source: DataSource): FilterState {
  return {
    ...emptyFilters,
    // Completed-hour Faustus markets remain useful when guarded for liquidity,
    // spread, or observation age.
    // Show them with warnings; downstream movers and trends still exclude them.
    includeLowConfidence: source === "faustus",
  };
}

function iconUrl(icon?: string) {
  if (!icon) return undefined;
  if (icon.startsWith("http")) return icon;
  return `https://web.poecdn.com${icon.startsWith("/") ? "" : "/"}${icon}`;
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeTrend(sparkline?: {
  totalChange?: number | null;
  data?: Array<number | null>;
}) {
  const data = (sparkline?.data || []).map((point) =>
    point == null || !Number.isFinite(Number(point)) ? null : Number(point),
  );
  const observations = data.filter((point) => point != null).length;
  const totalChange = Number(sparkline?.totalChange);
  return {
    data,
    change:
      observations >= 2 && Number.isFinite(totalChange) ? totalChange : null,
  };
}

function lowConfidenceReason(
  listingCount: number | null,
  observationCount: number | null,
) {
  const samples = [listingCount, observationCount].filter(
    (value): value is number => value != null && value > 0,
  );
  if (samples.length === 0) return undefined;
  const sampleSize = Math.min(...samples);
  return sampleSize < 5
    ? `${sampleSize} market ${sampleSize === 1 ? "observation" : "observations"}`
    : undefined;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function inferredDivineChaos(lines: RawItemOverview["lines"]) {
  const ratios = (lines || [])
    .map((line) => {
      const chaos = positiveNumber(line.chaosValue);
      const divine = positiveNumber(line.divineValue);
      return chaos != null && divine != null ? chaos / divine : null;
    })
    .filter(
      (ratio): ratio is number => ratio != null && ratio >= 20 && ratio <= 1_000,
    );
  return median(ratios) || 180;
}

function normalizeExchange(
  data: RawExchangeOverview,
  category: CategoryDefinition,
): NormalizedOverview {
  const coreItems = data.core?.items || [];
  const allItems = [...coreItems, ...(data.items || [])];
  const items = Object.fromEntries(allItems.map((item) => [item.id, item]));
  const primary = data.core?.primary || "chaos";
  const secondary = data.core?.secondary || "divine";
  const rates = data.core?.rates || {};

  const divineRate =
    primary === "divine"
      ? 1
      : safeNumber(rates.divine, primary === "chaos" ? 1 / 180 : 0);
  const chaosRate =
    primary === "chaos"
      ? 1
      : safeNumber(rates.chaos, primary === "divine" ? 180 : 0);

  const rows: EconomyRow[] = (data.lines || []).flatMap((line) => {
    const item = items[line.id];
    const primaryValue = positiveNumber(line.primaryValue);
    if (primaryValue == null) return [];
    const chaosValue = primaryValue * chaosRate;
    const divineValue = primaryValue * divineRate;
    const volume = line.volumePrimaryValue == null ? null : line.volumePrimaryValue;
    const trend = normalizeTrend(line.sparkline);
    const confidenceReason = lowConfidenceReason(volume, volume);
    return [{
      key: `${category.id}:exchange:${line.id}`,
      id: line.id,
      name: item?.name || line.id,
      icon: iconUrl(item?.image || item?.icon),
      categoryId: category.id,
      categoryLabel: category.label,
      source: "exchange",
      detailsId: item?.detailsId,
      itemType: item?.category,
      chaosValue,
      divineValue,
      change: trend.change,
      sparkline: trend.data,
      volume,
      listingCount: null,
      observationCount: null,
      maxVolumeCurrency: line.maxVolumeCurrency,
      maxVolumeRate: line.maxVolumeRate,
      implicitModifiers: [],
      explicitModifiers: [],
      mutatedModifiers: [],
      lowConfidence: Boolean(confidenceReason),
      confidenceReason,
    }];
  });

  return {
    rows,
    core: {
      primary,
      secondary,
      rates,
      items,
    },
  };
}

function normalizeStashCurrency(
  data: RawStashCurrencyOverview,
  category: CategoryDefinition,
): NormalizedOverview {
  const details = data.currencyDetails || [];
  const detailByName = Object.fromEntries(
    details.map((detail) => [detail.name?.toLowerCase() || "", detail]),
  );
  const divineChaos =
    data.lines?.find((line) => line.currencyTypeName === "Divine Orb")
      ?.chaosEquivalent || 180;

  const rows: EconomyRow[] = (data.lines || []).flatMap((line, index) => {
    const detail = detailByName[line.currencyTypeName?.toLowerCase() || ""];
    const count = Math.max(
      safeNumber(line.pay?.count),
      safeNumber(line.receive?.count),
    );
    const listingCount = Math.max(
      safeNumber(line.pay?.listing_count),
      safeNumber(line.receive?.listing_count),
    );
    const spark =
      line.receiveSparkLine?.data?.some((point) => point != null)
        ? line.receiveSparkLine
        : line.paySparkLine;
    const chaosValue = positiveNumber(line.chaosEquivalent);
    if (chaosValue == null) return [];
    const id = line.detailsId || detail?.tradeId || String(detail?.id || index);
    const trend = normalizeTrend(spark);
    const confidenceReason = lowConfidenceReason(listingCount || null, count || null);
    return [{
      key: `${category.id}:stash-currency:${id}`,
      id,
      name: line.currencyTypeName || id,
      icon: iconUrl(detail?.icon),
      categoryId: category.id,
      categoryLabel: category.label,
      source: "stash-currency",
      detailsId: line.detailsId,
      chaosValue,
      divineValue: chaosValue / divineChaos,
      change: trend.change,
      sparkline: trend.data,
      volume: null,
      listingCount: listingCount || null,
      observationCount: count || null,
      implicitModifiers: [],
      explicitModifiers: [],
      mutatedModifiers: [],
      lowConfidence: Boolean(confidenceReason),
      confidenceReason,
    }];
  });

  return {
    rows,
    core: {
      primary: "chaos",
      secondary: "divine",
      rates: { divine: 1 / divineChaos },
      items: {},
    },
  };
}

function normalizeItems(
  data: RawItemOverview,
  category: CategoryDefinition,
): NormalizedOverview {
  const divineChaos = inferredDivineChaos(data.lines);
  const rows: EconomyRow[] = (data.lines || []).flatMap((line) => {
    const chaosValue = positiveNumber(line.chaosValue);
    if (chaosValue == null) return [];
    const divineValue =
      positiveNumber(line.divineValue) ?? chaosValue / divineChaos;
    const listingCount =
      line.listingCount == null ? null : safeNumber(line.listingCount);
    const observations = line.count == null ? null : safeNumber(line.count);
    const trend = normalizeTrend(line.sparkLine);
    const confidenceReason = lowConfidenceReason(listingCount, observations);
    return [{
      key: `${category.id}:stash-item:${line.id}`,
      id: String(line.id),
      name: line.name || line.baseType || String(line.id),
      icon: iconUrl(line.icon),
      categoryId: category.id,
      categoryLabel: category.label,
      source: "stash-item",
      detailsId: line.detailsId,
      baseType: line.baseType,
      itemType: line.itemType,
      variant: line.variant,
      chaosValue,
      divineValue,
      exaltedValue: line.exaltedValue,
      change: trend.change,
      sparkline: trend.data,
      volume: null,
      listingCount,
      observationCount: observations,
      levelRequired: line.levelRequired,
      links: line.links,
      gemLevel: line.gemLevel,
      gemQuality: line.gemQuality,
      corrupted: line.corrupted,
      mapTier: line.mapTier,
      mapRegion: line.mapRegion,
      stackSize: line.stackSize,
      flavourText: line.flavourText,
      implicitModifiers: line.implicitModifiers || [],
      explicitModifiers: line.explicitModifiers || [],
      mutatedModifiers: line.mutatedModifiers || [],
      metadata: line.metadata,
      tradeInfo: line.tradeInfo,
      tradeFilter: line.tradeFilter,
      lowConfidence: Boolean(confidenceReason),
      confidenceReason,
    }];
  });

  return {
    rows,
    core: {
      primary: "chaos",
      secondary: "divine",
      rates: { divine: 1 / divineChaos },
      items: {},
    },
  };
}

export function normalizeOverview(
  data: RawExchangeOverview | RawItemOverview | RawStashCurrencyOverview,
  source: DataSource,
  category: CategoryDefinition,
) {
  if (source === "exchange") {
    return normalizeExchange(data as RawExchangeOverview, category);
  }
  if (source === "stash-currency") {
    return normalizeStashCurrency(data as RawStashCurrencyOverview, category);
  }
  return normalizeItems(data as RawItemOverview, category);
}

function matchesLevel(row: EconomyRow, levelFilter: string) {
  if (levelFilter === "all") return true;
  const value = row.levelRequired;
  if (value == null) return false;
  const [minimum, maximum] = levelFilter.split("-").map(Number);
  return value >= minimum && (Number.isFinite(maximum) ? value <= maximum : true);
}

function matchesPrice(
  row: EconomyRow,
  display: ValueDisplay,
  minimum: string,
  maximum: string,
) {
  const value = displayPrice(row, display).value;
  const parsedMinimum = minimum === "" ? null : Number(minimum);
  const parsedMaximum = maximum === "" ? null : Number(maximum);
  if (parsedMinimum != null && Number.isFinite(parsedMinimum) && value < parsedMinimum)
    return false;
  if (parsedMaximum != null && Number.isFinite(parsedMaximum) && value > parsedMaximum)
    return false;
  return true;
}

export function getGemType(row: EconomyRow) {
  const name = row.name;
  const vaal = /^Vaal\s/i.test(name);
  const awakened = /^Awakened\s/i.test(name);
  const transfigured =
    /\sof\s[A-Z]/.test(name.replace(/\s*\(.+$/, "")) ||
    Boolean(name.match(/\(.+\sof\s.+\)/i));
  if (awakened) return "awakened";
  if (vaal && transfigured) return "vaal-transfigured";
  if (vaal) return "vaal";
  if (transfigured) return "transfigured";
  return "normal";
}

export function filterRows(
  rows: EconomyRow[],
  filters: FilterState,
  display: ValueDisplay,
) {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (
      query &&
      !`${row.name} ${row.baseType || ""} ${row.variant || ""}`
        .toLowerCase()
        .includes(query)
    )
      return false;
    if (
      filters.foulborn !== "all" &&
      String(/^Foulborn\s/i.test(row.name)) !== filters.foulborn
    )
      return false;
    if (filters.gemType !== "all" && getGemType(row) !== filters.gemType)
      return false;
    if (filters.itemType !== "all" && row.itemType !== filters.itemType)
      return false;
    if (!matchesLevel(row, filters.level)) return false;
    if (filters.links !== "all" && String(row.links || "0") !== filters.links)
      return false;
    if (
      filters.corruption !== "all" &&
      String(Boolean(row.corrupted)) !== filters.corruption
    )
      return false;
    if (
      filters.gemLevel !== "all" &&
      String(row.gemLevel) !== filters.gemLevel
    )
      return false;
    if (
      filters.gemQuality !== "all" &&
      String(row.gemQuality) !== filters.gemQuality
    )
      return false;
    if (filters.variant !== "all" && row.variant !== filters.variant) return false;
    if (filters.mapTier !== "all" && String(row.mapTier) !== filters.mapTier)
      return false;
    if (filters.trend === "gainers" && (row.change == null || row.change <= 0))
      return false;
    if (filters.trend === "losers" && (row.change == null || row.change >= 0))
      return false;
    if (
      filters.trend === "stable" &&
      (row.change == null || Math.abs(row.change) > 5)
    )
      return false;
    if (!filters.includeLowConfidence && row.lowConfidence) return false;
    return matchesPrice(row, display, filters.minPrice, filters.maxPrice);
  });
}

export function sortRows(
  rows: EconomyRow[],
  sort: SortState,
  display: ValueDisplay,
) {
  const multiplier = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let aValue: string | number | null | undefined;
    let bValue: string | number | null | undefined;
    switch (sort.key) {
      case "name":
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
        break;
      case "value":
        aValue = displayPrice(a, display).value;
        bValue = displayPrice(b, display).value;
        break;
      case "change":
        aValue = a.change;
        bValue = b.change;
        break;
      case "volume":
        aValue = a.volume;
        bValue = b.volume;
        break;
      case "listed":
        aValue = a.listingCount;
        bValue = b.listingCount;
        break;
      case "level":
        aValue = a.gemLevel ?? a.levelRequired ?? a.mapTier;
        bValue = b.gemLevel ?? b.levelRequired ?? b.mapTier;
        break;
      case "quality":
        aValue = a.gemQuality;
        bValue = b.gemQuality;
        break;
    }
    if (aValue == null && bValue == null) return a.name.localeCompare(b.name);
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    if (typeof aValue === "string" && typeof bValue === "string") {
      return aValue.localeCompare(bValue) * multiplier;
    }
    return (Number(aValue) - Number(bValue)) * multiplier;
  });
}

function uniqueSorted(values: Array<string | number | undefined>) {
  return [...new Set(values.filter((value) => value != null && value !== ""))]
    .sort((a, b) =>
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b)),
    )
    .map(String);
}

export function deriveFilterOptions(rows: EconomyRow[]) {
  return {
    itemTypes: uniqueSorted(rows.map((row) => row.itemType)),
    links: uniqueSorted(rows.map((row) => row.links)),
    gemLevels: uniqueSorted(rows.map((row) => row.gemLevel)),
    gemQualities: uniqueSorted(rows.map((row) => row.gemQuality)),
    variants: uniqueSorted(rows.map((row) => row.variant)).slice(0, 120),
    mapTiers: uniqueSorted(rows.map((row) => row.mapTier)),
    hasLevel: rows.some((row) => row.levelRequired != null),
    hasCorruption: rows.some((row) => row.corrupted != null),
    hasLowConfidence: rows.some((row) => row.lowConfidence),
    hasFoulborn: rows.some((row) => /^Foulborn\s/i.test(row.name)),
    gemTypes: uniqueSorted(rows.map((row) => getGemType(row))),
  };
}

export function marketStats(rows: EconomyRow[]) {
  const reliable = rows.filter((row) => !row.lowConfidence);
  const trustedRows = reliable.length > 0 ? reliable : rows;
  const changed = trustedRows.filter((row) => row.change != null);
  const gainers = [...changed].sort((a, b) => (b.change || 0) - (a.change || 0));
  const losers = [...changed].sort((a, b) => (a.change || 0) - (b.change || 0));
  const liquid = [...trustedRows].sort(
    (a, b) =>
      (b.volume ?? b.listingCount ?? 0) - (a.volume ?? a.listingCount ?? 0),
  );
  return {
    gainer: gainers[0],
    loser: losers[0],
    liquid: liquid[0],
  };
}
