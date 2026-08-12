import type {
  CacheEnvelope,
  DesktopSettings,
  ItemTooltipRequest,
  KnowledgeSearchRequest,
  OverviewRequest,
  PoeWidgetBridge,
  RawExchangeOverview,
  RawItemOverview,
  RawKnowledgeSearchResponse,
  RawStashCurrencyOverview,
  RawWikiCargoResponse,
  RawWikiImageInfoResponse,
  SurfaceState,
  ToolkitWorkspace,
  UpdateState,
} from "../types";
import packageMetadata from "../../package.json";
import { isOverviewPayload, mobileBridge } from "./mobile-bridge";
import { fetchBoundedToolkitText } from "./bounded-text-fetch";
import {
  knowledgeImageQuery,
  knowledgeImageTitles,
  knowledgeSearchQueries,
} from "./knowledge";
import { trustedExternalUrl } from "./mobile-network";
import {
  isPoeNinjaMirrorManifest,
  mirrorEnvelopeTimes,
  mirrorRouteForRequest,
  mirrorRouteUrl,
  POE_NINJA_MIRROR_MANIFEST_URL,
  verifyMirrorPayloadBytes,
} from "./poe-ninja-mirror";
import type { PoeNinjaMirrorManifest } from "./poe-ninja-mirror";
import { isNativeMobile } from "./platform";
import { defaultPriceCheckSettings } from "./price-check/types";
import {
  cloneDesktopSettings,
  mergeDesktopSettingsPatch,
  sanitizeDesktopSettingsPatch,
} from "./settings-sync";
import { defaultDesktopShortcuts, validateShortcutDraft } from "./shortcuts";
import {
  readMigratedStorage,
  retiredProductStorageKey,
} from "./storage-migration";
import {
  browserSupportBundle,
  browserWorkspaceBackup,
  downloadJson,
  pickWorkspaceJson,
} from "./workspace-transfer";

const browserSettings: DesktopSettings = {
  alwaysOnTop: true,
  opacity: 1,
  compact: false,
  clickThrough: false,
  startMinimized: false,
  autoCheckUpdates: true,
  updateChannel: "stable",
  shortcuts: defaultDesktopShortcuts,
  priceCheck: defaultPriceCheckSettings,
};
let browserSettingsRevision = 0;

const browserUpdateState: UpdateState = {
  status: "unconfigured",
  currentVersion: "browser",
  message: "Desktop updates are unavailable in browser preview",
  feedConfigured: false,
};

let browserSurfaceState: SurfaceState = {
  league: "",
  categoryLabel: "Currency",
  stale: false,
  loading: true,
  alertCount: 0,
  alerts: [],
  topMovers: [],
  searchRows: [],
  commands: [],
  update: browserUpdateState,
};

const browserCache = new Map<
  string,
  CacheEnvelope<RawExchangeOverview | RawItemOverview | RawStashCurrencyOverview>
>();
const browserOverviewInflight = new Map<
  string,
  Promise<CacheEnvelope<RawExchangeOverview | RawItemOverview | RawStashCurrencyOverview>>
>();
const browserTooltipCache = new Map<
  string,
  CacheEnvelope<RawWikiCargoResponse>
>();
const browserKnowledgeCache = new Map<
  string,
  CacheEnvelope<RawKnowledgeSearchResponse>
>();

const MARKET_CACHE_VERSION = "v3-mirror";
const MAX_BROWSER_MIRROR_BYTES = 16 * 1024 * 1024;
const MAX_BROWSER_MANIFEST_BYTES = 2 * 1024 * 1024;
const BROWSER_MIRROR_DEADLINE_MS = 35_000;
let browserMirrorManifestCache: CacheEnvelope<PoeNinjaMirrorManifest> | null = null;
const browserMirrorManifestInflight = new Map<
  string,
  Promise<CacheEnvelope<PoeNinjaMirrorManifest>>
>();

