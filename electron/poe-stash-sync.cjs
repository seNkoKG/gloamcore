const { version: APP_VERSION } = require("../package.json");

const MAX_JSON_BYTES = 24 * 1024 * 1024;
const REALMS = new Set(["pc", "xbox", "sony"]);
const TAB_PACE_MS = 150;
const LEAGUES_TTL_MS = 60 * 60 * 1000;

function cleanText(value, label, maximum = 128) {
  const text = String(value || "").replace(/[\0\r\n]/g, "").trim();
  if (!text || text.length > maximum) throw new Error(`${label} is missing or too long.`);
  return text;
}

function realmPath(realm) {
  return realm === "pc" ? "" : `/${realm}`;
}

function validatedStashRequest(request) {
  const realm = String(request?.realm || "pc").toLowerCase();
  if (!REALMS.has(realm)) throw new Error("Unsupported Path of Exile realm.");
  const league = cleanText(request?.league, "League name");
  const accessToken = cleanText(request?.accessToken, "OAuth access token", 4096);
  return { realm, league, accessToken };
}

function httpError(status, label) {
  const error = new Error(label);
  error.status = status;
  return error;
}

async function readJson(response, label) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error(`${label} is too large.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_JSON_BYTES) throw new Error(`${label} is too large.`);
  if (!response.ok) {
    if (response.status === 401) throw httpError(401, "Stash authorization expired or is invalid.");
    if (response.status === 403) throw httpError(403, "The token lacks account:stashes access for this league.");
    if (response.status === 404) throw httpError(404, "The league or stash tab was not found.");
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      throw httpError(429, `Path of Exile rate limit reached${retry ? `; retry in ${retry} seconds` : ""}.`);
    }
    throw httpError(response.status, `Path of Exile stash request failed (${response.status}).`);
  }
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("Path of Exile returned invalid stash data.");
  }
}

function tabSummary(tab, path) {
  const name = cleanText(tab?.name, "Stash tab name", 256);
  const id = cleanText(tab?.id, "Stash tab id", 512);
  const index = Number.isFinite(Number(tab?.index)) ? Number(tab.index) : 0;
  const type = String(tab?.type || "StashTab");
  return { id, name, type, index, path };
}

function flattenLeafTabs(stashes, folderPath = []) {
  const leaves = [];
  for (const tab of Array.isArray(stashes) ? stashes : []) {
    if (!tab || typeof tab !== "object") continue;
    const children = Array.isArray(tab.children) ? tab.children : [];
    const isFolder = String(tab?.type || "") === "Folder";
    if (children.length > 0 || isFolder) {
      const folderName = cleanText(tab?.name || "Folder", "Stash tab name", 256);
      leaves.push(...flattenLeafTabs(children, [...folderPath, folderName]));
      continue;
    }
    if (!tab?.id) continue;
    leaves.push(tabSummary(tab, folderPath));
  }
  return leaves;
}

function createPoeStashSyncService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const userAgent = options.userAgent || `Ninja-Lens/${APP_VERSION}`;
  const leaguesCache = new Map();

  async function requestJson(url, accessToken = "") {
    // Never retain authenticated account responses: a shared `oauth` cache key
    // can return one account's private stash data to a later token, while a
    // token-derived key would still retain credential identity in process state.
    // Public league responses remain safely cacheable because they carry no
    // account data and the realm is already part of their URL.
    const key = accessToken ? "" : url;
    const cached = key ? leaguesCache.get(key) : null;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    const value = await readJson(response, accessToken ? "Stash response" : "League response");
    if (key) leaguesCache.set(key, { value, expiresAt: Date.now() + LEAGUES_TTL_MS });
    return value;
  }

  function leagueUrl(realm) {
    return `https://www.pathofexile.com/api/leagues?type=main&realm=${realm}`;
  }

  function stashUrl(realm, league) {
    return `https://api.pathofexile.com/stash${realmPath(realm)}/${encodeURIComponent(league)}`;
  }

  function stashTabUrl(realm, league, tabId) {
    return `${stashUrl(realm, league)}/${encodeURIComponent(tabId)}`;
  }

  async function getLeagues(rawRequest) {
    const realm = String(rawRequest?.realm || "pc").toLowerCase();
    if (!REALMS.has(realm)) throw new Error("Unsupported Path of Exile realm.");
    const data = await requestJson(leagueUrl(realm));
    if (!Array.isArray(data)) throw new Error("Path of Exile returned no league list.");
    return data
      .filter((entry) => entry && typeof entry.id === "string" && entry.id.length > 0)
      .map((entry) => ({ id: entry.id, name: entry.name || entry.id, realm }));
  }

  async function listStashTabs(rawRequest) {
    const request = validatedStashRequest(rawRequest);
    const data = await requestJson(stashUrl(request.realm, request.league), request.accessToken);
    const stashes = Array.isArray(data?.stashes) ? data.stashes : [];
    if (stashes.length === 0) {
      throw new Error("Path of Exile returned no stash tabs for this league. The account:stashes scope normally grants the first 15 tabs.");
    }
    return flattenLeafTabs(stashes);
  }

  async function getStashTab(rawRequest, rawTabId) {
    const request = validatedStashRequest(rawRequest);
    const tabId = cleanText(rawTabId, "Stash tab id", 512);
    const data = await requestJson(stashTabUrl(request.realm, request.league, tabId), request.accessToken);
    const stash = data?.stash;
    if (!stash || !Array.isArray(stash.items)) {
      throw new Error("The official API returned no stash tab contents.");
    }
    const summary = tabSummary(stash, []);
    return {
      id: summary.id,
      name: summary.name,
      type: summary.type,
      index: summary.index,
      items: stash.items,
    };
  }

  async function syncStash(rawRequest, handlers = {}) {
    const request = validatedStashRequest(rawRequest);
    const leaves = await listStashTabs(rawRequest);
    const total = leaves.length;
    const details = [];
    for (let index = 0; index < leaves.length; index += 1) {
      const leaf = leaves[index];
      const detail = await getStashTab(rawRequest, leaf.id);
      detail.path = leaf.path || [];
      details.push(detail);
      if (typeof handlers.onProgress === "function") {
        try {
          handlers.onProgress({
            index: index + 1,
            total,
            tabName: detail.name,
            path: leaf.path,
          });
        } catch {
          // Progress reporting must never fail a successful sync.
        }
      }
      // GGG applies dynamic per-account and per-client rate limits; keep the
      // per-tab fetches deliberately sequential and lightly paced.
      if (index < leaves.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, TAB_PACE_MS));
      }
    }
    return details;
  }

  return { getLeagues, getStashTab, listStashTabs, syncStash };
}

module.exports = { createPoeStashSyncService, flattenLeafTabs, validatedStashRequest };