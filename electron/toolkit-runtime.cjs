const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_MACROS = 24;
const MAX_SHEETS = 40;
const MAX_BOARD_ELEMENTS = 500;
const MAX_BOARD_SNAPSHOTS = 24;
const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGE_CHARS = 512 * 1024;
const MAX_PLUGIN_STORAGE_KEYS = 64;
const MAX_PLUGIN_STORAGE_VALUE_CHARS = 16 * 1024;
const MAX_PLUGIN_STORAGE_CHARS = 128 * 1024;
const BOARD_TOOLS = new Set(["free", "highlighter", "line", "rect", "circle", "arrow", "triangle", "text", "image", "ruler", "radius", "mirror"]);

function shortText(value, maximum) {
  return String(value || "").replace(/[\0\r\n]/g, " ").trim().slice(0, maximum);
}

function safeId(value) {
  const id = shortText(value, 80).replace(/[^a-z0-9_.-]/gi, "-");
  return id || crypto.randomUUID();
}

function uniqueSafeId(value, seen) {
  let id = safeId(value);
  while (seen.has(id)) id = crypto.randomUUID();
  seen.add(id);
  return id;
}

function sanitizeOverlayBounds(value) {
  if (!value || typeof value !== "object") return undefined;
  const width = Number(value.width);
  const height = Number(value.height);
  const x = Number(value.x);
  const y = Number(value.y);
  if (![width, height, x, y].every(Number.isFinite)) return undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(320, Math.min(4096, Math.round(width))),
    height: Math.max(240, Math.min(4096, Math.round(height))),
  };
}

function finitePoint(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.max(-10_000, Math.min(10_000, x)), y: Math.max(-10_000, Math.min(10_000, y)) };
}

function safeInlineImage(value) {
  const image = typeof value === "string" ? value : "";
  return image.length <= MAX_INLINE_IMAGE_CHARS && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(image) ? image : "";
}

function workspaceImageSources(value) {
  const source = value && typeof value === "object" ? value : {};
  const images = [];
  for (const sheet of Array.isArray(source.cheatSheets) ? source.cheatSheets : []) {
    if (typeof sheet?.image === "string") images.push(sheet.image);
  }
  const collectBoard = (entries) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry?.tool === "image" && typeof entry.src === "string") images.push(entry.src);
    }
  };
  collectBoard(source.whiteboard?.strokes);
  for (const snapshot of Array.isArray(source.whiteboard?.snapshots) ? source.whiteboard.snapshots : []) {
    collectBoard(snapshot?.strokes);
  }
  return images;
}

function assertWorkspaceImageBudgets(value) {
  if (workspaceImageSources(value).some((image) => image.length > MAX_INLINE_IMAGE_CHARS)) {
    throw new Error("A workspace image is too large. Re-import an image below 375 KB.");
  }
}

function sanitizePluginStorage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  let total = 0;
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_PLUGIN_STORAGE_KEYS)) {
    const key = shortText(rawKey, 80).replace(/[^a-z0-9_.:-]/gi, "-");
    if (!key || typeof rawValue !== "string") continue;
    const clean = rawValue.replace(/\0/g, "").slice(0, MAX_PLUGIN_STORAGE_VALUE_CHARS);
    if (total + key.length + clean.length > MAX_PLUGIN_STORAGE_CHARS) break;
    output[key] = clean;
    total += key.length + clean.length;
  }
  return output;
}

function sanitizeBoardElements(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_BOARD_ELEMENTS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !BOARD_TOOLS.has(entry.tool)) return [];
    const points = Array.isArray(entry.points) ? entry.points.slice(0, 2000).map(finitePoint).filter(Boolean) : [];
    if (!points.length) return [];
    const base = {
      id: safeId(entry.id),
      tool: entry.tool,
      color: /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : "#35d9b5",
      width: Math.max(1, Math.min(40, Number(entry.width) || 3)),
      points,
    };
    if (entry.tool === "text") {
      const text = String(entry.text || "").replace(/\0/g, "").slice(0, 4000);
      if (!text) return [];
      return [{ ...base, text, fontSize: Math.max(8, Math.min(144, Number(entry.fontSize) || 24)) }];
    }
    if (entry.tool === "image") {
      const src = safeInlineImage(entry.src);
      return src && points.length >= 2 ? [{ ...base, src }] : [];
    }
    if (entry.tool === "mirror") {
      const source = entry.source && typeof entry.source === "object" ? {
        x: Math.max(0, Math.min(1, Number(entry.source.x) || 0)),
        y: Math.max(0, Math.min(1, Number(entry.source.y) || 0)),
        w: Math.max(0.01, Math.min(1, Number(entry.source.w) || 0.25)),
        h: Math.max(0.01, Math.min(1, Number(entry.source.h) || 0.25)),
      } : { x: 0, y: 0, w: 0.25, h: 0.25 };
      return points.length >= 2 ? [{ ...base, source }] : [];
    }
    return [{ ...base }];
  });
}