function browserPreviewPriceCheckCapture() {
  if (!import.meta.env.DEV) return null;
  const encoded = new URLSearchParams(window.location.search).get("qa-item");
  if (!encoded || encoded.length > 90_000) return null;
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const text = new TextDecoder().decode(bytes).replace(/\0/g, "").slice(0, 65_536);
    if (!/^Item Class:\s*.+/m.test(text)) return null;
    return {
      text,
      capturedAt: Date.now(),
      captureId: 1,
      validPrefix: true,
    };
  } catch {
    return null;
  }
}

const WIKI_TOOLTIP_FIELDS = [
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

function browserTooltipPath(request: ItemTooltipRequest) {
  const escapedName = request.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const search = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    limit: "10",
    tables: "items",
    fields: WIKI_TOOLTIP_FIELDS,
    where: `name="${escapedName}"`,
  });
  return `/wiki-api/w/api.php?${search}`;
}

async function browserCargoQuery(parameters: URLSearchParams) {
  const response = await fetch(`/wiki-api/w/api.php?${parameters}`);
  if (!response.ok) {
    throw new Error(`PoE knowledge request failed: ${response.status}`);
  }
  return (await response.json()) as RawWikiCargoResponse;
}

async function browserKnowledgeImages(items: RawWikiCargoResponse) {
  const titles = knowledgeImageTitles(items);
  if (titles.length === 0) return undefined;
  try {
    const response = await fetch(
      `/wiki-api/w/api.php?${knowledgeImageQuery(titles)}`,
    );
    if (!response.ok) return undefined;
    const payload = (await response.json()) as RawWikiImageInfoResponse;
    return await hydrateBrowserKnowledgeImages(payload);
  } catch {
    // Search results remain useful with class-specific artwork fallbacks.
    return undefined;
  }
}

function browserWikiImageProxy(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "www.poewiki.net" &&
      url.pathname.startsWith("/images/")
      ? `/wiki-api${url.pathname}${url.search}`
      : undefined;
  } catch {
    return undefined;
  }
}

