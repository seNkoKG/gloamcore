const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { version: APP_VERSION } = require("../package.json");
const { readResponseBufferLimited } = require("./bounded-remote-fetch.cjs");

const MAX_TEXT_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BYTES = 384_000;
const IMAGE_MIME = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const SAFE_REMOTE_HOSTS = new Set([
  "pathofexile.com",
  "www.pathofexile.com",
  "pobb.in",
  "pastebin.com",
  "poedb.tw",
  "maxroll.gg",
  "www.maxroll.gg",
  "raw.githubusercontent.com",
]);
const FILTER_MODE_EXTENSIONS = Object.freeze({
  normal: ".filter",
  ruthless: ".ruthlessfilter",
});

function cleanText(value) {
  if (typeof value !== "string") throw new Error("Expected text content.");
  if (Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) {
    throw new Error("The selected text is too large.");
  }
  return value.replace(/\0/g, "");
}

function extensionFilters(kind) {
  if (kind === "filter") {
    return [
      { name: "Path of Exile filters", extensions: ["filter", "ruthlessfilter"] },
      { name: "Text files", extensions: ["txt"] },
    ];
  }
  if (kind === "build") {
    return [
      { name: "Path of Building XML", extensions: ["xml"] },
      { name: "GloamCore workspace", extensions: ["json"] },
      { name: "Text files", extensions: ["txt"] },
    ];
  }
  if (kind === "image") {
    return [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }];
  }
  return [{ name: "Text files", extensions: ["txt", "json", "xml", "filter", "ruthlessfilter"] }];
}

function assertFilterSaveTarget(filePath, request) {
  if (request?.kind !== "filter") return;
  const expectedExtension = FILTER_MODE_EXTENSIONS[request?.filterMode];
  if (!expectedExtension) {
    throw new Error("Filter saves require a normal or ruthless mode.");
  }
  if (path.extname(filePath).toLowerCase() !== expectedExtension) {
    const label = request.filterMode === "ruthless" ? "Ruthless" : "Normal";
    throw new Error(`${label} filters must be saved as ${expectedExtension}.`);
  }
}

function pathIdentity(filePath) {
  return crypto.createHash("sha256").update(filePath.toLowerCase()).digest("hex");
}

function assertRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Only regular files can be opened.");
  }
  if (stat.size > MAX_TEXT_BYTES) throw new Error("The selected file is too large.");
}

function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporary, cleanText(content), "utf8");
  fs.renameSync(temporary, filePath);
}

function checkpointDirectory(userDataDirectory, filePath) {
  return path.join(userDataDirectory, "toolkit-checkpoints", pathIdentity(filePath));
}

function checkpointName(label) {
  const safeLabel = String(label || "checkpoint")
    .replace(/[^a-z0-9_. -]+/gi, "-")
    .trim()
    .slice(0, 60) || "checkpoint";
  return `${new Date().toISOString().replace(/[:.]/g, "-")}--${safeLabel}.json`;
}

function supportedRemoteImportUrl(url) {
  return url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    SAFE_REMOTE_HOSTS.has(url.hostname.toLowerCase());
}

