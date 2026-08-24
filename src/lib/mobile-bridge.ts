import { CapacitorHttp } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Preferences } from "@capacitor/preferences";
import packageMetadata from "../../package.json";
import type {
  CacheEnvelope,
  DesktopSettings,
  FaustusOverviewRequest,
  KnowledgeSearchRequest,
  PoeWidgetBridge,
  RawExchangeOverview,
  RawFaustusMarket,
  RawFaustusOverview,
  RawItemOverview,
  RawKnowledgeSearchResponse,
  RawStashCurrencyOverview,
  RawWikiCargoResponse,
  RawWikiImageInfoResponse,
  SurfaceSearchIndexGroup,
  SurfaceState,
  ToolkitWorkspace,
  UpdateState,
} from "../types";
import { readMobileCache, writeMobileCache } from "./mobile-cache";
import { fetchBoundedToolkitText } from "./bounded-text-fetch";
import {
  knowledgeImageQuery,
  knowledgeImageTitles,
  knowledgeSearchQueries,
} from "./knowledge";
import {
  assertMobileResponseMetadata,
  decodedBase64ByteLength,
  isValidMobileStoredResponse,
  MAX_MOBILE_ARTWORK_BYTES,
  MAX_MOBILE_JSON_BYTES,
  mobileWikiTooltipUrl,
  parseLimitedMobileJson,
  responseHeader,
  responseMaxAge,
  responseSourceTime,
  trustedExternalUrl,
  withMobileHttpDeadline,
} from "./mobile-network";
import type { MobileStoredResponse } from "./mobile-network";
import {
  isPoeNinjaMirrorManifest,
  MAX_ACTIONABLE_MIRROR_AGE_MS,
  mirrorEnvelopeTimes,
  mirrorRouteForRequest,
  mirrorRouteUrl,
  POE_NINJA_MIRROR_MANIFEST_URL,
  verifyMirrorPayloadText,
} from "./poe-ninja-mirror";
import type {
  PoeNinjaMirrorManifest,
  PoeNinjaMirrorRoute,
} from "./poe-ninja-mirror";
import { resolveFaustusItemMetadata } from "./faustus";
import { defaultPriceCheckSettings } from "./price-check/types";
import { searchQuickRows } from "./quick-search";
import {
  cloneDesktopSettings,
  createSerialTaskQueue,
  mergeDesktopSettingsPatch,
  sanitizeDesktopSettingsPatch,
  sanitizeDesktopSettingsSnapshot,
} from "./settings-sync";
import { defaultDesktopShortcuts, validateShortcutDraft } from "./shortcuts";
import {
  browserSupportBundle,
  browserWorkspaceBackup,
  downloadJson,
  pickWorkspaceJson,
} from "./workspace-transfer";

type OverviewPayload =
  | RawExchangeOverview
  | RawItemOverview
  | RawStashCurrencyOverview;

interface StoredKnowledgeArtwork {
  dataUrl: string;
  expiresAt: number;
}

function isStoredKnowledgeArtwork(value: unknown): value is StoredKnowledgeArtwork {
  if (!isRecord(value) || typeof value.dataUrl !== "string") return false;
  const match = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
    value.dataUrl,
  );
  const bytes = match ? decodedBase64ByteLength(match[1]) : null;
  return (
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt >= 0 &&
    bytes != null &&
    bytes > 0 &&
    bytes <= MAX_MOBILE_ARTWORK_BYTES
  );
}

const SETTINGS_KEY = "desktop-settings";
const TOOLKIT_WORKSPACE_KEY = "toolkit-workspace-v1";
const MAX_MOBILE_TOOLKIT_BYTES = 2 * 1024 * 1024;
const MAX_MOBILE_TOOLKIT_IMAGE_CHARS = 512 * 1024;
const DEFAULT_TTL = 15 * 60 * 1000;
const MAX_MARKET_STALE_MS = 2 * 60 * 60 * 1000;
const MARKET_CACHE_VERSION = "v3-mirror";
const FAUSTUS_API_ROOT = "https://web.poecdn.com/api/currency-exchange";
const WIKI_USER_AGENT = `GloamCore/${packageMetadata.version} (+https://github.com/seNkoKG/gloamcore)`;
const CHAOS_METADATA_ID = "Metadata/Items/Currency/CurrencyRerollRare";
const DIVINE_METADATA_ID = "Metadata/Items/Currency/CurrencyModValues";
const mobileRequestInflight = new Map<string, Promise<CacheEnvelope<unknown>>>();

const mobileSettings: DesktopSettings = {
  alwaysOnTop: false,
  opacity: 1,
  compact: false,
  clickThrough: false,
  startMinimized: false,
  autoCheckUpdates: false,
  updateChannel: "stable",
  shortcuts: defaultDesktopShortcuts,
  priceCheck: defaultPriceCheckSettings,
};
let mobileSettingsRevision = 0;

const mobileUpdateState: UpdateState = {
  status: "unconfigured",
  currentVersion: packageMetadata.version,
  message: "Mobile updates are installed from a new app package",
  feedConfigured: false,
};

