import type { ToolkitPlugin, ToolkitWorkspace } from "../../types";

const MAX_PLUGIN_STORAGE_KEYS = 64;
const MAX_PLUGIN_STORAGE_VALUE_CHARS = 16 * 1024;
const MAX_PLUGIN_STORAGE_CHARS = 128 * 1024;

export function assertPersistablePluginStorage(storage: Record<string, string>) {
  const entries = Object.entries(storage);
  if (entries.length > MAX_PLUGIN_STORAGE_KEYS) throw new Error("Plugin storage is limited to 64 keys.");
  let total = 0;
  for (const [key, value] of entries) {
    if (!/^[a-z0-9_.:-]{1,80}$/i.test(key)) throw new Error("Plugin storage keys may contain only letters, numbers, dots, colons, underscores, and dashes.");
    if (typeof value !== "string" || value.includes("\0") || value.length > MAX_PLUGIN_STORAGE_VALUE_CHARS) {
      throw new Error("Each plugin storage value is limited to 16 KB of text.");
    }
    total += key.length + value.length;
  }
  if (total > MAX_PLUGIN_STORAGE_CHARS) throw new Error("Plugin storage is limited to 128 KB.");
  return storage;
}

function sameActivationState(left: ToolkitPlugin, right: ToolkitPlugin) {
  return left.name === right.name &&
    left.url === right.url &&
    left.enabled === right.enabled &&
    left.game === right.game &&
    left.permissions.currentItem === right.permissions.currentItem &&
    left.permissions.gameCapture === right.permissions.gameCapture &&
    left.permissions.openExternal === right.permissions.openExternal;
}

/** Returns only a saved plugin whose draft activation/capability state is unchanged. */
export function persistedPluginForPreview(
  draft: ToolkitWorkspace,
  persisted: ToolkitWorkspace | null,
  pluginId: string,
) {
  const draftPlugin = draft.plugins.find((entry) => entry.id === pluginId);
  const savedPlugin = persisted?.plugins.find((entry) => entry.id === pluginId);
  return draftPlugin && savedPlugin?.enabled && sameActivationState(draftPlugin, savedPlugin)
    ? savedPlugin
    : null;
}

/** Applies host-owned storage to the saved snapshot, never to unrelated draft fields. */
export function workspaceWithPersistedPluginStorage(
  persisted: ToolkitWorkspace,
  pluginId: string,
  storage: Record<string, string>,
) {
  const plugin = persisted.plugins.find((entry) => entry.id === pluginId);
  if (!plugin?.enabled) throw new Error("Save and enable this plugin before it can store data.");
  assertPersistablePluginStorage(storage);
  return {
    ...persisted,
    plugins: persisted.plugins.map((entry) => entry.id === pluginId ? { ...entry, storage } : entry),
  };
}

/** Reflects a successful storage write without discarding the user's unsaved editor draft. */
export function mergePersistedPluginStorageIntoDraft(
  draft: ToolkitWorkspace,
  persisted: ToolkitWorkspace,
  pluginId: string,
) {
  const savedStorage = persisted.plugins.find((entry) => entry.id === pluginId)?.storage;
  if (!savedStorage) return draft;
  return {
    ...draft,
    plugins: draft.plugins.map((entry) => entry.id === pluginId ? { ...entry, storage: savedStorage } : entry),
  };
}

/** Storage is host-owned; a stale editor snapshot must not roll it back on Save. */
export function workspaceWithLatestPersistedPluginStorage(
  draft: ToolkitWorkspace,
  persisted: ToolkitWorkspace | null,
) {
  if (!persisted) return draft;
  const storageById = new Map(persisted.plugins.map((entry) => [entry.id, entry.storage]));
  return {
    ...draft,
    plugins: draft.plugins.map((entry) => storageById.has(entry.id)
      ? { ...entry, storage: storageById.get(entry.id)! }
      : entry),
  };
}
