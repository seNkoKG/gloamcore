const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { fileURLToPath } = require("node:url");
const { loadTrayIcon } = require("./tray-icon.cjs");
const {
  readConfiguredFeedUrl,
  UpdateService,
} = require("./update-service.cjs");
const {
  OverlayController,
  OVERLAY_WINDOW_OPTS,
} = require("electron-overlay-window");
const {
  createLatestItemCaptureQueue,
  createOneKeyItemCapture,
} = require("./one-key-capture.cjs");
const {
  priceCheckBlurDisposition,
  priceCheckPassiveInteractionArea,
  priceCheckPassivePanelArea,
  priceCheckPointerExitDisposition,
  shouldAcceptPriceCheckOverlayFocus,
  shouldArmPriceCheckPassiveWatch,
  shouldRestartPriceCheckPanelWatch,
  shouldRestorePriceCheckTargetFocus,
} = require("./price-check-focus-policy.cjs");
const {
  assignCaptureIdentity,
  canReadPriceCheckCapture,
  createDashboardCapture,
  sanitizePriceCheckDashboardSnapshot,
  sendPriceCheckCaptureToWindow,
} = require("./price-check-handoff.cjs");
const {
  createRendererCommandQueue,
} = require("./renderer-command-queue.cjs");
const { canAccessSettings } = require("./settings-access.cjs");
const { fetchTrustedLimited } = require("./bounded-remote-fetch.cjs");
const {
  createOfficialTradeListingService,
} = require("./official-trade-listings.cjs");
const { createToolkitFileService } = require("./toolkit-files.cjs");
const { decodePobBuild, encodePobBuild } = require("./pob-planner.cjs");
const { createPobEngineDispatcher } = require("./pob-engine-dispatch.cjs");
const { createPobPlannerDispatcher } = require("./pob-planner-dispatch.cjs");
const { createPoeCharacterService } = require("./poe-character-import.cjs");
const { createToolkitRuntimeStore } = require("./toolkit-runtime.cjs");
const {
  isLeaguePayload,
  isOverviewPayload,
  isWikiCargoPayload,
  isWikiImageMetadataPayload,
} = require("./market-payload-validation.cjs");
const {
  DEFAULT_DESKTOP_SHORTCUTS,
  registerGlobalShortcutSetBestEffort,
  replaceGlobalShortcutPlan,
  replaceGlobalShortcutSet,
  sanitizeDesktopShortcuts,
  validateShortcut,
  validateShortcutPlan,
} = require("./shortcut-settings.cjs");

const API_ROOT = "https://poe.ninja";
const WIKI_API_ROOT = "https://www.poewiki.net/w/api.php";
const USER_AGENT = `Ninja-Lens/${app.getVersion()} (personal desktop widget)`;
const officialTradeListingService = createOfficialTradeListingService({
  userAgent: USER_AGENT,
});
const pobEngineDispatcher = createPobEngineDispatcher({
  engineOptions: { resourcesPath: process.resourcesPath },
});
const pobPlannerDispatcher = createPobPlannerDispatcher();
const poeCharacterService = createPoeCharacterService({ userAgent: USER_AGENT });
let toolkitFileService = null;
let toolkitRuntimeStore = null;
let registeredToolkitMacros = new Set();
let toolkitStashScrollProcess = null;
let toolkitStashScrollConfig = "";

function getToolkitFileService() {
  if (!toolkitFileService) {
    toolkitFileService = createToolkitFileService({
      dialog,
      userDataDirectory: app.getPath("userData"),
    });
  }
  return toolkitFileService;
}

function getToolkitRuntimeStore() {
  if (!toolkitRuntimeStore) {
    toolkitRuntimeStore = createToolkitRuntimeStore(app.getPath("userData"));
    toolkitRuntimeStore.load();
  }
  return toolkitRuntimeStore;
}
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_MARKET_STALE_MS = 2 * 60 * 60 * 1000;
const MAX_MARKET_JSON_BYTES = 64 * 1024 * 1024;
const MAX_WIKI_IMAGE_BYTES = 2 * 1024 * 1024;
const MARKET_CACHE_VERSION = "v2";
const WIKI_TOOLTIP_TTL_MS = 24 * 60 * 60 * 1000;
const WIKI_KNOWLEDGE_TTL_MS = 60 * 60 * 1000;
const WIKI_ICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const TRAY_CLICK_DEBOUNCE_MS = 180;
const TRAY_PANEL_WIDTH = 372;
const TRAY_PANEL_HEIGHT = 500;
const QUICK_SEARCH_WIDTH = 720;
const QUICK_SEARCH_HEIGHT = 570;
// Match Awakened's 28.75rem desktop card at Chromium's 16px root size. The
// native panel still clamps this width to the target game's usable work area.
const PRICE_CHECK_WIDTH = 460;
const PRICE_CHECK_MAX_REQUESTED_HEIGHT = 4096;
const PRICE_CHECK_EMPTY_HEIGHT = 72;
const PRICE_CHECK_PANEL_GAP = 8;
const PRICE_CHECK_FOCUS_TIMEOUT_MS = 750;
const POE_WINDOW_TITLE = "Path of Exile";
const MAX_CLIPBOARD_ITEM_BYTES = 65_536;
const MAX_TRADE_STAT_CATALOG_BYTES = 8 * 1024 * 1024;
const TRADE_STAT_CATALOG_SHA256 = "42a6c5722c0a49a65d76155a2d01005e6dc36aa3db6f95a356a7316596bc304c";
const MAX_REGEX_DATA_BYTES = 12 * 1024 * 1024;
const REGEX_DATA_SHA256 = "ea0b93a6498a2af2f9f467e6945c392f7aee89b7344de27e8c64434a2e9e57cc";
const DEFAULT_PRICE_CHECK_HOTKEY = "CommandOrControl+D";
const DEFAULT_LOCKED_PRICE_CHECK_HOTKEY = "CommandOrControl+Alt+D";
const PRICE_CHECK_CLIPBOARD_TIMEOUT_MS = 600;
const PRICE_CHECK_PENDING_TTL_MS = 15_000;
const NATIVE_INPUT_OUTPUT_LIMIT = 1024;
const POE_PROCESS_NAMES = Object.freeze([
  "PathOfExile.exe",
  "PathOfExileSteam.exe",
  "PathOfExileEGS.exe",
  "PathOfExile_x64.exe",
  "PathOfExile_x64Steam.exe",
  "PathOfExile_x64EGS.exe",
]);
const TRUSTED_RENDERER_PATH = path.resolve(__dirname, "..", "dist", "index.html");
const DEV_RUNTIME = !app.isPackaged;
const START_MINIMIZED = process.argv.includes("--start-minimized");
const QA_RUNTIME = DEV_RUNTIME || (
  process.argv.includes("--ninja-lens-qa-smoke") &&
  Boolean(process.env.POE_WIDGET_QA_USER_DATA_PATH) &&
  Boolean(process.env.POE_WIDGET_QA_RESULT_PATH)
);
const DEV_SERVER_URL = (() => {
  if (!DEV_RUNTIME || !process.env.VITE_DEV_SERVER_URL) return "";
  try {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
    return url.protocol === "http:" &&
      loopback.has(url.hostname) &&
      !url.username &&
      !url.password
      ? url.toString()
      : "";
  } catch {
    return "";
  }
})();
const QA_OPEN_SURFACE = QA_RUNTIME ? process.env.POE_WIDGET_QA_OPEN_SURFACE || "" : "";
const QA_USER_DATA_PATH = QA_RUNTIME ? process.env.POE_WIDGET_QA_USER_DATA_PATH : undefined;
const QA_CLIPBOARD_BASE64 = QA_RUNTIME ? process.env.POE_WIDGET_QA_CLIPBOARD_BASE64 : undefined;
const QA_CLIPBOARD_TEXT = QA_RUNTIME ? process.env.POE_WIDGET_QA_CLIPBOARD_TEXT : undefined;
const QA_TARGET_TITLE = QA_RUNTIME ? process.env.POE_WIDGET_QA_TARGET_TITLE || "" : "";
const QA_RESULT_PATH = QA_RUNTIME ? process.env.POE_WIDGET_QA_RESULT_PATH || "" : "";
const QA_NATIVE_CAPTURE = Boolean(
  QA_RUNTIME &&
  QA_OPEN_SURFACE === "price-check" &&
  QA_USER_DATA_PATH &&
  QA_RESULT_PATH &&
  process.env.POE_WIDGET_QA_CAPTURE_TEST === "1",
);
const QA_EXPAND_OPTIONAL_STATS = Boolean(
  QA_NATIVE_CAPTURE && process.env.POE_WIDGET_QA_EXPAND_STATS === "1",
);
const FOCUS_TRACE_ENABLED = DEV_RUNTIME && process.env.POE_WIDGET_FOCUS_TRACE === "1";
const mainCommandQueue = createRendererCommandQueue();

if (QA_USER_DATA_PATH) {
  const qaPath = path.resolve(QA_USER_DATA_PATH);
  const tempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tempRoot, qaPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("QA user-data path must be a dedicated child of the system temp folder.");
  }
  if (app.isPackaged) {
    const resultPath = path.resolve(QA_RESULT_PATH);
    const resultRelative = path.relative(qaPath, resultPath);
    if (
      !resultRelative ||
      resultRelative.startsWith("..") ||
      path.isAbsolute(resultRelative)
    ) {
      throw new Error("Packaged QA output must stay inside its dedicated temp profile.");
    }
  }
  app.setPath("userData", qaPath);
}
const ALLOWED_EXTERNAL_HOSTS = new Set([
  "poe.ninja",
  "www.pathofexile.com",
  "www.poewiki.net",
  "www.craftofexile.com",
  "craftofexile.com",
  "poedb.tw",
  "www.poedb.tw",
]);
const memoryCache = new Map();
const remoteJsonInflight = new Map();

let mainWindow;
let trayWindow;
let quickWindow;
let priceCheckWindow;
const toolkitOverlayWindows = new Map();
const toolkitOverlayGeometryTimers = new Map();
let tray;
let trayClickTimer;
let updateService;
let lastPriceCheckCapture = null;
let pendingPriceCheckDashboardCapture = null;
let pendingPriceCheckDashboardCaptureExpiresAt = 0;
let priceCheckDashboardHandoffGeneration = 0;
let priceCheckPinned = false;
let priceCheckOverlayAttached = false;
let priceCheckOverlayHasAccess = true;
let priceCheckOverlayVisible = false;
let priceCheckOverlayInteractive = false;
let priceCheckActivationPending = false;
let priceCheckActivationGeneration = 0;
let priceCheckOverlayRevision = 0;
let priceCheckOverlayMessage = "";
let priceCheckPanelBounds = null;
let priceCheckRequestedHeight = PRICE_CHECK_EMPTY_HEIGHT;
let priceCheckOverlayShapeApplied = false;
let priceCheckGeometryTimer = null;
let pendingPriceCheckCapture = null;
let pendingPriceCheckRestorePinned = false;
let pendingPriceCheckCaptureExpiresAt = 0;
let pendingPriceCheckCaptureGeneration = 0;
let priceCheckCaptureGeneration = 0;
let priceCheckCaptureFocusHandoffCount = 0;
let priceCheckCapturePreparationAudit = null;
let configuredPriceCheckHotkey = "";
let registeredPriceCheckHotkey = "";
let registeredLockedPriceCheckHotkey = "";
let priceCheckShortcutWarning = "";
let priceCheckPresentationMode = "hidden";
let priceCheckPanelWatchAbort = null;
let priceCheckPromotionTracksPointerExit = false;
const priceCheckLifecycleEvents = [];
let registeredDesktopShortcuts = {};
let desktopShortcutWarning = "";
let priceCheckQaScheduled = false;
let bundledTradeStatCatalogText = null;
let bundledRegexDataText = null;
let priceCheckQaCaptureScheduled = false;
let priceCheckFocusRestoreAudit = null;
let settingsNeedPersist = false;
let settingsRevision = 0;
let settings = {
  alwaysOnTop: true,
  opacity: 1,
  compact: false,
  clickThrough: false,
  startMinimized: false,
  autoCheckUpdates: true,
  shortcuts: { ...DEFAULT_DESKTOP_SHORTCUTS },
  priceCheck: {
    enabled: true,
    hotkey: DEFAULT_PRICE_CHECK_HOTKEY,
    captureMode: "auto-copy",
    openNearCursor: true,
    closeOnBlur: true,
    pinByDefault: false,
    rollTolerance: 10,
    defaultOnlineOnly: true,
    rememberHistory: true,
    maxHistory: 50,
    showAdvanced: false,
    legacyBehavior: false,
  },
  // The renderer card moves inside the fixed game-sized overlay host. Store
  // its anchor as percentages so it survives resolution and DPI changes.
  priceCheckPanelPosition: null,
  bounds: null,
  expandedBounds: null,
};
let surfaceState = {
  league: "",
  categoryLabel: "Currency",
  stale: false,
  loading: true,
  alertCount: 0,
  alerts: [],
  topMovers: [],
  searchRows: [],
  update: {
    status: "unconfigured",
    currentVersion: app.getVersion(),
    message: "Update hosting is not connected yet",
    feedConfigured: false,
  },
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function cacheDirectory() {
  return path.join(app.getPath("userData"), "economy-cache");
}

function safeCacheName(key) {
  return `${key.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}.json`;
}

function cachePath(key) {
  return path.join(cacheDirectory(), safeCacheName(key));
}

const RETIRED_CACHE_PATTERNS = Object.freeze([
  /^faustus-(?:hour|metadata)-.*\.json$/i,
  /^(?!v2-)[a-z0-9_-]+-(?:exchange|stash)-(?:currency|item)-.*\.json$/i,
  /^poe1-leagues\.json$/i,
]);

async function cleanupRetiredCacheFiles() {
  try {
    const directory = cacheDirectory();
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            RETIRED_CACHE_PATTERNS.some((pattern) => pattern.test(entry.name)),
        )
        .map((entry) =>
          fs.promises.unlink(path.join(directory, entry.name)).catch(() => undefined),
        ),
    );
  } catch {
    // A missing or locked cache never blocks startup; current keys remain valid.
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    settings = {
      ...settings,
      ...saved,
      shortcuts: sanitizeDesktopShortcuts(
        saved && typeof saved.shortcuts === "object" ? saved.shortcuts : {},
        settings.shortcuts,
      ),
      priceCheck: {
        ...settings.priceCheck,
        ...(saved && typeof saved.priceCheck === "object"
          ? saved.priceCheck
          : {}),
      },
      priceCheckPanelPosition: sanitizePriceCheckPanelPosition(
        saved?.priceCheckPanelPosition,
      ),
    };
    if (settings.priceCheck.openNearCursor) {
      settings.priceCheckPanelPosition = null;
    }
    delete settings.settingsRevision;
    if (priceCheckHotkeyError(settings.priceCheck.hotkey)) {
      settings.priceCheck.hotkey = DEFAULT_PRICE_CHECK_HOTKEY;
      settingsNeedPersist = true;
    } else if (settings.priceCheck.hotkey === "CommandOrControl+Shift+D") {
      // v2.1 replaces the old two-step clipboard shortcut with one-key capture.
      settings.priceCheck.hotkey = DEFAULT_PRICE_CHECK_HOTKEY;
      settingsNeedPersist = true;
    }
    let planError = validateShortcutPlan(settings);
    if (planError) {
      settings.shortcuts = { ...DEFAULT_DESKTOP_SHORTCUTS };
      planError = validateShortcutPlan(settings);
      if (planError) settings.priceCheck.hotkey = DEFAULT_PRICE_CHECK_HOTKEY;
      settingsNeedPersist = true;
    }
    if (settings.priceCheck.captureMode !== "auto-copy") {
      settings.priceCheck.captureMode = "auto-copy";
      settingsNeedPersist = true;
    }
  } catch {
    // First launch or an invalid settings file: defaults are intentional.
  }
}

function persistSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  const persistedSettings = { ...settings };
  delete persistedSettings.settingsRevision;
  delete persistedSettings.shortcutWarning;
  const serialized = JSON.stringify(persistedSettings, null, 2);
  const temporaryPath = `${settingsPath()}.tmp`;
  fs.writeFileSync(temporaryPath, serialized, "utf8");
  fs.renameSync(temporaryPath, settingsPath());
  settingsRevision += 1;
}

function settingsForRenderer() {
  return {
    ...settings,
    settingsRevision,
    shortcutWarning: desktopShortcutWarning || undefined,
    priceCheck: {
      ...settings.priceCheck,
      shortcutWarning: priceCheckShortcutWarning || undefined,
    },
  };
}

function parseMaxAge(cacheControl, fallback = DEFAULT_TTL_MS) {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl || "");
  return match ? Number(match[1]) * 1000 : fallback;
}

