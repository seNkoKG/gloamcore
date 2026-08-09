import type { DesktopSettings, DesktopSettingsPatch } from "../types";

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
