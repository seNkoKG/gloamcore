import { categoryById, defaultSource } from "../config/categories";
import type {
  AppPreferences,
  DataSource,
  EconomyRow,
  ModifierLine,
  WatchEntry,
} from "../types";

const DATA_SOURCES = new Set<DataSource>([
  "exchange",
  "stash-item",
  "stash-currency",
  "faustus",
]);
const VALUE_DISPLAYS = new Set(["adaptive", "chaos", "divine"]);
const DENSITIES = new Set(["compact", "comfortable"]);
const APP_THEMES = new Set(["gloam", "azurite", "ember", "wraeclast"]);
const TEXT_SCALES = new Set(["small", "normal", "large"]);
const COLOR_VISION_MODES = new Set(["standard", "accessible"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDataSource(value: unknown): value is DataSource {
  return typeof value === "string" && DATA_SOURCES.has(value as DataSource);
}

function sourceIsSupported(categoryId: string, source: DataSource) {
  const category = categoryById[categoryId];
  if (!category) return false;
  if (source === "faustus") {
    return category.source === "exchange" || category.source === "dual";
  }
  if (source === "exchange") {
    return category.source === "exchange" || category.source === "dual";
  }
  if (source === "stash-currency") return category.source === "dual";
  if (source === "stash-item") return category.source === "item";
  return false;
}

function sameStoredValue(left: unknown, right: unknown) {
  try {
    const canonical = (candidate: unknown): unknown => {
      if (Array.isArray(candidate)) return candidate.map(canonical);
      if (!isRecord(candidate)) return candidate;
      return Object.fromEntries(
        Object.keys(candidate)
          .sort()
          .map((key) => [key, canonical(candidate[key])]),
      );
    };
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  } catch {
    return false;
  }
}

function sanitizeModifierLines(value: unknown): ModifierLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ModifierLine[] => {
    if (!isRecord(candidate)) return [];
    const line: ModifierLine = {};
    if (typeof candidate.text === "string") line.text = candidate.text;
    if (typeof candidate.optional === "boolean") line.optional = candidate.optional;
    return [line];
  });
}

function sanitizeTradeInfo(value: unknown): EconomyRow["tradeInfo"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const result: NonNullable<EconomyRow["tradeInfo"]>[number] = {};
    if (typeof candidate.mod === "string") result.mod = candidate.mod;
    if (finiteNumber(candidate.min)) result.min = candidate.min;
    if (finiteNumber(candidate.max)) result.max = candidate.max;
    if (typeof candidate.option === "string") result.option = candidate.option;
    return [result];
  });
}

function sanitizeFaustus(value: unknown): EconomyRow["faustus"] {
  if (
    !isRecord(value) ||
    !finiteNumber(value.hour) ||
    !finiteNumber(value.minimumChaos) ||
    !finiteNumber(value.maximumChaos) ||
    !finiteNumber(value.traded) ||
    value.hour < 0 ||
    value.minimumChaos < 0 ||
    value.maximumChaos < 0 ||
    value.traded < 0 ||
    (value.reference !== "chaos" && value.reference !== "divine")
  ) return undefined;
  return {
    hour: value.hour,
    minimumChaos: value.minimumChaos,
    maximumChaos: value.maximumChaos,
    traded: value.traded,
    reference: value.reference,
    ...(finiteNumber(value.minimumStock) && value.minimumStock >= 0
      ? { minimumStock: value.minimumStock }
      : {}),
    ...(finiteNumber(value.maximumStock) && value.maximumStock >= 0
      ? { maximumStock: value.maximumStock }
      : {}),
  };
}