let mobileSurfaceState: SurfaceState = {
  league: "",
  categoryLabel: "Currency",
  searchRevision: 0,
  stale: false,
  loading: true,
  alertCount: 0,
  alerts: [],
  topMovers: [],
  commands: [],
  update: mobileUpdateState,
};
let mobileSearchPublisherId = "";
let mobileSearchRevision = 0;
const mobileSearchGroups = new Map<string, SurfaceSearchIndexGroup>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mobileToolkitDefaults(): ToolkitWorkspace {
  return {
    version: 1,
    macros: [],
    cheatSheets: [],
    theme: { accent: "#35d9b5", background: "#080f14", density: "compact" },
    whiteboard: { strokes: [], snapshots: [] },
    overlayBounds: {},
    stashScroll: { enabled: false, modifier: "Ctrl" },
    plugins: [],
  };
}

function toolkitText(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.replace(/\0/g, "").trim().slice(0, maximum)
    : "";
}

function toolkitId(value: unknown) {
  return toolkitText(value, 80).replace(/[^a-z0-9_.-]/gi, "-") || crypto.randomUUID();
}

function toolkitHttpsUrl(value: unknown) {
  const text = toolkitText(value, 2_048);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function toolkitImage(value: unknown) {
  const image = typeof value === "string" ? value : "";
  return image.length <= MAX_MOBILE_TOOLKIT_IMAGE_CHARS &&
    /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(image)
    ? image
    : "";
}

function toolkitBoardElements(value: unknown) {
  const tools = new Set([
    "free", "highlighter", "line", "rect", "circle", "arrow", "triangle",
    "text", "image", "ruler", "radius", "mirror",
  ]);
  if (!Array.isArray(value)) return [];
  return value.slice(-500).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.tool !== "string" || !tools.has(entry.tool)) {
      return [];
    }
    const points = (Array.isArray(entry.points) ? entry.points : [])
      .slice(0, 2_000)
      .flatMap((point) => {
        if (!isRecord(point)) return [];
        const x = Number(point.x);
        const y = Number(point.y);
        return Number.isFinite(x) && Number.isFinite(y)
          ? [{
              x: Math.max(-10_000, Math.min(10_000, x)),
              y: Math.max(-10_000, Math.min(10_000, y)),
            }]
          : [];
      });
    if (!points.length) return [];
    const base = {
      id: toolkitId(entry.id),
      tool: entry.tool,
      color:
        typeof entry.color === "string" && /^#[0-9a-f]{6}$/i.test(entry.color)
          ? entry.color
          : "#35d9b5",
      width: Math.max(1, Math.min(40, Number(entry.width) || 3)),
      points,
    };
    if (entry.tool === "text") {
      const text = typeof entry.text === "string"
        ? entry.text.replace(/\0/g, "").slice(0, 4_000)
        : "";
      return text
        ? [{
            ...base,
            text,
            fontSize: Math.max(8, Math.min(144, Number(entry.fontSize) || 24)),
          }]
        : [];
    }
    if (entry.tool === "image") {
      const src = toolkitImage(entry.src);
      return src && points.length >= 2 ? [{ ...base, src }] : [];
    }
    if (entry.tool === "mirror") {
      const source = isRecord(entry.source)
        ? {
            x: Math.max(0, Math.min(1, Number(entry.source.x) || 0)),
            y: Math.max(0, Math.min(1, Number(entry.source.y) || 0)),
            w: Math.max(0.01, Math.min(1, Number(entry.source.w) || 0.25)),
            h: Math.max(0.01, Math.min(1, Number(entry.source.h) || 0.25)),
          }
        : { x: 0, y: 0, w: 0.25, h: 0.25 };
      return points.length >= 2 ? [{ ...base, source }] : [];
    }
    return [{ ...base }];
  });
}

function toolkitPluginStorage(value: unknown) {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  let total = 0;
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 64)) {
    if (typeof rawValue !== "string") continue;
    const key = toolkitText(rawKey, 80).replace(/[^a-z0-9_.:-]/gi, "-");
    const clean = rawValue.replace(/\0/g, "").slice(0, 16 * 1024);
    if (!key || total + key.length + clean.length > 128 * 1024) break;
    result[key] = clean;
    total += key.length + clean.length;
  }
  return result;
}

