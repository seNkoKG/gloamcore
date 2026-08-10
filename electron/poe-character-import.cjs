const { version: APP_VERSION } = require("../package.json");

const MAX_JSON_BYTES = 24 * 1024 * 1024;
const REALMS = new Set(["pc", "xbox", "sony", "poe2"]);

function cleanText(value, label, maximum = 128) {
  const text = String(value || "").replace(/[\0\r\n]/g, "").trim();
  if (!text || text.length > maximum) throw new Error(`${label} is missing or too long.`);
  return text;
}

function realmPath(realm) {
  return realm === "pc" ? "" : `/${realm}`;
}

function validatedRequest(request, needsCharacter = false) {
  const realm = String(request?.realm || "pc").toLowerCase();
  if (!REALMS.has(realm)) throw new Error("Unsupported Path of Exile realm.");
  const mode = request?.mode === "oauth" ? "oauth" : "public";
  if (realm === "poe2" && mode === "public") {
    throw new Error("PoE 2 character data is available only through the official OAuth character API.");
  }
  const accessToken = mode === "oauth" ? cleanText(request?.accessToken, "OAuth access token", 4096) : "";
  const accountName = mode === "public" ? cleanText(request?.accountName, "Account name") : "";
  const character = needsCharacter ? cleanText(request?.character, "Character name") : "";
  return { realm, mode, accessToken, accountName, character };
}

function httpError(status, label) {
  const error = new Error(label);
  error.status = status;
  return error;
}

async function readJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error("Character response is too large.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_JSON_BYTES) throw new Error("Character response is too large.");
  if (!response.ok) {
    if (response.status === 401) throw httpError(401, "Character authorization expired or is invalid.");
    if (response.status === 403) throw httpError(403, "The profile is private or the token lacks account:characters access.");
    if (response.status === 404) throw httpError(404, "The account or character was not found.");
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      throw httpError(429, `Path of Exile rate limit reached${retry ? `; retry in ${retry} seconds` : ""}.`);
    }
    throw httpError(response.status, `Path of Exile character request failed (${response.status}).`);
  }
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("Path of Exile returned invalid character data.");
  }
}

function createPoeCharacterService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const userAgent = options.userAgent || `Ninja-Lens/${APP_VERSION}`;
  const cache = new Map();

  async function requestJson(url, accessToken = "", ttl = 30_000) {
    // Never retain authenticated account responses. A shared `oauth` cache key
    // can return one account's private character data to a later token, while a
    // token-derived key would still retain credential identity in process state.
    // Public profile requests remain safely cacheable because the account is
    // already part of their URL.
    const key = accessToken ? "" : url;
    const cached = key ? cache.get(key) : null;
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
    const value = await readJson(response);
    if (key) cache.set(key, { value, expiresAt: Date.now() + ttl });
    return value;
  }

  async function listCharacters(rawRequest) {
    const request = validatedRequest(rawRequest);
    if (request.mode === "oauth") {
      const url = `https://api.pathofexile.com/character${realmPath(request.realm)}`;
      const data = await requestJson(url, request.accessToken);
      return Array.isArray(data?.characters) ? data.characters : [];
    }
    const query = new URLSearchParams({ accountName: request.accountName, realm: request.realm });
    const data = await requestJson(`https://www.pathofexile.com/character-window/get-characters?${query}`);
    if (!Array.isArray(data)) throw new Error("The public account returned no character list.");
    return data;
  }

  async function getCharacter(rawRequest) {
    const request = validatedRequest(rawRequest, true);
    if (request.mode === "oauth") {
      const url = `https://api.pathofexile.com/character${realmPath(request.realm)}/${encodeURIComponent(request.character)}`;
      const data = await requestJson(url, request.accessToken, 60_000);
      if (!data?.character) throw new Error("The official API returned no character.");
      return data.character;
    }
    const query = new URLSearchParams({
      accountName: request.accountName,
      character: request.character,
      realm: request.realm,
    });
    const [passives, items] = await Promise.all([
      requestJson(`https://www.pathofexile.com/character-window/get-passive-skills?${query}`, "", 60_000),
      requestJson(`https://www.pathofexile.com/character-window/get-items?${query}`, "", 60_000),
    ]);
    return {
      name: request.character,
      realm: request.realm,
      class: items.character?.class || items.character?.className || "Scion",
      league: items.character?.league || "",
      level: Number(items.character?.level) || 1,
      equipment: Array.isArray(items.items) ? items.items : [],
      jewels: Array.isArray(passives.items) ? passives.items : [],
      passives,
      metadata: { source: "public-profile" },
    };
  }

  return { getCharacter, listCharacters };
}

module.exports = { createPoeCharacterService, validatedRequest };
