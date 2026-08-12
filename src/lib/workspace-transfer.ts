import type { SupportBundleContext } from "../types";

export const WORKSPACE_STORAGE_KEYS = [
  "gloamcore:preferences:v1",
  "gloamcore:atlas-command-center:v1",
  "gloamcore:active-planner-workspace:v1",
  "gloamcore:saved-planner-builds:v1",
  "gloamcore:league-navigator:v1",
  "gloamcore:poe-event-log:filters:v1",
  "gloamcore:toolkit:regex-profiles:v2",
  "gloamcore:price-check-history:v1",
  "gloamcore:toolkit-workspace:v1",
] as const;

const MAX_TRANSFER_BYTES = 32 * 1024 * 1024;

function allowedWorkspaceStorage(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    WORKSPACE_STORAGE_KEYS.flatMap((key) =>
      typeof source[key] === "string" ? [[key, source[key]]] : []
    ),
  );
}

function shortText(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.replace(/[\0\r\n]/g, " ").trim().slice(0, maximum)
    : "";
}

function boundedCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(10_000_000, count) : 0;
}

function safeSupportContext(value: unknown): SupportBundleContext {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<SupportBundleContext>
    : {};
  return {
    display: {
      theme: shortText(source.display?.theme, 32),
      density: shortText(source.display?.density, 32),
      textScale: shortText(source.display?.textScale, 32),
      reducedMotion: Boolean(source.display?.reducedMotion),
      colorVision: shortText(source.display?.colorVision, 32),
    },
    data: {
      gameVersion: shortText(source.data?.gameVersion, 40),
      revision: shortText(source.data?.revision, 100),
      atlasNodes: boundedCount(source.data?.atlasNodes),
      gems: boundedCount(source.data?.gems),
    },
    storage: {
      preferences: boundedCount(source.storage?.preferences),
      atlasPresets: boundedCount(source.storage?.atlasPresets),
      savedBuilds: boundedCount(source.storage?.savedBuilds),
      filterCheckpoints: boundedCount(source.storage?.filterCheckpoints),
      toolkitMacros: boundedCount(source.storage?.toolkitMacros),
    },
    capabilities: {
      pobEngine: Boolean(source.capabilities?.pobEngine),
      desktopUpdater: Boolean(source.capabilities?.desktopUpdater),
      toolkitFiles: Boolean(source.capabilities?.toolkitFiles),
      mappingJournal: Boolean(source.capabilities?.mappingJournal),
    },
  };
}

export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function pickWorkspaceJson() {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
  if (!file) return null;
  if (file.size > MAX_TRANSFER_BYTES) {
    throw new Error("Workspace backup exceeds the 32 MB transfer safety limit.");
  }
  const value = JSON.parse(await file.text()) as Record<string, unknown>;
  if (value.schema !== "gloamcore-workspace" || value.version !== 1) {
    throw new Error("This is not a supported GloamCore workspace backup.");
  }
  return allowedWorkspaceStorage(value.renderer);
}

export function browserWorkspaceBackup(appVersion: string, renderer: Record<string, string>) {
  return {
    schema: "gloamcore-workspace",
    version: 1,
    createdAt: Date.now(),
    appVersion,
    renderer: allowedWorkspaceStorage(renderer),
    native: {},
  };
}

export function browserSupportBundle(appVersion: string, context: SupportBundleContext) {
  return {
    schema: "gloamcore-support",
    version: 1,
    createdAt: Date.now(),
    app: { version: appVersion, platform: "web", arch: "web", packaged: false, portable: false },
    ...safeSupportContext(context),
    privacy: {
      includesPaths: false,
      includesCharacterNames: false,
      includesItemText: false,
      includesCookiesOrTokens: false,
    },
  };
}

export function collectWorkspaceStorage(storage: Storage = localStorage) {
  return Object.fromEntries(
    WORKSPACE_STORAGE_KEYS.flatMap((key) => {
      const value = storage.getItem(key);
      return value == null ? [] : [[key, value]];
    }),
  );
}

export function applyWorkspaceStorage(
  value: Record<string, string>,
  storage: Storage = localStorage,
) {
  const allowed = new Set<string>(WORKSPACE_STORAGE_KEYS);
  for (const key of WORKSPACE_STORAGE_KEYS) storage.removeItem(key);
  for (const [key, item] of Object.entries(value)) {
    if (allowed.has(key) && typeof item === "string") storage.setItem(key, item);
  }
}

function parsedCount(value: string | null, select: (parsed: unknown) => number) {
  if (!value) return 0;
  try {
    return Math.max(0, select(JSON.parse(value)) || 0);
  } catch {
    return 0;
  }
}

export function supportContext(input: {
  theme: string;
  density: string;
  textScale: string;
  reducedMotion: boolean;
  colorVision: string;
  gameVersion?: string;
  revision?: string;
  atlasNodes?: number;
  gems?: number;
  pobEngine?: boolean;
}): SupportBundleContext {
  return {
    display: {
      theme: input.theme,
      density: input.density,
      textScale: input.textScale,
      reducedMotion: input.reducedMotion,
      colorVision: input.colorVision,
    },
    data: {
      gameVersion: input.gameVersion || "",
      revision: input.revision || "",
      atlasNodes: input.atlasNodes || 0,
      gems: input.gems || 0,
    },
    storage: {
      preferences: localStorage.getItem("gloamcore:preferences:v1") ? 1 : 0,
      atlasPresets: parsedCount(
        localStorage.getItem("gloamcore:atlas-command-center:v1"),
        (value) => Array.isArray((value as { loadouts?: unknown[] })?.loadouts)
          ? (value as { loadouts: unknown[] }).loadouts.length
          : 0,
      ),
      savedBuilds: parsedCount(
        localStorage.getItem("gloamcore:saved-planner-builds:v1"),
        (value) => Array.isArray(value) ? value.length : 0,
      ),
      filterCheckpoints: 0,
      toolkitMacros: 0,
    },
    capabilities: {
      pobEngine: Boolean(input.pobEngine),
      desktopUpdater: Boolean(window.poeWidget),
      toolkitFiles: Boolean(window.poeWidget),
      mappingJournal: Boolean(window.poeWidget),
    },
  };
}
