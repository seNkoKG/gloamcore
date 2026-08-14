import type { AppPreferences } from "../types";
import { Preferences } from "@capacitor/preferences";
import { isNativeMobile } from "./platform";
import { migrateStoredPreferences } from "./preference-migration";
import {
  readMigratedStorage,
  retiredProductStorageKey,
} from "./storage-migration";

export const PREFERENCES_STORAGE_KEY = "gloamcore:preferences:v1";
const LEGACY_STORAGE_KEYS = [
  retiredProductStorageKey("preferences:v1"),
  "poe-economy-widget:preferences:v1",
] as const;
const STORAGE_SCHEMA = 3;
const PREVIOUS_STORAGE_SCHEMA = 2;

interface StoredPreferencesRecord {
  schema: typeof PREVIOUS_STORAGE_SCHEMA | typeof STORAGE_SCHEMA;
  revision: number;
  updatedAt: number;
  preferences: unknown;
}

export interface DecodedPreferencesRecord {
  schema: 0 | typeof PREVIOUS_STORAGE_SCHEMA | typeof STORAGE_SCHEMA;
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
  theme: "gloam",
  textScale: "normal",
  reducedMotion: false,
  colorVision: "standard",
  sidebarCollapsed: false,
  refreshMinutes: 5,
  watchlist: [],
  lastViewed: [],
};

export function applyDisplayPreferences(
  preferences: Pick<
    AppPreferences,
    "theme" | "textScale" | "reducedMotion" | "colorVision"
  >,
  root: Pick<HTMLElement, "dataset">,
) {
  root.dataset.theme = preferences.theme;
  root.dataset.textScale = preferences.textScale;
  root.dataset.reducedMotion = preferences.reducedMotion ? "true" : "false";
  root.dataset.colorVision = preferences.colorVision;
}

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
      (value.schema === STORAGE_SCHEMA ||
        value.schema === PREVIOUS_STORAGE_SCHEMA) &&
      "preferences" in value
    ) {
      return {
        schema: value.schema,
        revision: validRevision(value.revision),
        updatedAt: Math.max(0, Number(value.updatedAt) || 0),
        preferences: value.preferences,
        serialized,
        legacy: value.schema !== STORAGE_SCHEMA,
      };
    }
    return {
      schema: 0,
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
    readMigratedStorage(
      localStorage,
      PREFERENCES_STORAGE_KEY,
      LEGACY_STORAGE_KEYS,
    ),
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
    .then(() => Preferences.set({
      key: PREFERENCES_STORAGE_KEY,
      value: serialized,
    }))
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

export function normalizeStoredPreferences(
  value: unknown,
  invalidateLegacyDivineValues = false,
): {
  preferences: AppPreferences;
  migrated: boolean;
} {
  const migration = migrateStoredPreferences(value, {
    invalidateLegacyDivineValues,
  });

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
    const local = decodePreferencesRecord(
      readMigratedStorage(
        localStorage,
        PREFERENCES_STORAGE_KEY,
        LEGACY_STORAGE_KEYS,
      ),
    );
    const { value } = await Preferences.get({ key: PREFERENCES_STORAGE_KEY });
    let native = decodePreferencesRecord(value);
    if (!native) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        native = decodePreferencesRecord((await Preferences.get({ key: legacyKey })).value);
        if (native) break;
      }
    }
    const winner = selectNewestPreferencesRecord(local, native);
    if (!winner) return;

    const normalized = normalizeStoredPreferences(
      winner.preferences,
      winner.schema !== STORAGE_SCHEMA,
    );
    const needsUpgrade = winner.legacy || normalized.migrated;
    const revision = needsUpgrade
      ? Math.max(Date.now(), currentPreferenceRevision + 1)
      : winner.revision;
    const updatedAt = needsUpgrade ? Date.now() : winner.updatedAt;
    const serialized = needsUpgrade
      ? encodePreferencesRecord(normalized.preferences, revision, updatedAt)
      : winner.serialized;
    currentPreferenceRevision = Math.max(currentPreferenceRevision, revision);
    localStorage.setItem(PREFERENCES_STORAGE_KEY, serialized);
    if (native?.serialized !== serialized) {
      await Preferences.set({
        key: PREFERENCES_STORAGE_KEY,
        value: serialized,
      });
    }
  } catch {
    // The newer WebView copy remains available if native storage is unavailable.
  }
}

export function loadPreferences(): AppPreferences {
  try {
    const record = decodePreferencesRecord(
      readMigratedStorage(
        localStorage,
        PREFERENCES_STORAGE_KEY,
        LEGACY_STORAGE_KEYS,
      ),
    );
    const normalized = normalizeStoredPreferences(
      record?.preferences || {},
      record != null && record.schema !== STORAGE_SCHEMA,
    );
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
    localStorage.setItem(PREFERENCES_STORAGE_KEY, serialized);
  } catch {
    try {
      serialized = encodePreferencesRecord(
        compactPreferences(preferences),
        revision,
        updatedAt,
      );
      localStorage.setItem(PREFERENCES_STORAGE_KEY, serialized);
    } catch {
      // The active in-memory settings remain usable if browser storage is unavailable.
    }
  }
  if (serialized) enqueueNativePreferenceWrite(serialized);
}