export function sanitizeStoredMobileToolkitWorkspace(value: unknown): ToolkitWorkspace {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("The saved mobile toolkit workspace has an unsupported format.");
  }
  const theme = isRecord(value.theme) ? value.theme : {};
  const whiteboard = isRecord(value.whiteboard) ? value.whiteboard : {};
  const stashScroll = isRecord(value.stashScroll) ? value.stashScroll : {};
  const macroIds = new Set<string>();
  const sheetIds = new Set<string>();
  const pluginIds = new Set<string>();
  const uniqueId = (raw: unknown, seen: Set<string>) => {
    let id = toolkitId(raw);
    while (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    return id;
  };

  return {
    version: 1,
    macros: (Array.isArray(value.macros) ? value.macros : [])
      .slice(0, 24)
      .flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const hotkey = toolkitText(entry.hotkey, 80);
        const text = toolkitText(entry.text, 512);
        if (!hotkey || !text) return [];
        return [{
          id: uniqueId(entry.id, macroIds),
          label: toolkitText(entry.label, 80) || text,
          hotkey,
          text,
          enabled: Boolean(entry.enabled),
        }];
      }),
    cheatSheets: (Array.isArray(value.cheatSheets) ? value.cheatSheets : [])
      .slice(0, 40)
      .flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const title = toolkitText(entry.title, 100);
        if (!title) return [];
        return [{
          id: uniqueId(entry.id, sheetIds),
          title,
          category: toolkitText(entry.category, 80) || "General",
          body: typeof entry.body === "string"
            ? entry.body.replace(/\0/g, "").slice(0, 20_000)
            : "",
          url: toolkitHttpsUrl(entry.url),
          image: toolkitImage(entry.image),
          pinned: Boolean(entry.pinned),
        }];
      }),
    theme: {
      accent: typeof theme.accent === "string" && /^#[0-9a-f]{6}$/i.test(theme.accent)
        ? theme.accent
        : "#35d9b5",
      background:
        typeof theme.background === "string" && /^#[0-9a-f]{6}$/i.test(theme.background)
          ? theme.background
          : "#080f14",
      density: theme.density === "comfortable" ? "comfortable" : "compact",
    },
    whiteboard: {
      strokes: toolkitBoardElements(whiteboard.strokes),
      snapshots: (Array.isArray(whiteboard.snapshots) ? whiteboard.snapshots : [])
        .slice(-24)
        .flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const name = toolkitText(entry.name, 100);
          if (!name) return [];
          const createdAt = Number(entry.createdAt);
          return [{
            id: toolkitId(entry.id),
            name,
            createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
            strokes: toolkitBoardElements(entry.strokes),
          }];
        }),
    },
    overlayBounds: {},
    stashScroll: {
      enabled: Boolean(stashScroll.enabled),
      modifier:
        stashScroll.modifier === "Shift" || stashScroll.modifier === "Alt"
          ? stashScroll.modifier
          : "Ctrl",
    },
    plugins: (Array.isArray(value.plugins) ? value.plugins : [])
      .slice(0, 20)
      .flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const name = toolkitText(entry.name, 80);
        if (!name) return [];
        const url = toolkitHttpsUrl(entry.url);
        const permissions = isRecord(entry.permissions) ? entry.permissions : {};
        return [{
          id: uniqueId(entry.id, pluginIds),
          name,
          url,
          enabled: Boolean(entry.enabled && url),
          permissions: {
            currentItem: Boolean(permissions.currentItem),
            gameCapture: Boolean(permissions.gameCapture),
            openExternal: Boolean(permissions.openExternal),
          },
          storage: toolkitPluginStorage(entry.storage),
        }];
      }),
  };
}

export function serializeMobileToolkitWorkspace(value: unknown) {
  const workspace = sanitizeStoredMobileToolkitWorkspace(value);
  const serialized = JSON.stringify(workspace);
  if (new TextEncoder().encode(serialized).byteLength > MAX_MOBILE_TOOLKIT_BYTES) {
    throw new Error(
      "The toolkit workspace exceeds the 2 MB safety limit. Remove some images before saving.",
    );
  }
  return { workspace, serialized };
}

const mobileToolkitSaveQueue = createSerialTaskQueue<
  ToolkitWorkspace,
  {
    workspace: ToolkitWorkspace;
    failures: Array<{ id: string; hotkey: string; error: string }>;
  }
>(async (value) => {
  const { workspace, serialized } = serializeMobileToolkitWorkspace(value);
  await Preferences.set({ key: TOOLKIT_WORKSPACE_KEY, value: serialized });
  return { workspace, failures: [] };
});

