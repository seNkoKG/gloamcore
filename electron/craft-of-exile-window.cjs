"use strict";

const {
  AD_BLOCK_LOAD_TIMEOUT_MS,
  loadWealthyExileAdBlocker,
} = require("./wealthy-exile-window.cjs");

const CRAFT_OF_EXILE_URL = "https://beta.craftofexile.com/?game=poe1";
const CRAFT_OF_EXILE_PARTITION = "persist:gloamcore-craft-of-exile";
const CRAFT_OF_EXILE_LOAD_TIMEOUT_MS = 30_000;

const CRAFT_OF_EXILE_HOSTS = new Set([
  "beta.craftofexile.com",
  "craftofexile.com",
  "www.craftofexile.com",
]);
const CRAFT_OF_EXILE_AUTH_HOSTS = new Set([
  "patreon.com",
  "www.patreon.com",
]);
const CRAFT_OF_EXILE_EXTERNAL_HOSTS = new Set([
  "arpg.info",
  "discord.gg",
  "poe-vault.com",
  "poe.ninja",
  "pohx.net",
  "www.arpg.info",
  "www.pathofexile.com",
  "www.poe-vault.com",
  "www.poewiki.net",
  "www.pohx.net",
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
]);
const configuredSessions = new WeakSet();
const sessionAdBlockers = new WeakMap();

function strictHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      (url.port !== "" && url.port !== "443") ||
      url.username ||
      url.password
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function isCraftOfExileUrl(value) {
  const url = strictHttpsUrl(value);
  return Boolean(url && CRAFT_OF_EXILE_HOSTS.has(url.hostname));
}

function allowedNavigationUrl(value) {
  const url = strictHttpsUrl(value);
  if (!url) return null;
  if (CRAFT_OF_EXILE_HOSTS.has(url.hostname)) return url;
  if (CRAFT_OF_EXILE_AUTH_HOSTS.has(url.hostname)) return url;
  return null;
}

function allowedExternalUrl(value) {
  const url = strictHttpsUrl(value);
  return url && CRAFT_OF_EXILE_EXTERNAL_HOSTS.has(url.hostname) ? url : null;
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

function canWriteClipboard(permission, value) {
  return permission === "clipboard-sanitized-write" && isCraftOfExileUrl(value);
}

function shouldBlockAds(value) {
  return isCraftOfExileUrl(value);
}

function loadCraftOfExileAdBlocker(session, dependencies = {}) {
  return loadWealthyExileAdBlocker(session, {
    ...dependencies,
    cacheLabel: "Craft of Exile",
  });
}

function syncAdBlocking(blocker, session, value) {
  const shouldEnable = shouldBlockAds(value);
  if (blocker.isBlockingEnabled(session) === shouldEnable) return;
  if (shouldEnable) blocker.enableBlockingInSession(session);
  else blocker.disableBlockingInSession(session);
}

function getSessionAdBlocker(session, loadAdBlocker, timeoutMs) {
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
    if (sessionAdBlockers.get(session) === pending) {
      sessionAdBlockers.delete(session);
    }
  });
  return pending;
}

function createCraftOfExileView({
  WebContentsView,
  openExternal = () => undefined,
  loadAdBlocker = loadCraftOfExileAdBlocker,
  adBlockTimeoutMs = AD_BLOCK_LOAD_TIMEOUT_MS,
  loadTimeoutMs = CRAFT_OF_EXILE_LOAD_TIMEOUT_MS,
}) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: true,
      partition: CRAFT_OF_EXILE_PARTITION,
    },
  });

  view.setBackgroundColor("#080b10");
  view.setBorderRadius(8);
  view.setVisible(false);
  const contents = view.webContents;
  const session = contents.session;
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
  view.craftOfExileReady = ready;
  contents.once("did-finish-load", () => settleReady(true));
  contents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame !== false) settleReady(false);
  });

  const openAllowedExternal = (value) => {
    const url = allowedExternalUrl(value);
    if (!url) return false;
    void Promise.resolve(openExternal(url.toString())).catch(() => undefined);
    return true;
  };
  const navigate = (value) => {
    const url = allowedNavigationUrl(value);
    if (!url) return openAllowedExternal(value);
    if (adBlocker) syncAdBlocking(adBlocker, session, url);
    void contents.loadURL(url.toString()).catch(() => undefined);
    return true;
  };
  const guardNavigation = (event, value) => {
    const url = allowedNavigationUrl(value);
    if (url) {
      if (adBlocker) syncAdBlocking(adBlocker, session, url);
      return;
    }
    event.preventDefault();
    openAllowedExternal(value);
  };

  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    navigate(url);
    return { action: "deny" };
  });
  session.setPermissionCheckHandler(
    (requestingContents, permission, requestingOrigin, details) =>
      requestingContents === contents &&
      canWriteClipboard(permission, details?.requestingUrl || requestingOrigin),
  );
  session.setPermissionRequestHandler(
    (requestingContents, permission, callback, details) => callback(
      requestingContents === contents &&
      canWriteClipboard(permission, details?.requestingUrl),
    ),
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
      navigate(CRAFT_OF_EXILE_URL);
    })
    .catch((cause) => {
      console.warn("Craft of Exile ad blocking unavailable:", cause);
      if (!contents.isDestroyed()) navigate(CRAFT_OF_EXILE_URL);
    });
  return view;
}

module.exports = {
  CRAFT_OF_EXILE_LOAD_TIMEOUT_MS,
  CRAFT_OF_EXILE_PARTITION,
  CRAFT_OF_EXILE_URL,
  allowedExternalUrl,
  allowedNavigationUrl,
  canWriteClipboard,
  createCraftOfExileView,
  fitViewBounds,
  isCraftOfExileUrl,
  loadCraftOfExileAdBlocker,
  shouldBlockAds,
  syncAdBlocking,
};
