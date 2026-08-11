import type { PriceCheckHistoryEntry } from "./types";
import {
  readMigratedStorage,
  retiredProductStorageKey,
} from "../storage-migration";

const HISTORY_KEY = "gloamcore:price-check-history:v1";
const LEGACY_HISTORY_KEYS = [
  retiredProductStorageKey("price-check-history:v1"),
] as const;
let pendingHistorySave: PriceCheckHistoryEntry[] | null = null;
let pendingHistorySaveTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPendingHistorySave() {
  if (pendingHistorySaveTimer != null) clearTimeout(pendingHistorySaveTimer);
  pendingHistorySaveTimer = null;
  pendingHistorySave = null;
}

function looksLikeHistoryEntry(value: unknown): value is PriceCheckHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PriceCheckHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.checkedAt === "number" &&
    Number.isFinite(entry.checkedAt) &&
    typeof entry.league === "string" &&
    Boolean(entry.item && typeof entry.item === "object") &&
    Boolean(entry.estimate && typeof entry.estimate === "object")
  );
}
export function loadPriceCheckHistory(): PriceCheckHistoryEntry[] {
  try {
    const parsed = JSON.parse(
      readMigratedStorage(localStorage, HISTORY_KEY, LEGACY_HISTORY_KEYS) || "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(looksLikeHistoryEntry).slice(0, 200);
  } catch {
    return [];
  }
}

export function savePriceCheckHistory(entries: PriceCheckHistoryEntry[]) {
  cancelPendingHistorySave();
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 200)));
  } catch {
    // A current result remains usable if the local history quota is unavailable.
  }
}

/**
 * Keeps the synchronous localStorage write out of the item-capture render task.
 * A history snapshot can be hundreds of kilobytes, and Chromium's synchronous
 * LevelDB bridge occasionally stalls while compacting it. Coalescing the write
 * into the next task lets React commit the freshly parsed overlay first while
 * preserving the same durable history contents.
 */
export function schedulePriceCheckHistorySave(entries: PriceCheckHistoryEntry[]) {
  pendingHistorySave = entries.slice(0, 200);
  if (pendingHistorySaveTimer != null) return;
  pendingHistorySaveTimer = setTimeout(() => {
    const pending = pendingHistorySave;
    pendingHistorySaveTimer = null;
    pendingHistorySave = null;
    if (!pending) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(pending));
    } catch {
      // A current result remains usable if the local history quota is unavailable.
    }
  }, 0);
}

export function clearPriceCheckHistory() {
  cancelPendingHistorySave();
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // Storage can be unavailable in locked-down browser previews.
  }
}