function sanitizeEconomyRow(value: unknown, fallbackKey: string): EconomyRow | null {
  if (!isRecord(value)) return null;
  const categoryId = nonEmptyString(value.categoryId) ? value.categoryId : "";
  const category = categoryById[categoryId];
  const source = isDataSource(value.source) ? value.source : null;
  const key = nonEmptyString(fallbackKey)
    ? fallbackKey
    : nonEmptyString(value.key) ? value.key : "";
  if (
    !category ||
    !source ||
    !key ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.name) ||
    !finiteNumber(value.chaosValue) ||
    value.chaosValue < 0 ||
    !sourceIsSupported(categoryId, source)
  ) return null;

  const nullableNumber = (candidate: unknown, allowNegative = false) =>
    finiteNumber(candidate) && (allowNegative || candidate >= 0) ? candidate : null;
  const row: EconomyRow = {
    key,
    id: value.id,
    name: value.name,
    categoryId,
    categoryLabel: nonEmptyString(value.categoryLabel)
      ? value.categoryLabel
      : category.label,
    source,
    chaosValue: value.chaosValue,
    divineValue: nullableNumber(value.divineValue),
    change: nullableNumber(value.change, true),
    sparkline: Array.isArray(value.sparkline)
      ? value.sparkline.filter(
        (candidate): candidate is number | null =>
          candidate === null || finiteNumber(candidate),
      )
      : [],
    volume: nullableNumber(value.volume),
    listingCount: nullableNumber(value.listingCount),
    observationCount: nullableNumber(value.observationCount),
    implicitModifiers: sanitizeModifierLines(value.implicitModifiers),
    explicitModifiers: sanitizeModifierLines(value.explicitModifiers),
    mutatedModifiers: sanitizeModifierLines(value.mutatedModifiers),
    lowConfidence: typeof value.lowConfidence === "boolean"
      ? value.lowConfidence
      : false,
  };

  for (const property of [
    "icon",
    "detailsId",
    "baseType",
    "itemType",
    "variant",
    "maxVolumeCurrency",
    "mapRegion",
    "flavourText",
    "confidenceReason",
  ] as const) {
    if (typeof value[property] === "string") row[property] = value[property];
  }
  for (const property of [
    "exaltedValue",
    "maxVolumeRate",
    "levelRequired",
    "links",
    "gemLevel",
    "gemQuality",
    "mapTier",
    "stackSize",
  ] as const) {
    if (finiteNumber(value[property]) && value[property] >= 0) {
      row[property] = value[property];
    }
  }
  if (typeof value.corrupted === "boolean") row.corrupted = value.corrupted;
  if (isRecord(value.metadata)) row.metadata = { ...value.metadata };
  const tradeInfo = sanitizeTradeInfo(value.tradeInfo);
  if (tradeInfo) row.tradeInfo = tradeInfo;
  if (isRecord(value.tradeFilter) && isRecord(value.tradeFilter.query)) {
    row.tradeFilter = { query: { ...value.tradeFilter.query } };
  }
  const faustus = sanitizeFaustus(value.faustus);
  if (faustus) row.faustus = faustus;
  return row;
}

function sanitizeWatchEntry(value: unknown): WatchEntry | null {
  if (!isRecord(value)) return null;
  const rawRow = isRecord(value.row) ? value.row : null;
  const key = nonEmptyString(value.key)
    ? value.key
    : rawRow && nonEmptyString(rawRow.key) ? rawRow.key : "";
  const row = sanitizeEconomyRow(rawRow, key);
  if (
    !row ||
    !nonEmptyString(value.league) ||
    !finiteNumber(value.addedAt) ||
    value.addedAt < 0
  ) return null;
  const entry: WatchEntry = {
    key: row.key,
    row,
    league: value.league,
    addedAt: value.addedAt,
  };
  if (finiteNumber(value.marketFetchedAt) && value.marketFetchedAt >= 0) {
    entry.marketFetchedAt = value.marketFetchedAt;
  }
  if (typeof value.marketStale === "boolean") entry.marketStale = value.marketStale;
  if (finiteNumber(value.targetPrice) && value.targetPrice >= 0) {
    entry.targetPrice = value.targetPrice;
  }
  if (value.targetUnit === "chaos" || value.targetUnit === "divine") {
    entry.targetUnit = value.targetUnit;
  }
  if (typeof value.note === "string") entry.note = value.note;
  if (value.lastAlertState === "above" || value.lastAlertState === "below") {
    entry.lastAlertState = value.lastAlertState;
  }
  return entry;
}