function responseAgeMs(headers) {
  const seconds = Number(headers.get("age"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function responseSourceTime(headers, now = Date.now()) {
  const parsedDate = Date.parse(headers.get("date") || "");
  const responseTime =
    Number.isFinite(parsedDate) && Math.abs(parsedDate - now) < 10 * 60 * 1000
      ? parsedDate
      : now;
  return Math.min(now, Math.max(0, responseTime - responseAgeMs(headers)));
}

function cacheTimestampAge(fetchedAt, now = Date.now()) {
  const age = now - Number(fetchedAt);
  return Number.isFinite(age) && age >= 0 ? age : null;
}

function responseRemainingTtl(headers, fallback, minimum = 0) {
  const cacheControl = headers.get("cache-control") || "";
  const hasSourceLifetime = /(?:^|,)\s*max-age=\d+/i.test(cacheControl);
  const lifetime = parseMaxAge(cacheControl, fallback);
  return Math.max(
    1_000,
    minimum,
    lifetime - (hasSourceLifetime ? responseAgeMs(headers) : 0),
  );
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      !url.username &&
      !url.password &&
      ALLOWED_EXTERNAL_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

function openExternalUrl(value) {
  if (!isAllowedExternalUrl(value)) {
    throw new Error("This external destination is not allowed.");
  }
  return shell.openExternal(new URL(value).toString());
}

function isTrustedRendererUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      if (url.hostname) return false;
      return path.resolve(fileURLToPath(url)).toLowerCase() ===
        TRUSTED_RENDERER_PATH.toLowerCase();
    }
    if (!DEV_SERVER_URL) return false;
    return url.origin === new URL(DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || "";
  if (!isTrustedRendererUrl(senderUrl)) {
    throw new Error("Rejected an IPC request from an untrusted page.");
  }
}

async function readDiskCache(key) {
  try {
    const cached = JSON.parse(await fs.promises.readFile(cachePath(key), "utf8"));
    memoryCache.set(key, cached);
    return cached;
  } catch {
    return null;
  }
}

async function writeDiskCache(key, value) {
  await fs.promises.mkdir(cacheDirectory(), { recursive: true });
  const target = cachePath(key);
  const temporary = `${target}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(value), "utf8");
  await fs.promises.rename(temporary, target);
}

async function writeDiskCacheBestEffort(key, value) {
  try {
    await writeDiskCache(key, value);
  } catch (error) {
    console.warn(
      `Could not persist the ${key} cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function getCachedRemoteJsonUncoalesced(
  key,
  url,
  force = false,
  {
    defaultTtlMs = DEFAULT_TTL_MS,
    minimumTtlMs = 0,
    maxStaleMs = Number.POSITIVE_INFINITY,
    sourceName = "poe.ninja",
    validate,
  } = {},
) {
  const now = Date.now();
  let cached = memoryCache.get(key) || (await readDiskCache(key));
  if (cached && validate && !validate(cached.data)) {
    memoryCache.delete(key);
    cached = null;
  }
  if (cached && cacheTimestampAge(cached.fetchedAt, now) == null) {
    memoryCache.delete(key);
    cached = null;
  }

  if (!force && cached && cached.expiresAt > now) {
    return {
      data: cached.data,
      fetchedAt: cached.fetchedAt,
      expiresAt: cached.expiresAt,
      stale: false,
      cache: "fresh",
    };
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (cached?.etag) {
    headers["If-None-Match"] = cached.etag;
  }

  try {
    const { response, body } = await fetchTrustedLimited(url, {
      headers,
      kind: "json",
      label: sourceName,
      maximumBytes: MAX_MARKET_JSON_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (response.status === 304 && cached) {
      const checkedAt = Date.now();
      cached = {
        ...cached,
        fetchedAt: responseSourceTime(response.headers, checkedAt),
        expiresAt:
          checkedAt +
          responseRemainingTtl(
            response.headers,
            defaultTtlMs,
            minimumTtlMs,
          ),
      };
      memoryCache.set(key, cached);
      await writeDiskCacheBestEffort(key, cached);
      return {
        data: cached.data,
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
        stale: false,
        cache: "revalidated",
      };
    }

    if (!response.ok) {
      throw new Error(`${sourceName} returned ${response.status}`);
    }

    let data;
    try {
      data = JSON.parse(body.toString("utf8"));
    } catch {
      throw new Error(`${sourceName} returned invalid JSON.`);
    }
    if (validate && !validate(data)) {
      throw new Error(`${sourceName} returned an invalid market payload.`);
    }
    const checkedAt = Date.now();
    const maxAge = responseRemainingTtl(
      response.headers,
      defaultTtlMs,
      minimumTtlMs,
    );
    const value = {
      data,
      etag: response.headers.get("etag"),
      fetchedAt: responseSourceTime(response.headers, checkedAt),
      expiresAt: checkedAt + maxAge,
    };
    memoryCache.set(key, value);
    await writeDiskCacheBestEffort(key, value);
    return {
      data,
      fetchedAt: value.fetchedAt,
      expiresAt: value.expiresAt,
      stale: false,
      cache: "network",
    };
  } catch (error) {
    const cachedAge = cached ? cacheTimestampAge(cached.fetchedAt) : null;
    if (cached && cachedAge != null && cachedAge <= maxStaleMs) {
      return {
        data: cached.data,
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
        stale: true,
        cache: "stale",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}

async function getCachedRemoteJson(key, url, force = false, options = {}) {
  const normalKey = `${key}:normal`;
  const forceKey = `${key}:force`;
  const inflightKey = force ? forceKey : normalKey;
  const existing = force
    ? remoteJsonInflight.get(forceKey)
    : remoteJsonInflight.get(forceKey) || remoteJsonInflight.get(normalKey);
  if (existing) return existing;
  const weaker = force ? remoteJsonInflight.get(normalKey) : null;
  const request = weaker
    ? Promise.resolve(weaker)
        .catch(() => undefined)
        .then(() => getCachedRemoteJsonUncoalesced(key, url, true, options))
    : getCachedRemoteJsonUncoalesced(key, url, force, options);
  remoteJsonInflight.set(inflightKey, request);
  try {
    return await request;
  } finally {
    if (remoteJsonInflight.get(inflightKey) === request) {
      remoteJsonInflight.delete(inflightKey);
    }
  }
}

async function getCachedRemoteImageDataUrl(key, url) {
  const now = Date.now();
  let cached = memoryCache.get(key) || (await readDiskCache(key));
  if (
    cached &&
    (
      typeof cached.data !== "string" ||
      !/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(cached.data) ||
      cached.data.length > Math.ceil(MAX_WIKI_IMAGE_BYTES * 1.4)
    )
  ) {
    memoryCache.delete(key);
    cached = null;
  }
  if (cached && cacheTimestampAge(cached.fetchedAt, now) == null) {
    memoryCache.delete(key);
    cached = null;
  }
  if (cached && cached.expiresAt > now) return cached.data;

  const headers = {
    Accept: "image/avif,image/webp,image/png,image/*",
    "User-Agent": USER_AGENT,
  };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  try {
    const { response, body } = await fetchTrustedLimited(url, {
      headers,
      kind: "image",
      label: "PoE artwork",
      maximumBytes: MAX_WIKI_IMAGE_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (response.status === 304 && cached) {
      const checkedAt = Date.now();
      cached = {
        ...cached,
        fetchedAt: responseSourceTime(response.headers, checkedAt),
        expiresAt: checkedAt + WIKI_ICON_TTL_MS,
      };
      memoryCache.set(key, cached);
      await writeDiskCacheBestEffort(key, cached);
      return cached.data;
    }
    const mime = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!response.ok || !/^image\/(?:avif|gif|jpeg|png|webp)$/.test(mime)) {
      throw new Error(`PoE artwork returned ${response.status}`);
    }
    if (body.length === 0) {
      throw new Error("PoE artwork exceeded the safe size limit.");
    }
    const data = `data:${mime};base64,${body.toString("base64")}`;
    const checkedAt = Date.now();
    const value = {
      data,
      etag: response.headers.get("etag"),
      fetchedAt: responseSourceTime(response.headers, checkedAt),
      expiresAt:
        checkedAt +
        Math.max(
          WIKI_ICON_TTL_MS,
          parseMaxAge(response.headers.get("cache-control"), WIKI_ICON_TTL_MS),
        ),
    };
    memoryCache.set(key, value);
    await writeDiskCacheBestEffort(key, value);
    return data;
  } catch {
    return cached?.data;
  }
}

function getCachedJson(key, apiPath, force = false, kind = "overview") {
  return getCachedRemoteJson(key, `${API_ROOT}${apiPath}`, force, {
    maxStaleMs: kind === "leagues" ? 24 * 60 * 60 * 1000 : MAX_MARKET_STALE_MS,
    validate: kind === "leagues" ? isLeaguePayload : isOverviewPayload,
  });
}

function limitedTooltipString(value, maximum = 180) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}

function validateTooltipRequest(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid item tooltip request.");
  }
  const name = limitedTooltipString(value.name);
  if (!name) throw new Error("An item name is required for its tooltip.");
  return {
    name,
    baseType: limitedTooltipString(value.baseType) || undefined,
    categoryId: limitedTooltipString(value.categoryId, 100) || undefined,
    detailsId: limitedTooltipString(value.detailsId, 180) || undefined,
  };
}

function wikiTooltipUrl(request) {
  const fields = [
    "name",
    "base_item",
    "rarity",
    "class",
    "description",
    "help_text",
    "flavour_text",
    "implicit_stat_text",
    "explicit_stat_text",
    "enchantment_stat_text",
    "drop_level",
    "required_level",
    "frame_type",
    "inventory_icon",
    "metadata_id",
    "drop_text",
    "drop_areas",
    "drop_monsters",
    "acquisition_tags",
    "release_version",
    "drop_enabled",
    "is_in_game",
    "removal_version",
  ].join(",");
  const escapedName = request.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const search = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    limit: "10",
    tables: "items",
    fields,
    where: `name="${escapedName}"`,
  });
  return `${WIKI_API_ROOT}?${search}`;
}

function getItemTooltip(request) {
  const identity = request.detailsId || request.name;
  const key = `wiki-tooltip-${identity}-${request.baseType || ""}`;
  return getCachedRemoteJson(key, wikiTooltipUrl(request), false, {
    defaultTtlMs: WIKI_TOOLTIP_TTL_MS,
    minimumTtlMs: WIKI_TOOLTIP_TTL_MS,
    sourceName: "PoE Wiki",
    validate: isWikiCargoPayload,
  });
}

function validateKnowledgeRequest(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid knowledge search request.");
  }
  const query = limitedTooltipString(value.query, 80)
    .replace(/["\\%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (query.length < 2) {
    throw new Error("Enter at least two letters to search PoE knowledge.");
  }
  return {
    query,
    limit: Math.max(8, Math.min(40, Math.round(Number(value.limit) || 24))),
    force: Boolean(value.force),
  };
}

function wikiKnowledgeUrls(request) {
  const pattern = `%${request.query}%`;
  const common = {
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    limit: String(request.limit),
  };
  const itemSearch = new URLSearchParams({
    ...common,
    tables: "items",
    fields: [
      "name",
      "base_item",
      "rarity",
      "class",
      "description",
      "drop_level",
      "required_level",
      "frame_type",
      "inventory_icon",
      "metadata_id",
      "drop_text",
      "drop_areas",
      "drop_monsters",
      "acquisition_tags",
      "release_version",
      "drop_enabled",
      "is_in_game",
      "removal_version",
    ].join(","),
    where: `(name LIKE "${pattern}" OR base_item LIKE "${pattern}" OR class LIKE "${pattern}") AND is_in_game=1 AND removal_version IS NULL AND class!="Cosmetic Item" AND class!="Hideout Decoration"`,
  });
  const modifierSearch = new URLSearchParams({
    ...common,
    tables: "mods",
    fields: [
      "id",
      "name",
      "domain",
      "game_mode",
      "generation_type",
      "mod_groups",
      "mod_type",
      "required_level",
      "stat_text_raw",
      "tags",
      "tier_text",
    ].join(","),
    where: `(stat_text_raw LIKE "${pattern}" OR name LIKE "${pattern}") AND game_mode=0`,
  });
  return {
    items: `${WIKI_API_ROOT}?${itemSearch}`,
    modifiers: `${WIKI_API_ROOT}?${modifierSearch}`,
  };
}

function wikiKnowledgeIconTitles(payload) {
  const titles = new Set();
  for (const entry of payload?.cargoquery || []) {
    const record = entry?.title || {};
    const value = record.inventory_icon || record["inventory icon"];
    if (typeof value !== "string") continue;
    const normalized = value.replace(/_/g, " ").trim();
    if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(normalized)) continue;
    titles.add(/^File:/i.test(normalized) ? normalized : `File:${normalized}`);
  }
  return [...titles].slice(0, 40);
}

function wikiKnowledgeImagesUrl(titles) {
  const search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|mime|size",
    iiurlwidth: "128",
    titles: titles.join("|"),
  });
  return `${WIKI_API_ROOT}?${search}`;
}

async function getKnowledgeImages(items, force) {
  const titles = wikiKnowledgeIconTitles(items);
  if (titles.length === 0) return undefined;
  const digest = crypto
    .createHash("sha256")
    .update(titles.slice().sort().join("\u0000"))
    .digest("hex");
  try {
    const metadata = await getCachedRemoteJson(
      `wiki-knowledge-images-${digest}`,
      wikiKnowledgeImagesUrl(titles),
      force,
      {
        defaultTtlMs: WIKI_ICON_TTL_MS,
        minimumTtlMs: WIKI_ICON_TTL_MS,
        sourceName: "PoE Wiki images",
        validate: isWikiImageMetadataPayload,
      },
    );
    const pages = await Promise.all(
      (metadata.data?.query?.pages || []).map(async (page) => {
        const info = page?.imageinfo?.[0];
        const url = trustedWikiArtworkUrl(info?.thumburl || info?.url);
        if (!info || !url) return page;
        const artDigest = crypto.createHash("sha256").update(url).digest("hex");
        const dataUrl = await getCachedRemoteImageDataUrl(
          `wiki-artwork-${artDigest}`,
          url,
        );
        return dataUrl
          ? { ...page, imageinfo: [{ ...info, dataUrl }] }
          : page;
      }),
    );
    return {
      ...metadata,
      data: {
        ...metadata.data,
        query: { ...metadata.data?.query, pages },
      },
    };
  } catch {
    // Search content stays useful if artwork resolution is temporarily down.
    return undefined;
  }
}

function trustedWikiArtworkUrl(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "www.poewiki.net" &&
      url.pathname.startsWith("/images/")
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function getKnowledgeSearch(request) {
  const urls = wikiKnowledgeUrls(request);
  const digest = crypto
    .createHash("sha256")
    .update(`${request.query.toLowerCase()}:${request.limit}`)
    .digest("hex");
  const [items, modifiers] = await Promise.all([
    getCachedRemoteJson(
      `wiki-knowledge-items-${digest}`,
      urls.items,
      request.force,
      {
        defaultTtlMs: WIKI_KNOWLEDGE_TTL_MS,
        minimumTtlMs: WIKI_KNOWLEDGE_TTL_MS,
        sourceName: "PoE Wiki",
        validate: isWikiCargoPayload,
      },
    ),
    getCachedRemoteJson(
      `wiki-knowledge-modifiers-${digest}`,
      urls.modifiers,
      request.force,
      {
        defaultTtlMs: WIKI_KNOWLEDGE_TTL_MS,
        minimumTtlMs: WIKI_KNOWLEDGE_TTL_MS,
        sourceName: "PoE Wiki",
        validate: isWikiCargoPayload,
      },
    ),
  ]);
  const images = await getKnowledgeImages(items.data, request.force);
  const stale = items.stale || modifiers.stale || Boolean(images?.stale);
  return {
    data: {
      items: items.data,
      modifiers: modifiers.data,
      images: images?.data,
    },
    fetchedAt: Math.min(
      items.fetchedAt,
      modifiers.fetchedAt,
      images?.fetchedAt ?? Number.POSITIVE_INFINITY,
    ),
    expiresAt: Math.min(
      items.expiresAt,
      modifiers.expiresAt,
      images?.expiresAt ?? Number.POSITIVE_INFINITY,
    ),
    stale,
    cache: stale
      ? "stale"
      : items.cache === modifiers.cache
        ? items.cache
        : "network",
    error: [items.error, modifiers.error, images?.error]
      .filter(Boolean)
      .join("; ") || undefined,
  };
}

function overviewPath(request) {
  const league = encodeURIComponent(request.league);
  const type = encodeURIComponent(request.type);
  if (request.source === "exchange") {
    return `/poe1/api/economy/exchange/current/overview?league=${league}&type=${type}`;
  }
  if (request.source === "stash-currency") {
    return `/poe1/api/economy/stash/current/currency/overview?league=${league}&type=${type}`;
  }
  return `/poe1/api/economy/stash/current/item/overview?league=${league}&type=${type}`;
}

function createTrayIcon() {
  return loadTrayIcon(nativeImage, {
    resourcesPath: process.resourcesPath,
    appRoot: path.join(__dirname, ".."),
  });
}

function sendMainCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainCommandQueue.send(mainWindow, command);
}

function broadcastSettings() {
  const snapshot = settingsForRenderer();
  for (const window of [mainWindow, priceCheckWindow]) {
    safeSend(window, "settings:changed", snapshot);
  }
}

function assertSettingsSender(event) {
  assertTrustedSender(event);
  if (!canAccessSettings(event.sender, { mainWindow, priceCheckWindow })) {
    throw new Error("Only the dashboard and price checker can access settings.");
  }
}

function assertDashboardSender(event) {
  assertTrustedSender(event);
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Only the dashboard can use toolkit files.");
  }
}

function showMainWindow(command) {
  if (!mainWindow) return;
  if (priceCheckOverlayVisible) {
    deactivatePriceCheck({ focusTarget: false });
  }
  trayWindow?.hide();
  quickWindow?.hide();
  if (mainWindow.isMinimized()) mainWindow.restore();
  ensureWindowIsVisible();
  mainWindow.show();
  mainWindow.focus();
  if (command) sendMainCommand(command);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? "Hide widget" : "Show widget",
        ...(registeredDesktopShortcuts.toggleWidget
          ? { accelerator: registeredDesktopShortcuts.toggleWidget }
          : {}),
        click: () => toggleVisibility(),
      },
      {
        label: "Quick item search",
        ...(registeredDesktopShortcuts.instantSearch
          ? { accelerator: registeredDesktopShortcuts.instantSearch }
          : {}),
        click: () => showQuickSearch(),
      },
      {
        label: priceCheckShortcutWarning
          ? "Price check hovered item (shortcut unavailable)"
          : "Price check hovered item",
        ...(settings.priceCheck?.enabled && registeredPriceCheckHotkey
          ? { accelerator: registeredPriceCheckHotkey }
          : {}),
        enabled: true,
        click: () => showPriceCheck(),
      },
      {
        label: "Open watchlist",
        click: () => showMainWindow({ type: "open-watchlist" }),
      },
      {
        label: "Refresh prices",
        click: () => sendMainCommand({ type: "refresh-market" }),
      },
      { type: "separator" },
      {
        label: "Always on top",
        type: "checkbox",
        checked: Boolean(settings.alwaysOnTop),
        click: (item) => {
          settings.alwaysOnTop = item.checked;
          mainWindow?.setAlwaysOnTop(item.checked, "floating");
          persistSettings();
          sendMainCommand({
            type: "always-on-top",
            value: item.checked,
          });
        },
      },
      {
        label: "Click-through mode",
        type: "checkbox",
        checked: Boolean(settings.clickThrough),
        ...(registeredDesktopShortcuts.toggleClickThrough
          ? { accelerator: registeredDesktopShortcuts.toggleClickThrough }
          : {}),
        click: (item) => setClickThrough(item.checked),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function toggleVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
  updateTrayMenu();
}

function handleTrayClick() {
  clearTimeout(trayClickTimer);
  trayClickTimer = setTimeout(() => {
    trayClickTimer = null;
    toggleTrayPanel();
  }, TRAY_CLICK_DEBOUNCE_MS);
}

function setClickThrough(value) {
  settings.clickThrough = Boolean(value);
  mainWindow?.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  persistSettings();
  updateTrayMenu();
  sendMainCommand({
    type: "click-through",
    value: settings.clickThrough,
  });
}

function intersectsWorkArea(bounds, workArea) {
  const overlapWidth =
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
    Math.max(bounds.x, workArea.x);
  const overlapHeight =
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
    Math.max(bounds.y, workArea.y);
  return overlapWidth >= 80 && overlapHeight >= 80;
}

function visibleWindowBounds(savedBounds, compact = false) {
  const primary = screen.getPrimaryDisplay().workArea;
  const requestedWidth = compact
    ? 480
    : Number(savedBounds?.width) || 1440;
  const requestedHeight = compact
    ? 720
    : Number(savedBounds?.height) || 900;
  const width = Math.max(460, Math.min(requestedWidth, primary.width));
  const height = Math.max(560, Math.min(requestedHeight, primary.height));
  const requested = {
    width,
    height,
    x: Number.isFinite(Number(savedBounds?.x))
      ? Number(savedBounds.x)
      : primary.x + Math.round((primary.width - width) / 2),
    y: Number.isFinite(Number(savedBounds?.y))
      ? Number(savedBounds.y)
      : primary.y + Math.round((primary.height - height) / 2),
  };

  if (
    screen
      .getAllDisplays()
      .some((display) => intersectsWorkArea(requested, display.workArea))
  ) {
    return requested;
  }

  return {
    width,
    height,
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
  };
}

function ensureWindowIsVisible() {
  if (!mainWindow) return;
  const current = mainWindow.getBounds();
  if (
    screen
      .getAllDisplays()
      .some((display) => intersectsWorkArea(current, display.workArea))
  ) {
    return;
  }
  mainWindow.setBounds(visibleWindowBounds(current, settings.compact));
}

function setCompact(value) {
  if (!mainWindow) return;
  const compact = Boolean(value);
  if (compact === settings.compact) return;

  if (compact) {
    settings.expandedBounds = mainWindow.getBounds();
    const current = mainWindow.getBounds();
    mainWindow.setBounds(visibleWindowBounds(current, true));
  } else if (settings.expandedBounds) {
    mainWindow.setBounds(visibleWindowBounds(settings.expandedBounds, false));
  } else {
    mainWindow.setBounds(visibleWindowBounds({ width: 1380, height: 860 }, false));
  }
  settings.compact = compact;
  persistSettings();
}

function configureWindowSecurity(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void openExternalUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void openExternalUrl(url);
  });
  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingUrl = details?.requestingUrl || webContents.getURL();
      callback(
        permission === "notifications" && isTrustedRendererUrl(requestingUrl),
      );
    },
  );
}

function loadRenderer(window, surface) {
  if (DEV_SERVER_URL) {
    const url = new URL(DEV_SERVER_URL);
    if (surface) url.searchParams.set("surface", surface);
    return window.loadURL(url.toString());
  }
  return window.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
    query: surface ? { surface } : {},
  });
}

function safeSend(window, channel, ...args) {
  if (!window || window.isDestroyed?.()) return false;
  const webContents = window.webContents;
  if (
    !webContents ||
    webContents.isDestroyed?.() ||
    webContents.isLoadingMainFrame?.()
  ) return false;
  try {
    webContents.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}

function installRendererRecovery(window, surface, onGone = () => undefined) {
  const crashTimes = [];
  window.webContents.on("render-process-gone", (_event, details) => {
    try {
      onGone(details);
    } catch (error) {
      console.warn(`Could not prepare renderer recovery: ${error.message}`);
    }
    if (app.isQuitting || window.isDestroyed()) return;
    const now = Date.now();
    while (crashTimes.length && now - crashTimes[0] > 60_000) crashTimes.shift();
    crashTimes.push(now);
    if (crashTimes.length > 3) {
      console.error(`Renderer recovery stopped after repeated ${surface || "dashboard"} crashes.`);
      return;
    }
    setTimeout(() => {
      if (app.isQuitting || window.isDestroyed()) return;
      void loadRenderer(window, surface).catch((error) => {
        console.error(
          `Could not recover the ${surface || "dashboard"} renderer: ${error.message}`,
        );
      });
    }, 120);
  });
}

function readClipboardItem() {
  const qaText = QA_OPEN_SURFACE
    ? QA_CLIPBOARD_BASE64
      ? Buffer.from(QA_CLIPBOARD_BASE64, "base64").toString("utf8")
      : QA_CLIPBOARD_TEXT
    : undefined;
  const text = String(qaText ?? clipboard.readText())
    .replace(/\0/g, "")
    .slice(0, MAX_CLIPBOARD_ITEM_BYTES);
  return {
    text,
    capturedAt: Date.now(),
    validPrefix: /^Item Class:\s*.+/m.test(text),
  };
}

const WINDOWS_VIRTUAL_KEYS = new Map([
  ["commandorcontrol", 0x11], ["cmdorctrl", 0x11],
  ["control", 0x11], ["ctrl", 0x11],
  ["shift", 0x10], ["alt", 0x12], ["option", 0x12],
  ["altgr", 0x11], ["meta", 0x5b], ["super", 0x5b],
  ["command", 0x5b], ["cmd", 0x5b],
  ["space", 0x20], ["tab", 0x09], ["enter", 0x0d], ["return", 0x0d],
  ["escape", 0x1b], ["esc", 0x1b], ["backspace", 0x08],
  ["delete", 0x2e], ["insert", 0x2d], ["home", 0x24], ["end", 0x23],
  ["pageup", 0x21], ["pagedown", 0x22], ["up", 0x26], ["down", 0x28],
  ["left", 0x25], ["right", 0x27], ["plus", 0xbb],
]);

function priceCheckShortcutVirtualKeys(accelerator = configuredPriceCheckHotkey) {
  const keys = [];
  for (const rawToken of String(accelerator || DEFAULT_PRICE_CHECK_HOTKEY).split("+")) {
    const token = rawToken.trim().toLowerCase();
    let virtualKey = WINDOWS_VIRTUAL_KEYS.get(token);
    if (token === "altgr") keys.push(0x12);
    if (virtualKey == null && /^[a-z]$/.test(token)) {
      virtualKey = token.toUpperCase().charCodeAt(0);
    } else if (virtualKey == null && /^[0-9]$/.test(token)) {
      virtualKey = token.charCodeAt(0);
    } else if (virtualKey == null && /^f(?:[1-9]|1\d|2[0-4])$/.test(token)) {
      virtualKey = 0x70 + Number(token.slice(1)) - 1;
    }
    if (Number.isFinite(virtualKey) && !keys.includes(virtualKey)) keys.push(virtualKey);
  }
  return keys;
}

function priceCheckHoldVirtualKey(accelerator = configuredPriceCheckHotkey) {
  const tokens = String(accelerator || DEFAULT_PRICE_CHECK_HOTKEY)
    .split("+")
    .map((token) => token.trim().toLowerCase());
  for (const token of [
    "commandorcontrol", "cmdorctrl", "control", "ctrl",
    "alt", "option", "shift", "meta", "super", "command", "cmd",
  ]) {
    if (tokens.includes(token)) return WINDOWS_VIRTUAL_KEYS.get(token);
  }
  return undefined;
}

function electronInputMatchesAccelerator(input, accelerator) {
  if (!input || !accelerator) return false;
  const modifierTokens = new Set([
    "commandorcontrol", "cmdorctrl", "control", "ctrl",
    "shift", "alt", "option", "meta", "super", "command", "cmd",
  ]);
  const tokens = String(accelerator)
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const key = tokens.find((token) => !modifierTokens.has(token));
  if (!key) return false;
  const commandOrControl = tokens.includes("commandorcontrol") || tokens.includes("cmdorctrl");
  const expectedControl = commandOrControl
    ? process.platform !== "darwin"
    : tokens.includes("control") || tokens.includes("ctrl");
  const expectedMeta = commandOrControl
    ? process.platform === "darwin"
    : tokens.some((token) => ["meta", "super", "command", "cmd"].includes(token));
  const expectedAlt = tokens.includes("alt") || tokens.includes("option");
  const expectedShift = tokens.includes("shift");
  const inputKey = String(input.key || "").toLowerCase();
  return (
    inputKey === key &&
    Boolean(input.control) === expectedControl &&
    Boolean(input.meta) === expectedMeta &&
    Boolean(input.alt) === expectedAlt &&
    Boolean(input.shift) === expectedShift
  );
}

function nativeInputHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "native-input", "NinjaLensInput.exe")
    : path.join(__dirname, "..", "build", "native-input", "NinjaLensInput.exe");
}

function priceCheckTargetTitle() {
  return QA_TARGET_TITLE ||
    (QA_OPEN_SURFACE === "price-check"
      ? "Ninja Lens QA Path of Exile"
      : POE_WINDOW_TITLE);
}

