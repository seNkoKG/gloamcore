"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const WEALTHY_EXILE_URL = "https://wealthyexile.com/stash";
const WEALTHY_EXILE_PARTITION = "persist:gloamcore-wealthy-exile";
const AD_BLOCK_CACHE_FILE = "ads-only.bin";
const AD_BLOCK_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AD_BLOCK_LOAD_TIMEOUT_MS = 10_000;
const WEALTHY_EXILE_LOAD_TIMEOUT_MS = 30_000;
const configuredSessions = new WeakSet();
const sessionAdBlockers = new WeakMap();
const WEALTHY_EXILE_AD_CLEANUP_CSS = `
  #wealthy-exile-nitro-ad-left,
  #wealthy-exile-nitro-ad-right,
  [id^="google_ads_iframe_"][id$="__container__"],
  iframe[id^="google_ads_iframe_"],
  iframe[aria-label="Advertisement"],
  body *:has(> #wealthy-exile-nitro-ad-left),
  body *:has(> #wealthy-exile-nitro-ad-right) {
    display: none !important;
    visibility: hidden !important;
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    height: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    overflow: hidden !important;
  }
`;
const WEALTHY_EXILE_AD_CLEANUP_SCRIPT = `(() => {
  const styleId = "gloamcore-wealthy-exile-ad-cleanup";
  const css = ${JSON.stringify(WEALTHY_EXILE_AD_CLEANUP_CSS)};
  const install = () => {
    if (!document.documentElement || document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = css;
    document.documentElement.appendChild(style);
  };
  install();
  if (!window.__gloamcoreWealthyExileAdObserver) {
    const observer = new MutationObserver(install);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__gloamcoreWealthyExileAdObserver = observer;
  }
  return true;
})()`;

function allowedNavigationUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      (url.port !== "" && url.port !== "443") ||
      url.username ||
      url.password
    ) return null;
    if (url.hostname === "wealthyexile.com") return url;
    if (url.hostname === "pathofexile.com" || url.hostname === "www.pathofexile.com") return url;
    if (url.hostname === "steamcommunity.com") return url;
    return null;
  } catch {
    return null;
  }
}

function fitViewBounds(value, container) {
  if (!value || typeof value !== "object" || !container) return null;
  const numbers = [value.x, value.y, value.width, value.height, container.width, container.height];
  if (!numbers.every(Number.isFinite)) return null;
  const left = Math.max(0, Math.round(value.x));
  const top = Math.max(0, Math.round(value.y));
  const right = Math.min(Math.round(container.width), Math.round(value.x + value.width));
  const bottom = Math.min(Math.round(container.height), Math.round(value.y + value.height));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function shouldBlockAds(value) {
  return allowedNavigationUrl(value)?.hostname === "wealthyexile.com";
}

function installWealthyExileAdCleanup(contents) {
  const inject = () => {
    if (contents.isDestroyed?.() || !shouldBlockAds(contents.getURL?.())) return;
    void contents.executeJavaScript(WEALTHY_EXILE_AD_CLEANUP_SCRIPT, true)
      .catch((cause) => console.warn("Wealthy Exile ad cleanup unavailable:", cause));
  };
  contents.on("dom-ready", inject);
  contents.on("did-finish-load", inject);
  return inject;
}

async function loadWealthyExileAdBlocker(session, dependencies = {}) {
  const ElectronBlocker = dependencies.ElectronBlocker
    || require("@ghostery/adblocker-electron").ElectronBlocker;
  const readFile = dependencies.readFile || fs.readFile;
  const writeFile = dependencies.writeFile || fs.writeFile;
  const stat = dependencies.stat || fs.stat;
  const mkdir = dependencies.mkdir || fs.mkdir;
  const now = dependencies.now || Date.now;
  const cachePath = session.storagePath
    ? path.join(session.storagePath, AD_BLOCK_CACHE_FILE)
    : null;
  let cached = null;
  let cacheFresh = false;

  if (cachePath) {
    try {
      const [serialized, cacheStat] = await Promise.all([readFile(cachePath), stat(cachePath)]);
      cached = ElectronBlocker.deserialize(serialized);
      cacheFresh = now() - cacheStat.mtimeMs < AD_BLOCK_CACHE_MAX_AGE_MS;
    } catch {
      cached = null;
    }
  }
  if (cached && cacheFresh) return cached;

  try {
    const blocker = await ElectronBlocker.fromPrebuiltAdsOnly(dependencies.fetchImpl);
    if (cachePath) {
      try {
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, blocker.serialize());
      } catch (cause) {
        console.warn(
          `Unable to cache ${dependencies.cacheLabel || "Wealthy Exile"} ad filters:`,
          cause,
        );
      }
    }
    return blocker;
  } catch (cause) {
    if (cached) return cached;
    throw cause;
  }
}