export function migrateStoredPreferences(
  value: unknown,
  options: { invalidateLegacyDivineValues?: boolean } = {},
): {
  stored: Partial<AppPreferences> & {
    sourceByCategory: Record<string, DataSource>;
    watchlist: WatchEntry[];
  };
  migrated: boolean;
} {
  const raw = isRecord(value) ? value : {};
  const saved: Partial<AppPreferences> = {};
  let migrated = value != null && !isRecord(value);

  if (own(raw, "league")) {
    if (nonEmptyString(raw.league)) saved.league = raw.league;
    else migrated = true;
  }
  if (own(raw, "categoryId")) {
    if (nonEmptyString(raw.categoryId) && categoryById[raw.categoryId]) {
      saved.categoryId = raw.categoryId;
    } else migrated = true;
  }
  if (own(raw, "valueDisplay")) {
    if (typeof raw.valueDisplay === "string" && VALUE_DISPLAYS.has(raw.valueDisplay)) {
      saved.valueDisplay = raw.valueDisplay as AppPreferences["valueDisplay"];
    } else migrated = true;
  }
  if (own(raw, "density")) {
    if (typeof raw.density === "string" && DENSITIES.has(raw.density)) {
      saved.density = raw.density as AppPreferences["density"];
    } else migrated = true;
  }
  if (own(raw, "theme")) {
    if (typeof raw.theme === "string" && APP_THEMES.has(raw.theme)) {
      saved.theme = raw.theme as AppPreferences["theme"];
    } else migrated = true;
  }
  if (own(raw, "textScale")) {
    if (typeof raw.textScale === "string" && TEXT_SCALES.has(raw.textScale)) {
      saved.textScale = raw.textScale as AppPreferences["textScale"];
    } else migrated = true;
  }
  if (own(raw, "reducedMotion")) {
    if (typeof raw.reducedMotion === "boolean") saved.reducedMotion = raw.reducedMotion;
    else migrated = true;
  }
  if (own(raw, "colorVision")) {
    if (
      typeof raw.colorVision === "string" &&
      COLOR_VISION_MODES.has(raw.colorVision)
    ) saved.colorVision = raw.colorVision as AppPreferences["colorVision"];
    else migrated = true;
  }
  if (own(raw, "sidebarCollapsed")) {
    if (typeof raw.sidebarCollapsed === "boolean") {
      saved.sidebarCollapsed = raw.sidebarCollapsed;
    } else migrated = true;
  }
  if (own(raw, "refreshMinutes")) {
    if (
      finiteNumber(raw.refreshMinutes) &&
      raw.refreshMinutes >= 1 &&
      raw.refreshMinutes <= 24 * 60
    ) saved.refreshMinutes = raw.refreshMinutes;
    else migrated = true;
  }
  if (own(raw, "lastViewed")) {
    if (Array.isArray(raw.lastViewed)) {
      saved.lastViewed = raw.lastViewed.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      );
      if (!sameStoredValue(raw.lastViewed, saved.lastViewed)) migrated = true;
    } else migrated = true;
  }

  const rawSources = isRecord(raw.sourceByCategory) ? raw.sourceByCategory : {};
  if (own(raw, "sourceByCategory") && !isRecord(raw.sourceByCategory)) migrated = true;
  const sourceByCategory: Record<string, DataSource> = {};
  for (const [categoryId, source] of Object.entries(rawSources)) {
    const category = categoryById[categoryId];
    if (!category || !isDataSource(source)) {
      migrated = true;
      continue;
    }
    if (!sourceIsSupported(categoryId, source)) {
      sourceByCategory[categoryId] = defaultSource(category);
      migrated = true;
      continue;
    }
    sourceByCategory[categoryId] = source;
  }

  const rawWatchlist = Array.isArray(raw.watchlist) ? raw.watchlist : [];
  if (own(raw, "watchlist") && !Array.isArray(raw.watchlist)) migrated = true;
  const safeWatchlist = rawWatchlist.flatMap((entry): WatchEntry[] => {
    const sanitized = sanitizeWatchEntry(entry);
    if (!sanitized) {
      migrated = true;
      return [];
    }
    if (!sameStoredValue(entry, sanitized)) migrated = true;
    return [sanitized];
  });
  const migratedWatchlist = options.invalidateLegacyDivineValues
    ? safeWatchlist.map((entry): WatchEntry => {
      migrated = true;
      return {
        ...entry,
        marketFetchedAt: undefined,
        marketStale: true,
        row: { ...entry.row, divineValue: null },
      };
    })
    : safeWatchlist;
  const watchByIdentity = new Map<string, WatchEntry>();
  for (const entry of migratedWatchlist) {
    const identity = `${entry.league}\u0000${entry.key}`;
    const existing = watchByIdentity.get(identity);
    if (!existing) {
      watchByIdentity.set(identity, entry);
      continue;
    }
    migrated = true;
    const freshness = (candidate: WatchEntry) =>
      (candidate.marketStale === true ? -1 : 0) +
      (candidate.marketFetchedAt != null ? 2 : 0);
    const preferred = freshness(entry) > freshness(existing) ? entry : existing;
    const fallback = preferred === entry ? existing : entry;
    watchByIdentity.set(identity, {
      ...preferred,
      addedAt: Math.min(preferred.addedAt, fallback.addedAt),
      targetPrice: preferred.targetPrice ?? fallback.targetPrice,
      targetUnit: preferred.targetUnit ?? fallback.targetUnit,
      note: preferred.note ?? fallback.note,
    });
  }
  const watchlist = [...watchByIdentity.values()];

  return {
    stored: {
      ...saved,
      sourceByCategory,
      watchlist,
    },
    migrated,
  };
}