async function readMobileToolkitWorkspace() {
  await mobileToolkitSaveQueue.waitForIdle();
  const { value } = await Preferences.get({ key: TOOLKIT_WORKSPACE_KEY });
  if (!value) return mobileToolkitDefaults();
  if (new TextEncoder().encode(value).byteLength > MAX_MOBILE_TOOLKIT_BYTES) {
    throw new Error("The saved mobile toolkit workspace exceeds the 2 MB safety limit.");
  }
  try {
    return sanitizeStoredMobileToolkitWorkspace(JSON.parse(value));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The saved mobile toolkit workspace could not be loaded: ${detail}`);
  }
}

function isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord);
}

function hasOptionalRecordArray(record: Record<string, unknown>, key: string) {
  return record[key] == null || isRecordArray(record[key]);
}

function hasOptionalSparkline(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value == null) return true;
  if (!isRecord(value)) return false;
  return (
    value.data == null ||
    (Array.isArray(value.data) &&
      value.data.every(
        (point) => point == null || (typeof point === "number" && Number.isFinite(point)),
      ))
  );
}

export function isWikiCargoPayload(data: unknown): data is RawWikiCargoResponse {
  return (
    isRecord(data) &&
    isRecordArray(data.cargoquery) &&
    data.cargoquery.every(
      (entry) => entry.title == null || isRecord(entry.title),
    )
  );
}

export function isWikiImagePayload(data: unknown): data is RawWikiImageInfoResponse {
  if (!isRecord(data) || !isRecord(data.query) || !isRecordArray(data.query.pages)) {
    return false;
  }
  return data.query.pages.every(
    (page) => page.imageinfo == null || isRecordArray(page.imageinfo),
  );
}

async function boundedMobileGet(
  url: string,
  {
    headers,
    responseType = "text",
    maximumBytes,
  }: {
    headers?: Record<string, string>;
    responseType?: "arraybuffer" | "text";
    maximumBytes: number;
  },
) {
  const response = await withMobileHttpDeadline(
    CapacitorHttp.get({
      url,
      responseType,
      disableRedirects: true,
      connectTimeout: 15_000,
      readTimeout: 20_000,
      headers,
    }),
  );
  assertMobileResponseMetadata(url, response.url, response.headers, maximumBytes);
  return response;
}

async function cachedGetUncoalesced<T>(
  key: string,
  url: string,
  validate: (data: unknown) => data is T,
  force = false,
  fallbackTtl = DEFAULT_TTL,
  maxStaleMs = Number.POSITIVE_INFINITY,
  requestHeaders: Record<string, string> = {},
  integrity?: Pick<PoeNinjaMirrorRoute, "bytes" | "sha256">,
): Promise<CacheEnvelope<T>> {
  const cacheKey = `http:${key}`;
  const now = Date.now();
  const stored = await readMobileCache<MobileStoredResponse<T>>(cacheKey);
  const cached = isValidMobileStoredResponse(stored, validate, now) &&
    (!integrity || stored.integritySha256 === integrity.sha256)
    ? stored
    : null;
  if (!force && cached && cached.envelope.expiresAt > now) {
    return { ...cached.envelope, stale: false, cache: "fresh" };
  }

  try {
    const response = await boundedMobileGet(url, {
      maximumBytes: MAX_MOBILE_JSON_BYTES,
      headers: {
        Accept: "application/json",
        ...requestHeaders,
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      },
    });
    if (response.status === 304 && cached) {
      const envelope: CacheEnvelope<T> = {
        ...cached.envelope,
        fetchedAt: responseSourceTime(response.headers),
        expiresAt:
          Date.now() + responseMaxAge(response.headers, fallbackTtl),
        stale: false,
        cache: "revalidated",
        error: undefined,
      };
      await writeMobileCache(cacheKey, {
        envelope,
        etag: cached.etag,
        integritySha256: cached.integritySha256,
      } satisfies MobileStoredResponse<T>);
      return envelope;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Request failed (${response.status})`);
    }
    if (integrity) await verifyMirrorPayloadText(response.data, integrity);
    const data = parseLimitedMobileJson<T>(response.data, MAX_MOBILE_JSON_BYTES);
    if (!validate(data)) {
      throw new Error("The source returned an invalid market payload.");
    }
    const now = Date.now();
    const fetchedAt = responseSourceTime(response.headers, now);
    const envelope: CacheEnvelope<T> = {
      data,
      fetchedAt,
      expiresAt: now + responseMaxAge(response.headers, fallbackTtl),
      stale: false,
      cache: "mobile",
    };
    await writeMobileCache(cacheKey, {
      envelope,
      etag: responseHeader(response.headers, "etag"),
      integritySha256: integrity?.sha256,
    } satisfies MobileStoredResponse<T>);
    return envelope;
  } catch (reason) {
    const fallbackAge = cached
      ? Date.now() - cached.envelope.fetchedAt
      : Number.NaN;
    if (
      cached &&
      Number.isFinite(fallbackAge) &&
      fallbackAge >= 0 &&
      fallbackAge <= maxStaleMs
    ) {
      return {
        ...cached.envelope,
        stale: true,
        cache: "stale",
        error: reason instanceof Error ? reason.message : String(reason),
      };
    }
    throw reason;
  }
}

async function cachedGet<T>(
  key: string,
  url: string,
  validate: (data: unknown) => data is T,
  force = false,
  fallbackTtl = DEFAULT_TTL,
  maxStaleMs = Number.POSITIVE_INFINITY,
  requestHeaders: Record<string, string> = {},
  integrity?: Pick<PoeNinjaMirrorRoute, "bytes" | "sha256">,
) {
  const normalKey = `http:${key}:normal`;
  const forceKey = `http:${key}:force`;
  const inflightKey = force ? forceKey : normalKey;
  const existing = force
    ? mobileRequestInflight.get(forceKey)
    : mobileRequestInflight.get(forceKey) || mobileRequestInflight.get(normalKey);
  if (existing) return existing as Promise<CacheEnvelope<T>>;
  const weaker = force ? mobileRequestInflight.get(normalKey) : undefined;
  const run = () =>
    cachedGetUncoalesced(
      key,
      url,
      validate,
      force,
      fallbackTtl,
      maxStaleMs,
      requestHeaders,
      integrity,
    );
  const request = weaker
    ? weaker.catch(() => undefined).then(run)
    : run();
  mobileRequestInflight.set(inflightKey, request as Promise<CacheEnvelope<unknown>>);
  try {
    return await request;
  } finally {
    if (mobileRequestInflight.get(inflightKey) === request) {
      mobileRequestInflight.delete(inflightKey);
    }
  }
}

