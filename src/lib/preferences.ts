import type { AppPreferences } from "../types";
import { Preferences } from "@capacitor/preferences";
import { isNativeMobile } from "./platform";
import { migrateStoredPreferences } from "./preference-migration";

const STORAGE_KEY = "ninja-lens:preferences:v1";
const LEGACY_STORAGE_KEY = "poe-economy-widget:preferences:v1";
const STORAGE_SCHEMA = 2;

interface StoredPreferencesRecord {
  schema: typeof STORAGE_SCHEMA;
  revision: number;
  updatedAt: number;
  preferences: unknown;
}

export interface DecodedPreferencesRecord {
  revision: number;
  updatedAt: number;
  preferences: unknown;
  serialized: string;
  legacy: boolean;
}

let currentPreferenceRevision = 0;
let nativePreferenceWriteChain: Promise<void> = Promise.resolve();

export const defaultPreferences: AppPreferences = {
  categoryId: "currency",
  sourceByCategory: {},
  valueDisplay: "adaptive",
  density: "compact",
  sidebarCollapsed: false,
  refreshMinutes: 5,
  watchlist: [],
  lastViewed: [],
};

function validRevision(value: unknown) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function decodePreferencesRecord(
  serialized: string | null | undefined,
): DecodedPreferencesRecord | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<StoredPreferencesRecord>;
    if (
      value &&
      typeof value === "object" &&
      value.schema === STORAGE_SCHEMA &&
      "preferences" in value
    ) {
      return {
        revision: validRevision(value.revision),
        updatedAt: Math.max(0, Number(value.updatedAt) || 0),
        preferences: value.preferences,
        serialized,
        legacy: false,
      };
    }
    return {
      revision: 0,
      updatedAt: 0,
      preferences: value,
      serialized,
      legacy: true,
    };
  } catch {
    return null;
  }
}

export function selectNewestPreferencesRecord(
  local: DecodedPreferencesRecord | null,
  native: DecodedPreferencesRecord | null,
) {
  if (!local) return native;
  if (!native) return local;
  if (native.revision > local.revision) return native;
  if (local.revision > native.revision) return local;
  if (native.updatedAt > local.updatedAt) return native;
  return local;
}

function encodePreferencesRecord(
  preferences: AppPreferences | unknown,
  revision: number,
  updatedAt: number,
) {
  return JSON.stringify({
    schema: STORAGE_SCHEMA,
    revision,
    updatedAt,
    preferences,
  } satisfies StoredPreferencesRecord);
}

function nextPreferenceRevision() {
  const local = decodePreferencesRecord(
    localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY),
  );
  currentPreferenceRevision = Math.max(
    currentPreferenceRevision,
    local?.revision || 0,
  );
  currentPreferenceRevision = Math.max(
    currentPreferenceRevision + 1,
    Date.now(),
  );
  return currentPreferenceRevision;
}

function enqueueNativePreferenceWrite(serialized: string) {
  if (!isNativeMobile) return;
  nativePreferenceWriteChain = nativePreferenceWriteChain
    .then(() => Preferences.set({ key: STORAGE_KEY, value: serialized }))
    .then(
      () => undefined,
      () => undefined,
    );
}

function compactPreferences(preferences: AppPreferences): AppPreferences {
  return {
    ...preferences,
    watchlist: preferences.watchlist.map((entry) => ({
      ...entry,
      row: {
        ...entry.row,
        metadata: undefined,
        implicitModifiers: [],
        explicitModifiers: [],
        mutatedModifiers: [],
        flavourText: undefined,
        tradeFilter: undefined,
      },
    })),
  };
}

export function normalizeStoredPreferences(value: unknown): {
  preferences: AppPreferences;
  migrated: boolean;
} {
  const migration = migrateStoredPreferences(value);

  return {
    preferences: {
      ...defaultPreferences,
      ...migration.stored,
    },
    migrated: migration.migrated,
  };
}

export async function hydratePreferences() {
  if (!isNativeMobile) return;
  try {
    const local =
      decodePreferencesRecord(localStorage.getItem(STORAGE_KEY)) ??
      decodePreferencesRecord(localStorage.getItem(LEGACY_STORAGE_KEY));
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    const native = decodePreferencesRecord(value) ??
      decodePreferencesRecord(
        (await Preferences.get({ key: LEGACY_STORAGE_KEY })).value,
      );
    const winner = selectNewestPreferencesRecord(local, native);
    if (!winner) return;

    const needsUpgrade = winner.legacy;
    const revision = needsUpgrade
      ? Math.max(Date.now(), currentPreferenceRevision + 1)
      : winner.revision;
    const updatedAt = needsUpgrade ? Date.now() : winner.updatedAt;
    const serialized = needsUpgrade
      ? encodePreferencesRecord(winner.preferences, revision, updatedAt)
      : winner.serialized;
    currentPreferenceRevision = Math.max(currentPreferenceRevision, revision);
    localStorage.setItem(STORAGE_KEY, serialized);
    if (native?.serialized !== serialized) {
      await Preferences.set({ key: STORAGE_KEY, value: serialized });
    }
  } catch {
    // The newer WebView copy remains available if native storage is unavailable.
  }
}

export function loadPreferences(): AppPreferences {
  try {
    const record =
      decodePreferencesRecord(localStorage.getItem(STORAGE_KEY)) ??
      decodePreferencesRecord(localStorage.getItem(LEGACY_STORAGE_KEY));
    const normalized = normalizeStoredPreferences(record?.preferences || {});
    if (normalized.migrated || record?.legacy) savePreferences(normalized.preferences);
    return normalized.preferences;
  } catch {
    return defaultPreferences;
  }
}

export function savePreferences(preferences: AppPreferences) {
  const revision = nextPreferenceRevision();
  const updatedAt = Date.now();
  let serialized = "";
  try {
    serialized = encodePreferencesRecord(preferences, revision, updatedAt);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    try {
      serialized = encodePreferencesRecord(
        compactPreferences(preferences),
        revision,
        updatedAt,
      );
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // The active in-memory settings remain usable if browser storage is unavailable.
    }
  }
  if (serialized) enqueueNativePreferenceWrite(serialized);
}