function priceCheckTargetProcessNames() {
  return QA_NATIVE_CAPTURE
    ? [...POE_PROCESS_NAMES, "NinjaLensQaTarget.exe"]
    : [...POE_PROCESS_NAMES];
}

function encodeNativeInputArgument(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function runNativeInputHelper(
  argumentsList,
  { deadline, signal, captureOutput = false } = {},
) {
  return new Promise((resolve, reject) => {
    const remainingMs = Math.floor(Number(deadline) - Date.now());
    if (!Number.isFinite(remainingMs) || remainingMs <= 0 || signal?.aborted) {
      resolve({ code: null, output: "", timedOut: true });
      return;
    }
    const helperPath = nativeInputHelperPath();
    if (!fs.existsSync(helperPath)) {
      reject(new Error("Ninja Lens input helper is missing."));
      return;
    }

    let child;
    try {
      child = spawn(helperPath, argumentsList, {
        shell: false,
        stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let output = "";
    let outputOverflow = false;
    let timedOut = false;
    let settled = false;
    const terminate = () => {
      if (child.exitCode == null && !child.killed) child.kill();
    };
    const onAbort = () => terminate();
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, remainingMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk) => {
      if (outputOverflow) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > NATIVE_INPUT_OUTPUT_LIMIT) {
        outputOverflow = true;
        output = "";
        terminate();
      }
    });

    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result);
    };
    child.once("error", (error) => finish(null, error));
    child.once("close", (code) => finish({
      code: outputOverflow ? null : code,
      output: output.trim(),
      timedOut: timedOut || Boolean(signal?.aborted),
    }));
  });
}

async function triggerToolkitChatMacro(macro) {
  const scope = macro.scope || "poe1";
  const allowedProcesses = scope === "poe2"
    ? ["PathOfExile2.exe", "PathOfExile2Steam.exe"]
    : scope === "both"
      ? [...POE_PROCESS_NAMES, "PathOfExile2.exe", "PathOfExile2Steam.exe"]
      : [...POE_PROCESS_NAMES];
  const expectedTitle = scope === "poe2" ? "Path of Exile 2" : priceCheckTargetTitle();
  const deadline = Date.now() + 750;
  const result = await runNativeInputHelper([
    "send-text",
    String(deadline),
    encodeNativeInputArgument(expectedTitle),
    String(allowedProcesses.length),
    ...allowedProcesses,
    encodeNativeInputArgument(macro.text),
  ], { deadline });
  if (result.code !== 0) {
    safeSend(mainWindow, "toolkit:macro-result", {
      id: macro.id,
      ok: false,
      message: result.code === 65
        ? "Macro ignored because Path of Exile was not the foreground window."
        : "Macro input was not accepted by Windows.",
    });
  }
}

function syncToolkitMacroShortcuts(workspace) {
  for (const accelerator of registeredToolkitMacros) {
    globalShortcut.unregister(accelerator);
  }
  registeredToolkitMacros = new Set();
  const failures = [];
  for (const macro of workspace.macros || []) {
    if (!macro.enabled) continue;
    const error = validateShortcut(macro.hotkey, { global: true });
    if (error) {
      failures.push({ id: macro.id, hotkey: macro.hotkey, error });
      continue;
    }
    let accepted = false;
    try {
      accepted = globalShortcut.register(macro.hotkey, () => {
        void triggerToolkitChatMacro(macro);
      });
    } catch {
      accepted = false;
    }
    if (accepted) registeredToolkitMacros.add(macro.hotkey);
    else failures.push({ id: macro.id, hotkey: macro.hotkey, error: "Shortcut is already in use." });
  }
  return failures;
}