export function isOverviewPayload(data: unknown): data is OverviewPayload {
  if (!isRecord(data) || !isRecordArray(data.lines)) return false;
  if (
    !hasOptionalRecordArray(data, "items") ||
    !hasOptionalRecordArray(data, "currencyDetails")
  ) {
    return false;
  }
  if (data.core != null) {
    if (!isRecord(data.core) || !hasOptionalRecordArray(data.core, "items")) {
      return false;
    }
    if (data.core.rates != null && !isRecord(data.core.rates)) return false;
  }
  return data.lines.every(
    (line) =>
      hasOptionalRecordArray(line, "implicitModifiers") &&
      hasOptionalRecordArray(line, "explicitModifiers") &&
      hasOptionalRecordArray(line, "mutatedModifiers") &&
      hasOptionalRecordArray(line, "tradeInfo") &&
      hasOptionalSparkline(line, "sparkline") &&
      hasOptionalSparkline(line, "sparkLine") &&
      hasOptionalSparkline(line, "paySparkLine") &&
      hasOptionalSparkline(line, "receiveSparkLine") &&
      hasOptionalSparkline(line, "lowConfidencePaySparkLine") &&
      hasOptionalSparkline(line, "lowConfidenceReceiveSparkLine"),
  );
}

async function getMobileMirrorManifest(force = false) {
  return cachedGet<PoeNinjaMirrorManifest>(
    `${MARKET_CACHE_VERSION}:manifest`,
    POE_NINJA_MIRROR_MANIFEST_URL,
    isPoeNinjaMirrorManifest,
    force,
    5 * 60 * 1000,
    MAX_ACTIONABLE_MIRROR_AGE_MS,
  );
}

