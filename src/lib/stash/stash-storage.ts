import { STASH_FAMILY_ORDER } from "./stash-classify";
import type {
  StashFamilyValue,
  StashSession,
  StashSnapshot,
  StashSnapshotHistory,
  StashTabSummaryValue,
  StashTopItem,
} from "./stash-types";
import {
  readMigratedStorage,
  retiredProductStorageKey,
} from "../storage-migration";

const SNAPSHOTS_KEY = "gloamcore:stash:snapshots:v1";
const SESSION_KEY = "gloamcore:stash:session:v1";
const LEGACY_SNAPSHOTS_KEYS = [
  retiredProductStorageKey("stash:snapshots:v1"),
] as const;
const LEGACY_SESSION_KEYS = [
  retiredProductStorageKey("stash:session:v1"),
] as const;
const MAX_SNAPSHOTS = 400;
const MAX_STORED_BYTES = 4 * 1024 * 1024;

function isFamilyValue(value: unknown): value is StashFamilyValue {
  return (
    value != null &&
    typeof value === "object" &&
    Number.isFinite((value as StashFamilyValue).chaos) &&
    Number.isFinite((value as StashFamilyValue).divine) &&
    Number.isFinite((value as StashFamilyValue).count)
  );
}

function isTabSummary(value: unknown): value is StashTabSummaryValue {
  if (value == null || typeof value !== "object") return false;
  const tab = value as StashTabSummaryValue;
  return (
    typeof tab.id === "string" &&
    typeof tab.name === "string" &&
    Array.isArray(tab.path) &&
    Number.isFinite(tab.itemCount) &&
    Number.isFinite(tab.pricedItemCount) &&
    Number.isFinite(tab.unpricedItemCount) &&
    Number.isFinite(tab.chaos) &&
    Number.isFinite(tab.divine)
  );
}

function isTopItem(value: unknown): value is StashTopItem {
  if (value == null || typeof value !== "object") return false;
  const item = value as StashTopItem;
  return (
    typeof item.name === "string" &&
    typeof item.family === "string" &&
    Number.isFinite(item.quantity) &&
    Number.isFinite(item.chaos)
  );
}

function isSnapshot(value: unknown): value is StashSnapshot {
  if (value == null || typeof value !== "object") return false;
  const snapshot = value as StashSnapshot;
  if (snapshot.version !== 1) return false;
  if (typeof snapshot.league !== "string" || typeof snapshot.realm !== "string") return false;
  if (!Number.isFinite(snapshot.createdAt)) return false;
  if (!Number.isFinite(snapshot.chaos) || !Number.isFinite(snapshot.divine)) return false;
  if (!Array.isArray(snapshot.tabs) || !snapshot.tabs.every(isTabSummary)) return false;
  if (!Array.isArray(snapshot.topItems) || !snapshot.topItems.every(isTopItem)) return false;
  if (!isFamilyRecord(snapshot.families)) return false;
  return true;
}

function isFamilyRecord(value: unknown): value is Partial<Record<string, StashFamilyValue>> {
  if (value == null || typeof value !== "object") return false;
  return Object.values(value).every((entry) => entry == null || isFamilyValue(entry));
}

function isStashSession(value: unknown): value is StashSession {
  if (value == null || typeof value !== "object") return false;
  const session = value as StashSession;
  return (
    session.version === 1 &&
    typeof session.league === "string" &&
    typeof session.realm === "string" &&
    Number.isFinite(session.lastSyncAt) &&
    [0, 15, 30, 60].includes(session.autoSyncMinutes)
  );
}

function readStoredJson<T>(
  key: string,
  legacyKeys: readonly string[],
  validate: (value: unknown) => value is T,
): T | null {
  try {
    const raw = readMigratedStorage(localStorage, key, legacyKeys);
    if (!raw) return null;
    if (new TextEncoder().encode(raw).byteLength > MAX_STORED_BYTES) return null;
    const parsed = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredJson<T>(key: string, value: T) {
  try {
    const raw = JSON.stringify(value);
    if (new TextEncoder().encode(raw).byteLength > MAX_STORED_BYTES) return false;
    localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function loadStashSnapshotHistory(): StashSnapshotHistory {
  const stored = readStoredJson(SNAPSHOTS_KEY, LEGACY_SNAPSHOTS_KEYS, (value): value is StashSnapshotHistory => {
    if (value == null || typeof value !== "object") return false;
    const history = value as StashSnapshotHistory;
    return (
      history.version === 1 &&
      Array.isArray(history.snapshots) &&
      history.snapshots.every(isSnapshot)
    );
  });
  if (stored) {
    stored.snapshots = stored.snapshots
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_SNAPSHOTS);
    return stored;
  }
  return { version: 1, snapshots: [] };
}

export function pushStashSnapshot(snapshot: StashSnapshot, history: StashSnapshotHistory) {
  const next = [...history.snapshots, snapshot]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_SNAPSHOTS);
  const updated: StashSnapshotHistory = { version: 1, snapshots: next };
  if (!writeStoredJson(SNAPSHOTS_KEY, updated)) return false;
  history.snapshots = next;
  return true;
}

export function clearStashSnapshots() {
  try {
    localStorage.removeItem(SNAPSHOTS_KEY);
  } catch {
    // Storage is unavailable; nothing to clear.
  }
}

export function loadStashSession(): StashSession | null {
  return readStoredJson(SESSION_KEY, LEGACY_SESSION_KEYS, isStashSession);
}

export function saveStashSession(session: StashSession) {
  writeStoredJson(SESSION_KEY, session);
}

export function familiesFromSnapshot(snapshot: StashSnapshot) {
  const families = snapshot.families || {};
  return STASH_FAMILY_ORDER.filter((family) => {
    const value = families[family];
    return value != null && (value.chaos > 0 || value.count > 0);
  }).map((family) => ({ family, value: families[family] as StashFamilyValue }));
}

export { STASH_FAMILY_ORDER };

/** Snapshot family rollup for display, including only non-empty families. */
export function snapshotFamilies(snapshot: StashSnapshot) {
  return familiesFromSnapshot(snapshot);
}