function browserImageDataUrl(buffer: ArrayBuffer, mime: string) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(offset, offset + 16_384)),
    );
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function hydrateBrowserKnowledgeImages(
  payload: RawWikiImageInfoResponse,
) {
  const pages = await Promise.all(
    (payload.query?.pages || []).map(async (page) => {
      const info = page.imageinfo?.[0];
      const proxied = browserWikiImageProxy(info?.thumburl || info?.url);
      if (!info || !proxied) return page;
      try {
        const response = await fetch(proxied, {
          headers: { Accept: "image/avif,image/webp,image/png,image/*" },
        });
        const mime = (response.headers.get("content-type") || info.mime || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (!response.ok || !/^image\/(?:avif|gif|jpeg|png|webp)$/.test(mime)) {
          return page;
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0 || buffer.byteLength > 2_000_000) return page;
        return {
          ...page,
          imageinfo: [{ ...info, dataUrl: browserImageDataUrl(buffer, mime) }],
        };
      } catch {
        return page;
      }
    }),
  );
  return { ...payload, query: { ...payload.query, pages } };
}

async function searchBrowserKnowledge(request: KnowledgeSearchRequest) {
  const queries = knowledgeSearchQueries(request);
  const key = `${queries.query.toLowerCase()}:${queries.limit}`;
  const cached = browserKnowledgeCache.get(key);
  if (!request.force && cached && cached.expiresAt > Date.now()) return cached;
  const [items, modifiers] = await Promise.all([
    browserCargoQuery(queries.items),
    browserCargoQuery(queries.modifiers),
  ]);
  const images = await browserKnowledgeImages(items);
  const fetchedAt = Date.now();
  const envelope: CacheEnvelope<RawKnowledgeSearchResponse> = {
    data: { items, modifiers, images },
    fetchedAt,
    expiresAt: fetchedAt + 60 * 60 * 1000,
    stale: false,
    cache: "browser",
  };
  browserKnowledgeCache.set(key, envelope);
  return envelope;
}

async function browserMirrorBytes(
  url: string,
  maximumBytes: number,
  force = false,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("The market mirror request exceeded its deadline.")),
    BROWSER_MIRROR_DEADLINE_MS,
  );
  try {
    const response = await fetch(url, {
      cache: force ? "reload" : "default",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.url !== url) throw new Error("The market mirror redirected unexpectedly.");
    if (!response.ok) throw new Error(`Market mirror request failed: ${response.status}`);
    const rawLength = response.headers.get("content-length");
    if (rawLength != null && (!/^\d+$/.test(rawLength) || Number(rawLength) > maximumBytes)) {
      throw new Error("The market mirror response exceeded the safe size limit.");
    }
    if (!response.body) throw new Error("The market mirror did not provide a bounded stream.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumBytes) {
          const error = new Error("The market mirror response exceeded the safe size limit.");
          controller.abort(error);
          await reader.cancel().catch(() => undefined);
          throw error;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (total === 0) throw new Error("The market mirror returned an empty response.");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeBrowserMirrorJson(bytes: Uint8Array) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("The market mirror returned invalid JSON.");
  }
}

async function getBrowserMirrorManifest(
  force = false,
): Promise<CacheEnvelope<PoeNinjaMirrorManifest>> {
  const now = Date.now();
  const cached = browserMirrorManifestCache;
  if (!force && cached && cached.expiresAt > now) {
    return { ...cached, cache: "fresh" as const };
  }
  const inflightKey = force ? "force" : "normal";
  const existing = force
    ? browserMirrorManifestInflight.get("force")
    : browserMirrorManifestInflight.get("force") ||
      browserMirrorManifestInflight.get("normal");
  if (existing) return existing;
  const pending: Promise<CacheEnvelope<PoeNinjaMirrorManifest>> = (async () => {
    const bytes = await browserMirrorBytes(
      POE_NINJA_MIRROR_MANIFEST_URL,
      MAX_BROWSER_MANIFEST_BYTES,
      force,
    );
    const data = decodeBrowserMirrorJson(bytes);
    if (!isPoeNinjaMirrorManifest(data)) {
      throw new Error("The market mirror manifest is invalid.");
    }
    const checkedAt = Date.now();
    const envelope: CacheEnvelope<PoeNinjaMirrorManifest> = {
      data,
      fetchedAt: data.generatedAt,
      expiresAt: Math.min(
        checkedAt + 10 * 60 * 1000,
        Math.max(checkedAt + 60_000, data.generatedAt + data.cadenceMs),
      ),
      stale: false,
      cache: "browser",
    };
    browserMirrorManifestCache = envelope;
    return envelope;
  })();
  browserMirrorManifestInflight.set(inflightKey, pending);
  try {
    return await pending;
  } finally {
    if (browserMirrorManifestInflight.get(inflightKey) === pending) {
      browserMirrorManifestInflight.delete(inflightKey);
    }
  }
}

const BROWSER_TOOLKIT_WORKSPACE_KEY = "gloamcore:toolkit-workspace:v1";
const LEGACY_BROWSER_TOOLKIT_WORKSPACE_KEYS = [
  retiredProductStorageKey("toolkit-workspace:v1"),
] as const;
const MAX_BROWSER_TOOLKIT_BYTES = 2 * 1024 * 1024;
const MAX_BROWSER_TOOLKIT_IMAGE_CHARS = 512 * 1024;

function unavailableMappingJournalState(activeCharacter = "") {
  return {
    settings: { version: 1 as const, enabled: false, activeCharacter },
    sessions: [],
    activeSessionId: "",
    activeSince: null,
    storageError: "Mapping Journal requires the Windows app and a user-selected PoE 1 Client.txt.",
    limits: { sessions: 25_000, noteLength: 2_000, tags: 12, tagLength: 32 },
    log: { path: "", status: "missing" as const, error: "Client.txt is unavailable on this platform." },
  };
}

function assertBrowserToolkitWorkspaceBudget(value: ToolkitWorkspace) {
  const images = [
    ...value.cheatSheets.map((entry) => entry.image),
    ...value.whiteboard.strokes.filter((entry): entry is { tool: "image"; src: string } => Boolean(entry && typeof entry === "object" && (entry as { tool?: unknown }).tool === "image" && typeof (entry as { src?: unknown }).src === "string")).map((entry) => entry.src),
    ...value.whiteboard.snapshots.flatMap((snapshot) => snapshot.strokes.filter((entry): entry is { tool: "image"; src: string } => Boolean(entry && typeof entry === "object" && (entry as { tool?: unknown }).tool === "image" && typeof (entry as { src?: unknown }).src === "string")).map((entry) => entry.src)),
  ].filter(Boolean);
  if (images.some((image) => image.length > MAX_BROWSER_TOOLKIT_IMAGE_CHARS)) {
    throw new Error("A workspace image is too large. Re-import an image below 375 KB.");
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BROWSER_TOOLKIT_BYTES) {
    throw new Error("The toolkit workspace exceeds the 2 MB safety limit. Remove some images before saving.");
  }
  return serialized;
}

const browserBridge: PoeWidgetBridge = {
  async getLeagues(options) {
    const manifest = await getBrowserMirrorManifest(Boolean(options?.force));
    const times = mirrorEnvelopeTimes(manifest.data.leagueSnapshot);
    return {
      data: manifest.data.leagueSnapshot.data,
      ...times,
      stale: false,
      cache: "browser",
    };
  },
  async getOverview(request) {
    const key = `${MARKET_CACHE_VERSION}:${request.league}:${request.source}:${request.type}`;
    const cached = browserCache.get(key);
    if (!request.force && cached && cached.expiresAt > Date.now()) return cached;
    const normalKey = `${key}:normal`;
    const forceKey = `${key}:force`;
    const inflightKey = request.force ? forceKey : normalKey;
    const existing = request.force
      ? browserOverviewInflight.get(forceKey)
      : browserOverviewInflight.get(forceKey) ||
        browserOverviewInflight.get(normalKey);
    if (existing) return existing;
    const fetchOverview = async () => {
      const manifest = await getBrowserMirrorManifest(Boolean(request.force));
      const route = mirrorRouteForRequest(manifest.data, request);
      const times = mirrorEnvelopeTimes(route);
      const bytes = await browserMirrorBytes(
        mirrorRouteUrl(route),
        MAX_BROWSER_MIRROR_BYTES,
        Boolean(request.force),
      );
      await verifyMirrorPayloadBytes(bytes, route);
      const data = decodeBrowserMirrorJson(bytes);
      if (!isOverviewPayload(data)) throw new Error("The market mirror payload is invalid.");
      const envelope = {
        data,
        ...times,
        stale: false,
        cache: "browser" as const,
      };
      browserCache.set(key, envelope);
      return envelope;
    };
    const weaker = request.force
      ? browserOverviewInflight.get(normalKey)
      : undefined;
    const pending = weaker
      ? weaker.catch(() => undefined).then(fetchOverview)
      : fetchOverview();
    browserOverviewInflight.set(inflightKey, pending);
    try {
      return await pending;
    } finally {
      if (browserOverviewInflight.get(inflightKey) === pending) {
        browserOverviewInflight.delete(inflightKey);
      }
    }
  },
  async getItemTooltip(request) {
    const key = `${request.name}:${request.baseType || ""}`.toLowerCase();
    const cached = browserTooltipCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached;
    const response = await fetch(browserTooltipPath(request));
    if (!response.ok) {
      throw new Error(`Item information request failed: ${response.status}`);
    }
    const envelope = {
      data: (await response.json()) as RawWikiCargoResponse,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      stale: false,
      cache: "browser" as const,
    };
    browserTooltipCache.set(key, envelope);
    return envelope;
  },
  async getFaustusOverview() {
    throw new Error("Official Faustus history is available in the installed desktop and mobile apps.");
  },
  searchKnowledge: searchBrowserKnowledge,
  async readClipboardItem() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Mobile and hardened browsers can require a manual paste gesture.
    }
    text = text.replace(/\0/g, "").slice(0, 65_536);
    return {
      text,
      capturedAt: Date.now(),
      validPrefix: /^Item Class:\s*.+/m.test(text),
    };
  },
  async getPendingPriceCheckCapture() {
    return browserPreviewPriceCheckCapture();
  },
  async getPriceCheckOverlayState() {
    if (browserPreviewPriceCheckCapture()) {
      return {
        revision: 1,
        active: true,
        attached: true,
        targetActive: true,
        interactive: true,
        shapeApplied: true,
        panel: { x: 0, y: 0, width: 360, height: 360 },
      };
    }
    return {
      revision: 0,
      active: false,
      attached: false,
      targetActive: false,
      interactive: false,
      shapeApplied: false,
      panel: null,
    };
  },
  async openExternal(url) {
    const parsed = trustedExternalUrl(url);
    if (!parsed) throw new Error("Blocked an untrusted external link.");
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  },
  async openWealthyExile() {
    await browserBridge.openExternal("https://wealthyexile.com/stash");
    return true;
  },
  async hideWealthyExile() {
    return false;
  },
  async controlWealthyExile() {
    return false;
  },
  async openCraftOfExile() {
    await browserBridge.openExternal("https://beta.craftofexile.com/?game=poe1");
    return true;
  },
  async hideCraftOfExile() {
    return false;
  },
  async controlCraftOfExile() {
    return false;
  },
  async openToolkitText() {
    return null;
  },
  async openToolkitImage() {
    return null;
  },
  async saveToolkitText(request) {
    const name = request.suggestedName || "document.txt";
    const blob = new Blob([request.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
    return { path: "", name };
  },
  async createToolkitCheckpoint(request) {
    return { id: `browser-${Date.now()}`, label: request.label || "Checkpoint", createdAt: Date.now() };
  },
  async listToolkitCheckpoints() {
    return [];
  },
  async readToolkitCheckpoint() {
    throw new Error("Checkpoints require the desktop app.");
  },
  async restoreToolkitCheckpoint() {
    throw new Error("Checkpoints require the desktop app.");
  },
  async exportWorkspaceBackup(renderer) {
    const name = `GloamCore-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(name, browserWorkspaceBackup(packageMetadata.version, renderer));
    return { path: "", name };
  },
  async importWorkspaceBackup() {
    const renderer = await pickWorkspaceJson();
    return renderer ? { renderer, recoveryName: null } : null;
  },
  async exportSupportBundle(context) {
    const name = `GloamCore-support-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(name, browserSupportBundle(packageMetadata.version, context));
    return { path: "", name };
  },
  async fetchToolkitText(url) {
    return fetchBoundedToolkitText(url);
  },
  async getPassiveTreeData() {
    throw new Error("The authoritative passive tree requires the desktop app and Path of Building Community.");
  },
  async decodePobBuild(input) {
    if (/^<\?xml\b|^<PathOfBuilding\b/i.test(input.trim())) return input.trim();
    throw new Error("Compressed Path of Building imports require the desktop app.");
  },
  async encodePobBuild() {
    throw new Error("Compressed Path of Building exports require the desktop app.");
  },
  async diagnosePobEngine() {
    return {
      ok: false as const,
      authoritative: false as const,
      available: false as const,
      capability: "unavailable" as const,
      code: "POB_ENGINE_UNAVAILABLE",
      message: "Authoritative Path of Building calculations require the Windows desktop app.",
      recoverable: false,
    };
  },
  async calculatePobBuild() {
    return {
      ok: false as const,
      authoritative: false as const,
      code: "POB_ENGINE_UNAVAILABLE",
      message: "Authoritative Path of Building calculations require the Windows desktop app.",
      recoverable: false,
    };
  },
  async analyzePobNodes() {
    return {
      ok: false as const,
      authoritative: false as const,
      code: "POB_ENGINE_UNAVAILABLE",
      message: "Authoritative passive-power analysis requires the Windows desktop app.",
      recoverable: false,
    };
  },
  async previewPobTimeless() {
    return {
      ok: false as const,
      authoritative: false as const,
      code: "POB_ENGINE_UNAVAILABLE",
      message: "Authoritative Timeless Jewel decoding requires the Windows desktop app.",
      recoverable: false,
    };
  },
  async huntPobTimeless() {
    return {
      ok: false as const,
      authoritative: false as const,
      code: "POB_ENGINE_UNAVAILABLE",
      message: "Authoritative Timeless Jewel seed ranking requires the Windows desktop app.",
      recoverable: false,
    };
  },
  async readPlannerClipboard() {
    return navigator.clipboard.readText();
  },
  async resolvePlannerItemArtwork() {
    return {};
  },
  async getToolkitWorkspace() {
    const clean = (): ToolkitWorkspace => ({
      version: 1,
      macros: [],
      cheatSheets: [],
      theme: { accent: "#35d9b5", background: "#080f14", density: "compact" },
      whiteboard: { strokes: [], snapshots: [] },
      overlayBounds: {},
      stashScroll: { enabled: false, modifier: "Ctrl" },
      plugins: [],
    });
    const raw = readMigratedStorage(
      localStorage,
      BROWSER_TOOLKIT_WORKSPACE_KEY,
      LEGACY_BROWSER_TOOLKIT_WORKSPACE_KEYS,
    );
    if (!raw) return clean();
    try {
      if (new TextEncoder().encode(raw).byteLength > MAX_BROWSER_TOOLKIT_BYTES) {
        throw new Error("the workspace exceeds the 2 MB safety limit");
      }
      const stored = JSON.parse(raw);
      if (stored?.version === 1) {
        const fallback = clean();
        const workspace: ToolkitWorkspace = {
          ...fallback,
          ...stored,
          macros: Array.isArray(stored.macros) ? stored.macros : [],
          cheatSheets: Array.isArray(stored.cheatSheets) ? stored.cheatSheets.map((sheet: ToolkitWorkspace["cheatSheets"][number]) => ({ ...sheet, image: sheet.image || "" })) : [],
          theme: { ...fallback.theme, ...(stored.theme || {}) },
          whiteboard: {
            strokes: Array.isArray(stored.whiteboard?.strokes) ? stored.whiteboard.strokes : [],
            snapshots: Array.isArray(stored.whiteboard?.snapshots) ? stored.whiteboard.snapshots : [],
          },
          overlayBounds: stored.overlayBounds || {},
          stashScroll: stored.stashScroll || fallback.stashScroll,
          plugins: Array.isArray(stored.plugins) ? stored.plugins.map((plugin: Partial<ToolkitWorkspace["plugins"][number]>) => ({
            id: String(plugin.id || crypto.randomUUID()),
            name: String(plugin.name || "Plugin"),
            url: String(plugin.url || ""),
            enabled: Boolean(plugin.enabled),
            permissions: {
              currentItem: Boolean(plugin.permissions?.currentItem),
              gameCapture: Boolean(plugin.permissions?.gameCapture),
              openExternal: Boolean(plugin.permissions?.openExternal),
            },
            storage: plugin.storage && typeof plugin.storage === "object" ? plugin.storage : {},
          })) : [],
        };
        assertBrowserToolkitWorkspaceBudget(workspace);
        return workspace;
      }
      throw new Error("The saved browser toolkit workspace has an unsupported format.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`The saved browser toolkit workspace could not be loaded: ${detail}`);
    }
  },
  async recoverToolkitWorkspace() {
    const raw = localStorage.getItem(BROWSER_TOOLKIT_WORKSPACE_KEY);
    const backupName = raw ? `${BROWSER_TOOLKIT_WORKSPACE_KEY}:recovered:${Date.now()}` : null;
    if (raw && backupName) localStorage.setItem(backupName, raw);
    localStorage.removeItem(BROWSER_TOOLKIT_WORKSPACE_KEY);
    return { workspace: await browserBridge.getToolkitWorkspace(), backupName };
  },
  async saveToolkitWorkspace(value) {
    localStorage.setItem(BROWSER_TOOLKIT_WORKSPACE_KEY, assertBrowserToolkitWorkspaceBudget(value));
    return { workspace: value, failures: [] };
  },
  async showToolkitOverlay() {
    throw new Error("Game overlays require the desktop app.");
  },
  async hideToolkitOverlay() {
    return undefined;
  },
  async captureToolkitGameWindow() {
    return null;
  },
  async getMapModCheck() {
    return { settings: { version: 1 as const, enabled: false, hotkey: "CommandOrControl+Alt+M", rules: {}, customRules: {} }, definitions: [], shortcutError: "Map capture requires the Windows desktop app." };
  },
  async saveMapModCheck(settings) {
    return { settings, shortcutError: "Map capture requires the Windows desktop app." };
  },
  async checkMapMods() {
    throw new Error("Map Mod Check requires the Windows desktop app.");
  },
  async getMapModOverlayResult() {
    return null;
  },
  async hideMapModOverlay() {
    return undefined;
  },
  async getPoeEventLog() {
    return { settings: { version: 1 as const, logPath: "" }, status: "missing" as const, error: "PoE Event Log requires the Windows app.", events: [] };
  },
  async startPoeEventLog() {
    return browserBridge.getPoeEventLog();
  },
  async stopPoeEventLog() {
    return browserBridge.getPoeEventLog();
  },
  async clearPoeEventLog() {
    return browserBridge.getPoeEventLog();
  },
  async selectPoeEventLogPath() {
    return null;
  },
  onPoeEventLog() {
    return () => undefined;
  },
  async getMappingJournal() {
    return unavailableMappingJournalState();
  },
  async updateMappingJournalSettings(settings) {
    return unavailableMappingJournalState(settings.activeCharacter);
  },
  async updateMappingJournalSession() {
    return unavailableMappingJournalState();
  },
  async removeMappingJournalSession() {
    return unavailableMappingJournalState();
  },
  async clearMappingJournal() {
    return unavailableMappingJournalState();
  },
  async exportMappingJournalCsv() {
    return null;
  },
  onMappingJournal() {
    return () => undefined;
  },
  async getSettings() {
    return cloneDesktopSettings(browserSettings, browserSettingsRevision);
  },
  async saveSettings(patch) {
    const next = mergeDesktopSettingsPatch(
      browserSettings,
      sanitizeDesktopSettingsPatch(patch, browserSettings),
    );
    const errors = validateShortcutDraft({
      ...next.shortcuts,
      priceCheck: next.priceCheck.hotkey,
    }, { priceCheckEnabled: next.priceCheck.enabled });
    const firstError = Object.values(errors)[0];
    if (firstError) throw new Error(firstError);
    Object.assign(browserSettings, next);
    browserSettingsRevision += 1;
    return cloneDesktopSettings(browserSettings, browserSettingsRevision);
  },
  async windowAction(action, payload) {
    switch (action) {
      case "always-on-top":
      case "compact":
      case "click-through":
        if (typeof payload !== "boolean") {
          throw new Error(`${action} must be a boolean.`);
        }
        if (action === "always-on-top") browserSettings.alwaysOnTop = payload;
        if (action === "compact") browserSettings.compact = payload;
        if (action === "click-through") browserSettings.clickThrough = payload;
        browserSettingsRevision += 1;
        break;
      case "opacity":
        if (typeof payload !== "number" || !Number.isFinite(payload)) {
          throw new Error("Opacity must be a finite number.");
        }
        browserSettings.opacity = Math.max(0.65, Math.min(1, payload));
        browserSettingsRevision += 1;
        break;
      case "minimize":
      case "hide":
      case "close":
      case "toggle-maximize":
        break;
      default:
        throw new Error(`Unknown window action: ${action}`);
    }
    return cloneDesktopSettings(browserSettings, browserSettingsRevision);
  },
  async publishSurfaceState(state) {
    browserSurfaceState = { ...state, update: browserUpdateState };
  },
  async getSurfaceState() {
    return browserSurfaceState;
  },
  async surfaceAction() {
    return undefined;
  },
  async getUpdateState() {
    return browserUpdateState;
  },
  async checkForUpdates() {
    return browserUpdateState;
  },
  async installUpdate() {
    return undefined;
  },
  async rendererReady() {
    return undefined;
  },
  onSettingsChanged() {
    return () => undefined;
  },
  onShortcut() {
    return () => undefined;
  },
  onPriceCheckCapture() {
    return () => undefined;
  },
  onPriceCheckOverlayState() {
    return () => undefined;
  },
  onSurfaceState() {
    return () => undefined;
  },
  onUpdateState() {
    return () => undefined;
  },
};

export const bridge: PoeWidgetBridge =
  window.poeWidget ?? (isNativeMobile ? mobileBridge : browserBridge);
export const isDesktop = Boolean(window.poeWidget);