async function getMobileKnowledge(
  request: KnowledgeSearchRequest,
): Promise<CacheEnvelope<RawKnowledgeSearchResponse>> {
  const queries = knowledgeSearchQueries(request);
  const identity = `${queries.query.toLowerCase()}:${queries.limit}`;
  const root = "https://www.poewiki.net/w/api.php?";
  const [items, modifiers] = await Promise.all([
    cachedGet<RawWikiCargoResponse>(
      `knowledge:items:${identity}`,
      `${root}${queries.items}`,
      isWikiCargoPayload,
      request.force,
      60 * 60 * 1000,
    ),
    cachedGet<RawWikiCargoResponse>(
      `knowledge:modifiers:${identity}`,
      `${root}${queries.modifiers}`,
      isWikiCargoPayload,
      request.force,
      60 * 60 * 1000,
    ),
  ]);
  const iconTitles = knowledgeImageTitles(items.data);
  let images: CacheEnvelope<RawWikiImageInfoResponse> | undefined;
  if (iconTitles.length > 0) {
    try {
      images = await cachedGet<RawWikiImageInfoResponse>(
        `knowledge:images:${identity}`,
        `${root}${knowledgeImageQuery(iconTitles)}`,
        isWikiImagePayload,
        request.force,
        7 * 24 * 60 * 60 * 1000,
      );
    } catch {
      // Item records remain available with a class-specific visual fallback.
    }
  }
  const hydratedImages = images
    ? await hydrateMobileKnowledgeImages(images.data, Boolean(request.force))
    : undefined;
  const stale = items.stale || modifiers.stale || Boolean(images?.stale);
  return {
    data: {
      items: items.data,
      modifiers: modifiers.data,
      images: hydratedImages,
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
        : "mobile",
    error: [items.error, modifiers.error, images?.error]
      .filter(Boolean)
      .join("; ") || undefined,
  };
}

function trustedMobileArtworkUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      !url.username &&
      !url.password &&
      url.hostname === "www.poewiki.net" &&
      url.pathname.startsWith("/images/")
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function getMobileKnowledgeArtwork(
  value: string,
  fallbackMime: string | undefined,
  force: boolean,
) {
  const url = trustedMobileArtworkUrl(value);
  if (!url) return undefined;
  const cacheKey = `knowledge-artwork:${url}`;
  const stored = await readMobileCache<StoredKnowledgeArtwork>(cacheKey);
  const cached = isStoredKnowledgeArtwork(stored) ? stored : null;
  if (!force && cached && cached.expiresAt > Date.now()) return cached.dataUrl;

  try {
    const response = await boundedMobileGet(url, {
      responseType: "arraybuffer",
      maximumBytes: MAX_MOBILE_ARTWORK_BYTES,
      headers: { Accept: "image/avif,image/webp,image/png,image/*" },
    });
    const mime = (
      responseHeader(response.headers, "content-type") ||
      fallbackMime ||
      ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();
    const base64 =
      typeof response.data === "string"
        ? response.data.replace(/\s+/g, "")
        : undefined;
    const decodedBytes = base64 ? decodedBase64ByteLength(base64) : null;
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !/^image\/(?:avif|gif|jpeg|png|webp)$/.test(mime) ||
      !base64 ||
      decodedBytes == null ||
      decodedBytes === 0 ||
      decodedBytes > MAX_MOBILE_ARTWORK_BYTES
    ) {
      return cached?.dataUrl;
    }
    const dataUrl = `data:${mime};base64,${base64}`;
    await writeMobileCache(cacheKey, {
      dataUrl,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    } satisfies StoredKnowledgeArtwork);
    return dataUrl;
  } catch {
    return cached?.dataUrl;
  }
}

async function hydrateMobileKnowledgeImages(
  payload: RawWikiImageInfoResponse,
  force: boolean,
) {
  const pages = await Promise.all(
    (payload.query?.pages || []).map(async (page) => {
      const info = page.imageinfo?.[0];
      if (!info) return page;
      const dataUrl = await getMobileKnowledgeArtwork(
        info.thumburl || info.url || "",
        info.mime,
        force,
      );
      return dataUrl
        ? { ...page, imageinfo: [{ ...info, dataUrl }] }
        : page;
    }),
  );
  return { ...payload, query: { ...payload.query, pages } };
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

export function sanitizeStoredMobileSettings(value: unknown) {
  let next = sanitizeDesktopSettingsSnapshot(value, mobileSettings);
  let shortcutErrors = validateShortcutDraft({
    ...next.shortcuts,
    priceCheck: next.priceCheck.hotkey,
  }, { priceCheckEnabled: next.priceCheck.enabled });
  if (Object.values(shortcutErrors)[0]) {
    next = {
      ...next,
      shortcuts: { ...defaultDesktopShortcuts },
    };
    shortcutErrors = validateShortcutDraft({
      ...next.shortcuts,
      priceCheck: next.priceCheck.hotkey,
    }, { priceCheckEnabled: next.priceCheck.enabled });
    if (Object.values(shortcutErrors)[0]) {
      next = {
        ...next,
        priceCheck: {
          ...next.priceCheck,
          hotkey: defaultPriceCheckSettings.hotkey,
        },
      };
    }
  }
  return next;
}

async function readStoredSettings() {
  try {
    const { value } = await Preferences.get({ key: SETTINGS_KEY });
    if (!value) {
      return cloneDesktopSettings(mobileSettings, mobileSettingsRevision);
    }
    const merged = sanitizeStoredMobileSettings(JSON.parse(value));
    return cloneDesktopSettings(merged, mobileSettingsRevision);
  } catch {
    return cloneDesktopSettings(mobileSettings, mobileSettingsRevision);
  }
}

const mobileSettingsSaveQueue = createSerialTaskQueue(
  async (patch: import("../types").DesktopSettingsPatch) => {
    const current = await readStoredSettings();
    const next = mergeDesktopSettingsPatch(
      current,
      sanitizeDesktopSettingsPatch(patch, current),
    );
    const shortcutErrors = validateShortcutDraft({
      ...next.shortcuts,
      priceCheck: next.priceCheck.hotkey,
    }, { priceCheckEnabled: next.priceCheck.enabled });
    const firstShortcutError = Object.values(shortcutErrors)[0];
    if (firstShortcutError) throw new Error(firstShortcutError);
    const { settingsRevision: _runtimeRevision, ...persisted } = next;
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(persisted) });
    mobileSettingsRevision += 1;
    return cloneDesktopSettings(next, mobileSettingsRevision);
  },
);

async function readSettings() {
  await mobileSettingsSaveQueue.waitForIdle();
  return readStoredSettings();
}

interface MobileFaustusDigest {
  next_change_id?: number;
  markets: RawFaustusMarket[];
}

function isMobileFaustusDigest(value: unknown): value is MobileFaustusDigest {
  return isRecord(value) && Array.isArray(value.markets) && value.markets.every(isRecord);
}

