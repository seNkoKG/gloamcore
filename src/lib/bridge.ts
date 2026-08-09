import type {
  CacheEnvelope,
  DesktopSettings,
  EconomyLeague,
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
import { mobileBridge } from "./mobile-bridge";
import {
  knowledgeImageQuery,
  knowledgeImageTitles,
  knowledgeSearchQueries,
} from "./knowledge";
import {
  responseMaxAge,
  responseSourceTime,
  trustedExternalUrl,
} from "./mobile-network";
import { isNativeMobile } from "./platform";
import { defaultPriceCheckSettings } from "./price-check/types";
import {
  cloneDesktopSettings,
  mergeDesktopSettingsPatch,
} from "./settings-sync";
import { defaultDesktopShortcuts, validateShortcutDraft } from "./shortcuts";

const browserSettings: DesktopSettings = {
  alwaysOnTop: true,
  opacity: 1,
  compact: false,
  clickThrough: false,
  startMinimized: false,
  autoCheckUpdates: true,
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

const MARKET_CACHE_VERSION = "v2";

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

function browserOverviewPath(request: OverviewRequest) {
  const league = encodeURIComponent(request.league);
  const type = encodeURIComponent(request.type);
  if (request.source === "exchange") {
    return `/poe-api/poe1/api/economy/exchange/current/overview?league=${league}&type=${type}`;
  }
  if (request.source === "stash-currency") {
    return `/poe-api/poe1/api/economy/stash/current/currency/overview?league=${league}&type=${type}`;
  }
  return `/poe-api/poe1/api/economy/stash/current/item/overview?league=${league}&type=${type}`;
}

const BROWSER_TOOLKIT_WORKSPACE_KEY = "ninja-lens:toolkit-workspace:v1";
const MAX_BROWSER_TOOLKIT_BYTES = 2 * 1024 * 1024;
const MAX_BROWSER_TOOLKIT_IMAGE_CHARS = 512 * 1024;

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
    const response = await fetch("/poe-api/poe1/api/economy/leagues", {
      cache: options?.force ? "reload" : "default",
    });
    if (!response.ok) throw new Error(`League request failed: ${response.status}`);
    const data = (await response.json()) as EconomyLeague[];
    if (
      !Array.isArray(data) ||
      !data.every(
        (entry) =>
          entry && typeof entry.id === "string" && typeof entry.name === "string",
      )
    ) {
      throw new Error("League source returned an invalid payload.");
    }
    const now = Date.now();
    return {
      data,
      fetchedAt: responseSourceTime(Object.fromEntries(response.headers), now),
      expiresAt:
        now + responseMaxAge(Object.fromEntries(response.headers), 30 * 60 * 1000),
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
      const response = await fetch(browserOverviewPath(request), {
        cache: request.force ? "reload" : "default",
      });
      if (!response.ok) throw new Error(`Economy request failed: ${response.status}`);
      const data = (await response.json()) as
        | RawExchangeOverview
        | RawItemOverview
        | RawStashCurrencyOverview;
      if (!data || typeof data !== "object" || !Array.isArray(data.lines)) {
        throw new Error("Economy source returned an invalid payload.");
      }
      const headers = Object.fromEntries(response.headers);
      const now = Date.now();
      const envelope = {
        data,
        fetchedAt: responseSourceTime(headers, now),
        expiresAt: now + responseMaxAge(headers, 15 * 60 * 1000),
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
  async restoreToolkitCheckpoint() {
    throw new Error("Checkpoints require the desktop app.");
  },
  async fetchToolkitText(url) {
    const parsed = trustedExternalUrl(url);
    if (!parsed) throw new Error("Blocked an untrusted import URL.");
    const response = await fetch(parsed);
    if (!response.ok) throw new Error(`Import failed: ${response.status}`);
    return response.text();
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
  async importPobCharacter() {
    return {
      ok: false as const,
      authoritative: false as const,
      code: "POB_ENGINE_UNAVAILABLE",
      message: "Authoritative Path of Building character import requires the Windows desktop app.",
      recoverable: false,
    };
  },
  async readPlannerClipboard() {
    return navigator.clipboard.readText();
  },
  async listPoeCharacters() {
    throw new Error("Character account import requires the desktop app.");
  },
  async getPoeCharacter() {
    throw new Error("Character account import requires the desktop app.");
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
    const raw = localStorage.getItem(BROWSER_TOOLKIT_WORKSPACE_KEY);
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
            game: plugin.game === "poe2" ? "poe2" : "poe1",
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
  async getSettings() {
    return cloneDesktopSettings(browserSettings, browserSettingsRevision);
  },
  async saveSettings(patch) {
    const next = mergeDesktopSettingsPatch(browserSettings, patch);
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
    if (action === "always-on-top") {
      browserSettings.alwaysOnTop = Boolean(payload);
    }
    if (action === "compact") {
      browserSettings.compact = Boolean(payload);
    }
    if (action === "click-through") {
      browserSettings.clickThrough = Boolean(payload);
    }
    if (action === "opacity") {
      browserSettings.opacity = Math.max(
        0.65,
        Math.min(1, Number(payload) || 1),
      );
    }
    browserSettingsRevision += 1;
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
