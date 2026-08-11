"use strict";

const { randomBytes, createHash } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkcePair() {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

const GGG_AUTHORIZE_ENDPOINT = "https://www.pathofexile.com/oauth/authorize";
const GGG_TOKEN_ENDPOINT = "https://www.pathofexile.com/oauth/token";
const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_REDIRECT_PORT = 52798;
const DEFAULT_SCOPE = "account:stashes account:characters";
const AUTHORIZE_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

function pathValue(value) {
  return typeof value === "function" ? value() : value;
}

function credentialsError() {
  return new Error(
    "Path of Exile OAuth credentials are missing. Put your GGG client id and secret in oauth-credentials.json next to the app (see oauth-credentials.example.json).",
  );
}

function readCredentials(credentialsPath) {
  const resolved = pathValue(credentialsPath);
  if (!resolved) throw credentialsError();
  let raw;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch {
    throw credentialsError();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("oauth-credentials.json is not valid JSON.");
  }
  const clientId = String(parsed?.clientId || "").trim();
  const clientSecret = String(parsed?.clientSecret || "").trim();
  if (!clientId || /example/i.test(clientId)) {
    throw credentialsError();
  }
  const redirectPort = Number.isInteger(parsed?.redirectPort) ? parsed.redirectPort : DEFAULT_REDIRECT_PORT;
  if (redirectPort < 1024 || redirectPort > 65535) {
    throw new Error("oauth-credentials.json redirectPort must be between 1024 and 65535.");
  }
  return { clientId, clientSecret, redirectPort };
}

function redirectUri(port) {
  return `http://${LOOPBACK_HOST}:${port}/callback`;
}

function formEncode(params) {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function normalizedSession(payload) {
  const accessToken = String(payload?.access_token || "");
  if (!accessToken) throw new Error("Path of Exile did not return an access token.");
  return {
    accessToken,
    refreshToken: String(payload?.refresh_token || ""),
    scope: String(payload?.scope || ""),
    username: String(payload?.username || ""),
    expiresAt: Number.isFinite(payload?.expires_in) ? Date.now() + payload.expires_in * 1000 : 0,
  };
}

function publicSession(session) {
  return {
    scope: session.scope,
    username: session.username || "",
    expiresAt: session.expiresAt || null,
  };
}

async function startLoopbackListener({ port, state }) {
  let settle;
  let settled = false;
  const callbackPromise = new Promise((resolve) => {
    settle = resolve;
  });
  const server = http.createServer((request, response) => {
    if (!request.url || !request.url.startsWith("/callback")) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const url = new URL(request.url, `http://${LOOPBACK_HOST}`);
    const outcome = {
      code: url.searchParams.get("code") || "",
      state: url.searchParams.get("state") || "",
      error: url.searchParams.get("error") || "",
    };
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      '<!doctype html><meta charset="utf-8"><title>GloamCore</title><body style="font-family:system-ui;background:#0b1016;color:#e8f2f0;display:grid;place-items:center;height:100vh;margin:0"><p>Connected! You can close this window and return to GloamCore.</p></body>',
    );
    if (!settled) {
      settled = true;
      settle(outcome);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: LOOPBACK_HOST, port }, resolve);
  });
  return {
    port: server.address()?.port || port,
    callback: callbackPromise,
    close() {
      try {
        server.close();
      } catch {
        // already closed
      }
    },
  };
}