function createToolkitFileService({ dialog, userDataDirectory, fetchImpl = fetch }) {
  const authorisedPaths = new Set();

  async function openText(window, kind = "text") {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: extensionFilters(kind),
    });
    const selected = result.canceled ? undefined : result.filePaths[0];
    if (!selected) return null;
    const resolved = path.resolve(selected);
    assertRegularFile(resolved);
    authorisedPaths.add(resolved);
    return {
      path: resolved,
      name: path.basename(resolved),
      text: cleanText(fs.readFileSync(resolved, "utf8")),
    };
  }

  async function saveText(window, request) {
    const content = cleanText(request?.text);
    let target = request?.path ? path.resolve(String(request.path)) : "";
    let authoriseTarget = false;
    if (!target || !authorisedPaths.has(target)) {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: request?.suggestedName || "document.txt",
        filters: extensionFilters(request?.kind || "text"),
      });
      if (result.canceled || !result.filePath) return null;
      target = path.resolve(result.filePath);
      authoriseTarget = true;
    }
    assertFilterSaveTarget(target, request);
    if (authoriseTarget) authorisedPaths.add(target);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("The selected target is not a regular file.");
      }
    }
    atomicWrite(target, content);
    return { path: target, name: path.basename(target) };
  }

  async function openImage(window) {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: extensionFilters("image"),
    });
    const selected = result.canceled ? undefined : result.filePaths[0];
    if (!selected) return null;
    const resolved = path.resolve(selected);
    const stat = fs.lstatSync(resolved);
    const mime = IMAGE_MIME.get(path.extname(resolved).toLowerCase());
    if (!stat.isFile() || stat.isSymbolicLink() || !mime || stat.size > MAX_IMAGE_BYTES) {
      throw new Error("Choose a PNG, JPEG, WebP, or GIF image no larger than 375 KB.");
    }
    return {
      name: path.basename(resolved),
      dataUrl: `data:${mime};base64,${fs.readFileSync(resolved).toString("base64")}`,
    };
  }

  function createCheckpoint(request) {
    const target = path.resolve(String(request?.path || ""));
    if (!authorisedPaths.has(target)) throw new Error("Open the file before checkpointing it.");
    assertRegularFile(target);
    const directory = checkpointDirectory(userDataDirectory, target);
    fs.mkdirSync(directory, { recursive: true });
    const filename = checkpointName(request?.label);
    const record = {
      originalPath: target,
      label: String(request?.label || "Checkpoint").slice(0, 120),
      createdAt: Date.now(),
      text: request?.text == null
        ? cleanText(fs.readFileSync(target, "utf8"))
        : cleanText(request.text),
    };
    atomicWrite(path.join(directory, filename), JSON.stringify(record));
    return { ...record, id: filename, text: undefined };
  }

  function readCheckpoint(request) {
    const target = path.resolve(String(request?.path || ""));
    if (!authorisedPaths.has(target)) throw new Error("Open the file before reading its checkpoints.");
    const id = path.basename(String(request?.id || ""));
    if (!id.endsWith(".json")) throw new Error("Invalid checkpoint.");
    const recordPath = path.join(checkpointDirectory(userDataDirectory, target), id);
    assertRegularFile(recordPath);
    const parsed = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    if (parsed.originalPath !== target || typeof parsed.text !== "string") {
      throw new Error("Checkpoint does not belong to this file.");
    }
    return { path: target, name: path.basename(target), text: cleanText(parsed.text) };
  }

  function listCheckpoints(filePath) {
    const target = path.resolve(String(filePath || ""));
    if (!authorisedPaths.has(target)) return [];
    const directory = checkpointDirectory(userDataDirectory, target);
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8"));
          if (parsed.originalPath !== target || typeof parsed.text !== "string") return [];
          return [{ id: entry.name, label: parsed.label, createdAt: parsed.createdAt }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  function restoreCheckpoint(request) {
    const target = path.resolve(String(request?.path || ""));
    if (!authorisedPaths.has(target)) throw new Error("Open the file before restoring it.");
    const parsed = readCheckpoint(request);
    createCheckpoint({ path: target, label: "Before restore" });
    atomicWrite(target, parsed.text);
    return { path: target, name: path.basename(target), text: parsed.text };
  }

  async function fetchRemoteText(rawUrl) {
    const url = new URL(String(rawUrl || ""));
    if (!supportedRemoteImportUrl(url)) {
      throw new Error("That source is not on the supported import allowlist.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      let current = url;
      let response;
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        response = await fetchImpl(current, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": `GloamCore/${APP_VERSION}` },
        });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw new Error("The import redirected too many times.");
        const next = new URL(location, current);
        try {
          await response.body?.cancel();
        } catch {
          // The redirect body is irrelevant and may already be closed.
        }
        if (!supportedRemoteImportUrl(next)) {
          throw new Error("The import redirected to an unsupported host.");
        }
        current = next;
      }
      if (!response) throw new Error("The import returned no response.");
      const final = new URL(response.url || current);
      if (!supportedRemoteImportUrl(final)) throw new Error("The import redirected to an unsupported host.");
      if (!response.ok) throw new Error(`Import failed (${response.status}).`);
      const bytes = await readResponseBufferLimited(
        response,
        MAX_TEXT_BYTES,
        "Remote import",
        controller,
      );
      return cleanText(bytes.toString("utf8"));
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    openText,
    openImage,
    saveText,
    createCheckpoint,
    readCheckpoint,
    listCheckpoints,
    restoreCheckpoint,
    fetchRemoteText,
    _authoriseForTest(filePath) {
      authorisedPaths.add(path.resolve(filePath));
    },
  };
}

module.exports = {
  MAX_TEXT_BYTES,
  MAX_IMAGE_BYTES,
  SAFE_REMOTE_HOSTS,
  supportedRemoteImportUrl,
  createToolkitFileService,
};