function syncAdBlocking(blocker, session, value) {
  const shouldEnable = shouldBlockAds(value);
  if (blocker.isBlockingEnabled(session) === shouldEnable) return;
  if (shouldEnable) blocker.enableBlockingInSession(session);
  else blocker.disableBlockingInSession(session);
}

function getSessionAdBlocker(session, loadAdBlocker, timeoutMs = AD_BLOCK_LOAD_TIMEOUT_MS) {
  const existing = sessionAdBlockers.get(session);
  if (existing) return existing;
  let timeout;
  const pending = Promise.race([
    Promise.resolve().then(() => loadAdBlocker(session)),
    new Promise((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("ad filter loading timed out")),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timeout));
  sessionAdBlockers.set(session, pending);
  void pending.catch(() => {
    if (sessionAdBlockers.get(session) === pending) sessionAdBlockers.delete(session);
  });
  return pending;
}

function createWealthyExileView({
  WebContentsView,
  loadAdBlocker = loadWealthyExileAdBlocker,
  adBlockTimeoutMs = AD_BLOCK_LOAD_TIMEOUT_MS,
  loadTimeoutMs = WEALTHY_EXILE_LOAD_TIMEOUT_MS,
}) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: WEALTHY_EXILE_PARTITION,
    },
  });

  view.setBackgroundColor("#080b10");
  view.setBorderRadius(8);
  view.setVisible(false);
  const contents = view.webContents;
  const session = contents.session;
  installWealthyExileAdCleanup(contents);
  let adBlocker = null;
  let settleReady;
  let readyTimer;
  const ready = new Promise((resolve) => {
    settleReady = (value) => {
      clearTimeout(readyTimer);
      resolve(value);
    };
  });
  readyTimer = setTimeout(() => settleReady(false), loadTimeoutMs);
  readyTimer.unref?.();
  view.wealthyExileReady = ready;
  contents.once("did-finish-load", () => settleReady(true));
  contents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame !== false) settleReady(false);
  });
  const navigate = (value) => {
    const url = allowedNavigationUrl(value);
    if (!url) return false;
    if (adBlocker) syncAdBlocking(adBlocker, session, url);
    void contents.loadURL(url.toString()).catch(() => undefined);
    return true;
  };
  const guardNavigation = (event, value) => {
    const url = allowedNavigationUrl(value);
    if (!url) {
      event.preventDefault();
      return;
    }
    if (adBlocker) syncAdBlocking(adBlocker, session, url);
  };

  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    navigate(url);
    return { action: "deny" };
  });
  session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  if (!configuredSessions.has(session)) {
    configuredSessions.add(session);
    session.on("will-download", (event) => event.preventDefault());
    session.cookies.on("changed", () => {
      void session.cookies.flushStore().catch(() => undefined);
    });
  }
  getSessionAdBlocker(session, loadAdBlocker, adBlockTimeoutMs)
    .then((blocker) => {
      if (contents.isDestroyed()) return;
      adBlocker = blocker;
      navigate(WEALTHY_EXILE_URL);
    })
    .catch((cause) => {
      console.warn("Wealthy Exile ad blocking unavailable:", cause);
      if (!contents.isDestroyed()) navigate(WEALTHY_EXILE_URL);
    });
  return view;
}

module.exports = {
  AD_BLOCK_CACHE_MAX_AGE_MS,
  AD_BLOCK_LOAD_TIMEOUT_MS,
  WEALTHY_EXILE_LOAD_TIMEOUT_MS,
  WEALTHY_EXILE_AD_CLEANUP_CSS,
  WEALTHY_EXILE_AD_CLEANUP_SCRIPT,
  WEALTHY_EXILE_PARTITION,
  WEALTHY_EXILE_URL,
  allowedNavigationUrl,
  createWealthyExileView,
  fitViewBounds,
  installWealthyExileAdCleanup,
  loadWealthyExileAdBlocker,
  shouldBlockAds,
  syncAdBlocking,
};
