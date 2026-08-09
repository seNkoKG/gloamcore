import type {
  ParsedPoeItem,
  PriceCheckHistoryEntry,
} from "./types";

export interface PriceCheckHistoryTrend {
  entries: PriceCheckHistoryEntry[];
  values: number[];
  sampleCount: number;
  medianChaos: number | null;
  lowChaos: number | null;
  highChaos: number | null;
  changePercent: number | null;
  direction: "rising" | "falling" | "flat" | "unknown";
  stable: boolean;
  ageMs: number | null;
}

export interface HistorySelectionOptions {
  league?: string;
  selectedMatchKey?: string;
  limit?: number;
  now?: number;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 500;
const DEDUPE_WINDOW_MS = 30_000;

function normalize(value?: string) {
  return (value || "")
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function rounded(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function boundedLimit(value?: number) {
  if (!finiteNumber(value)) return DEFAULT_HISTORY_LIMIT;
  return Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(value)));
}

function quantile(sorted: readonly number[], position: number) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Stable identity used for deduplication and trend selection. Rare/magic items
 * include their modifier IDs and rolls so unlike rares are never mixed together.
 */
export function priceCheckItemFingerprint(item: ParsedPoeItem) {
  const state = [
    normalize(item.rarity),
    normalize(item.name),
    normalize(item.baseType),
    item.gemLevel ?? "",
    item.quality ?? "",
    item.mapTier ?? "",
    item.links ?? "",
    item.itemLevel ?? "",
    item.stackSize ?? "",
    item.corrupted ? 1 : 0,
    item.mirrored ? 1 : 0,
    item.split ? 1 : 0,
    item.replica ? 1 : 0,
    item.synthesised ? 1 : 0,
    item.fractured ? 1 : 0,
    item.veiled ? 1 : 0,
    item.foil ? 1 : 0,
    item.scourged ? 1 : 0,
    item.foulborn ? 1 : 0,
    item.identified ? 1 : 0,
    [...item.influences].map(normalize).sort().join(","),
  ];

  if (item.rarity === "rare" || item.rarity === "magic") {
    state.push(
      item.modifiers
        .map((modifier) =>
          [
            normalize(modifier.kind),
            normalize(modifier.id || modifier.normalizedText || modifier.text),
            ...modifier.values.map(rounded),
          ].join(":"),
        )
        .sort()
        .join("|"),
    );
  }

  return state.join("~");
}

function estimateNear(left: number | null, right: number | null) {
  if (left == null || right == null) return left === right;
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / scale <= 0.005;
}

function isNearDuplicate(
  left: PriceCheckHistoryEntry,
  right: PriceCheckHistoryEntry,
) {
  return (
    left.league === right.league &&
    left.selectedMatchKey === right.selectedMatchKey &&
    priceCheckItemFingerprint(left.item) === priceCheckItemFingerprint(right.item) &&
    Math.abs(left.checkedAt - right.checkedAt) <= DEDUPE_WINDOW_MS &&
    estimateNear(left.estimate.chaosValue, right.estimate.chaosValue)
  );
}

/**
 * Adds a newest-first history entry, replacing duplicate captures and enforcing
 * a hard upper bound so clipboard checks cannot grow storage indefinitely.
 */
export function appendPriceCheckHistory(
  history: readonly PriceCheckHistoryEntry[],
  entry: PriceCheckHistoryEntry,
  maxEntries = DEFAULT_HISTORY_LIMIT,
) {
  const withoutDuplicates = history.filter(
    (candidate) => candidate.id !== entry.id && !isNearDuplicate(candidate, entry),
  );
  return [entry, ...withoutDuplicates]
    .sort((left, right) => right.checkedAt - left.checkedAt || left.id.localeCompare(right.id))
    .slice(0, boundedLimit(maxEntries));
}

export const addPriceCheckHistory = appendPriceCheckHistory;

export function selectPriceCheckHistory(
  history: readonly PriceCheckHistoryEntry[],
  item: ParsedPoeItem,
  options: HistorySelectionOptions = {},
) {
  const fingerprint = priceCheckItemFingerprint(item);
  const limit = boundedLimit(options.limit);
  const now = options.now ?? Date.now();
  return history
    .filter(
      (entry) =>
        finiteNumber(entry.checkedAt) &&
        entry.checkedAt >= 0 &&
        entry.checkedAt <= now &&
        priceCheckItemFingerprint(entry.item) === fingerprint &&
        (options.league == null || entry.league === options.league) &&
        (options.selectedMatchKey == null ||
          entry.selectedMatchKey === options.selectedMatchKey),
    )
    .sort((left, right) => right.checkedAt - left.checkedAt || left.id.localeCompare(right.id))
    .slice(0, limit);
}

/** Builds robust, outlier-resistant local trend evidence from previous checks. */
export function getPriceCheckHistoryTrend(
  history: readonly PriceCheckHistoryEntry[],
  item: ParsedPoeItem,
  options: HistorySelectionOptions = {},
): PriceCheckHistoryTrend {
  const now = options.now ?? Date.now();
  const entries = selectPriceCheckHistory(history, item, options).filter(
    (entry) =>
      entry.estimate.confidence !== "none" &&
      finiteNumber(entry.estimate.chaosValue) &&
      entry.estimate.chaosValue > 0,
  );
  const values = entries.map((entry) => entry.estimate.chaosValue as number);
  const sorted = [...values].sort((left, right) => left - right);
  const medianChaos = quantile(sorted, 0.5);
  const lowChaos = quantile(sorted, 0.25);
  const highChaos = quantile(sorted, 0.75);

  let changePercent: number | null = null;
  let direction: PriceCheckHistoryTrend["direction"] = "unknown";
  if (values.length >= 2) {
    const newest = values[0];
    const oldest = values[values.length - 1];
    if (oldest > 0) {
      changePercent = ((newest - oldest) / oldest) * 100;
      direction = changePercent > 5 ? "rising" : changePercent < -5 ? "falling" : "flat";
    }
  }

  const interquartileSpread =
    medianChaos && lowChaos != null && highChaos != null
      ? (highChaos - lowChaos) / medianChaos
      : Number.POSITIVE_INFINITY;

  return {
    entries,
    values,
    sampleCount: values.length,
    medianChaos,
    lowChaos,
    highChaos,
    changePercent,
    direction,
    stable: values.length >= 3 && interquartileSpread <= 0.25,
    ageMs: entries.length ? now - entries[0].checkedAt : null,
  };
}

export const getLocalHistoryEvidence = getPriceCheckHistoryTrend;