function sanitizeWorkspace(value) {
  const source = value && typeof value === "object" ? value : {};
  const macroIds = new Set();
  const macros = Array.isArray(source.macros) ? source.macros.slice(0, MAX_MACROS).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const text = shortText(entry.text, 512);
    const hotkey = shortText(entry.hotkey, 80);
    if (!text || !hotkey) return [];
    return [{
      id: uniqueSafeId(entry.id, macroIds),
      label: shortText(entry.label, 80) || text,
      hotkey,
      text,
      enabled: Boolean(entry.enabled),
      scope: ["poe1", "poe2", "both"].includes(entry.scope) ? entry.scope : "poe1",
    }];
  }) : [];
  const cheatSheetIds = new Set();
  const cheatSheets = Array.isArray(source.cheatSheets) ? source.cheatSheets.slice(0, MAX_SHEETS).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const title = shortText(entry.title, 100);
    if (!title) return [];
    const url = shortText(entry.url, 2048);
    if (url && !standardHttpsUrl(url)) return [];
    const image = safeInlineImage(entry.image);
    return [{
      id: uniqueSafeId(entry.id, cheatSheetIds),
      title,
      category: shortText(entry.category, 80) || "General",
      body: String(entry.body || "").replace(/\0/g, "").slice(0, 20_000),
      url,
      image,
      pinned: Boolean(entry.pinned),
    }];
  }) : [];
  const theme = source.theme && typeof source.theme === "object" ? source.theme : {};
  const pluginIds = new Set();
  return {
    version: 1,
    macros,
    cheatSheets,
    theme: {
      accent: /^#[0-9a-f]{6}$/i.test(theme.accent) ? theme.accent : "#35d9b5",
      background: /^#[0-9a-f]{6}$/i.test(theme.background) ? theme.background : "#080f14",
      density: theme.density === "comfortable" ? "comfortable" : "compact",
    },
    whiteboard: {
      strokes: sanitizeBoardElements(source.whiteboard?.strokes),
      snapshots: Array.isArray(source.whiteboard?.snapshots) ? source.whiteboard.snapshots.slice(-MAX_BOARD_SNAPSHOTS).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const name = shortText(entry.name, 100);
        if (!name) return [];
        return [{ id: safeId(entry.id), name, createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(), strokes: sanitizeBoardElements(entry.strokes) }];
      }) : [],
    },
    overlayBounds: {
      ...(sanitizeOverlayBounds(source.overlayBounds?.cheats) ? { cheats: sanitizeOverlayBounds(source.overlayBounds.cheats) } : {}),
      ...(sanitizeOverlayBounds(source.overlayBounds?.whiteboard) ? { whiteboard: sanitizeOverlayBounds(source.overlayBounds.whiteboard) } : {}),
    },
    stashScroll: {
      enabled: Boolean(source.stashScroll?.enabled),
      modifier: ["Ctrl", "Shift", "Alt"].includes(source.stashScroll?.modifier) ? source.stashScroll.modifier : "Ctrl",
    },
    plugins: Array.isArray(source.plugins) ? source.plugins.slice(0, 20).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const name = shortText(entry.name, 80);
      const url = shortText(entry.url, 2048);
      if (!name || (url && !standardHttpsUrl(url))) return [];
      return [{
        id: uniqueSafeId(entry.id, pluginIds),
        name,
        url,
        enabled: Boolean(entry.enabled && url),
        game: entry.game === "poe2" ? "poe2" : "poe1",
        permissions: {
          currentItem: Boolean(entry.permissions?.currentItem),
          gameCapture: Boolean(entry.permissions?.gameCapture),
          openExternal: Boolean(entry.permissions?.openExternal),
        },
        storage: sanitizePluginStorage(entry.storage),
      }];
    }) : [],
  };
}

function standardHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

function createToolkitRuntimeStore(userDataDirectory) {
  const filePath = path.join(userDataDirectory, "toolkit-workspace.json");
  let current = sanitizeWorkspace({});
  let loadFailure = null;

  function failureMessage(error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `The toolkit workspace could not be loaded: ${detail}`;
  }

  function load() {
    current = sanitizeWorkspace({});
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("the workspace path is not a regular file");
      }
      if (stat.size > MAX_WORKSPACE_BYTES) {
        throw new Error("the workspace exceeds the 2 MB safety limit");
      }
      const bytes = fs.readFileSync(filePath);
      if (bytes.length > MAX_WORKSPACE_BYTES) {
        throw new Error("the workspace exceeds the 2 MB safety limit");
      }
      const parsed = JSON.parse(bytes.toString("utf8"));
      assertWorkspaceImageBudgets(parsed);
      current = sanitizeWorkspace(parsed);
      loadFailure = null;
    } catch (error) {
      if (error?.code === "ENOENT") loadFailure = null;
      else loadFailure = failureMessage(error);
    }
    return current;
  }

  function save(value) {
    if (loadFailure) {
      throw new Error(`${loadFailure}. Recover it explicitly before saving a new workspace.`);
    }
    assertWorkspaceImageBudgets(value);
    const next = sanitizeWorkspace(value);
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized, "utf8") > MAX_WORKSPACE_BYTES) {
      throw new Error("The toolkit workspace exceeds the 2 MB safety limit. Remove some images before saving.");
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, serialized, "utf8");
      fs.renameSync(temporary, filePath);
    } finally {
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch {
        // A failed cleanup must not hide the original atomic-write error.
      }
    }
    current = next;
    return current;
  }

  function recover() {
    if (!loadFailure) return { workspace: current, backupName: null };
    let sourceExists = true;
    try {
      fs.lstatSync(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") sourceExists = false;
      else throw error;
    }
    const backupPath = sourceExists
      ? `${filePath}.recovered-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}.bak`
      : null;
    if (backupPath) fs.renameSync(filePath, backupPath);
    loadFailure = null;
    current = sanitizeWorkspace({});
    try {
      return {
        workspace: save(current),
        backupName: backupPath ? path.basename(backupPath) : null,
      };
    } catch (error) {
      loadFailure = failureMessage(error);
      throw error;
    }
  }

  function get() {
    return current;
  }

  function error() {
    return loadFailure;
  }

  return { filePath, get, load, save, recover, error };
}

module.exports = {
  MAX_INLINE_IMAGE_CHARS,
  MAX_WORKSPACE_BYTES,
  assertWorkspaceImageBudgets,
  createToolkitRuntimeStore,
  sanitizeBoardElements,
  sanitizeOverlayBounds,
  sanitizePluginStorage,
  sanitizeWorkspace,
};