function syncToolkitStashScroll(workspace) {
  const requested = workspace.stashScroll?.enabled ? workspace.stashScroll.modifier || "Ctrl" : "";
  if (
    requested === toolkitStashScrollConfig &&
    (
      !requested ||
      Boolean(toolkitStashScrollProcess && toolkitStashScrollProcess.exitCode == null)
    )
  ) return;
  if (
    toolkitStashScrollProcess &&
    toolkitStashScrollProcess.exitCode == null &&
    !toolkitStashScrollProcess.killed
  ) toolkitStashScrollProcess.kill();
  toolkitStashScrollProcess = null;
  toolkitStashScrollConfig = requested;
  if (!requested || process.platform !== "win32") return;
  const helperPath = nativeInputHelperPath();
  if (!fs.existsSync(helperPath)) return;
  try {
    const child = spawn(helperPath, ["watch-stash-scroll", requested], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    toolkitStashScrollProcess = child;
    child.once("error", () => {
      if (toolkitStashScrollProcess === child) toolkitStashScrollProcess = null;
    });
    child.once("exit", () => {
      if (toolkitStashScrollProcess === child) toolkitStashScrollProcess = null;
    });
  } catch {
    toolkitStashScrollProcess = null;
  }
}

async function injectHoveredItemCopy({ deadline, signal, context } = {}) {
  if (process.platform !== "win32") {
    throw new Error("One-key item capture is currently available on Windows only.");
  }
  const expectedTitle = priceCheckTargetTitle();
  const allowedProcesses = priceCheckTargetProcessNames();
  const remainingMs = Math.max(1, Math.min(2000, Math.floor(deadline - Date.now())));
  const releaseKeys = priceCheckShortcutVirtualKeys(
    context?.accelerator || configuredPriceCheckHotkey,
  );
  const holdVirtualKey = context?.mode === "passive"
    ? priceCheckHoldVirtualKey(context?.accelerator || configuredPriceCheckHotkey)
    : undefined;
  const preserveHeldModifier = Number.isFinite(holdVirtualKey) && releaseKeys.includes(holdVirtualKey)
    ? holdVirtualKey
    : 0;
  const nativeStartedAt = Date.now();
  auditPriceCheckLifecycle("capture-native-start");
  const copied = await runNativeInputHelper(
    [
      "capture",
      String(Math.floor(deadline)),
      String(remainingMs),
      String(preserveHeldModifier),
      encodeNativeInputArgument(expectedTitle),
      String(allowedProcesses.length),
      ...allowedProcesses,
      String(releaseKeys.length),
      ...releaseKeys.map(String),
    ],
    { deadline, signal },
  );
  auditPriceCheckLifecycle("capture-native-complete", {
    nativeElapsedMs: Date.now() - nativeStartedAt,
    nativeCode: copied.code,
    nativeTimedOut: copied.timedOut,
  });
  const verified = copied.code === 0 && !copied.timedOut;
  return {
    clipboardChanged: verified,
    // One native call binds HWND/PID/process/title, injects Ctrl+C, and
    // revalidates foreground ownership after the clipboard changes. Avoiding
    // a second .NET process launch keeps Ctrl+D on Awakened's immediate path.
    targetIdentityVerified: verified,
  };
}

const oneKeyItemCapture = createOneKeyItemCapture({
  readClipboardText: () => clipboard.readText(),
  injectCopy: injectHoveredItemCopy,
  isCaptureAvailable: () => priceCheckOverlayAttached && priceCheckOverlayHasAccess,
  isTargetFocused: () => Boolean(OverlayController.targetHasFocus),
  getCaptureAccelerator: (context) =>
    context?.accelerator || configuredPriceCheckHotkey,
  timeoutMs: PRICE_CHECK_CLIPBOARD_TIMEOUT_MS,
  maxTextLength: MAX_CLIPBOARD_ITEM_BYTES,
});

async function captureHoveredPoeItem(context) {
  return oneKeyItemCapture.capture(context);
}

async function preparePriceCheckTargetForCapture(context) {
  const audit = QA_RESULT_PATH
    ? {
        overlayAttachedBefore: priceCheckOverlayAttached,
        overlayHasAccessBefore: priceCheckOverlayHasAccess,
        overlayFocusedBefore: Boolean(priceCheckWindow?.isFocused()),
        targetFocusedBefore: Boolean(OverlayController.targetHasFocus),
        handedOff: false,
        overlayFocusedAfter: null,
        targetFocusedAfter: null,
        prepared: false,
      }
    : null;
  if (audit) priceCheckCapturePreparationAudit = audit;
  if (!priceCheckOverlayAttached || !priceCheckOverlayHasAccess) return false;
  const overlayOwnsFocus = priceCheckOverlayOwnsCaptureContext();
  if (!overlayOwnsFocus) {
    const prepared = Boolean(OverlayController.targetHasFocus);
    if (audit) audit.prepared = prepared;
    return prepared;
  }

  if (!context?.allowFocusHandoff) return false;

  // The renderer-local fallback can hand an already-interactive overlay back
  // to PoE once before copying. Global shortcuts are never registered in this
  // state, matching Awakened PoE Trade's target-only shortcut scope.
  // back to PoE. Polling observes that handoff; it never retries focusTarget
  // and therefore cannot steal focus after an unrelated Alt-Tab.
  try {
    priceCheckCaptureFocusHandoffCount += 1;
    if (audit) audit.handedOff = true;
    OverlayController.focusTarget();
  } catch {
    return false;
  }
  // targetHasFocus can still contain its pre-handoff value until Windows pumps
  // the foreground notifications. Give that single handoff one event turn
  // before polling, so a latched `true` cannot start Ctrl+C prematurely.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const deadline = Date.now() + PRICE_CHECK_FOCUS_TIMEOUT_MS;
  while (
    Date.now() < deadline &&
    priceCheckOverlayAttached &&
    priceCheckOverlayHasAccess &&
    !OverlayController.targetHasFocus
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const prepared = Boolean(
    priceCheckOverlayAttached &&
    priceCheckOverlayHasAccess &&
    OverlayController.targetHasFocus,
  );
  if (audit) {
    audit.overlayFocusedAfter = Boolean(priceCheckWindow?.isFocused());
    audit.targetFocusedAfter = Boolean(OverlayController.targetHasFocus);
    audit.prepared = prepared;
  }
  return prepared;
}

const latestPriceCheckCapture = createLatestItemCaptureQueue({
  prepareCapture: preparePriceCheckTargetForCapture,
  capture: captureHoveredPoeItem,
  present: (capture, request) => {
    showPriceCheck(capture, {
      preservePin: priceCheckOverlayVisible && priceCheckPinned,
      mode: request?.mode || "passive",
    });
  },
});

function requestPriceCheckCapture({
  mode = "passive",
  accelerator = configuredPriceCheckHotkey,
  allowFocusHandoff = false,
} = {}) {
  const request = latestPriceCheckCapture.request({
    mode: mode === "locked" ? "locked" : "passive",
    accelerator,
    allowFocusHandoff,
  });
  void request.catch((error) => {
    console.warn(
      `Could not complete the latest Path of Exile item capture: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  return request;
}

function handlePriceCheckShortcut() {
  auditPriceCheckLifecycle("hotkey-callback");
  return requestPriceCheckCapture({
    mode: "passive",
    accelerator: configuredPriceCheckHotkey,
  });
}

function handleLockedPriceCheckShortcut() {
  return requestPriceCheckCapture({
    mode: "locked",
    accelerator: DEFAULT_LOCKED_PRICE_CHECK_HOTKEY,
  });
}

function sanitizePriceCheckPanelPosition(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

function priceCheckPanelViewport(host) {
  const fallback = {
    x: 0,
    y: 0,
    width: Math.max(1, host.width),
    height: Math.max(1, host.height),
  };
  try {
    const workArea = screen.getDisplayMatching(host)?.workArea;
    if (!workArea) return fallback;
    const left = Math.max(host.x, workArea.x);
    const top = Math.max(host.y, workArea.y);
    const right = Math.min(host.x + host.width, workArea.x + workArea.width);
    const bottom = Math.min(host.y + host.height, workArea.y + workArea.height);
    if (right <= left || bottom <= top) return fallback;
    return {
      x: left - host.x,
      y: top - host.y,
      width: right - left,
      height: bottom - top,
    };
  } catch {
    return fallback;
  }
}

function priceCheckPanelSize(host) {
  const viewport = priceCheckPanelViewport(host);
  const insetX = viewport.width > PRICE_CHECK_PANEL_GAP * 2
    ? PRICE_CHECK_PANEL_GAP
    : 0;
  const insetY = viewport.height > PRICE_CHECK_PANEL_GAP * 2
    ? PRICE_CHECK_PANEL_GAP
    : 0;
  const minX = viewport.x + insetX;
  const minY = viewport.y + insetY;
  const maxX = viewport.x + viewport.width - insetX;
  const maxY = viewport.y + viewport.height - insetY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, Math.min(PRICE_CHECK_WIDTH, maxX - minX)),
    height: Math.max(
      1,
      Math.min(
        Math.max(
          PRICE_CHECK_EMPTY_HEIGHT,
          Math.min(PRICE_CHECK_MAX_REQUESTED_HEIGHT, priceCheckRequestedHeight),
        ),
        maxY - minY,
      ),
    ),
  };
}

function priceCheckPanelLayoutFromPosition(position, host) {
  const normalized = sanitizePriceCheckPanelPosition(position);
  if (!normalized) return null;
  const targetHost = host || priceCheckWindow?.getBounds();
  if (!targetHost) return null;
  const { minX, minY, maxX, maxY, width, height } = priceCheckPanelSize(targetHost);
  const travelX = Math.max(0, maxX - minX - width);
  const travelY = Math.max(0, maxY - minY - height);
  return {
    x: Math.round(minX + normalized.x * travelX),
    y: Math.round(minY + normalized.y * travelY),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function normalizedPriceCheckPanelPosition(panel) {
  if (!panel || !priceCheckWindow || priceCheckWindow.isDestroyed()) return null;
  const host = priceCheckWindow.getBounds();
  const { minX, minY, maxX, maxY, width, height } = priceCheckPanelSize(host);
  const travelX = Math.max(0, maxX - minX - width);
  const travelY = Math.max(0, maxY - minY - height);
  return {
    x: travelX > 0 ? Math.max(0, Math.min(1, (panel.x - minX) / travelX)) : 0,
    y: travelY > 0 ? Math.max(0, Math.min(1, (panel.y - minY) / travelY)) : 0,
  };
}

function savedPriceCheckPanelLayout() {
  if (settings.priceCheck?.openNearCursor) return null;
  return priceCheckPanelLayoutFromPosition(settings.priceCheckPanelPosition);
}

function createPriceCheckPanelLayout() {
  if (!priceCheckWindow || priceCheckWindow.isDestroyed()) return null;
  const host = priceCheckWindow.getBounds();
  const { minX, minY, maxX, maxY, width, height } = priceCheckPanelSize(host);
  const savedPanel = savedPriceCheckPanelLayout();
  if (savedPanel) return savedPanel;
  const cursor = screen.getCursorScreenPoint();
  const cursorX = cursor.x - host.x;
  const cursorY = cursor.y - host.y;
  if (!settings.priceCheck?.openNearCursor) {
    return {
      x: minX,
      y: Math.max(minY, Math.round(minY + (maxY - minY - height) / 2)),
      width: Math.round(width),
      height: Math.round(height),
    };
  }
  const rightX = cursorX + 22;
  const leftX = cursorX - width - 22;
  const preferredX = rightX + width <= maxX
    ? rightX
    : leftX;
  const x = Math.max(
    minX,
    Math.min(preferredX, maxX - width),
  );
  const y = Math.max(
    minY,
    Math.min(
      cursorY - 80,
      maxY - height,
    ),
  );
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function clampPriceCheckPanelLayout(panel = priceCheckPanelBounds) {
  if (!priceCheckWindow || priceCheckWindow.isDestroyed()) return null;
  if (!panel) return createPriceCheckPanelLayout();
  const host = priceCheckWindow.getBounds();
  const { minX, minY, maxX, maxY, width, height } = priceCheckPanelSize(host);
  return {
    x: Math.round(Math.max(minX, Math.min(panel.x, maxX - width))),
    y: Math.round(Math.max(minY, Math.min(panel.y, maxY - height))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function resizeOrRepositionPriceCheckPanel(panel = priceCheckPanelBounds) {
  return savedPriceCheckPanelLayout() || clampPriceCheckPanelLayout(panel);
}

function applyPriceCheckOverlayShape() {
  if (!priceCheckWindow || priceCheckWindow.isDestroyed()) return false;
  if (process.platform !== "win32" && process.platform !== "linux") {
    priceCheckOverlayShapeApplied = false;
    return !priceCheckOverlayVisible;
  }
  try {
    const panel = priceCheckOverlayVisible ? priceCheckPanelBounds : null;
    priceCheckWindow.setShape(panel ? [{ ...panel }] : []);
    priceCheckOverlayShapeApplied = Boolean(panel);
    return !panel || priceCheckOverlayShapeApplied;
  } catch (error) {
    priceCheckOverlayShapeApplied = false;
    console.warn(`Could not shape the price-check overlay: ${error.message}`);
    return !priceCheckOverlayVisible;
  }
}

function updatePriceCheckPanelLayout(nextPanel) {
  if (!nextPanel) return false;
  const previousPanel = priceCheckPanelBounds;
  priceCheckPanelBounds = nextPanel;
  if (!applyPriceCheckOverlayShape()) {
    // Never publish renderer geometry the native hit-test shape did not
    // accept. Restore the previous shape before the caller deactivates.
    priceCheckPanelBounds = previousPanel;
    applyPriceCheckOverlayShape();
    return false;
  }
  sendPriceCheckOverlayState();
  // The native tracker snapshots the widget's full-height entry column. Keep
  // that column aligned when the card is moved or its shaped bounds change.
  if (priceCheckPresentationMode === "passive") {
    startPriceCheckPanelTracker(priceCheckActivationGeneration);
  } else if (
    priceCheckPresentationMode === "promoted" &&
    priceCheckOverlayInteractive &&
    priceCheckPromotionTracksPointerExit
  ) {
    // A dragged card changes the full-height activation column. Rearm the
    // promoted exit watcher against the new column without leaving an orphan.
    stopPriceCheckPanelTracker();
    startPriceCheckPanelExitWatch(priceCheckActivationGeneration);
  }
  return true;
}

function schedulePriceCheckGeometrySync() {
  clearTimeout(priceCheckGeometryTimer);
  priceCheckGeometryTimer = setTimeout(() => {
    priceCheckGeometryTimer = null;
    if (priceCheckOverlayVisible) {
      const nextPanel = resizeOrRepositionPriceCheckPanel();
      if (!updatePriceCheckPanelLayout(nextPanel)) {
        deactivatePriceCheck({ focusTarget: false });
        notifyPriceCheckUnavailable(
          "Native overlay shaping became unavailable, so Ninja Lens closed the panel to keep Path of Exile clickable.",
        );
        return;
      }
      return;
    }
    sendPriceCheckOverlayState();
  }, 60);
}

function currentPriceCheckOverlayState() {
  return {
    revision: priceCheckOverlayRevision,
    active: priceCheckOverlayVisible,
    attached: priceCheckOverlayAttached,
    targetActive: Boolean(OverlayController.targetHasFocus),
    interactive: priceCheckOverlayInteractive,
    mode: priceCheckPresentationMode,
    shapeApplied: priceCheckOverlayShapeApplied,
    panel: priceCheckOverlayVisible && priceCheckPanelBounds
      ? { ...priceCheckPanelBounds }
      : null,
    message: priceCheckOverlayMessage,
  };
}

function sendPriceCheckOverlayState(message) {
  if (typeof message === "string") priceCheckOverlayMessage = message;
  priceCheckOverlayRevision += 1;
  if (!priceCheckWindow || priceCheckWindow.isDestroyed()) return;
  if (priceCheckWindow.webContents.isLoadingMainFrame()) return;
  safeSend(
    priceCheckWindow,
    "price-check:overlay-state",
    currentPriceCheckOverlayState(message),
  );
}

function notifyPriceCheckUnavailable(message) {
  priceCheckOverlayMessage = message;
  try {
    tray?.displayBalloon({
      title: "Ninja Lens in-game overlay",
      content: message,
      iconType: "warning",
    });
  } catch {
    // The tray warning remains available when Windows balloons are disabled.
  }
}

function restorePriceCheckTargetFocus(generation) {
  const deadline = Date.now() + PRICE_CHECK_FOCUS_TIMEOUT_MS;
  const audit = {
    generation,
    attempts: 1,
    success: false,
    exhausted: false,
    aborted: "",
    lastError: "",
  };
  if (QA_RESULT_PATH) priceCheckFocusRestoreAudit = audit;
  // X/Escape schedules this on the next turn. If the user Alt-Tabbed in that
  // gap, the close request no longer owns foreground authority and must not
  // pull them back into the game.
  if (!priceCheckWindow || priceCheckWindow.isDestroyed() || !priceCheckWindow.isFocused()) {
    audit.aborted = "overlay-focus-lost";
    return;
  }
  try {
    // A close action gets one foreground handoff. Repeated focusTarget calls
    // can steal focus back several seconds after the user has Alt-Tabbed.
    OverlayController.focusTarget();
  } catch (error) {
    audit.lastError = error instanceof Error ? error.message : String(error);
    audit.exhausted = true;
    console.warn(`Could not return focus to Path of Exile: ${audit.lastError}`);
    return;
  }
  const verify = () => {
    if (
      generation !== priceCheckActivationGeneration ||
      !priceCheckOverlayAttached
    ) {
      audit.aborted = generation !== priceCheckActivationGeneration
        ? "generation-changed"
        : "overlay-detached";
      return;
    }
    if (
      OverlayController.targetHasFocus &&
      (!priceCheckWindow?.isFocused() || !priceCheckOverlayVisible)
    ) {
      syncPriceCheckShortcutRegistration();
      audit.success = true;
      return;
    }
    if (Date.now() < deadline) {
      setTimeout(verify, 50);
    } else {
      audit.exhausted = true;
    }
  };
  setTimeout(verify, 50);
}

function auditPriceCheckLifecycle(event, detail = {}) {
  if (!QA_RESULT_PATH && !FOCUS_TRACE_ENABLED) return;
  const entry = {
    at: Date.now(),
    event,
    mode: priceCheckPresentationMode,
    visible: priceCheckOverlayVisible,
    interactive: priceCheckOverlayInteractive,
    activationPending: priceCheckActivationPending,
    targetFocused: Boolean(OverlayController.targetHasFocus),
    overlayFocused: Boolean(priceCheckWindow?.isFocused()),
    activationGeneration: priceCheckActivationGeneration,
    ...detail,
  };
  if (QA_RESULT_PATH) {
    priceCheckLifecycleEvents.push(entry);
    if (priceCheckLifecycleEvents.length > 80) priceCheckLifecycleEvents.shift();
  }
  if (FOCUS_TRACE_ENABLED) {
    console.log(`[price-check-focus] ${JSON.stringify(entry)}`);
  }
}

function stopPriceCheckPanelTracker() {
  if (priceCheckPanelWatchAbort) priceCheckPanelWatchAbort.abort();
  priceCheckPanelWatchAbort = null;
}

function promotePriceCheckOverlayFromTracker(
  generation,
  { persistent = false } = {},
) {
  if (
    generation !== priceCheckActivationGeneration ||
    priceCheckPresentationMode !== "passive" ||
    !priceCheckOverlayVisible ||
    !priceCheckWindow ||
    priceCheckWindow.isDestroyed() ||
    !priceCheckOverlayAttached ||
    !priceCheckOverlayHasAccess ||
    !OverlayController.targetHasFocus
  ) return;

  priceCheckActivationPending = true;
  priceCheckPresentationMode = "promoted";
  priceCheckPromotionTracksPointerExit = !persistent;
  auditPriceCheckLifecycle("promote-panel", { persistent });
  try {
    // This sets the overlay library's intentional focus target before Windows
    // emits the PoE blur, preventing the host from being hidden mid-click.
    OverlayController.activateOverlay();
    priceCheckWindow.moveTop();
  } catch {
    deactivatePriceCheck({ focusTarget: false });
    return;
  }

  const focusDeadline = Date.now() + PRICE_CHECK_FOCUS_TIMEOUT_MS;
  const confirmFocus = () => {
    if (
      generation !== priceCheckActivationGeneration ||
      priceCheckPresentationMode !== "promoted" ||
      !priceCheckOverlayVisible ||
      !priceCheckActivationPending
    ) return;
    if (priceCheckWindow.isFocused()) {
      priceCheckActivationPending = false;
      priceCheckOverlayInteractive = true;
      if (priceCheckPromotionTracksPointerExit && !priceCheckPanelWatchAbort) {
        startPriceCheckPanelExitWatch(generation);
      }
      sendPriceCheckOverlayState();
      return;
    }
    if (Date.now() < focusDeadline) {
      setTimeout(confirmFocus, 20);
      return;
    }
    deactivatePriceCheck({ focusTarget: Boolean(priceCheckWindow?.isFocused()) });
  };
  setTimeout(confirmFocus, 20);
}

function startPriceCheckPanelInteractionWatch(generation) {
  if (!shouldArmPriceCheckPassiveWatch({
    win32: process.platform === "win32",
    current: generation === priceCheckActivationGeneration,
    visible: priceCheckOverlayVisible,
    mode: priceCheckPresentationMode,
    windowAvailable: Boolean(priceCheckWindow && !priceCheckWindow.isDestroyed()),
    panelAvailable: Boolean(priceCheckPanelBounds),
    attached: priceCheckOverlayAttached,
    hasAccess: priceCheckOverlayHasAccess,
    targetFocused: OverlayController.targetHasFocus,
  })) return;
  const holdVirtualKey = priceCheckHoldVirtualKey();
  if (!Number.isFinite(holdVirtualKey)) return;
  const interactionArea = currentPriceCheckInteractionAreaInScreenPixels();
  const panelArea = currentPriceCheckPanelAreaInScreenPixels();
  if (!interactionArea || !panelArea) return;
  const controller = new AbortController();
  priceCheckPanelWatchAbort = controller;
  const deadline = Date.now() + 60_000;
  void runNativeInputHelper(
    [
      "watch-panel",
      String(deadline),
      String(holdVirtualKey),
      priceCheckPinned || !settings.priceCheck?.closeOnBlur || QA_NATIVE_CAPTURE ? "0" : "1",
      String(interactionArea.left),
      String(interactionArea.top),
      String(interactionArea.right),
      String(interactionArea.bottom),
      String(panelArea.left),
      String(panelArea.top),
      String(panelArea.right),
      String(panelArea.bottom),
    ],
    { deadline, signal: controller.signal },
  ).then((result) => {
    const wasCurrent = priceCheckPanelWatchAbort === controller;
    if (wasCurrent) {
      priceCheckPanelWatchAbort = null;
    }
    if (shouldRestartPriceCheckPanelWatch({
      current: wasCurrent,
      expired: result.timedOut || result.code === 12,
      visible: priceCheckOverlayVisible,
      mode: priceCheckPresentationMode,
      expectedMode: "passive",
      quitting: Boolean(app.isQuitting),
    })) {
      startPriceCheckPanelInteractionWatch(generation);
      return;
    }
    if (
      result.timedOut ||
      generation !== priceCheckActivationGeneration ||
      priceCheckPresentationMode !== "passive"
    ) return;
    if (result.code === 10) {
      promotePriceCheckOverlayFromTracker(generation, { persistent: false });
    } else if (result.code === 11) {
      deactivatePriceCheck({
        focusTarget: false,
        reason: "passive-outside-click",
      });
    }
  }).catch(() => {
    if (priceCheckPanelWatchAbort === controller) {
      priceCheckPanelWatchAbort = null;
    }
  });
}

function startPriceCheckPanelTracker(generation = priceCheckActivationGeneration) {
  stopPriceCheckPanelTracker();
  // The shaped card owns its direct clicks. This watcher only handles held-
  // modifier entry through the full-height column and passive outside clicks.
  // Cursor hover alone never changes BrowserWindow focus.
  startPriceCheckPanelInteractionWatch(generation);
}

function priceCheckAreaInScreenPixels(interactionArea) {
  if (!interactionArea) return null;
  const topLeft = screen.dipToScreenPoint({
    x: interactionArea.x,
    y: interactionArea.y,
  });
  const bottomRight = screen.dipToScreenPoint({
    x: interactionArea.x + interactionArea.width,
    y: interactionArea.y + interactionArea.height,
  });
  if (bottomRight.x <= topLeft.x || bottomRight.y <= topLeft.y) return null;
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}

function currentPriceCheckInteractionAreaInScreenPixels() {
  if (!priceCheckWindow || priceCheckWindow.isDestroyed() || !priceCheckPanelBounds) {
    return null;
  }
  return priceCheckAreaInScreenPixels(priceCheckPassiveInteractionArea({
    host: priceCheckWindow.getBounds(),
    panel: priceCheckPanelBounds,
  }));
}

function currentPriceCheckPanelAreaInScreenPixels() {
  if (!priceCheckWindow || priceCheckWindow.isDestroyed() || !priceCheckPanelBounds) {
    return null;
  }
  return priceCheckAreaInScreenPixels(priceCheckPassivePanelArea({
    host: priceCheckWindow.getBounds(),
    panel: priceCheckPanelBounds,
  }));
}

function startPriceCheckPanelExitWatch(generation) {
  if (
    process.platform !== "win32" ||
    generation !== priceCheckActivationGeneration ||
    priceCheckPresentationMode !== "promoted" ||
    !priceCheckPromotionTracksPointerExit ||
    !priceCheckOverlayInteractive ||
    !priceCheckWindow?.isFocused()
  ) return;
  const interactionArea = currentPriceCheckInteractionAreaInScreenPixels();
  if (!interactionArea) return;
  const nativeHandle = priceCheckWindow.getNativeWindowHandle();
  const handleValue = nativeHandle.length >= 8
    ? nativeHandle.readBigUInt64LE(0)
    : BigInt(nativeHandle.readUInt32LE(0));
  if (handleValue <= 0n) return;
  const controller = new AbortController();
  priceCheckPanelWatchAbort = controller;
  const deadline = Date.now() + 60_000;
  void runNativeInputHelper(
    [
      "watch-panel-exit",
      String(deadline),
      String(handleValue),
      String(interactionArea.left),
      String(interactionArea.top),
      String(interactionArea.right),
      String(interactionArea.bottom),
    ],
    { deadline, signal: controller.signal },
  ).then((result) => {
    const wasCurrent = priceCheckPanelWatchAbort === controller;
    if (wasCurrent) {
      priceCheckPanelWatchAbort = null;
    }
    if (shouldRestartPriceCheckPanelWatch({
      current: wasCurrent,
      expired: result.timedOut || result.code === 12,
      visible: priceCheckOverlayVisible,
      mode: priceCheckPresentationMode,
      expectedMode: "promoted",
      quitting: Boolean(app.isQuitting),
    })) {
      startPriceCheckPanelExitWatch(generation);
      return;
    }
    if (
      result.code !== 13 ||
      result.timedOut ||
      generation !== priceCheckActivationGeneration ||
      priceCheckPresentationMode !== "promoted" ||
      !priceCheckWindow?.isFocused()
    ) return;
    const disposition = priceCheckPointerExitDisposition({
      visible: priceCheckOverlayVisible,
      mode: priceCheckPresentationMode,
      pinned: priceCheckPinned,
      closeOnBlur: settings.priceCheck?.closeOnBlur,
    });
    if (disposition === "hide") {
      deactivatePriceCheck({
        focusTarget: true,
        reason: "promoted-pointer-away",
      });
      return;
    }
    if (disposition !== "passive") return;
    setPriceCheckOverlayPassive();
    try {
      OverlayController.focusTarget();
    } catch {
      deactivatePriceCheck({
        focusTarget: false,
        reason: "promoted-pointer-away-focus-failed",
      });
    }
  }).catch(() => {
    if (priceCheckPanelWatchAbort === controller) {
      priceCheckPanelWatchAbort = null;
    }
  });
}

function deactivatePriceCheck({
  focusTarget = true,
  hidePanel = true,
  preservePending = false,
  reason = "unspecified",
} = {}) {
  auditPriceCheckLifecycle("deactivate", { reason, focusTarget, hidePanel });
  const restoreTargetFocus = shouldRestorePriceCheckTargetFocus({
    requested: focusTarget,
    attached: priceCheckOverlayAttached,
    overlayFocused: Boolean(priceCheckWindow?.isFocused()),
    interactive: priceCheckOverlayInteractive,
  });
  const generation = ++priceCheckActivationGeneration;
  stopPriceCheckPanelTracker();
  clearTimeout(priceCheckGeometryTimer);
  priceCheckGeometryTimer = null;
  priceCheckActivationPending = false;
  priceCheckOverlayInteractive = false;
  priceCheckPresentationMode = "hidden";
  priceCheckPromotionTracksPointerExit = false;
  if (hidePanel) {
    priceCheckOverlayVisible = false;
    priceCheckPanelBounds = null;
  }
  if (!preservePending) {
    priceCheckCaptureGeneration += 1;
    pendingPriceCheckCapture = null;
    pendingPriceCheckRestorePinned = false;
    pendingPriceCheckCaptureExpiresAt = 0;
    pendingPriceCheckCaptureGeneration = 0;
  }
  priceCheckOverlayMessage = "";
  applyPriceCheckOverlayShape();
  sendPriceCheckOverlayState();
  if (priceCheckWindow && !priceCheckWindow.isDestroyed()) {
    priceCheckWindow.setIgnoreMouseEvents(true);
  }
  syncPriceCheckShortcutRegistration();
  if (restoreTargetFocus) {
    // Match Awakened's next-turn focus return. X/Escape first release and hide
    // the Electron host; only then does the one deliberate handoff go to PoE.
    // Alt-Tab and external blur call this function with focusTarget=false.
    setImmediate(() => {
      if (
        generation === priceCheckActivationGeneration &&
        priceCheckOverlayAttached &&
        !priceCheckOverlayVisible
      ) {
        restorePriceCheckTargetFocus(generation);
      }
    });
  } else if (!priceCheckOverlayAttached) {
    priceCheckWindow?.hide();
  }
}

function setPriceCheckOverlayPassive() {
  if (!priceCheckOverlayVisible) return;
  const generation = ++priceCheckActivationGeneration;
  priceCheckActivationPending = false;
  priceCheckOverlayInteractive = false;
  priceCheckPresentationMode = "passive";
  priceCheckPromotionTracksPointerExit = false;
  auditPriceCheckLifecycle("set-passive");
  if (priceCheckWindow && !priceCheckWindow.isDestroyed()) {
    priceCheckWindow.setIgnoreMouseEvents(false);
    if (!priceCheckWindow.isVisible()) priceCheckWindow.showInactive();
  }
  startPriceCheckPanelTracker(generation);
  syncPriceCheckShortcutRegistration();
  sendPriceCheckOverlayState();
}

function sendPriceCheckCapture(capture) {
  if (!priceCheckWindow || priceCheckWindow.isDestroyed()) return;
  const send = () => safeSend(priceCheckWindow, "price-check:capture", capture);
  if (priceCheckWindow.webContents.isLoadingMainFrame()) {
    // createPriceCheckWindow publishes the latest capture after the first load.
    return;
  } else {
    send();
  }
}

function showPriceCheck(
  capture,
  { preservePin = false, mode = "locked" } = {},
) {
  if (!priceCheckWindow || priceCheckWindow.isDestroyed()) return;
  const replacementPanel = priceCheckOverlayVisible && priceCheckPanelBounds
    ? { ...priceCheckPanelBounds }
    : null;
  const captureGeneration = ++priceCheckCaptureGeneration;
  const rawCapture = capture || readClipboardItem();
  const nextCapture = {
    ...rawCapture,
    captureId: Number.isSafeInteger(rawCapture?.captureId)
      ? rawCapture.captureId
      : captureGeneration,
  };
  const restorePinned = preservePin && priceCheckPinned;
  lastPriceCheckCapture = nextCapture;
  pendingPriceCheckDashboardCapture = null;
  pendingPriceCheckDashboardCaptureExpiresAt = 0;
  pendingPriceCheckCapture = nextCapture;
  pendingPriceCheckRestorePinned = restorePinned;
  pendingPriceCheckCaptureGeneration = captureGeneration;
  pendingPriceCheckCaptureExpiresAt = restorePinned
    ? Number.POSITIVE_INFINITY
    : Date.now() + PRICE_CHECK_PENDING_TTL_MS;
  if (!priceCheckOverlayAttached || !priceCheckOverlayHasAccess) {
    if (!QA_OPEN_SURFACE) {
      notifyPriceCheckUnavailable(
        priceCheckOverlayHasAccess
          ? "Path of Exile is not active. Open it, hover an item, then press Ctrl+D."
          : "Ninja Lens cannot access the Path of Exile window. Run both apps at the same Windows privilege level.",
      );
    }
    return;
  }
  mainWindow?.hide();
  trayWindow?.hide();
  quickWindow?.hide();
  if (!preservePin) {
    priceCheckPinned = Boolean(settings.priceCheck.pinByDefault);
  }
  if (!replacementPanel) priceCheckRequestedHeight = PRICE_CHECK_EMPTY_HEIGHT;
  const passive = mode === "passive";
  const targetNeedsFocus = !OverlayController.targetHasFocus;
  stopPriceCheckPanelTracker();
  priceCheckOverlayVisible = true;
  priceCheckOverlayInteractive = false;
  // Keep target-focus notifications from being mistaken for a user blur until
  // Windows confirms that the overlay itself accepted focus.
  priceCheckActivationPending = !passive;
  priceCheckPresentationMode = passive ? "passive" : "locked";
  priceCheckPromotionTracksPointerExit = false;
  auditPriceCheckLifecycle("show", { requestedMode: mode });
  pendingPriceCheckCapture = null;
  pendingPriceCheckRestorePinned = false;
  pendingPriceCheckCaptureExpiresAt = 0;
  pendingPriceCheckCaptureGeneration = 0;
  priceCheckOverlayMessage = "";
  priceCheckWindow.setIgnoreMouseEvents(true);
  priceCheckPanelBounds = replacementPanel
    ? clampPriceCheckPanelLayout(replacementPanel)
    : createPriceCheckPanelLayout();
  if (!priceCheckPanelBounds) {
    deactivatePriceCheck({ focusTarget: false });
    notifyPriceCheckUnavailable("The Path of Exile overlay has no usable client area.");
    return;
  }
  if (!applyPriceCheckOverlayShape()) {
    deactivatePriceCheck({ focusTarget: false });
    notifyPriceCheckUnavailable(
      "Native overlay shaping is unavailable, so Ninja Lens left the panel closed to keep Path of Exile clickable.",
    );
    return;
  }
  sendPriceCheckCapture(nextCapture);
  sendPriceCheckOverlayState();
  const generation = ++priceCheckActivationGeneration;
  if (passive) {
    // A verified copy proves PoE owned foreground at clipboard time, not that
    // it still owns foreground now. Never re-show a passive always-on-top host
    // after an Alt-Tab that landed between native capture and presentation.
    if (targetNeedsFocus) {
      deactivatePriceCheck({ focusTarget: false });
      return;
    }
    try {
      // The native shape contains only the rendered card, so enabling its hit
      // test does not block PoE anywhere else. showInactive keeps hover
      // passive; the first click reaches the intended card control.
      priceCheckWindow.setIgnoreMouseEvents(false);
      // Keep the attached host alive like Awakened does. Repeated checks only
      // reshape/repaint it and never hide/show a Windows foreground candidate.
      if (!priceCheckWindow.isVisible()) priceCheckWindow.showInactive();
      auditPriceCheckLifecycle("passive-shown");
      startPriceCheckPanelTracker(generation);
      syncPriceCheckShortcutRegistration();
      sendPriceCheckOverlayState();
      schedulePriceCheckQaAudit();
    } catch (error) {
      deactivatePriceCheck({ focusTarget: false });
      notifyPriceCheckUnavailable(
        `The Path of Exile preview could not be shown: ${error.message}`,
      );
    }
    return;
  }
  const activate = () => {
    if (
      generation !== priceCheckActivationGeneration ||
      !priceCheckOverlayVisible ||
      !priceCheckWindow ||
      priceCheckWindow.isDestroyed() ||
      !priceCheckOverlayAttached ||
      !priceCheckOverlayHasAccess ||
      !OverlayController.targetHasFocus
    ) return false;
    sendPriceCheckOverlayState();
    try {
      // A detached/recovered host may be hidden; make it renderable before the
      // one deliberate interactive focus transfer.
      if (!priceCheckWindow.isVisible()) priceCheckWindow.showInactive();
      OverlayController.activateOverlay();
      priceCheckWindow.moveTop();
      const focusDeadline = Date.now() + PRICE_CHECK_FOCUS_TIMEOUT_MS;
      const confirmOverlayFocus = () => {
        if (
          generation !== priceCheckActivationGeneration ||
          !priceCheckOverlayVisible ||
          !priceCheckActivationPending
        ) return;
        if (priceCheckWindow.isFocused()) {
          priceCheckActivationPending = false;
          priceCheckOverlayInteractive = true;
          priceCheckWindow.setIgnoreMouseEvents(false);
          sendPriceCheckOverlayState();
          schedulePriceCheckQaAudit();
          return;
        }
        if (Date.now() < focusDeadline) {
          setTimeout(confirmOverlayFocus, 35);
          return;
        }
        deactivatePriceCheck({ focusTarget: Boolean(priceCheckWindow?.isFocused()) });
        notifyPriceCheckUnavailable(
          "The Path of Exile overlay did not accept input focus, so Ninja Lens left it closed.",
        );
      };
      setTimeout(confirmOverlayFocus, 35);
      return true;
    } catch (error) {
      deactivatePriceCheck({ focusTarget: Boolean(priceCheckWindow?.isFocused()) });
      notifyPriceCheckUnavailable(
        `The Path of Exile overlay could not be activated: ${error.message}`,
      );
      return false;
    }
  };
  if (targetNeedsFocus) {
    try {
      OverlayController.focusTarget();
    } catch {
      // The bounded focus check below reports a clear failure.
    }
    const deadline = Date.now() + PRICE_CHECK_FOCUS_TIMEOUT_MS;
    const activateWhenFocused = () => {
      if (generation !== priceCheckActivationGeneration) return;
      if (OverlayController.targetHasFocus && activate()) return;
      if (generation !== priceCheckActivationGeneration) return;
      if (Date.now() < deadline) {
        setTimeout(activateWhenFocused, 35);
        return;
      }
      deactivatePriceCheck({ focusTarget: false });
      notifyPriceCheckUnavailable(
        "Path of Exile did not accept focus, so Ninja Lens left the overlay closed.",
      );
    };
    setTimeout(activateWhenFocused, 35);
  } else {
    if (!activate() && generation === priceCheckActivationGeneration) {
      deactivatePriceCheck({ focusTarget: false });
      notifyPriceCheckUnavailable(
        "Path of Exile lost focus before the overlay could open, so Ninja Lens left it closed.",
      );
    }
  }
}

function schedulePriceCheckQaAudit() {
  const resultPath = QA_RESULT_PATH;
  if (!resultPath || priceCheckQaScheduled || !priceCheckWindow) return;
  priceCheckQaScheduled = true;
  void (async () => {
    const deadline = Date.now() + 25_000;
    let tradeCatalogProbe = null;
    try {
      tradeCatalogProbe = await priceCheckWindow.webContents.executeJavaScript(`(async () => {
        const loader = window.poeWidget?.getTradeStatCatalog;
        if (typeof loader !== 'function') return { available: false, length: 0, error: '' };
        try {
          const text = await loader();
          return { available: true, length: typeof text === 'string' ? text.length : 0, error: '' };
        } catch (error) {
          return { available: true, length: 0, error: error instanceof Error ? error.message : String(error) };
        }
      })()`);
    } catch (error) {
      tradeCatalogProbe = {
        available: false,
        length: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    let result = null;
    let alignedReadySince = 0;
    let optionalStatsExpanded = false;
    while (Date.now() < deadline && priceCheckWindow && !priceCheckWindow.isDestroyed()) {
      try {
        if (QA_EXPAND_OPTIONAL_STATS && !optionalStatsExpanded) {
          optionalStatsExpanded = await priceCheckWindow.webContents.executeJavaScript(`(async () => {
            const button = document.querySelector('.crme-heading button');
            if (!button) return false;
            if (button.getAttribute('aria-expanded') !== 'true') button.click();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return button.getAttribute('aria-expanded') === 'true';
          })()`);
          if (optionalStatsExpanded) {
            alignedReadySince = 0;
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }
        }
        result = await priceCheckWindow.webContents.executeJavaScript(`(() => {
          const panel = document.querySelector('.pco');
          const surface = panel;
          const surfaceRect = surface?.getBoundingClientRect();
          const itemName = document.querySelector('.pco-item-name strong')?.textContent?.trim() || '';
          const error = document.querySelector('.pco-empty.invalid, .pco-empty.error')?.textContent?.trim() || '';
          const buttons = [...document.querySelectorAll('button')].map((button) => button.textContent?.trim()).filter(Boolean);
          const style = panel ? getComputedStyle(panel) : null;
          const marketRows = document.querySelectorAll('.pco-row:not(.is-loading)').length;
          const modifierEditor = document.querySelector('.crme');
          const modifierRows = [...document.querySelectorAll('.crme-row')];
          const listingPanel = document.querySelector('.ctl');
          const listingLoading = listingPanel?.getAttribute('aria-busy') === 'true';
          const listingRows = document.querySelectorAll('.ctl tbody tr').length;
          const modifierList = modifierEditor?.querySelector('.crme-list');
          const modifierHeading = modifierEditor?.querySelector('.crme-heading');
          const stateStrip = modifierEditor?.querySelector('.crme-states');
          const presets = document.querySelector('.pco-presets');
          const tradeOptions = document.querySelector('.pco-trade-options');
          const uniqueResolver = document.querySelector('.pco-unique-resolver');
          const modifierRowsHeight = modifierRows
            .reduce((height, row) => height + row.getBoundingClientRect().height, 0);
          const modifierListingHeight = listingPanel
            ? listingRows
              ? 45 + Math.min(20, listingRows) * 25
              : 93
            : 0;
          const stateStripHeight = stateStrip?.getBoundingClientRect().height || 29;
          const presetHeight = presets?.getBoundingClientRect().height || 0;
          const tradeOptionsHeight = tradeOptions?.getBoundingClientRect().height || 0;
          const uniqueResolverHeight = uniqueResolver?.getBoundingClientRect().height || 0;
          const desiredHeight = modifierEditor
            ? presetHeight + tradeOptionsHeight + uniqueResolverHeight + 115 + stateStripHeight + modifierListingHeight +
              (modifierHeading?.getBoundingClientRect().height || 0) +
              (modifierList ? modifierRowsHeight : 0)
            : listingPanel
              ? Math.min(520, presetHeight + tradeOptionsHeight + uniqueResolverHeight + 199 + Math.max(0, Math.min(20, listingRows) - 1) * 25)
              : Math.min(520, presetHeight + tradeOptionsHeight + uniqueResolverHeight + 137 + Math.max(1, Math.min(8, marketRows)) * 28);
          const expectedHeight = Math.min(
            desiredHeight,
            Math.max(1, document.documentElement.clientHeight - 16),
          );
          const marketMatches = [...document.querySelectorAll('.pco-row')]
            .map((row) => row.querySelector(':scope > span:not(.pco-listed)')?.textContent?.trim() || '')
            .filter(Boolean);
          const facts = document.querySelector('.pco-facts');
          const results = document.querySelector('.pco-results');
          const sourceLabel = document.querySelector('.pco-matched')?.textContent?.trim() || '';
          const matchLabel = document.querySelector('.pco-source')?.textContent?.trim() || '';
          const editorHeading = document.querySelector('.crme-heading strong')?.textContent?.trim() || '';
          const estimateLabel = document.querySelector('.pco-item output')?.textContent?.trim() || '';
          const detailButton = Boolean(document.querySelector('.pco-details'));
          return {
            itemName,
            error,
            ready: Boolean(
              itemName &&
              panel &&
              // An Awakened-style compact editor can legitimately have zero
              // selected rows (for example a fixed-roll unique or a crafted
              // wand whose optional stats all start disabled). The mounted
              // editor and its state/summary controls are the ready surface.
              (modifierEditor ? true : marketRows >= 1 || listingPanel) &&
              sourceLabel &&
              detailButton &&
              surfaceRect &&
              !listingLoading &&
              Math.abs(surfaceRect.height - expectedHeight) <= 1
            ),
            buttons,
            marketRows,
            liveListings: Boolean(listingPanel),
            listingRows,
            tradeStatCatalog: document.documentElement.dataset.tradeStatCatalog || '',
            modifierEditor: Boolean(modifierEditor),
            modifierRows: modifierRows.length,
            modifierLabels: [...document.querySelectorAll('.crme-label')]
              .map((entry) => entry.textContent?.trim() || '')
              .filter(Boolean),
            rangeSliders: document.querySelectorAll('.crme-dual-range input[type="range"]').length,
            matchModeSelects: document.querySelectorAll('select[aria-label^="Match mode for"]').length,
            stateLabels: [...document.querySelectorAll('.crme-state b')]
              .map((entry) => entry.textContent?.trim() || '')
              .filter(Boolean),
            expectedHeight,
            desiredHeight,
            marketMatches,
            sourceLabel,
            matchLabel,
            editorHeading,
            estimateLabel,
            detailButton,
            borderRadius: style ? parseFloat(style.borderTopLeftRadius) || 0 : null,
            compactCopyClean: !/(Ctrl\+C|clipboard-only|confidence|warning|tutorial)/i.test(document.body.innerText),
            text: document.body.innerText.slice(0, 8000),
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight,
            surfaceBounds: surfaceRect ? {
              x: Math.round(surfaceRect.x),
              y: Math.round(surfaceRect.y),
              width: Math.round(surfaceRect.width),
              height: Math.round(surfaceRect.height),
            } : null,
            horizontalOverflow: Math.max(
              0,
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
              document.body.scrollWidth - document.documentElement.clientWidth,
            ),
             verticalOverflow: surface
               ? Math.max(0, surface.scrollHeight - surface.clientHeight)
               : null,
             factHorizontalOverflow: facts
               ? Math.max(0, facts.scrollWidth - facts.clientWidth)
               : 0,
             resultsOverflow: results
               ? Math.max(0, results.scrollHeight - results.clientHeight)
               : 0,
            editorOverflow: modifierEditor
              ? Math.max(
                  0,
                  (modifierList?.scrollWidth || 0) - (modifierList?.clientWidth || 0),
                  ...modifierRows.map((row) => row.scrollWidth - row.clientWidth),
                )
              : 0,
            stateStripOverflow: stateStrip
              ? Math.max(0, stateStrip.scrollWidth - stateStrip.clientWidth)
              : 0,
            stateStripVerticalOverflow: stateStrip
              ? Math.max(0, stateStrip.scrollHeight - stateStrip.clientHeight)
              : 0,
            modifierListOverflow: modifierEditor
              ? Math.max(
                  0,
                  (modifierList?.scrollHeight || 0) - (modifierList?.clientHeight || 0),
                )
              : 0,
            layoutHeights: modifierEditor
              ? {
                  top: document.querySelector('.pco-top')?.getBoundingClientRect().height || 0,
                  item: document.querySelector('.pco-item')?.getBoundingClientRect().height || 0,
                  editor: modifierEditor.getBoundingClientRect().height,
                  editorHeading: modifierEditor.querySelector('.crme-heading')?.getBoundingClientRect().height || 0,
                  states: stateStrip?.getBoundingClientRect().height || 0,
                  modifierListClient: modifierList?.clientHeight || 0,
                  modifierListScroll: modifierList?.scrollHeight || 0,
                  modifierRows: modifierRows.map((row) => row.getBoundingClientRect().height),
                  controls: document.querySelector('.pco-controls')?.getBoundingClientRect().height || 0,
                  presets: presetHeight,
                  tradeOptions: tradeOptionsHeight,
                  uniqueResolver: uniqueResolverHeight,
                  listings: listingPanel?.getBoundingClientRect().height || 0,
                }
              : null,
          };
        })()`);
        const nativePanelAligned = Boolean(
          result?.surfaceBounds &&
          priceCheckPanelBounds &&
          !priceCheckGeometryTimer &&
          result.surfaceBounds.x === priceCheckPanelBounds.x &&
          result.surfaceBounds.y === priceCheckPanelBounds.y &&
          result.surfaceBounds.width === priceCheckPanelBounds.width &&
          result.surfaceBounds.height === priceCheckPanelBounds.height
        );
        if (result?.ready && nativePanelAligned) {
          if (!alignedReadySince) alignedReadySince = Date.now();
          if (Date.now() - alignedReadySince >= 300) break;
        } else {
          alignedReadySince = 0;
        }
        if (result?.error) break;
      } catch {
        // The renderer may still be navigating during the first poll.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    let modifierInteraction = null;
    if (result?.modifierEditor) {
      try {
        modifierInteraction = await priceCheckWindow.webContents.executeJavaScript(`(async () => {
          let slider = document.querySelector('.crme-dual-range input[type="range"]:not(:disabled)');
          let row = slider?.closest('.crme-row');
          let number = row?.querySelector('.crme-number');
          if (!slider && ${QA_EXPAND_OPTIONAL_STATS ? "true" : "false"}) {
            row = [...document.querySelectorAll('.crme-row')].find(
              (entry) => {
                const label = entry.querySelector('.crme-label')?.textContent?.trim() || '';
                return label === 'Physical DPS' || label.startsWith('Physical DPS:');
              },
            );
            const checkbox = row?.querySelector('.crme-check input[type="checkbox"]');
            if (checkbox && !checkbox.checked) {
              checkbox.click();
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }
            slider = row?.querySelector('.crme-dual-range input[type="range"]:not(:disabled)');
            number = row?.querySelector('.crme-number');
          }
          if (!slider || !row || !number) return { ready: true, skipped: true };
          const start = performance.now();
          const before = number.value;
          const minimum = Number(slider.min);
          const maximum = Number(slider.max);
          const step = Number(slider.step) || 1;
          const current = Number(slider.value);
          const target = current + step <= maximum
            ? current + step
            : Math.max(minimum, current - step);
          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set;
          if (!valueSetter) return { ready: false, error: 'Native range value setter is unavailable.' };
          valueSetter.call(slider, String(target));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
            resolve({
              ready: true,
              updated: number.value !== before,
              before,
              after: number.value,
              elapsedMs: Math.round((performance.now() - start) * 100) / 100,
              horizontalOverflow: Math.max(0, row.scrollWidth - row.clientWidth),
            });
          })));
        })()`);
      } catch (error) {
        modifierInteraction = {
          ready: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const resolvedResultPath = path.resolve(resultPath);
    const screenshotPath = path.join(path.dirname(resolvedResultPath), "price-check-smoke.png");
    fs.mkdirSync(path.dirname(resolvedResultPath), { recursive: true });
    let screenshotError = "";
    try {
      const screenshot = await priceCheckWindow.webContents.capturePage();
      fs.writeFileSync(screenshotPath, screenshot.toPNG());
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : String(error);
    }
    const windowBounds = priceCheckWindow.getBounds();
    const cursorWorkArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const panelWorkArea = screen.getDisplayMatching(windowBounds).workArea;
    const boundsInsideCursorDisplay =
      windowBounds.x >= cursorWorkArea.x &&
      windowBounds.y >= cursorWorkArea.y &&
      windowBounds.x + windowBounds.width <= cursorWorkArea.x + cursorWorkArea.width &&
      windowBounds.y + windowBounds.height <= cursorWorkArea.y + cursorWorkArea.height;
    const payload = {
      appVersion: app.getVersion(),
      nativeCaptureTest: QA_NATIVE_CAPTURE,
      tradeCatalogProbe,
      captureValid: Boolean(lastPriceCheckCapture?.validPrefix),
      timedOut: !result?.ready && !result?.error,
      result,
      modifierInteraction,
      window: {
        visible: priceCheckWindow.isVisible(),
        focused: priceCheckWindow.isFocused(),
        alwaysOnTop: priceCheckWindow.isAlwaysOnTop(),
        backgroundColor: priceCheckWindow.getBackgroundColor(),
        bounds: windowBounds,
        cursorWorkArea,
        panelWorkArea,
        boundsInsideCursorDisplay,
        dashboardHidden: !mainWindow?.isVisible(),
        overlayAttached: priceCheckOverlayAttached,
        overlayHasAccess: priceCheckOverlayHasAccess,
        overlayInteractive: priceCheckOverlayInteractive,
        overlayMode: priceCheckPresentationMode,
        overlayShapeApplied: priceCheckOverlayShapeApplied,
        overlayRevision: priceCheckOverlayRevision,
        panelInsideOverlay: Boolean(
          result?.surfaceBounds &&
          result.surfaceBounds.x >= 0 &&
          result.surfaceBounds.y >= 0 &&
          result.surfaceBounds.x + result.surfaceBounds.width <= windowBounds.width &&
          result.surfaceBounds.y + result.surfaceBounds.height <= windowBounds.height
        ),
        nativePanel: priceCheckPanelBounds ? { ...priceCheckPanelBounds } : null,
        pinDefaultApplied:
          priceCheckPinned === Boolean(settings.priceCheck.pinByDefault),
      },
      shortcut: {
        configured: settings.priceCheck.hotkey,
        lockedConfigured: DEFAULT_LOCKED_PRICE_CHECK_HOTKEY,
        registeredDuringOverlay: registeredPriceCheckHotkey,
        registeredLockedDuringOverlay: registeredLockedPriceCheckHotkey,
        warning: priceCheckShortcutWarning,
      },
      lifecycle: {
        events: priceCheckLifecycleEvents,
        passiveInitial: {
          mode: priceCheckPresentationMode,
          targetActive: Boolean(OverlayController.targetHasFocus),
          overlayFocused: priceCheckWindow.isFocused(),
          interactive: priceCheckOverlayInteractive,
          focusHandoffs: priceCheckCaptureFocusHandoffCount,
        },
      },
      screenshotPath: screenshotError ? null : screenshotPath,
      screenshotError,
    };
    try {
      const passiveGenerationBeforeRepeat = priceCheckCaptureGeneration;
      const passiveHandoffsBeforeRepeat = priceCheckCaptureFocusHandoffCount;
      const passiveRepeatStartedAt = Date.now();
      const passivePanelBeforeRepeat = priceCheckPanelBounds
        ? { ...priceCheckPanelBounds }
        : null;
      await handlePriceCheckShortcut();
      const passiveGenerationAfterFirst = priceCheckCaptureGeneration;
      await handlePriceCheckShortcut();
      const passiveRepeatDeadline = Date.now() + 3_000;
      while (
        Date.now() < passiveRepeatDeadline &&
        (
          priceCheckCaptureGeneration <= passiveGenerationAfterFirst ||
          priceCheckPresentationMode !== "passive" ||
          !priceCheckOverlayVisible ||
          priceCheckOverlayInteractive ||
          priceCheckWindow.isFocused() ||
          !OverlayController.targetHasFocus
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      payload.lifecycle.passiveRepeat = {
        callbacksCompleted: priceCheckCaptureGeneration >= passiveGenerationBeforeRepeat + 2,
        firstGenerationAdvanced:
          passiveGenerationAfterFirst > passiveGenerationBeforeRepeat,
        secondGenerationAdvanced:
          priceCheckCaptureGeneration > passiveGenerationAfterFirst,
        elapsedMs: Date.now() - passiveRepeatStartedAt,
        focusHandoffAttempted:
          priceCheckCaptureFocusHandoffCount > passiveHandoffsBeforeRepeat,
        mode: priceCheckPresentationMode,
        targetActive: Boolean(OverlayController.targetHasFocus),
        overlayFocused: priceCheckWindow.isFocused(),
        interactive: priceCheckOverlayInteractive,
        normalRegistered: registeredPriceCheckHotkey,
        lockedRegistered: registeredLockedPriceCheckHotkey,
        preparationAudit: priceCheckCapturePreparationAudit,
        positionStable: Boolean(
          passivePanelBeforeRepeat &&
          priceCheckPanelBounds &&
          passivePanelBeforeRepeat.x === priceCheckPanelBounds.x &&
          passivePanelBeforeRepeat.y === priceCheckPanelBounds.y
        ),
      };

      const lockedGenerationBefore = priceCheckCaptureGeneration;
      const lockedHandoffsBefore = priceCheckCaptureFocusHandoffCount;
      await handleLockedPriceCheckShortcut();
      const lockedDeadline = Date.now() + PRICE_CHECK_FOCUS_TIMEOUT_MS + 2_000;
      while (
        Date.now() < lockedDeadline &&
        (
          priceCheckCaptureGeneration <= lockedGenerationBefore ||
          priceCheckPresentationMode !== "locked" ||
          priceCheckActivationPending ||
          !priceCheckOverlayInteractive ||
          !priceCheckWindow.isFocused()
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      payload.lifecycle.locked = {
        generationAdvanced: priceCheckCaptureGeneration > lockedGenerationBefore,
        focusHandoffAttempted:
          priceCheckCaptureFocusHandoffCount > lockedHandoffsBefore,
        mode: priceCheckPresentationMode,
        targetActive: Boolean(OverlayController.targetHasFocus),
        overlayFocused: priceCheckWindow.isFocused(),
        interactive: priceCheckOverlayInteractive,
        activationPending: priceCheckActivationPending,
        globalNormalRegistered: registeredPriceCheckHotkey,
        globalLockedRegistered: registeredLockedPriceCheckHotkey,
      };

      // Let the native controller finish its second DPI-corrected setBounds
      // before proving that the Pin action itself cannot move the cached card.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const panelBeforePin = priceCheckPanelBounds
        ? { ...priceCheckPanelBounds }
        : null;
      await priceCheckWindow.webContents.executeJavaScript(
        "window.poeWidget.surfaceAction({ type: 'set-price-check-pinned', value: true })",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const panelAfterPin = priceCheckPanelBounds
        ? { ...priceCheckPanelBounds }
        : null;
      payload.pinToggle = {
        panelStable: Boolean(
          panelBeforePin &&
          panelAfterPin &&
          panelBeforePin.x === panelAfterPin.x &&
          panelBeforePin.y === panelAfterPin.y
        ),
        panelBefore: panelBeforePin,
        panelAfter: panelAfterPin,
        pinned: priceCheckPinned,
      };
      const resizeRevisionBefore = priceCheckOverlayRevision;
      const requestedHeightBefore = priceCheckRequestedHeight;
      const panelBeforeResize = priceCheckPanelBounds
        ? { ...priceCheckPanelBounds }
        : null;
      await priceCheckWindow.webContents.executeJavaScript(
        `window.poeWidget.surfaceAction(${JSON.stringify({
          type: "set-price-check-panel-height",
          height: requestedHeightBefore,
          captureId: lastPriceCheckCapture?.captureId,
        })})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 75));
      payload.resizeDedupe = {
        revisionStable: priceCheckOverlayRevision === resizeRevisionBefore,
        heightStable: priceCheckRequestedHeight === requestedHeightBefore,
        panelStable: Boolean(
          panelBeforeResize &&
          priceCheckPanelBounds &&
          panelBeforeResize.x === priceCheckPanelBounds.x &&
          panelBeforeResize.y === priceCheckPanelBounds.y
        ),
        geometryTimerPending: Boolean(priceCheckGeometryTimer),
        revisionBefore: resizeRevisionBefore,
        revisionAfter: priceCheckOverlayRevision,
      };
      const panelBeforeMove = priceCheckPanelBounds
        ? { ...priceCheckPanelBounds }
        : null;
      const moveLimits = priceCheckPanelSize(priceCheckWindow.getBounds());
      const moveTravelX = Math.max(
        0,
        moveLimits.maxX - moveLimits.minX - moveLimits.width,
      );
      const moveTravelY = Math.max(
        0,
        moveLimits.maxY - moveLimits.minY - moveLimits.height,
      );
      const moveTarget = panelBeforeMove
        ? {
            x: moveTravelX > 0
              ? Math.abs(panelBeforeMove.x - moveLimits.minX) < moveTravelX / 2
                ? moveLimits.maxX - moveLimits.width
                : moveLimits.minX
              : panelBeforeMove.x,
            y: moveTravelY > 0
              ? Math.abs(panelBeforeMove.y - moveLimits.minY) < moveTravelY / 2
                ? moveLimits.maxY - moveLimits.height
                : moveLimits.minY
              : panelBeforeMove.y,
          }
        : null;
      if (moveTarget) {
        await priceCheckWindow.webContents.executeJavaScript(
          `window.poeWidget.surfaceAction(${JSON.stringify({
            type: "set-price-check-panel-position",
            x: moveTarget.x,
            y: moveTarget.y,
            captureId: lastPriceCheckCapture?.captureId,
            commit: true,
          })})`,
        );
      }
      const moveDeadline = Date.now() + 1_000;
      let rendererPanelAfterMove = null;
      do {
        await new Promise((resolve) => setTimeout(resolve, 35));
        rendererPanelAfterMove = await priceCheckWindow.webContents.executeJavaScript(`(() => {
          const rect = document.querySelector('.pco')?.getBoundingClientRect();
          return rect ? {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          } : null;
        })()`);
      } while (
        Date.now() < moveDeadline &&
        JSON.stringify(rendererPanelAfterMove) !== JSON.stringify(priceCheckPanelBounds)
      );
      const panelAfterMove = priceCheckPanelBounds
        ? { ...priceCheckPanelBounds }
        : null;
      const persistedPanelPosition = sanitizePriceCheckPanelPosition(
        settings.priceCheckPanelPosition,
      );
      payload.panelMove = {
        supported: Boolean(panelBeforeMove && (moveTravelX > 0 || moveTravelY > 0)),
        moved: Boolean(
          panelBeforeMove &&
          panelAfterMove &&
          (panelBeforeMove.x !== panelAfterMove.x || panelBeforeMove.y !== panelAfterMove.y),
        ),
        rendererAligned:
          JSON.stringify(rendererPanelAfterMove) === JSON.stringify(panelAfterMove),
        positionPersisted: Boolean(persistedPanelPosition),
        openNearCursorDisabled: settings.priceCheck.openNearCursor === false,
        nativeShapeApplied: priceCheckOverlayShapeApplied,
        panelBefore: panelBeforeMove,
        panelAfter: panelAfterMove,
        rendererPanelAfter: rendererPanelAfterMove,
        normalizedPosition: persistedPanelPosition,
      };
      payload.shortcut.registeredWhilePinned = registeredPriceCheckHotkey;
      payload.shortcut.registeredLockedWhilePinned = registeredLockedPriceCheckHotkey;
      payload.shortcut.registeredWhileOverlayFocused = Boolean(
        priceCheckWindow.isFocused() &&
        (registeredPriceCheckHotkey || registeredLockedPriceCheckHotkey)
      );

      const focusHandoffsBeforeAltTab = priceCheckCaptureFocusHandoffCount;
      const focusRestoreGenerationBeforeAltTab = priceCheckFocusRestoreAudit?.generation ?? null;
      const qaSwitchWindow = new BrowserWindow({
        width: 420,
        height: 260,
        show: false,
        frame: true,
        skipTaskbar: true,
        title: "Ninja Lens QA unrelated foreground window",
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      qaSwitchWindow.setAlwaysOnTop(true, "screen-saver", 1);
      qaSwitchWindow.show();
      qaSwitchWindow.focus();
      const altTabDeadline = Date.now() + 4_000;
      while (
        Date.now() < altTabDeadline &&
        (
          OverlayController.targetHasFocus ||
          priceCheckOverlayVisible ||
          priceCheckOverlayInteractive ||
          priceCheckActivationPending ||
          priceCheckWindow.isFocused()
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      payload.lifecycle.altTab = {
        targetActive: Boolean(OverlayController.targetHasFocus),
        overlayVisible: priceCheckOverlayVisible,
        overlayInteractive: priceCheckOverlayInteractive,
        overlayMode: priceCheckPresentationMode,
        overlayFocused: priceCheckWindow.isFocused(),
        windowVisible: priceCheckWindow.isVisible(),
        mode: priceCheckPresentationMode,
        focusHandoffAttempted:
          priceCheckCaptureFocusHandoffCount > focusHandoffsBeforeAltTab,
        focusRestoreScheduled:
          (priceCheckFocusRestoreAudit?.generation ?? null) !==
          focusRestoreGenerationBeforeAltTab,
        normalRegistered: registeredPriceCheckHotkey,
        lockedRegistered: registeredLockedPriceCheckHotkey,
        unrelatedWindowFocused: qaSwitchWindow.isFocused(),
      };

      qaSwitchWindow.setFocusable(false);
      qaSwitchWindow.hide();
      // Let Chromium finish the focus transfer caused by hiding the unrelated
      // window before the one explicit QA return to PoE. Keep the test window
      // alive and hidden so a later close cannot enqueue another activation.
      await new Promise((resolve) => setTimeout(resolve, 100));
      OverlayController.focusTarget();
      // electron-overlay-window can emit one corrected blur immediately after
      // a synthetic foreground handoff, then reconcile on its native poll.
      // Wait for that observed target state; do not issue another focus call.
      const targetReturnDeadline = Date.now() + 5_000;
      while (
        Date.now() < targetReturnDeadline &&
        (
          !OverlayController.targetHasFocus ||
          registeredPriceCheckHotkey !== configuredPriceCheckHotkey ||
          registeredLockedPriceCheckHotkey !== DEFAULT_LOCKED_PRICE_CHECK_HOTKEY
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      payload.shortcut.registeredAfterAltTabReturn = registeredPriceCheckHotkey;
      payload.shortcut.registeredLockedAfterAltTabReturn = registeredLockedPriceCheckHotkey;
      const lockedReopenGeneration = priceCheckCaptureGeneration;
      await handleLockedPriceCheckShortcut();
      const lockedReopenDeadline = Date.now() + PRICE_CHECK_FOCUS_TIMEOUT_MS + 2_000;
      while (
        Date.now() < lockedReopenDeadline &&
        (
          priceCheckCaptureGeneration <= lockedReopenGeneration ||
          priceCheckPresentationMode !== "locked" ||
          priceCheckActivationPending ||
          !priceCheckOverlayInteractive ||
          !priceCheckWindow.isFocused()
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      payload.lifecycle.lockedReopen = {
        generationAdvanced: priceCheckCaptureGeneration > lockedReopenGeneration,
        mode: priceCheckPresentationMode,
        panelVisible: priceCheckOverlayVisible,
        interactive: priceCheckOverlayInteractive,
        overlayFocused: priceCheckWindow.isFocused(),
        savedPositionPreserved: (() => {
          const current = normalizedPriceCheckPanelPosition(priceCheckPanelBounds);
          const saved = sanitizePriceCheckPanelPosition(settings.priceCheckPanelPosition);
          return Boolean(
            current &&
            saved &&
            Math.abs(current.x - saved.x) <= 0.01 &&
            Math.abs(current.y - saved.y) <= 0.01
          );
        })(),
      };
      // A scripted click can otherwise land in the same native foreground
      // transition that activated the overlay. Real pointer interaction takes
      // longer than one electron-overlay-window 83 ms focus poll; settling the
      // QA driver keeps this test from manufacturing an impossible user race.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const closeButtonClicked = await priceCheckWindow.webContents.executeJavaScript(`(() => {
        const closeButton = document.querySelector('button[aria-label="Close price check"]');
        if (!(closeButton instanceof HTMLButtonElement)) return false;
        closeButton.click();
        return true;
      })()`);
      const dismissalDeadline = Date.now() + 4_000;
      let panelVisibleAfterClose = true;
      do {
        await new Promise((resolve) => setTimeout(resolve, 50));
        panelVisibleAfterClose = await priceCheckWindow.webContents.executeJavaScript(
          "Boolean(document.querySelector('.pc-overlay-card'))",
        );
      } while (
        Date.now() < dismissalDeadline &&
        (
          panelVisibleAfterClose ||
          priceCheckOverlayVisible ||
          priceCheckOverlayInteractive ||
          priceCheckPanelBounds ||
          priceCheckOverlayShapeApplied ||
          priceCheckGeometryTimer ||
          priceCheckActivationPending ||
          !OverlayController.targetHasFocus ||
          !priceCheckFocusRestoreAudit?.success ||
          priceCheckWindow.isFocused()
        )
      );
      payload.dismissal = {
        action: "close-button",
        closeButtonClicked,
        panelHidden: !panelVisibleAfterClose,
        overlayVisible: priceCheckOverlayVisible,
        overlayInteractive: priceCheckOverlayInteractive,
        overlayMode: priceCheckPresentationMode,
        overlayFocusable: priceCheckWindow.isFocusable(),
        overlayShapeApplied: priceCheckOverlayShapeApplied,
        nativePanel: priceCheckPanelBounds,
        geometryTimerPending: Boolean(priceCheckGeometryTimer),
        activationPending: priceCheckActivationPending,
        capturePending: Boolean(pendingPriceCheckCapture),
        windowVisible: priceCheckWindow.isVisible(),
        targetActive: Boolean(OverlayController.targetHasFocus),
        overlayFocused: priceCheckWindow.isFocused(),
        focusRestoreAudit: priceCheckFocusRestoreAudit,
      };
      payload.shortcut.registeredAfterTargetFocus = registeredPriceCheckHotkey;
      payload.shortcut.registeredLockedAfterTargetFocus = registeredLockedPriceCheckHotkey;
    } catch (error) {
      payload.dismissal = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    payload.backgroundThrottling = {
      priceCheck: priceCheckWindow?.webContents.getBackgroundThrottling() ?? null,
      dashboard: mainWindow?.webContents.getBackgroundThrottling() ?? null,
      tray: trayWindow?.webContents.getBackgroundThrottling() ?? null,
      quickSearch: quickWindow?.webContents.getBackgroundThrottling() ?? null,
    };
    fs.writeFileSync(resolvedResultPath, JSON.stringify(payload, null, 2));
    app.isQuitting = true;
    app.quit();
  })();
}

function priceCheckHotkeyError(value) {
  return validateShortcut(value, { global: true, priceCheck: true });
}

function unregisterActivePriceCheckShortcut() {
  if (registeredPriceCheckHotkey) {
    globalShortcut.unregister(registeredPriceCheckHotkey);
  }
  if (
    registeredLockedPriceCheckHotkey &&
    registeredLockedPriceCheckHotkey !== registeredPriceCheckHotkey
  ) {
    globalShortcut.unregister(registeredLockedPriceCheckHotkey);
  }
  registeredPriceCheckHotkey = "";
  registeredLockedPriceCheckHotkey = "";
}

function publishPriceCheckShortcutWarning(value) {
  const next = String(value || "");
  const changed = next !== priceCheckShortcutWarning;
  priceCheckShortcutWarning = next;
  updateTrayMenu();
  if (changed) broadcastSettings();
}

function priceCheckOverlayOwnsCaptureContext() {
  return Boolean(
    priceCheckOverlayVisible &&
    priceCheckWindow &&
    !priceCheckWindow.isDestroyed() &&
    priceCheckWindow.isFocused(),
  );
}

function priceCheckTargetCanCapture() {
  return Boolean(
    configuredPriceCheckHotkey &&
    priceCheckOverlayAttached &&
    priceCheckOverlayHasAccess &&
    OverlayController.targetHasFocus &&
    (!priceCheckOverlayVisible || !priceCheckWindow?.isFocused())
  );
}

function syncPriceCheckShortcutRegistration() {
  if (!priceCheckTargetCanCapture()) {
    unregisterActivePriceCheckShortcut();
    publishPriceCheckShortcutWarning("");
    return true;
  }
  if (registeredPriceCheckHotkey !== configuredPriceCheckHotkey) {
    unregisterActivePriceCheckShortcut();
    try {
      if (!globalShortcut.register(configuredPriceCheckHotkey, handlePriceCheckShortcut)) {
        publishPriceCheckShortcutWarning(
          `${configuredPriceCheckHotkey} is unavailable while Path of Exile is active.`,
        );
        return false;
      }
      registeredPriceCheckHotkey = configuredPriceCheckHotkey;
    } catch (error) {
      publishPriceCheckShortcutWarning(
        `${configuredPriceCheckHotkey} could not be activated.`,
      );
      console.warn(`${priceCheckShortcutWarning} ${error.message}`);
      return false;
    }
  }

  if (configuredPriceCheckHotkey === DEFAULT_LOCKED_PRICE_CHECK_HOTKEY) {
    registeredLockedPriceCheckHotkey = "";
    publishPriceCheckShortcutWarning(
      `${DEFAULT_LOCKED_PRICE_CHECK_HOTKEY} is also the locked price-check shortcut; choose a different normal shortcut.`,
    );
    return true;
  }
  if (registeredLockedPriceCheckHotkey === DEFAULT_LOCKED_PRICE_CHECK_HOTKEY) {
    publishPriceCheckShortcutWarning("");
    return true;
  }
  try {
    if (!globalShortcut.register(
      DEFAULT_LOCKED_PRICE_CHECK_HOTKEY,
      handleLockedPriceCheckShortcut,
    )) {
      registeredLockedPriceCheckHotkey = "";
      publishPriceCheckShortcutWarning(
        `${DEFAULT_LOCKED_PRICE_CHECK_HOTKEY} is unavailable; normal price check still works.`,
      );
      return true;
    }
    registeredLockedPriceCheckHotkey = DEFAULT_LOCKED_PRICE_CHECK_HOTKEY;
    publishPriceCheckShortcutWarning("");
    return true;
  } catch (error) {
    registeredLockedPriceCheckHotkey = "";
    publishPriceCheckShortcutWarning(
      `${DEFAULT_LOCKED_PRICE_CHECK_HOTKEY} could not be activated; normal price check still works.`,
    );
    console.warn(`${priceCheckShortcutWarning} ${error.message}`);
    return true;
  }
}

function registerPriceCheckShortcut(candidate = settings.priceCheck, fallback = settings.priceCheck) {
  const desired = candidate?.enabled ? candidate.hotkey || DEFAULT_PRICE_CHECK_HOTKEY : "";
  if (desired && priceCheckHotkeyError(desired)) return false;
  const previous = configuredPriceCheckHotkey;
  configuredPriceCheckHotkey = desired;
  if (syncPriceCheckShortcutRegistration()) return true;

  configuredPriceCheckHotkey = fallback?.enabled
    ? fallback.hotkey || previous || DEFAULT_PRICE_CHECK_HOTKEY
    : "";
  syncPriceCheckShortcutRegistration();
  return false;
}

function desktopGlobalShortcutValues(candidate = settings.shortcuts) {
  return {
    toggleWidget: candidate.toggleWidget,
    toggleClickThrough: candidate.toggleClickThrough,
    instantSearch: candidate.instantSearch,
  };
}

function desktopShortcutLabel(key) {
  return {
    toggleWidget: "Show / hide widget",
    toggleClickThrough: "Toggle click-through",
    instantSearch: "Instant market search",
    priceCheck: "Price check hovered item",
  }[key] || "Shortcut";
}

function desktopGlobalShortcutCallbacks() {
  return {
    toggleWidget: toggleVisibility,
    toggleClickThrough: () => setClickThrough(!settings.clickThrough),
    instantSearch: showQuickSearch,
  };
}

function publishDesktopShortcutWarning(value) {
  const next = String(value || "");
  const changed = next !== desktopShortcutWarning;
  desktopShortcutWarning = next;
  updateTrayMenu();
  if (changed) broadcastSettings();
}

function applyShortcutRegistrationPlan(nextSettings, previousSettings = settings) {
  const validationError = validateShortcutPlan(nextSettings);
  if (validationError) return { ok: false, error: validationError };

  const previousDesktop = { ...registeredDesktopShortcuts };
  const previousConfiguredPriceCheck = configuredPriceCheckHotkey;
  unregisterActivePriceCheckShortcut();

  const desktopResult = replaceGlobalShortcutPlan({
    globalShortcut,
    previousDesktop,
    nextDesktop: desktopGlobalShortcutValues(nextSettings.shortcuts),
    callbacks: desktopGlobalShortcutCallbacks(),
    probeAccelerator: nextSettings.priceCheck.enabled
      ? nextSettings.priceCheck.hotkey || DEFAULT_PRICE_CHECK_HOTKEY
      : "",
  });
  registeredDesktopShortcuts = desktopResult.registered;
  if (!desktopResult.ok) {
    configuredPriceCheckHotkey = previousConfiguredPriceCheck;
    syncPriceCheckShortcutRegistration();
    const rollbackNote = desktopResult.rollbackComplete
      ? "The previous shortcuts are still active."
      : "Windows also refused one previous shortcut; use the tray until restart.";
    return {
      ok: false,
      error:
        `${desktopShortcutLabel(desktopResult.failedKey)} ` +
        `(${desktopResult.failedAccelerator}) is already in use. ${rollbackNote}`,
    };
  }

  configuredPriceCheckHotkey = nextSettings.priceCheck.enabled
    ? nextSettings.priceCheck.hotkey || DEFAULT_PRICE_CHECK_HOTKEY
    : "";
  if (syncPriceCheckShortcutRegistration()) {
    publishDesktopShortcutWarning("");
    return { ok: true };
  }

  unregisterActivePriceCheckShortcut();
  const rollback = replaceGlobalShortcutSet({
    globalShortcut,
    previous: registeredDesktopShortcuts,
    next: previousDesktop,
    callbacks: desktopGlobalShortcutCallbacks(),
  });
  registeredDesktopShortcuts = rollback.registered;
  configuredPriceCheckHotkey = previousSettings.priceCheck.enabled
    ? previousConfiguredPriceCheck || previousSettings.priceCheck.hotkey
    : "";
  syncPriceCheckShortcutRegistration();
  const rollbackNote = !rollback.ok
    ? "Windows also refused one previous shortcut; use the tray until restart."
    : "The previous shortcuts are still active.";
  return {
    ok: false,
    error:
      `Price check hovered item (${nextSettings.priceCheck.hotkey}) is already in use. ` +
      rollbackNote,
  };
}

function createPriceCheckWindow() {
  const window = new BrowserWindow({
    ...OVERLAY_WINDOW_OPTS,
    width: 800,
    height: 600,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    title: "Ninja Lens - Path of Exile Overlay",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });
  window.setMenu(null);
  configureWindowSecurity(window);
  installRendererRecovery(window, "price-check", () => {
    deactivatePriceCheck({ focusTarget: true });
  });
  void loadRenderer(window, "price-check");
  window.webContents.on("did-finish-load", () => {
    if (lastPriceCheckCapture) sendPriceCheckCapture(lastPriceCheckCapture);
    sendPriceCheckOverlayState();
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      (input.key === "Escape" || (input.control && input.key.toLowerCase() === "w"))
    ) {
      event.preventDefault();
      process.nextTick(() => deactivatePriceCheck());
      return;
    }
    if (
      input.type === "keyDown" &&
      !input.isAutoRepeat &&
      priceCheckOverlayVisible &&
      (
        electronInputMatchesAccelerator(input, configuredPriceCheckHotkey) ||
        electronInputMatchesAccelerator(input, DEFAULT_LOCKED_PRICE_CHECK_HOTKEY)
      )
    ) {
      const accelerator = electronInputMatchesAccelerator(
        input,
        DEFAULT_LOCKED_PRICE_CHECK_HOTKEY,
      )
        ? DEFAULT_LOCKED_PRICE_CHECK_HOTKEY
        : configuredPriceCheckHotkey;
      event.preventDefault();
      if (!settings.priceCheck.legacyBehavior) {
        // Awakened parity: while the overlay owns keyboard focus, the
        // registered hotkey is not re-evaluated inside it. Escape and
        // Ctrl+W return focus to the game, where the hotkey is live again.
        return;
      }
      process.nextTick(() => {
        void requestPriceCheckCapture({
          mode: "locked",
          accelerator,
          allowFocusHandoff: true,
        });
      });
    }
  });
  window.on("focus", () => {
    auditPriceCheckLifecycle("overlay-focus");
    if (priceCheckPanelWatchAbort) priceCheckPanelWatchAbort.abort();
    priceCheckPanelWatchAbort = null;
    unregisterActivePriceCheckShortcut();
    const acceptFocus = shouldAcceptPriceCheckOverlayFocus({
      visible: priceCheckOverlayVisible,
      mode: priceCheckPresentationMode,
      activationPending: priceCheckActivationPending,
      interactive: priceCheckOverlayInteractive,
      passivePanelHitTest: priceCheckOverlayShapeApplied,
    });
    if (!acceptFocus) {
      window.setIgnoreMouseEvents(true);
      if (
        priceCheckOverlayVisible &&
        priceCheckPresentationMode === "passive" &&
        priceCheckOverlayAttached
      ) {
        try {
          OverlayController.focusTarget();
        } catch {
          deactivatePriceCheck({
            focusTarget: false,
            reason: "passive-focus-rejected",
          });
        }
      }
      return;
    }
    if (priceCheckPresentationMode === "passive") {
      priceCheckPresentationMode = "promoted";
      priceCheckPromotionTracksPointerExit = false;
      auditPriceCheckLifecycle("passive-panel-click");
    }
    priceCheckActivationPending = false;
    priceCheckOverlayInteractive = true;
    window.setIgnoreMouseEvents(false);
    if (priceCheckPresentationMode === "promoted") {
      startPriceCheckPanelExitWatch(priceCheckActivationGeneration);
    }
    sendPriceCheckOverlayState();
    schedulePriceCheckQaAudit();
  });
  window.on("blur", () => {
    auditPriceCheckLifecycle("overlay-blur");
    stopPriceCheckPanelTracker();
    const blurGeneration = priceCheckActivationGeneration;
    syncPriceCheckShortcutRegistration();
    setTimeout(() => {
      if (
        blurGeneration !== priceCheckActivationGeneration ||
        !priceCheckOverlayVisible ||
        window.isFocused()
      ) return;
      const focusedApplicationWindow = BrowserWindow.getFocusedWindow();
      const otherApplicationWindowFocused = Boolean(
        focusedApplicationWindow && focusedApplicationWindow !== window,
      );
      const targetFocused = Boolean(OverlayController.targetHasFocus);
      const disposition = priceCheckBlurDisposition({
        visible: priceCheckOverlayVisible,
        overlayFocused: window.isFocused(),
        targetFocused,
        otherApplicationWindowFocused,
        mode: priceCheckPresentationMode,
        pinned: priceCheckPinned,
        closeOnBlur: settings.priceCheck?.closeOnBlur,
      });
      if (disposition === "hide") {
        // Blur already transferred focus elsewhere. Closing must never pull it
        // back (especially when the destination is Alt-Tab, not the game).
        deactivatePriceCheck({ focusTarget: false, reason: "overlay-blur-external" });
        if (otherApplicationWindowFocused || !targetFocused) {
          // electron-overlay-window can report the previous target focus for
          // one native polling interval. Do not let that stale bit briefly
          // re-register game-only shortcuts over the app the user selected.
          unregisterActivePriceCheckShortcut();
        }
      } else if (disposition === "passive") {
        setPriceCheckOverlayPassive();
      }
    }, 40);
  });
  window.on("move", schedulePriceCheckGeometrySync);
  window.on("resize", schedulePriceCheckGeometrySync);
  window.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      deactivatePriceCheck();
    }
  });

  OverlayController.events.on("attach", (event) => {
    priceCheckOverlayAttached = true;
    priceCheckOverlayHasAccess = event.hasAccess !== false;
    priceCheckOverlayMessage = priceCheckOverlayHasAccess
      ? ""
      : "Path of Exile is running at a different Windows privilege level.";
    sendPriceCheckOverlayState(
      priceCheckOverlayMessage,
    );
    syncPriceCheckShortcutRegistration();
    if (QA_NATIVE_CAPTURE && !priceCheckQaCaptureScheduled) {
      priceCheckQaCaptureScheduled = true;
      const deadline = Date.now() + 4_000;
      const attemptCapture = () => {
        if (!OverlayController.targetHasFocus) {
          try {
            OverlayController.focusTarget();
          } catch {
            // The retry deadline below will surface a normal failed capture.
          }
          if (Date.now() < deadline) {
            setTimeout(attemptCapture, 140);
            return;
          }
        }
        void captureHoveredPoeItem({
          mode: "passive",
          accelerator: configuredPriceCheckHotkey,
        }).then((capture) => {
          if (capture?.validPrefix || Date.now() >= deadline) {
            showPriceCheck(capture || {
              text: "",
              capturedAt: Date.now(),
              validPrefix: false,
            }, { mode: "passive" });
            return;
          }
          try {
            OverlayController.focusTarget();
          } catch {
            // Retry after Windows finishes its foreground transition.
          }
          setTimeout(attemptCapture, 140);
        });
      };
      setTimeout(attemptCapture, 180);
    }
    const pendingExpired = Boolean(
      pendingPriceCheckCapture &&
      !pendingPriceCheckRestorePinned &&
      Date.now() > pendingPriceCheckCaptureExpiresAt,
    );
    if (pendingExpired) {
      pendingPriceCheckCapture = null;
      pendingPriceCheckRestorePinned = false;
      pendingPriceCheckCaptureExpiresAt = 0;
      pendingPriceCheckCaptureGeneration = 0;
    }
    if (pendingPriceCheckCapture && priceCheckOverlayHasAccess) {
      const pending = pendingPriceCheckCapture;
      const preservePin = pendingPriceCheckRestorePinned;
      const replayGeneration = pendingPriceCheckCaptureGeneration;
      const replayExpiresAt = pendingPriceCheckCaptureExpiresAt;
      pendingPriceCheckCapture = null;
      pendingPriceCheckRestorePinned = false;
      pendingPriceCheckCaptureExpiresAt = 0;
      pendingPriceCheckCaptureGeneration = 0;
      setTimeout(() => {
        if (
          replayGeneration !== priceCheckCaptureGeneration ||
          (!preservePin && Date.now() > replayExpiresAt)
        ) return;
        // Reattaching a restarted game must never resurrect a pinned card as a
        // focused locked window. Restore it as the same passive overlay host;
        // the player can deliberately promote it afterward.
        showPriceCheck(pending, {
          preservePin,
          mode: "passive",
        });
      }, 80);
    }
  });
  OverlayController.events.on("focus", () => {
    auditPriceCheckLifecycle("target-focus");
    syncPriceCheckShortcutRegistration();
    if (!priceCheckOverlayVisible) {
      window.setIgnoreMouseEvents(true);
      sendPriceCheckOverlayState();
      return;
    }
    if (priceCheckPresentationMode === "passive") {
      // electron-overlay-window resets attached overlays to click-through when
      // PoE regains focus. Re-enable only the already-applied card shape.
      window.setIgnoreMouseEvents(false);
      if (!priceCheckPanelWatchAbort) {
        startPriceCheckPanelTracker(priceCheckActivationGeneration);
      }
      sendPriceCheckOverlayState();
      return;
    }
    if (
      !priceCheckActivationPending &&
      !window.isFocused()
    ) {
      if (settings.priceCheck?.closeOnBlur && !priceCheckPinned) {
        deactivatePriceCheck({ focusTarget: false });
        return;
      } else if (priceCheckOverlayVisible) {
        setPriceCheckOverlayPassive();
        return;
      }
    }
    sendPriceCheckOverlayState();
  });
  OverlayController.events.on("blur", () => {
    auditPriceCheckLifecycle("target-blur");
    const blurGeneration = priceCheckActivationGeneration;
    const classificationDeadline = Date.now() + PRICE_CHECK_CLIPBOARD_TIMEOUT_MS;
    syncPriceCheckShortcutRegistration();
    // activateOverlay intentionally blurs the game before focusing this card.
    // Defer classification so that handoff can complete; a real app switch has
    // neither the target nor this overlay focused after the delay.
    const classifyBlur = () => {
      if (
        blurGeneration !== priceCheckActivationGeneration ||
        !priceCheckOverlayVisible ||
        priceCheckActivationPending ||
        window.isFocused()
      ) return;
      if (latestPriceCheckCapture.isRunning() && Date.now() < classificationDeadline) {
        setTimeout(classifyBlur, 35);
        return;
      }
      // Neither PoE nor the card accepted focus. This is an app switch, so the
      // overlay always disappears and never calls focusTarget from a timer.
      deactivatePriceCheck({ focusTarget: false, reason: "target-blur-external" });
    };
    setTimeout(classifyBlur, 40);
    sendPriceCheckOverlayState();
  });
  OverlayController.events.on("detach", () => {
    const restorePinned = Boolean(
      priceCheckPinned && priceCheckOverlayVisible && lastPriceCheckCapture,
    );
    if (restorePinned) {
      const captureGeneration = ++priceCheckCaptureGeneration;
      pendingPriceCheckCapture = lastPriceCheckCapture;
      pendingPriceCheckRestorePinned = true;
      pendingPriceCheckCaptureExpiresAt = Number.POSITIVE_INFINITY;
      pendingPriceCheckCaptureGeneration = captureGeneration;
    }
    priceCheckOverlayAttached = false;
    priceCheckOverlayHasAccess = true;
    unregisterActivePriceCheckShortcut();
    deactivatePriceCheck({ focusTarget: false, preservePending: restorePinned });
  });

  window.setIgnoreMouseEvents(true);
  OverlayController.attachByTitle(
    window,
    priceCheckTargetTitle(),
  );
  return window;
}

function createAuxiliaryWindow(surface) {
  const traySurface = surface === "tray";
  const window = new BrowserWindow({
    width: traySurface ? TRAY_PANEL_WIDTH : QUICK_SEARCH_WIDTH,
    height: traySurface ? TRAY_PANEL_HEIGHT : QUICK_SEARCH_HEIGHT,
    minWidth: traySurface ? TRAY_PANEL_WIDTH : QUICK_SEARCH_WIDTH,
    minHeight: traySurface ? TRAY_PANEL_HEIGHT : QUICK_SEARCH_HEIGHT,
    maxWidth: traySurface ? TRAY_PANEL_WIDTH : QUICK_SEARCH_WIDTH,
    maxHeight: traySurface ? TRAY_PANEL_HEIGHT : QUICK_SEARCH_HEIGHT,
    frame: false,
    show: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#080b10",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });
  window.setAlwaysOnTop(true, "pop-up-menu");
  configureWindowSecurity(window);
  installRendererRecovery(window, surface, () => window.hide());
  void loadRenderer(window, surface);
  window.webContents.on("did-finish-load", () => {
    safeSend(window, "surface:state", surfaceState);
  });
  window.on("blur", () => {
    if (
      !QA_OPEN_SURFACE &&
      !window.webContents.isDevToolsOpened()
    ) {
      window.hide();
    }
  });
  window.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  return window;
}

function visibleToolkitOverlayBounds(savedBounds, drawing) {
  const primary = screen.getPrimaryDisplay().workArea;
  const minimumWidth = drawing ? 600 : 380;
  const minimumHeight = 320;
  const width = Math.max(minimumWidth, Math.min(Number(savedBounds?.width) || (drawing ? 840 : 620), primary.width));
  const height = Math.max(minimumHeight, Math.min(Number(savedBounds?.height) || (drawing ? 650 : 580), primary.height));
  const requested = {
    width,
    height,
    x: Number.isFinite(Number(savedBounds?.x)) ? Number(savedBounds.x) : primary.x + Math.round((primary.width - width) / 2),
    y: Number.isFinite(Number(savedBounds?.y)) ? Number(savedBounds.y) : primary.y + Math.round((primary.height - height) / 2),
  };
  if (screen.getAllDisplays().some((display) => intersectsWorkArea(requested, display.workArea))) return requested;
  return {
    width,
    height,
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
  };
}

function persistToolkitOverlayBounds(kind, window) {
  clearTimeout(toolkitOverlayGeometryTimers.get(kind));
  toolkitOverlayGeometryTimers.set(kind, setTimeout(() => {
    toolkitOverlayGeometryTimers.delete(kind);
    if (app.isQuitting || window.isDestroyed()) return;
    const store = getToolkitRuntimeStore();
    const current = store.get();
    store.save({
      ...current,
      overlayBounds: { ...current.overlayBounds, [kind]: window.getBounds() },
    });
  }, 250));
}

function createToolkitOverlayWindow(kind) {
  const surface = `toolkit-overlay-${kind}`;
  const drawing = kind === "whiteboard";
  const bounds = visibleToolkitOverlayBounds(getToolkitRuntimeStore().get().overlayBounds?.[kind], drawing);
  const window = new BrowserWindow({
    ...bounds,
    minWidth: drawing ? 600 : 380,
    minHeight: 320,
    frame: false,
    show: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#080f14",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.setAlwaysOnTop(true, "screen-saver");
  window.setMenu(null);
  configureWindowSecurity(window);
  installRendererRecovery(window, surface, () => window.hide());
  void loadRenderer(window, surface);
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      const focused = window.isFocused();
      window.hide();
      if (focused && priceCheckOverlayAttached) OverlayController.focusTarget();
    }
  });
  window.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("move", () => persistToolkitOverlayBounds(kind, window));
  window.on("resize", () => persistToolkitOverlayBounds(kind, window));
  toolkitOverlayWindows.set(kind, window);
  return window;
}

function showToolkitOverlay(kind) {
  if (kind !== "cheats" && kind !== "whiteboard") throw new Error("Unknown toolkit overlay.");
  const window = toolkitOverlayWindows.get(kind) || createToolkitOverlayWindow(kind);
  if (window.isMinimized()) window.restore();
  window.showInactive();
  window.moveTop();
}

function hideToolkitOverlay(sender) {
  const window = [...toolkitOverlayWindows.values()].find((entry) => entry.webContents === sender);
  if (!window) return;
  const focused = window.isFocused();
  window.hide();
  if (focused && priceCheckOverlayAttached) OverlayController.focusTarget();
}

async function captureToolkitGameWindow() {
  if (!priceCheckOverlayAttached || !OverlayController.targetHasFocus) return null;
  const expectedTitle = priceCheckTargetTitle();
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 1280, height: 720 },
    fetchWindowIcons: false,
  });
  const source = sources.find((entry) => entry.name === expectedTitle);
  if (!source || !OverlayController.targetHasFocus) return null;
  const size = source.thumbnail.getSize();
  if (!size.width || !size.height) return null;
  return { dataUrl: source.thumbnail.toDataURL(), width: size.width, height: size.height };
}

function positionTrayPanel() {
  if (!trayWindow) return;
  const trayBounds = tray?.getBounds();
  const point =
    trayBounds && trayBounds.width > 0
      ? {
          x: trayBounds.x + Math.round(trayBounds.width / 2),
          y: trayBounds.y + Math.round(trayBounds.height / 2),
        }
      : screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(point).workArea;
  const x = Math.max(
    workArea.x + 8,
    Math.min(
      point.x - TRAY_PANEL_WIDTH + 22,
      workArea.x + workArea.width - TRAY_PANEL_WIDTH - 8,
    ),
  );
  const opensAbove = point.y > workArea.y + TRAY_PANEL_HEIGHT + 24;
  const y = opensAbove
    ? point.y - TRAY_PANEL_HEIGHT - 14
    : point.y + 22;
  trayWindow.setPosition(
    Math.round(x),
    Math.round(
      Math.max(
        workArea.y + 8,
        Math.min(y, workArea.y + workArea.height - TRAY_PANEL_HEIGHT - 8),
      ),
    ),
    false,
  );
}

function positionQuickSearch() {
  if (!quickWindow) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  quickWindow.setPosition(
    workArea.x + Math.round((workArea.width - QUICK_SEARCH_WIDTH) / 2),
    workArea.y +
      Math.max(42, Math.round((workArea.height - QUICK_SEARCH_HEIGHT) * 0.18)),
    false,
  );
}

function toggleTrayPanel() {
  if (!trayWindow) return;
  quickWindow?.hide();
  if (trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }
  positionTrayPanel();
  safeSend(trayWindow, "surface:state", surfaceState);
  trayWindow.show();
  trayWindow.focus();
}

function showQuickSearch() {
  if (!quickWindow) return;
  trayWindow?.hide();
  positionQuickSearch();
  safeSend(quickWindow, "surface:state", surfaceState);
  quickWindow.show();
  quickWindow.focus();
}

function broadcastSurfaceState() {
  for (const window of [trayWindow, quickWindow]) {
    if (window && !window.isDestroyed()) {
      safeSend(window, "surface:state", surfaceState);
    }
  }
}

function createWindow() {
  const savedBounds = settings.bounds || settings.expandedBounds || {};
  const bounds = visibleWindowBounds(savedBounds, Boolean(settings.compact));
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 460,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: "#080b10",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    alwaysOnTop: Boolean(settings.alwaysOnTop),
    opacity: Number(settings.opacity) || 1,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });

  mainWindow.setAlwaysOnTop(Boolean(settings.alwaysOnTop), "floating");
  mainWindow.setIgnoreMouseEvents(Boolean(settings.clickThrough), { forward: true });
  configureWindowSecurity(mainWindow);
  mainCommandQueue.markLoading(mainWindow);
  mainWindow.webContents.on("did-start-loading", () => {
    mainCommandQueue.markLoading(mainWindow);
  });
  installRendererRecovery(mainWindow, undefined, () => {
    mainCommandQueue.markLoading(mainWindow);
  });
  void loadRenderer(mainWindow);

  mainWindow.once("ready-to-show", () => {
    if (!settings.startMinimized && !START_MINIMIZED && !QA_OPEN_SURFACE) {
      mainWindow.show();
    }
  });

  let boundsTimer;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isMinimized() && !settings.compact) {
        settings.bounds = mainWindow.getBounds();
        persistSettings();
      }
    }, 350);
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);
  mainWindow.on("show", () => {
    trayWindow?.hide();
    quickWindow?.hide();
    updateTrayMenu();
  });
  mainWindow.on("hide", updateTrayMenu);
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      updateTrayMenu();
    }
  });
}

const gotSingleInstanceLock =
  Boolean(QA_OPEN_SURFACE) ||
  app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.setAppUserModelId("com.ninjalens.poe");

app.on("second-instance", () => {
  showMainWindow();
});

function migrateLegacyDataDirectories() {
  try {
    const currentUserData = app.getPath("userData");
    const legacyUserData = path.join(app.getPath("appData"), "PoE Economy Widget");
    if (
      legacyUserData !== currentUserData &&
      !fs.existsSync(currentUserData) &&
      fs.existsSync(legacyUserData)
    ) {
      const entries = fs.readdirSync(legacyUserData, { withFileTypes: true });
      const hasSettings = entries.some(
        (entry) => entry.name !== "Update Cache" && entry.name.toLowerCase() !== "crashpad",
      );
      if (hasSettings) {
        fs.mkdirSync(currentUserData, { recursive: true });
        for (const entry of entries) {
          fs.cpSync(
            path.join(legacyUserData, entry.name),
            path.join(currentUserData, entry.name),
            { recursive: true, force: true },
          );
        }
      }
    }
  } catch {
    // Legacy data remains untouched if migration is not possible.
  }
}

app.whenReady().then(() => {
  migrateLegacyDataDirectories();
  void cleanupRetiredCacheFiles();
  loadSettings();
  getToolkitRuntimeStore();
  if (settingsNeedPersist) persistSettings();
  if (!registerPriceCheckShortcut()) {
    priceCheckShortcutWarning =
      `${settings.priceCheck.hotkey} is already in use. Open Price checker settings ` +
      "and choose another shortcut; the tray action still works.";
  }
  priceCheckPinned = Boolean(settings.priceCheck.pinByDefault);
  createWindow();
  trayWindow = createAuxiliaryWindow("tray");
  quickWindow = createAuxiliaryWindow("quick");
  priceCheckWindow = createPriceCheckWindow();

  tray = new Tray(createTrayIcon());
  tray.setToolTip("Ninja Lens - click for the market panel");
  tray.on("click", handleTrayClick);
  updateTrayMenu();

  updateService = new UpdateService({
    app,
    feedUrl: readConfiguredFeedUrl({
      resourcesPath: process.resourcesPath,
      appRoot: path.join(__dirname, ".."),
      allowEnvironment: DEV_RUNTIME,
    }),
    autoCheck: settings.autoCheckUpdates,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    startDelayMs: DEV_RUNTIME
      ? process.env.POE_WIDGET_UPDATE_CHECK_DELAY_MS
      : undefined,
    diagnosticsPath: DEV_RUNTIME
      ? process.env.POE_WIDGET_UPDATE_DIAGNOSTICS_PATH || ""
      : "",
    onState: (update) => {
      surfaceState = { ...surfaceState, update };
      broadcastSurfaceState();
      safeSend(mainWindow, "update:state", update);
    },
  });
  updateService.start();

  const qaSurface = QA_OPEN_SURFACE;
  const qaWindow =
    qaSurface === "tray"
      ? trayWindow
      : qaSurface === "price-check"
        ? priceCheckWindow
        : quickWindow;
  const openQaSurface =
    qaSurface === "tray"
      ? toggleTrayPanel
      : qaSurface === "quick"
        ? showQuickSearch
      : qaSurface === "price-check"
          ? QA_NATIVE_CAPTURE ? null : showPriceCheck
        : null;
  if (qaWindow && openQaSurface) {
    if (qaWindow.webContents.isLoadingMainFrame()) {
      qaWindow.webContents.once("did-finish-load", () => openQaSurface());
    } else {
      setImmediate(openQaSurface);
    }
  }

  const shortcutResult = registerGlobalShortcutSetBestEffort({
    globalShortcut,
    next: desktopGlobalShortcutValues(settings.shortcuts),
    callbacks: desktopGlobalShortcutCallbacks(),
  });
  registeredDesktopShortcuts = shortcutResult.registered;
  if (shortcutResult.failures.length) {
    const [firstFailure] = shortcutResult.failures;
    const activeCount = Object.keys(shortcutResult.registered).length;
    publishDesktopShortcutWarning(
      `${desktopShortcutLabel(firstFailure.key)} (${firstFailure.accelerator}) is already in use. ` +
      (shortcutResult.failures.length > 1
        ? `${shortcutResult.failures.length - 1} other global shortcuts are also unavailable. `
        : "") +
      (activeCount
        ? `${activeCount} other configured global shortcut${activeCount === 1 ? " remains" : "s remain"} active. `
        : "No dashboard global shortcuts were activated. ") +
      "Use the tray or choose new keys in Settings.",
    );
  }
  const toolkitMacroFailures = syncToolkitMacroShortcuts(getToolkitRuntimeStore().get());
  syncToolkitStashScroll(getToolkitRuntimeStore().get());
  if (toolkitMacroFailures.length) {
    safeSend(mainWindow, "toolkit:macro-result", {
      ok: false,
      message: `${toolkitMacroFailures.length} toolkit macro shortcut${toolkitMacroFailures.length === 1 ? " is" : "s are"} unavailable.`,
    });
  }
  updateTrayMenu();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  pobEngineDispatcher.dispose();
  pobPlannerDispatcher.dispose();
  stopPriceCheckPanelTracker();
  globalShortcut.unregisterAll();
  if (
    toolkitStashScrollProcess &&
    toolkitStashScrollProcess.exitCode == null &&
    !toolkitStashScrollProcess.killed
  ) toolkitStashScrollProcess.kill();
  toolkitStashScrollProcess = null;
  toolkitStashScrollConfig = "";
  updateService?.dispose();
  updateService = null;
  clearTimeout(trayClickTimer);
  trayClickTimer = null;
  clearTimeout(priceCheckGeometryTimer);
  priceCheckGeometryTimer = null;
  for (const timer of toolkitOverlayGeometryTimers.values()) clearTimeout(timer);
  toolkitOverlayGeometryTimers.clear();
  trayWindow?.destroy();
  quickWindow?.destroy();
  for (const window of toolkitOverlayWindows.values()) window.destroy();
  toolkitOverlayWindows.clear();
  trayWindow = null;
  quickWindow = null;
  tray?.destroy();
  tray = null;
});

app.on("window-all-closed", (event) => {
  event.preventDefault?.();
});

function validateOverviewRequest(request) {
  if (!request || typeof request !== "object") {
    throw new Error("Invalid economy request.");
  }
  const league = typeof request.league === "string" ? request.league.trim() : "";
  const type = typeof request.type === "string" ? request.type.trim() : "";
  const allowedSources = new Set(["exchange", "stash-item", "stash-currency"]);
  if (
    !league ||
    league.length > 100 ||
    !type ||
    type.length > 100 ||
    !allowedSources.has(request.source)
  ) {
    throw new Error("Invalid economy request.");
  }
  return {
    league,
    type,
    source: request.source,
    force: Boolean(request.force),
  };
}

function limitedString(value, maxLength = 160) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeQuickRow(row, fallbackLeague) {
  if (!row || typeof row !== "object") return null;
  const allowedSources = new Set([
    "exchange",
    "stash-item",
    "stash-currency",
  ]);
  const key = limitedString(row.key);
  const name = limitedString(row.name);
  const categoryId = limitedString(row.categoryId, 100);
  const source = allowedSources.has(row.source) ? row.source : "";
  if (!key || !name || !categoryId || !source) return null;
  return {
    key,
    name,
    icon:
      typeof row.icon === "string" && /^https:\/\//i.test(row.icon)
        ? row.icon.slice(0, 1000)
        : undefined,
    categoryId,
    categoryLabel: limitedString(row.categoryLabel, 100),
    source,
    league: limitedString(row.league || fallbackLeague, 100),
    chaosValue: Math.max(0, finiteNumber(row.chaosValue)),
    divineValue: Math.max(0, finiteNumber(row.divineValue)),
    change: row.change == null ? null : finiteNumber(row.change),
    volume: row.volume == null ? null : Math.max(0, finiteNumber(row.volume)),
    listingCount:
      row.listingCount == null
        ? null
        : Math.max(0, finiteNumber(row.listingCount)),
    variant: limitedString(row.variant, 160) || undefined,
    baseType: limitedString(row.baseType, 160) || undefined,
    lowConfidence: Boolean(row.lowConfidence),
  };
}

function sanitizeSurfaceState(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid surface state.");
  }
  const league = limitedString(value.league, 100);
  const searchRows = (Array.isArray(value.searchRows) ? value.searchRows : [])
    .slice(0, 6000)
    .map((row) => sanitizeQuickRow(row, league))
    .filter(Boolean);
  const topMovers = (Array.isArray(value.topMovers) ? value.topMovers : [])
    .slice(0, 5)
    .map((row) => sanitizeQuickRow(row, league))
    .filter(Boolean);
  const alerts = (Array.isArray(value.alerts) ? value.alerts : [])
    .slice(0, 20)
    .map((alert) => {
      const row = sanitizeQuickRow(
        {
          ...alert,
          key: alert?.key,
          name: alert?.name,
          categoryLabel: "",
          chaosValue: 0,
          divineValue: 0,
          change: null,
          volume: null,
          listingCount: null,
          lowConfidence: false,
        },
        league,
      );
      if (!row || (alert.unit !== "chaos" && alert.unit !== "divine")) return null;
      return {
        key: row.key,
        name: row.name,
        icon: row.icon,
        current: Math.max(0, finiteNumber(alert.current)),
        target: Math.max(0, finiteNumber(alert.target)),
        unit: alert.unit,
        categoryId: row.categoryId,
        source: row.source,
        league: row.league,
      };
    })
    .filter(Boolean);
  return {
    league,
    categoryLabel: limitedString(value.categoryLabel, 100),
    fetchedAt:
      value.fetchedAt == null ? undefined : Math.max(0, finiteNumber(value.fetchedAt)),
    stale: Boolean(value.stale),
    loading: Boolean(value.loading),
    divineChaos:
      value.divineChaos == null
        ? undefined
        : Math.max(0, finiteNumber(value.divineChaos)),
    alertCount: Math.max(0, Math.floor(finiteNumber(value.alertCount))),
    alerts,
    topMovers,
    searchRows,
    update: surfaceState.update,
  };
}

function validateSurfaceAction(action) {
  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    throw new Error("Invalid surface action.");
  }
  const simpleActions = new Set([
    "hide-surface",
    "hide-price-check",
    "open-price-check",
    "open-dashboard",
    "open-quick-search",
    "open-watchlist",
    "refresh-market",
    "check-update",
    "install-update",
    "quit",
  ]);
  if (simpleActions.has(action.type)) return { type: action.type };
  if (action.type === "open-price-check-dashboard") {
    return {
      type: action.type,
      snapshot: sanitizePriceCheckDashboardSnapshot(action.snapshot) || undefined,
    };
  }
  if (action.type === "consume-price-check-dashboard-handoff") {
    const captureId = Number(action.captureId);
    const handoffId = Number(action.handoffId);
    if (
      !Number.isSafeInteger(captureId) ||
      captureId < 0 ||
      !Number.isSafeInteger(handoffId) ||
      handoffId < 0
    ) {
      throw new Error("Invalid price-check dashboard handoff acknowledgement.");
    }
    return { type: action.type, captureId, handoffId };
  }
  if (action.type === "set-price-check-pinned") {
    return { type: action.type, value: Boolean(action.value) };
  }
  if (action.type === "set-price-check-panel-height") {
    const height = Number(action.height);
    const captureId = Number(action.captureId);
    if (!Number.isFinite(height) || !Number.isSafeInteger(captureId) || captureId < 0) {
      throw new Error("Invalid price-check panel resize.");
    }
    return {
      type: action.type,
      height: Math.max(
        PRICE_CHECK_EMPTY_HEIGHT,
        Math.min(PRICE_CHECK_MAX_REQUESTED_HEIGHT, Math.round(height)),
      ),
      captureId,
    };
  }
  if (action.type === "set-price-check-panel-position") {
    const x = Number(action.x);
    const y = Number(action.y);
    const captureId = Number(action.captureId);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isSafeInteger(captureId) ||
      captureId < 0
    ) {
      throw new Error("Invalid price-check panel move.");
    }
    return {
      type: action.type,
      x: Math.max(-1_000_000, Math.min(1_000_000, Math.round(x))),
      y: Math.max(-1_000_000, Math.min(1_000_000, Math.round(y))),
      captureId,
      commit: Boolean(action.commit),
    };
  }
  if (action.type === "open-row") {
    const allowedSources = new Set([
      "exchange",
      "stash-item",
      "stash-currency",
    ]);
    const league = limitedString(action.league, 100);
    const categoryId = limitedString(action.categoryId, 100);
    const rowKey = limitedString(action.rowKey);
    if (!league || !categoryId || !rowKey || !allowedSources.has(action.source)) {
      throw new Error("Invalid row navigation action.");
    }
    return {
      type: action.type,
      league,
      categoryId,
      source: action.source,
      rowKey,
    };
  }
  throw new Error(`Unknown surface action: ${action.type}`);
}

function sanitizeSettingsPatch(patch) {
  if (!patch || typeof patch !== "object") return {};
  const sanitized = {};
  if ("alwaysOnTop" in patch) sanitized.alwaysOnTop = Boolean(patch.alwaysOnTop);
  if ("compact" in patch) sanitized.compact = Boolean(patch.compact);
  if ("clickThrough" in patch) sanitized.clickThrough = Boolean(patch.clickThrough);
  if ("startMinimized" in patch) {
    sanitized.startMinimized = Boolean(patch.startMinimized);
  }
  if ("autoCheckUpdates" in patch) {
    sanitized.autoCheckUpdates = Boolean(patch.autoCheckUpdates);
  }
  if ("opacity" in patch) {
    sanitized.opacity = Math.max(0.65, Math.min(1, Number(patch.opacity) || 1));
  }
  if (patch.shortcuts && typeof patch.shortcuts === "object") {
    const candidate = patch.shortcuts;
    sanitized.shortcuts = Object.fromEntries(
      Object.keys(DEFAULT_DESKTOP_SHORTCUTS).map((key) => [
        key,
        key in candidate
          ? limitedString(candidate[key], 80).trim()
          : settings.shortcuts[key],
      ]),
    );
  }
  if (patch.priceCheck && typeof patch.priceCheck === "object") {
    const current = settings.priceCheck;
    const candidate = patch.priceCheck;
    const hotkey = "hotkey" in candidate
      ? limitedString(candidate.hotkey, 80).trim()
      : current.hotkey;
    sanitized.priceCheck = {
      ...current,
      enabled:
        "enabled" in candidate ? Boolean(candidate.enabled) : current.enabled,
      hotkey,
      captureMode: "auto-copy",
      openNearCursor:
        "openNearCursor" in candidate
          ? Boolean(candidate.openNearCursor)
          : current.openNearCursor,
      closeOnBlur:
        "closeOnBlur" in candidate
          ? Boolean(candidate.closeOnBlur)
          : current.closeOnBlur,
      pinByDefault:
        "pinByDefault" in candidate
          ? Boolean(candidate.pinByDefault)
          : current.pinByDefault,
      rollTolerance: Math.max(
        0,
        Math.min(50, Math.round(finiteNumber(candidate.rollTolerance, current.rollTolerance))),
      ),
      defaultOnlineOnly:
        "defaultOnlineOnly" in candidate
          ? Boolean(candidate.defaultOnlineOnly)
          : current.defaultOnlineOnly,
      rememberHistory:
        "rememberHistory" in candidate
          ? Boolean(candidate.rememberHistory)
          : current.rememberHistory,
      maxHistory: Math.max(
        0,
        Math.min(200, Math.round(finiteNumber(candidate.maxHistory, current.maxHistory))),
      ),
      showAdvanced:
        "showAdvanced" in candidate
          ? Boolean(candidate.showAdvanced)
          : current.showAdvanced,
      legacyBehavior:
        "legacyBehavior" in candidate
          ? Boolean(candidate.legacyBehavior)
          : current.legacyBehavior,
    };
  }
  return sanitized;
}

ipcMain.handle("economy:get-leagues", (event, options = {}) => {
  assertTrustedSender(event);
  return (
  getCachedJson(
    `${MARKET_CACHE_VERSION}-poe1-leagues`,
    "/poe1/api/economy/leagues",
    Boolean(options.force),
    "leagues",
  )
  );
});

ipcMain.handle("economy:get-overview", (event, rawRequest) => {
  assertTrustedSender(event);
  const request = validateOverviewRequest(rawRequest);
  const key = `${MARKET_CACHE_VERSION}-${request.league}-${request.source}-${request.type}`;
  return getCachedJson(
    key,
    overviewPath(request),
    Boolean(request.force),
  );
});

ipcMain.handle("economy:get-item-tooltip", (event, rawRequest) => {
  assertTrustedSender(event);
  return getItemTooltip(validateTooltipRequest(rawRequest));
});

ipcMain.handle("knowledge:search", (event, rawRequest) => {
  assertTrustedSender(event);
  return getKnowledgeSearch(validateKnowledgeRequest(rawRequest));
});

ipcMain.handle("renderer:ready", (event) => {
  assertTrustedSender(event);
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Only the dashboard can report renderer readiness.");
  }
  mainCommandQueue.markReady(mainWindow);
});

ipcMain.handle("app:open-external", (event, url) => {
  assertTrustedSender(event);
  return openExternalUrl(url);
});

ipcMain.handle("toolkit:open-text", (event, kind) => {
  assertDashboardSender(event);
  return getToolkitFileService().openText(mainWindow, kind);
});

ipcMain.handle("toolkit:open-image", (event) => {
  assertDashboardSender(event);
  return getToolkitFileService().openImage(BrowserWindow.fromWebContents(event.sender) || mainWindow);
});

ipcMain.handle("toolkit:save-text", (event, request) => {
  assertDashboardSender(event);
  return getToolkitFileService().saveText(mainWindow, request);
});

ipcMain.handle("toolkit:create-checkpoint", (event, request) => {
  assertDashboardSender(event);
  return getToolkitFileService().createCheckpoint(request);
});

ipcMain.handle("toolkit:list-checkpoints", (event, filePath) => {
  assertDashboardSender(event);
  return getToolkitFileService().listCheckpoints(filePath);
});

ipcMain.handle("toolkit:restore-checkpoint", (event, request) => {
  assertDashboardSender(event);
  return getToolkitFileService().restoreCheckpoint(request);
});

ipcMain.handle("toolkit:fetch-text", (event, url) => {
  assertDashboardSender(event);
  return getToolkitFileService().fetchRemoteText(url);
});

ipcMain.handle("toolkit:get-regex-data", (event) => {
  assertDashboardSender(event);
  if (bundledRegexDataText == null) {
    const dataPath = path.join(
      __dirname,
      "..",
      "dist",
      "data",
      "toolkit",
      "regex-v1.json",
    );
    const bytes = fs.readFileSync(dataPath);
    if (bytes.length === 0 || bytes.length > MAX_REGEX_DATA_BYTES) {
      throw new Error("The bundled regex database has an invalid size.");
    }
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== REGEX_DATA_SHA256) {
      throw new Error("The bundled regex database failed its integrity check.");
    }
    bundledRegexDataText = bytes.toString("utf8");
  }
  return bundledRegexDataText;
});

ipcMain.handle("toolkit:get-workspace", (event) => {
  assertTrustedSender(event);
  const store = getToolkitRuntimeStore();
  const error = store.error();
  if (error) throw new Error(`${error}. Use Recover workspace to archive it and start clean.`);
  return store.get();
});

ipcMain.handle("toolkit:recover-workspace", (event) => {
  assertDashboardSender(event);
  return getToolkitRuntimeStore().recover();
});

ipcMain.handle("toolkit:save-workspace", (event, value) => {
  assertTrustedSender(event);
  const store = getToolkitRuntimeStore();
  const toolkitOverlay = [...toolkitOverlayWindows.values()].some((entry) => entry.webContents === event.sender);
  const workspace = toolkitOverlay
    ? store.save({ ...store.get(), whiteboard: value?.whiteboard })
    : store.save(value);
  if (toolkitOverlay) return { workspace, failures: [] };
  const failures = syncToolkitMacroShortcuts(workspace);
  syncToolkitStashScroll(workspace);
  return { workspace, failures };
});

ipcMain.handle("toolkit:show-overlay", (event, kind) => {
  assertDashboardSender(event);
  showToolkitOverlay(kind);
});

ipcMain.handle("toolkit:hide-overlay", (event) => {
  assertTrustedSender(event);
  hideToolkitOverlay(event.sender);
});

ipcMain.handle("toolkit:capture-game", (event) => {
  assertTrustedSender(event);
  return captureToolkitGameWindow();
});

ipcMain.handle("planner:get-passive-tree", (event, options) => {
  assertDashboardSender(event);
  return pobPlannerDispatcher.load({
    game: options?.game === "poe2" ? "poe2" : "poe1",
    treeVersion: String(options?.treeVersion || options?.version || "").slice(0, 40),
    ruthless: Boolean(options?.ruthless),
    alternate: Boolean(options?.alternate),
  });
});

ipcMain.handle("planner:decode-pob", (event, input) => {
  assertDashboardSender(event);
  return decodePobBuild(input);
});

ipcMain.handle("planner:encode-pob", (event, input) => {
  assertDashboardSender(event);
  return encodePobBuild(input);
});

ipcMain.handle("planner:diagnose-engine", (event) => {
  assertDashboardSender(event);
  return pobEngineDispatcher.diagnose();
});

ipcMain.handle("planner:calculate-build", (event, request) => {
  assertDashboardSender(event);
  return pobEngineDispatcher.calculate({
    xml: request?.xml,
    name: request?.name,
  });
});

ipcMain.handle("planner:import-character-pob", (event, request) => {
  assertDashboardSender(event);
  return pobEngineDispatcher.importCharacter({
    character: request?.character,
  });
});

ipcMain.handle("planner:read-clipboard", (event) => {
  assertDashboardSender(event);
  return clipboard.readText().replace(/\0/g, "").slice(0, 24 * 1024 * 1024);
});

ipcMain.handle("planner:list-characters", (event, request) => {
  assertDashboardSender(event);
  return poeCharacterService.listCharacters(request);
});

ipcMain.handle("planner:get-character", (event, request) => {
  assertDashboardSender(event);
  return poeCharacterService.getCharacter(request);
});

ipcMain.handle("price-check:read-clipboard", (event) => {
  assertTrustedSender(event);
  if (
    !canReadPriceCheckCapture(event.sender, {
      mainWindow,
      priceCheckWindow,
    })
  ) {
    throw new Error("Only the dashboard and price-check overlay can read the clipboard.");
  }
  const capture = readClipboardItem();
  if (event.sender !== priceCheckWindow?.webContents) return capture;
  const identifiedCapture = assignCaptureIdentity(
    capture,
    ++priceCheckCaptureGeneration,
  );
  lastPriceCheckCapture = identifiedCapture;
  pendingPriceCheckDashboardCapture = null;
  pendingPriceCheckDashboardCaptureExpiresAt = 0;
  return identifiedCapture;
});

ipcMain.handle("price-check:get-pending-capture", (event) => {
  assertTrustedSender(event);
  if (
    !canReadPriceCheckCapture(event.sender, {
      mainWindow,
      priceCheckWindow,
    })
  ) return null;
  if (
    event.sender === mainWindow?.webContents &&
    pendingPriceCheckDashboardCapture &&
    pendingPriceCheckDashboardCaptureExpiresAt >= Date.now()
  ) {
    return pendingPriceCheckDashboardCapture;
  }
  if (
    event.sender === mainWindow?.webContents &&
    pendingPriceCheckDashboardCaptureExpiresAt < Date.now()
  ) {
    pendingPriceCheckDashboardCapture = null;
    pendingPriceCheckDashboardCaptureExpiresAt = 0;
  }
  return lastPriceCheckCapture;
});

ipcMain.handle("price-check:get-overlay-state", (event) => {
  assertTrustedSender(event);
  if (event.sender !== priceCheckWindow?.webContents) {
    throw new Error("Only the price-check overlay can read overlay state.");
  }
  return currentPriceCheckOverlayState();
});

ipcMain.handle("price-check:get-trade-stat-catalog", (event) => {
  assertTrustedSender(event);
  if (
    !canReadPriceCheckCapture(event.sender, {
      mainWindow,
      priceCheckWindow,
    })
  ) {
    throw new Error("Only the dashboard and price-check overlay can read the bundled Trade catalog.");
  }
  if (bundledTradeStatCatalogText == null) {
    const catalogPath = path.join(
      __dirname,
      "..",
      "dist",
      "data",
      "price-check",
      "stats-v1.json",
    );
    const bytes = fs.readFileSync(catalogPath);
    if (bytes.length === 0 || bytes.length > MAX_TRADE_STAT_CATALOG_BYTES) {
      throw new Error("The bundled Trade catalog has an invalid size.");
    }
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== TRADE_STAT_CATALOG_SHA256) {
      throw new Error("The bundled Trade catalog failed its integrity check.");
    }
    bundledTradeStatCatalogText = bytes.toString("utf8");
  }
  return bundledTradeStatCatalogText;
});

ipcMain.handle("price-check:get-official-listings", (event, rawRequest) => {
  assertTrustedSender(event);
  if (
    !canReadPriceCheckCapture(event.sender, {
      mainWindow,
      priceCheckWindow,
    })
  ) {
    throw new Error("Only the dashboard and price-check overlay can request trade listings.");
  }
  return officialTradeListingService.lookup(rawRequest);
});

ipcMain.handle("settings:get", (event) => {
  assertSettingsSender(event);
  return settingsForRenderer();
});

ipcMain.handle("settings:save", (event, patch) => {
  assertSettingsSender(event);
  const sanitized = sanitizeSettingsPatch(patch);
  const previousSettings = settings;
  const resetPriceCheckPanelPosition = Boolean(
    patch?.priceCheck &&
    typeof patch.priceCheck === "object" &&
    Object.prototype.hasOwnProperty.call(patch.priceCheck, "openNearCursor") &&
    patch.priceCheck.openNearCursor,
  );
  const nextSettings = {
    ...settings,
    ...sanitized,
    shortcuts: sanitized.shortcuts
      ? { ...settings.shortcuts, ...sanitized.shortcuts }
      : settings.shortcuts,
    priceCheck: sanitized.priceCheck || settings.priceCheck,
    priceCheckPanelPosition: resetPriceCheckPanelPosition
      ? null
      : settings.priceCheckPanelPosition,
  };
  const shortcutChanged =
    JSON.stringify(nextSettings.shortcuts) !== JSON.stringify(settings.shortcuts) ||
    nextSettings.priceCheck.enabled !== settings.priceCheck.enabled ||
    nextSettings.priceCheck.hotkey !== settings.priceCheck.hotkey;
  if (shortcutChanged) {
    const registration = applyShortcutRegistrationPlan(nextSettings, settings);
    if (!registration.ok) throw new Error(registration.error);
    priceCheckShortcutWarning = "";
  }
  settings = nextSettings;
  try {
    persistSettings();
  } catch (error) {
    settings = previousSettings;
    if (shortcutChanged) {
      applyShortcutRegistrationPlan(previousSettings, nextSettings);
    }
    throw error;
  }
  if ("autoCheckUpdates" in sanitized) {
    updateService?.setAutoCheck(settings.autoCheckUpdates);
  }
  if ("priceCheck" in sanitized || "shortcuts" in sanitized) updateTrayMenu();
  broadcastSettings();
  return settingsForRenderer();
});

ipcMain.handle("surface:publish-state", (event, value) => {
  assertTrustedSender(event);
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Only the dashboard can publish market state.");
  }
  surfaceState = sanitizeSurfaceState(value);
  broadcastSurfaceState();
});

ipcMain.handle("surface:get-state", (event) => {
  assertTrustedSender(event);
  return surfaceState;
});

ipcMain.handle("surface:action", async (event, rawAction) => {
  assertTrustedSender(event);
  const action = validateSurfaceAction(rawAction);
  switch (action.type) {
    case "hide-surface":
      if (event.sender === trayWindow?.webContents) trayWindow.hide();
      if (event.sender === quickWindow?.webContents) quickWindow.hide();
      break;
    case "hide-price-check":
      if (event.sender === priceCheckWindow?.webContents) deactivatePriceCheck();
      break;
    case "open-price-check":
      showPriceCheck();
      break;
    case "set-price-check-pinned":
      if (event.sender !== priceCheckWindow?.webContents) {
        throw new Error("Only the price checker can change overlay pinning.");
      }
      priceCheckPinned = action.value;
      sendPriceCheckOverlayState();
      break;
    case "set-price-check-panel-height":
      if (event.sender !== priceCheckWindow?.webContents) {
        throw new Error("Only the price checker can resize its overlay card.");
      }
      if (
        action.captureId !== lastPriceCheckCapture?.captureId ||
        priceCheckRequestedHeight === action.height
      ) {
        break;
      }
      priceCheckRequestedHeight = action.height;
      if (priceCheckOverlayVisible && priceCheckPanelBounds) {
        const nextPanel = resizeOrRepositionPriceCheckPanel(priceCheckPanelBounds);
        if (!updatePriceCheckPanelLayout(nextPanel)) {
          deactivatePriceCheck({ focusTarget: false });
          throw new Error("Native overlay shaping failed during resize.");
        }
      }
      break;
    case "set-price-check-panel-position":
      if (event.sender !== priceCheckWindow?.webContents) {
        throw new Error("Only the price checker can move its overlay card.");
      }
      if (
        action.captureId !== lastPriceCheckCapture?.captureId ||
        !priceCheckOverlayVisible ||
        !priceCheckPanelBounds
      ) {
        break;
      }
      {
        const nextPanel = clampPriceCheckPanelLayout({
          ...priceCheckPanelBounds,
          x: action.x,
          y: action.y,
        });
        const moved = Boolean(
          nextPanel &&
          (nextPanel.x !== priceCheckPanelBounds.x ||
            nextPanel.y !== priceCheckPanelBounds.y ||
            nextPanel.width !== priceCheckPanelBounds.width ||
            nextPanel.height !== priceCheckPanelBounds.height),
        );
        if (moved && !updatePriceCheckPanelLayout(nextPanel)) {
          deactivatePriceCheck({ focusTarget: false });
          throw new Error("Native overlay shaping failed during move.");
        }
        if (action.commit) {
          const position = normalizedPriceCheckPanelPosition(
            moved ? nextPanel : priceCheckPanelBounds,
          );
          if (!position) throw new Error("The overlay card position is unavailable.");
          const previousSettings = settings;
          settings = {
            ...settings,
            priceCheckPanelPosition: position,
            priceCheck: {
              ...settings.priceCheck,
              openNearCursor: false,
            },
          };
          try {
            persistSettings();
          } catch (error) {
            settings = previousSettings;
            throw error;
          }
          updateTrayMenu();
          broadcastSettings();
        }
      }
      break;
    case "open-dashboard":
      showMainWindow();
      break;
    case "open-price-check-dashboard":
      if (action.snapshot && event.sender !== priceCheckWindow?.webContents) {
        throw new Error("Only the price checker can hand query edits to the dashboard.");
      }
      {
        const dashboardCapture = createDashboardCapture(
          lastPriceCheckCapture,
          action.snapshot,
          ++priceCheckDashboardHandoffGeneration,
        );
        pendingPriceCheckDashboardCapture = dashboardCapture?.dashboardSnapshot
          ? dashboardCapture
          : null;
        pendingPriceCheckDashboardCaptureExpiresAt =
          pendingPriceCheckDashboardCapture
            ? Date.now() + PRICE_CHECK_PENDING_TTL_MS
            : 0;
        showMainWindow({ type: "open-price-check-dashboard" });
        sendPriceCheckCaptureToWindow(mainWindow, dashboardCapture);
      }
      break;
    case "consume-price-check-dashboard-handoff":
      if (event.sender !== mainWindow?.webContents) {
        throw new Error("Only the dashboard can acknowledge a query handoff.");
      }
      if (
        pendingPriceCheckDashboardCapture?.captureId === action.captureId &&
        pendingPriceCheckDashboardCapture.dashboardSnapshot?.handoffId ===
          action.handoffId
      ) {
        pendingPriceCheckDashboardCapture = null;
        pendingPriceCheckDashboardCaptureExpiresAt = 0;
      }
      break;
    case "open-quick-search":
      showQuickSearch();
      break;
    case "open-watchlist":
      showMainWindow({ type: "open-watchlist" });
      break;
    case "refresh-market":
      sendMainCommand({ type: "refresh-market" });
      break;
    case "open-row":
      if (event.sender === priceCheckWindow?.webContents) {
        deactivatePriceCheck({ focusTarget: false });
      }
      showMainWindow(action);
      break;
    case "check-update":
      await updateService?.check();
      break;
    case "install-update":
      updateService?.install();
      break;
    case "quit":
      app.isQuitting = true;
      app.quit();
      break;
  }
});

ipcMain.handle("update:get-state", (event) => {
  assertTrustedSender(event);
  return updateService?.getState() || surfaceState.update;
});

ipcMain.handle("update:check", async (event) => {
  assertTrustedSender(event);
  return (await updateService?.check()) || surfaceState.update;
});

ipcMain.handle("update:install", (event) => {
  assertTrustedSender(event);
  updateService?.install();
});

ipcMain.handle("window:action", (event, action, payload) => {
  assertTrustedSender(event);
  if (!mainWindow) return null;
  switch (action) {
    case "minimize":
      mainWindow.minimize();
      break;
    case "hide":
      mainWindow.hide();
      updateTrayMenu();
      break;
    case "close":
      mainWindow.hide();
      updateTrayMenu();
      break;
    case "toggle-maximize":
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
      break;
    case "always-on-top":
      settings.alwaysOnTop = Boolean(payload);
      mainWindow.setAlwaysOnTop(settings.alwaysOnTop, "floating");
      persistSettings();
      updateTrayMenu();
      break;
    case "opacity":
      settings.opacity = Math.max(0.65, Math.min(1, Number(payload)));
      mainWindow.setOpacity(settings.opacity);
      persistSettings();
      break;
    case "compact":
      setCompact(payload);
      break;
    case "click-through":
      setClickThrough(payload);
      break;
    default:
      throw new Error(`Unknown window action: ${action}`);
  }
  return settingsForRenderer();
});
