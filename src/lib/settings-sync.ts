import type { DesktopSettings, DesktopSettingsPatch } from "../types";

const BOOLEAN_SETTING_KEYS = [
  "alwaysOnTop",
  "compact",
  "clickThrough",
  "startMinimized",
  "autoCheckUpdates",
] as const;
const SHORTCUT_KEYS = [
  "toggleWidget",
  "toggleClickThrough",
  "instantSearch",
  "focusItemSearch",
  "gameDataSearch",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function shortcutText(value: unknown) {
  return typeof value === "string" ? value.slice(0, 80).trim() : "";
}

export function normalizeSettingsRevision(value: unknown) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function mergePendingSettingFields<T extends object>(
  remote: T,
  local: T,
  pendingKeys: Iterable<keyof T>,
) {
  const merged = { ...remote };
  for (const key of pendingKeys) merged[key] = local[key];
  return merged;
}

export function reconcileSettingsSnapshot<T extends object>({
  authoritative,
  authoritativeRevision,
  incoming,
  incomingRevision,
  local,
  pendingKeys,
}: {
  authoritative: T;
  authoritativeRevision: number;
  incoming: T;
  incomingRevision: unknown;
  local: T;
  pendingKeys: Iterable<keyof T>;
}) {
  const revision = normalizeSettingsRevision(incomingRevision);
  const accepted = revision >= authoritativeRevision;
  const nextAuthoritative = accepted ? incoming : authoritative;
  const nextRevision = accepted ? revision : authoritativeRevision;
  return {
    accepted,
    authoritative: nextAuthoritative,
    authoritativeRevision: nextRevision,
    visible: mergePendingSettingFields(
      nextAuthoritative,
      local,
      pendingKeys,
    ),
  };
}

export function mergeDesktopSettingsPatch(
  current: DesktopSettings,
  patch: DesktopSettingsPatch,
): DesktopSettings {
  return {
    ...current,
    ...patch,
    shortcuts: patch.shortcuts
      ? { ...current.shortcuts, ...patch.shortcuts }
      : { ...current.shortcuts },
    priceCheck: patch.priceCheck
      ? { ...current.priceCheck, ...patch.priceCheck }
      : { ...current.priceCheck },
  };
}

/**
 * Runtime boundary shared by browser/mobile settings. It mirrors the native
 * process contract: unknown scalar types are ignored, bounded numeric values
 * are normalized, and a supplied nested object is rebuilt from known fields.
 */
export function sanitizeDesktopSettingsPatch(
  value: unknown,
  current: DesktopSettings,
): DesktopSettingsPatch {
  if (!isRecord(value)) return {};
  const sanitized: DesktopSettingsPatch = {};
  for (const key of BOOLEAN_SETTING_KEYS) {
    if (typeof value[key] === "boolean") sanitized[key] = value[key];
  }
  if (value.updateChannel === "stable" || value.updateChannel === "preview") {
    sanitized.updateChannel = value.updateChannel;
  }
  if (typeof value.opacity === "number" && Number.isFinite(value.opacity)) {
    sanitized.opacity = Math.max(0.65, Math.min(1, value.opacity));
  }

  if (isRecord(value.shortcuts)) {
    const candidate = value.shortcuts;
    const shortcuts = { ...current.shortcuts };
    for (const key of SHORTCUT_KEYS) {
      if (key in candidate) shortcuts[key] = shortcutText(candidate[key]);
    }
    sanitized.shortcuts = shortcuts;
  }

  if (isRecord(value.priceCheck)) {
    const candidate = value.priceCheck;
    const previous = current.priceCheck;
    sanitized.priceCheck = {
      ...previous,
      enabled: typeof candidate.enabled === "boolean"
        ? candidate.enabled
        : previous.enabled,
      hotkey: "hotkey" in candidate
        ? shortcutText(candidate.hotkey)
        : previous.hotkey,
      captureMode: "auto-copy",
      openNearCursor: typeof candidate.openNearCursor === "boolean"
        ? candidate.openNearCursor
        : previous.openNearCursor,
      closeOnBlur: typeof candidate.closeOnBlur === "boolean"
        ? candidate.closeOnBlur
        : previous.closeOnBlur,
      pinByDefault: typeof candidate.pinByDefault === "boolean"
        ? candidate.pinByDefault
        : previous.pinByDefault,
      rollTolerance: Math.max(
        0,
        Math.min(50, Math.round(finiteNumber(candidate.rollTolerance, previous.rollTolerance))),
      ),
      defaultOnlineOnly: typeof candidate.defaultOnlineOnly === "boolean"
        ? candidate.defaultOnlineOnly
        : previous.defaultOnlineOnly,
      rememberHistory: typeof candidate.rememberHistory === "boolean"
        ? candidate.rememberHistory
        : previous.rememberHistory,
      maxHistory: Math.max(
        0,
        Math.min(200, Math.round(finiteNumber(candidate.maxHistory, previous.maxHistory))),
      ),
      showAdvanced: typeof candidate.showAdvanced === "boolean"
        ? candidate.showAdvanced
        : previous.showAdvanced,
      legacyBehavior: typeof candidate.legacyBehavior === "boolean"
        ? candidate.legacyBehavior
        : previous.legacyBehavior,
    };
  }
  return sanitized;
}

export function sanitizeDesktopSettingsSnapshot(
  value: unknown,
  fallback: DesktopSettings,
) {
  return mergeDesktopSettingsPatch(
    fallback,
    sanitizeDesktopSettingsPatch(value, fallback),
  );
}

export function cloneDesktopSettings(
  settings: DesktopSettings,
  revision = normalizeSettingsRevision(settings.settingsRevision),
): DesktopSettings {
  return {
    ...settings,
    settingsRevision: revision,
    shortcuts: { ...settings.shortcuts },
    priceCheck: { ...settings.priceCheck },
  };
}

export function createSerialTaskQueue<TInput, TOutput>(
  task: (input: TInput) => Promise<TOutput>,
) {
  let tail: Promise<void> = Promise.resolve();
  return {
    run(input: TInput) {
      const result = tail.then(() => task(input));
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    waitForIdle() {
      return tail;
    },
  };
}