function mobileFaustusMetadataUrl(names: string[]) {
  const quoted = names.map((name) => `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
  const search = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    limit: "100",
    tables: "items",
    fields: "name,metadata_id,is_in_game,removal_version",
    where: `name IN (${quoted})`,
  });
  return `https://www.poewiki.net/w/api.php?${search}`;
}

async function resolveMobileFaustusItems(request: FaustusOverviewRequest) {
  const names = [...new Set(request.items.map((item) => item.name))];
  const cargoEntries: NonNullable<RawWikiCargoResponse["cargoquery"]> = [];
  for (let offset = 0; offset < names.length; offset += 35) {
    const batch = names.slice(offset, offset + 35);
    const envelope = await cachedGet(
      `faustus-metadata:${batch.slice().sort().join("|")}`,
      mobileFaustusMetadataUrl(batch),
      isWikiCargoPayload,
      request.force,
      7 * 24 * 60 * 60 * 1000,
      Number.POSITIVE_INFINITY,
      { "User-Agent": WIKI_USER_AGENT },
    );
    cargoEntries.push(...(envelope.data.cargoquery || []));
  }
  return resolveFaustusItemMetadata(request.items, cargoEntries);
}

function filterMobileFaustusMarkets(markets: RawFaustusMarket[], league: string, targets: ReadonlySet<string>) {
  return markets.filter((market) => {
    if (market.league !== league || !Array.isArray(market.market_pair)) return false;
    const pair = market.market_pair;
    if (pair.includes(CHAOS_METADATA_ID) && pair.includes(DIVINE_METADATA_ID)) return true;
    return (pair.includes(CHAOS_METADATA_ID) || pair.includes(DIVINE_METADATA_ID))
      && pair.some((metadataId) => targets.has(metadataId));
  });
}

async function getMobileFaustusOverview(request: FaustusOverviewRequest): Promise<CacheEnvelope<RawFaustusOverview>> {
  const items = await resolveMobileFaustusItems(request);
  const targets = new Set(items.map((item) => item.metadataId).filter((id): id is string => Boolean(id) && id !== CHAOS_METADATA_ID && id !== DIVINE_METADATA_ID));
  const currentHour = Math.floor(Date.now() / 3_600_000) * 3_600;
  let latestHour = 0;
  let latestFailure: unknown;
  for (let offset = 1; offset <= 3; offset += 1) {
    const hour = currentHour - offset * 3_600;
    try {
      await cachedGet(`faustus-hour:${hour}`, `${FAUSTUS_API_ROOT}/${hour}`, isMobileFaustusDigest, false, 30 * 24 * 60 * 60 * 1000, Number.POSITIVE_INFINITY);
      latestHour = hour;
      break;
    } catch (error) {
      latestFailure = error;
      // The latest completed digest can appear shortly after the hour.
    }
  }
  if (!latestHour) {
    const reason = latestFailure instanceof Error ? latestFailure.message : "Unknown upstream failure.";
    throw new Error(`The latest completed Faustus market hour is unavailable. ${reason}`);
  }
  const envelopes = await Promise.all(Array.from({ length: 8 }, async (_value, index) => {
    const hour = latestHour - index * 3_600;
    try {
      return { hour, envelope: await cachedGet(`faustus-hour:${hour}`, `${FAUSTUS_API_ROOT}/${hour}`, isMobileFaustusDigest, false, 30 * 24 * 60 * 60 * 1000, Number.POSITIVE_INFINITY) };
    } catch {
      return null;
    }
  }));
  const available = envelopes.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  return {
    data: {
      latestHour,
      items,
      hours: available.map(({ hour, envelope }) => ({
        id: hour,
        markets: filterMobileFaustusMarkets(envelope.data.markets, request.league, targets),
      })).sort((left, right) => left.id - right.id),
    },
    fetchedAt: latestHour * 1000,
    expiresAt: (currentHour + 3_600) * 1000 + 2 * 60 * 1000,
    stale: available.some((entry) => entry.envelope.stale),
    cache: "mobile",
  };
}

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

export const mobileBridge: PoeWidgetBridge = {
  async getLeagues(options) {
    const manifest = await getMobileMirrorManifest(Boolean(options?.force));
    const times = mirrorEnvelopeTimes(manifest.data.leagueSnapshot);
    return {
      data: manifest.data.leagueSnapshot.data,
      ...times,
      stale: manifest.stale || times.stale,
      cache: manifest.stale || times.stale ? "stale" : manifest.cache,
      error: manifest.error,
    };
  },
  async getOverview(request) {
    const manifest = await getMobileMirrorManifest(Boolean(request.force));
    const route = mirrorRouteForRequest(manifest.data, request);
    const times = mirrorEnvelopeTimes(route);
    const payload = await cachedGet<OverviewPayload>(
      `${MARKET_CACHE_VERSION}:overview:${request.league}:${request.source}:${request.type}`,
      mirrorRouteUrl(route),
      isOverviewPayload,
      request.force,
      DEFAULT_TTL,
      MAX_MARKET_STALE_MS,
      {},
      route,
    );
    return {
      ...payload,
      ...times,
      stale: manifest.stale || payload.stale || times.stale,
      cache: manifest.stale || payload.stale || times.stale ? "stale" : payload.cache,
      error: [manifest.error, payload.error].filter(Boolean).join("; ") || undefined,
    };
  },
  async getItemTooltip(request) {
    return cachedGet<RawWikiCargoResponse>(
      `tooltip:${request.name}:${request.baseType || ""}`.toLowerCase(),
      mobileWikiTooltipUrl(request, WIKI_TOOLTIP_FIELDS),
      isWikiCargoPayload,
      false,
      24 * 60 * 60 * 1000,
    );
  },
  getFaustusOverview: getMobileFaustusOverview,
  searchKnowledge: getMobileKnowledge,
  async readClipboardItem() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Native WebViews can require the item text to be pasted into the checker.
    }
    text = text.replace(/\0/g, "").slice(0, 65_536);
    return {
      text,
      capturedAt: Date.now(),
      validPrefix: /^Item Class:\s*.+/m.test(text),
    };
  },
  async getPendingPriceCheckCapture() {
    return null;
  },
  async openExternal(url) {
    const parsed = trustedExternalUrl(url);
    if (!parsed) {
      throw new Error("Blocked an untrusted external link.");
    }
    await Browser.open({ url: parsed.toString(), presentationStyle: "popover" });
  },
  async openWealthyExile() {
    await mobileBridge.openExternal("https://wealthyexile.com/stash");
    return true;
  },
  async hideWealthyExile() {
    return false;
  },
  async controlWealthyExile() {
    return false;
  },
  async openCraftOfExile() {
    await mobileBridge.openExternal("https://beta.craftofexile.com/?game=poe1");
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
    return {
      id: `mobile-${Date.now()}`,
      label: request.label || "Checkpoint",
      createdAt: Date.now(),
    };
  },
  async listToolkitCheckpoints() {
    return [];
  },
  async readToolkitCheckpoint() {
    throw new Error("Filter checkpoints require the desktop app.");
  },
  async restoreToolkitCheckpoint() {
    throw new Error("Filter checkpoints require the desktop app.");
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
    throw new Error("The authoritative passive tree currently requires the Windows desktop app.");
  },
  async decodePobBuild(input) {
    if (/^<\?xml\b|^<PathOfBuilding\b/i.test(input.trim())) return input.trim();
    throw new Error("Compressed Path of Building imports currently require the Windows desktop app.");
  },
  async encodePobBuild() {
    throw new Error("Compressed Path of Building exports require the Windows desktop app.");
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
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  },
  async resolvePlannerItemArtwork() {
    return {};
  },
  async getToolkitWorkspace() {
    return readMobileToolkitWorkspace();
  },
  async recoverToolkitWorkspace() {
    await mobileToolkitSaveQueue.waitForIdle();
    const { value } = await Preferences.get({ key: TOOLKIT_WORKSPACE_KEY });
    const backupName = value
      ? `${TOOLKIT_WORKSPACE_KEY}:recovered:${Date.now()}`
      : null;
    if (value && backupName) {
      await Preferences.set({ key: backupName, value });
    }
    await Preferences.remove({ key: TOOLKIT_WORKSPACE_KEY });
    return { workspace: mobileToolkitDefaults(), backupName };
  },
  async saveToolkitWorkspace(value) {
    return mobileToolkitSaveQueue.run(value);
  },
  async showToolkitOverlay() {
    throw new Error("Game overlays require the Windows desktop app.");
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
    return mobileBridge.getPoeEventLog();
  },
  async stopPoeEventLog() {
    return mobileBridge.getPoeEventLog();
  },
  async clearPoeEventLog() {
    return mobileBridge.getPoeEventLog();
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
  getSettings: readSettings,
  async saveSettings(patch) {
    const queuedPatch = {
      ...patch,
      priceCheck: patch.priceCheck
        ? { ...patch.priceCheck }
        : undefined,
    };
    return mobileSettingsSaveQueue.run(queuedPatch);
  },
  async windowAction(_action, _payload) {
    return readSettings();
  },
  async publishSurfaceState(state) {
    mobileSurfaceState = { ...state, update: mobileUpdateState };
  },
  async updateSurfaceSearchIndex(update) {
    if (update.publisherId !== mobileSearchPublisherId) {
      mobileSearchGroups.clear();
      mobileSearchPublisherId = update.publisherId;
      mobileSearchRevision = 0;
    }
    if (update.revision <= mobileSearchRevision) return;
    if (!update.reset && update.revision !== mobileSearchRevision + 1) {
      throw new Error("Quick-search index revision gap requires a full reset.");
    }
    if (update.reset) mobileSearchGroups.clear();
    for (const id of update.remove) mobileSearchGroups.delete(id);
    for (const group of update.replace) {
      mobileSearchGroups.delete(group.id);
      mobileSearchGroups.set(group.id, group);
    }
    mobileSearchRevision = update.revision;
  },
  async searchSurfaceRows(query, limit = 50) {
    return searchQuickRows(
      [...mobileSearchGroups.values()].flatMap((group) => group.rows),
      query,
      limit,
      mobileSurfaceState.league,
      mobileSearchRevision,
    );
  },
  async getSurfaceState() {
    return mobileSurfaceState;
  },
  async surfaceAction() {
    return undefined;
  },
  async getUpdateState() {
    return mobileUpdateState;
  },
  async checkForUpdates() {
    return mobileUpdateState;
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
  onSurfaceState() {
    return () => undefined;
  },
  onUpdateState() {
    return () => undefined;
  },
};