function createPoeOAuthService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const credentialsPath = options.credentialsPath;
  const storagePath = options.storagePath;
  const startListener = options.startCallbackListener || startLoopbackListener;
  const createWindow = options.createAuthWindow;
  const userAgent = options.userAgent || "GloamCore";

  function loadStoredSession() {
    const resolved = pathValue(storagePath);
    if (!resolved) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
      if (parsed && typeof parsed.accessToken === "string" && parsed.accessToken) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  function saveStoredSession(session) {
    const resolved = pathValue(storagePath);
    if (!resolved) return;
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(session, null, 2), { mode: 0o600 });
  }

  function clearStoredSession() {
    const resolved = pathValue(storagePath);
    if (!resolved) return;
    try {
      fs.unlinkSync(resolved);
    } catch {
      // already absent
    }
  }

  async function tokenRequest(params) {
    const credentials = readCredentials(credentialsPath);
    const redirect = redirectUri(params.port || credentials.redirectPort);
    const body = formEncode({
      grant_type: params.grantType,
      client_id: credentials.clientId,
      ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {}),
      ...(params.code
        ? { code: params.code, redirect_uri: redirect, ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}) }
        : {}),
      ...(params.refreshToken ? { refresh_token: params.refreshToken } : {}),
    });
    const response = await fetchImpl(GGG_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      body,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // non-JSON token response
    }
    if (!response.ok) {
      const detail =
        payload && typeof payload.error_description === "string"
          ? payload.error_description
          : payload && typeof payload.error === "string"
            ? payload.error
            : `Path of Exile returned ${response.status} for the token request.`;
      throw new Error(detail);
    }
    return normalizedSession(payload);
  }

  async function exchangeAuthorizationCode(code, port, codeVerifier) {
    const session = await tokenRequest({ grantType: "authorization_code", code, port, codeVerifier });
    saveStoredSession(session);
    return session;
  }

  async function refreshStoredSession() {
    const stored = loadStoredSession();
    if (!stored || !stored.refreshToken) {
      throw new Error("There is no refresh token; connect Path of Exile again.");
    }
    const refreshed = await tokenRequest({ grantType: "refresh_token", refreshToken: stored.refreshToken });
    const combined = { ...refreshed, refreshToken: refreshed.refreshToken || stored.refreshToken };
    saveStoredSession(combined);
    return combined;
  }

  function authStatus() {
    const stored = loadStoredSession();
    return stored
      ? { connected: true, scope: stored.scope || "", username: stored.username || "" }
      : { connected: false, scope: "", username: "" };
  }

  async function authorize(rawOptions) {
    const options = rawOptions || {};
    const credentials = readCredentials(credentialsPath);
    const scope = String(options.scope || DEFAULT_SCOPE).trim();
    const state = randomBytes(16).toString("hex");
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const listener = await startListener({ port: options.port || credentials.redirectPort, state });
    const redirect = redirectUri(listener.port);
    const authorizeUrl = `${GGG_AUTHORIZE_ENDPOINT}?client_id=${encodeURIComponent(
      credentials.clientId,
    )}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}&redirect_uri=${encodeURIComponent(
      redirect,
    )}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;
    if (typeof createWindow !== "function") {
      listener.close();
      throw new Error("OAuth window support is unavailable in this environment.");
    }
    const windowSession = createWindow({ url: authorizeUrl });
    if (!windowSession || typeof windowSession.closed?.then !== "function") {
      listener.close();
      throw new Error("The OAuth window failed to open.");
    }
    let outcome;
    try {
      outcome = await Promise.race([
        listener.callback,
        windowSession.closed.then(() => {
          if (outcome) return undefined;
          throw new Error("The authorization window was closed before connecting.");
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("The Path of Exile authorization request timed out.")), AUTHORIZE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      listener.close();
      if (typeof windowSession.close === "function") {
        try {
          windowSession.close();
        } catch {
          // already closed
        }
      }
    }
    if (!outcome) throw new Error("The authorization window was closed before connecting.");
    if (outcome.error) {
      if (outcome.error === "access_denied") {
        throw new Error("You declined the Path of Exile connection.");
      }
      throw new Error(`Path of Exile authorization failed: ${outcome.error}`);
    }
    if (outcome.state !== state) {
      throw new Error("Path of Exile authorization state did not match; try again.");
    }
    const session = await exchangeAuthorizationCode(outcome.code, listener.port, codeVerifier);
    return publicSession(session);
  }

  async function runWithFreshToken(run) {
    const stored = loadStoredSession();
    if (!stored) throw new Error("Connect Path of Exile first; the linked account is required.");
    let session = stored;
    if (session.expiresAt && Date.now() > session.expiresAt - REFRESH_MARGIN_MS) {
      session = await refreshStoredSession();
    }
    try {
      return await run(session.accessToken);
    } catch (cause) {
      if (cause && cause.status === 401 && session.refreshToken) {
        session = await refreshStoredSession();
        return await run(session.accessToken);
      }
      throw cause;
    }
  }

  return {
    authorize,
    authStatus,
    clearStoredSession,
    exchangeAuthorizationCode,
    loadStoredSession,
    refreshStoredSession,
    runWithFreshToken,
  };
}

module.exports = {
  createPoeOAuthService,
  formEncode,
  normalizedSession,
  readCredentials,
  redirectUri,
  startLoopbackListener,
};
