"use strict";

const MAX_TRANSFER_BYTES = 32 * 1024 * 1024;
const MAX_STORAGE_VALUE_BYTES = 12 * 1024 * 1024;
const WORKSPACE_SCHEMA = "gloamcore-workspace";
const SUPPORT_SCHEMA = "gloamcore-support";
const STORAGE_KEYS = Object.freeze([
  "gloamcore:preferences:v1",
  "gloamcore:atlas-command-center:v1",
  "gloamcore:active-planner-workspace:v1",
  "gloamcore:saved-planner-builds:v1",
  "gloamcore:league-navigator:v1",
  "gloamcore:poe-event-log:filters:v1",
  "gloamcore:toolkit:regex-profiles:v2",
  "gloamcore:price-check-history:v1",
  "gloamcore:toolkit-workspace:v1",
]);

const STORAGE_KEY_SET = new Set(STORAGE_KEYS);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function shortText(value, maximum = 160) {
  return typeof value === "string"
    ? value.replace(/[\0\r\n]/g, " ").trim().slice(0, maximum)
    : "";
}

function sanitizeRendererStorage(value) {
  const source = record(value);
  const output = {};
  let total = 0;
  for (const key of STORAGE_KEYS) {
    if (typeof source[key] !== "string") continue;
    const bytes = Buffer.byteLength(source[key], "utf8");
    if (bytes > MAX_STORAGE_VALUE_BYTES || total + bytes > MAX_TRANSFER_BYTES) {
      throw new Error("Workspace data exceeds the 32 MB transfer safety limit.");
    }
    output[key] = source[key];
    total += bytes;
  }
  return output;
}

function sanitizeNative(value) {
  const source = record(value);
  return {
    settings: record(source.settings),
    toolkit: record(source.toolkit),
    mapModCheck: record(source.mapModCheck),
    mappingJournal: record(source.mappingJournal),
    eventLog: record(source.eventLog),
  };
}

function createWorkspaceBackup({ appVersion, renderer, native, createdAt = Date.now() }) {
  return {
    schema: WORKSPACE_SCHEMA,
    version: 1,
    createdAt: Math.max(0, Number(createdAt) || 0),
    appVersion: shortText(appVersion, 40),
    renderer: sanitizeRendererStorage(renderer),
    native: sanitizeNative(native),
  };
}

function parseWorkspaceBackup(value) {
  const source = record(value);
  if (source.schema !== WORKSPACE_SCHEMA || source.version !== 1) {
    throw new Error("This is not a supported GloamCore workspace backup.");
  }
  return createWorkspaceBackup({
    appVersion: source.appVersion,
    createdAt: source.createdAt,
    renderer: source.renderer,
    native: source.native,
  });
}

function boundedCount(value, maximum = 10_000_000) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0
    ? Math.min(maximum, number)
    : 0;
}

function sanitizeSupportContext(value) {
  const source = record(value);
  const display = record(source.display);
  const data = record(source.data);
  const storage = record(source.storage);
  const capabilities = record(source.capabilities);
  return {
    display: {
      theme: shortText(display.theme, 32),
      density: shortText(display.density, 32),
      textScale: shortText(display.textScale, 32),
      reducedMotion: Boolean(display.reducedMotion),
      colorVision: shortText(display.colorVision, 32),
    },
    data: {
      gameVersion: shortText(data.gameVersion, 40),
      revision: shortText(data.revision, 100),
      atlasNodes: boundedCount(data.atlasNodes),
      gems: boundedCount(data.gems),
    },
    storage: Object.fromEntries(
      ["preferences", "atlasPresets", "savedBuilds", "filterCheckpoints", "toolkitMacros"]
        .map((key) => [key, boundedCount(storage[key])]),
    ),
    capabilities: Object.fromEntries(
      ["pobEngine", "desktopUpdater", "toolkitFiles", "mappingJournal"]
        .map((key) => [key, Boolean(capabilities[key])]),
    ),
  };
}

function createSupportBundle({ appVersion, platform, arch, packaged, portable, update, context, createdAt = Date.now() }) {
  const safeUpdate = record(update);
  return {
    schema: SUPPORT_SCHEMA,
    version: 1,
    createdAt: Math.max(0, Number(createdAt) || 0),
    app: {
      version: shortText(appVersion, 40),
      platform: shortText(platform, 24),
      arch: shortText(arch, 24),
      packaged: Boolean(packaged),
      portable: Boolean(portable),
    },
    update: {
      status: shortText(safeUpdate.status, 32),
      channel: safeUpdate.channel === "preview" ? "preview" : "stable",
      feedConfigured: Boolean(safeUpdate.feedConfigured),
      currentVersion: shortText(safeUpdate.currentVersion, 40),
      availableVersion: shortText(safeUpdate.version, 40),
    },
    ...sanitizeSupportContext(context),
    privacy: {
      includesPaths: false,
      includesCharacterNames: false,
      includesItemText: false,
      includesCookiesOrTokens: false,
    },
  };
}

module.exports = {
  MAX_TRANSFER_BYTES,
  STORAGE_KEYS,
  STORAGE_KEY_SET,
  SUPPORT_SCHEMA,
  WORKSPACE_SCHEMA,
  createSupportBundle,
  createWorkspaceBackup,
  parseWorkspaceBackup,
  sanitizeRendererStorage,
  sanitizeSupportContext,
};
