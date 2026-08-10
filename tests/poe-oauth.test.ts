import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  createPoeOAuthService,
  formEncode,
  normalizedSession,
  readCredentials,
  redirectUri,
} = require("../electron/poe-oauth.cjs");
const { createPoeStashSyncService } = require("../electron/poe-stash-sync.cjs");

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "poe-oauth-test-"));
}

function tokenJson(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      scope: "account:stashes account:characters",
      expires_in: 3600,
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function credentialsFile(dir: string, overrides: Record<string, unknown> = {}) {
  const file = path.join(dir, "oauth-credentials.json");
  writeFileSync(
    file,
    JSON.stringify({ clientId: "client-1", clientSecret: "secret-1", ...overrides }),
    "utf8",
  );
  return file;
}

describe("PoE OAuth credentials", () => {
  it("rejects missing or example placeholder credentials with a clear message", () => {
    const dir = tempDir();
    expect(() => readCredentials(path.join(dir, "missing.json"))).toThrow(/oauth-credentials\.json/);
    const placeholder = credentialsFile(dir, { clientId: "example-client-id" });
    expect(() => readCredentials(placeholder)).toThrow(/oauth-credentials\.json/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads real credentials and applies the default loopback port; secret is optional for public clients", () => {
    const dir = tempDir();
    const file = credentialsFile(dir);
    expect(readCredentials(file)).toEqual({ clientId: "client-1", clientSecret: "secret-1", redirectPort: 52798 });
    const noSecret = credentialsFile(dir, { clientSecret: "" });
    expect(readCredentials(noSecret).clientSecret).toBe("");
    const withPort = credentialsFile(dir, { redirectPort: 54200 });
    expect(readCredentials(withPort).redirectPort).toBe(54200);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects out-of-range redirect ports", () => {
    const dir = tempDir();
    const file = credentialsFile(dir, { redirectPort: 80 });
    expect(() => readCredentials(file)).toThrow(/redirectPort/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("PoE OAuth token exchange", () => {
  it("normalizes token payloads and rejects empty access tokens", () => {
    expect(normalizedSession({ access_token: "a", refresh_token: "r", scope: "s", expires_in: 60, username: "Nova#1234" })).toMatchObject({
      accessToken: "a",
      refreshToken: "r",
      scope: "s",
      username: "Nova#1234",
    });
    expect(() => normalizedSession({})).toThrow("access token");
  });

  it("exchanges an authorization code with PKCE fields and stores the session", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    const fetchImpl = vi.fn(async () => tokenJson({ username: "Nova#1234" }));
    const service = createPoeOAuthService({
      fetchImpl,
      credentialsPath: credentialsFile(dir),
      storagePath,
    });
    const session = await service.exchangeAuthorizationCode("the-code", 52798, "pkce-verifier-1");
    expect(session.scope).toContain("account:stashes");
    expect(session.username).toBe("Nova#1234");
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("client_id=client-1");
    expect(body).toContain("client_secret=secret-1");
    expect(body).toContain("code=the-code");
    expect(body).toContain("code_verifier=pkce-verifier-1");
    expect(body).toContain(encodeURIComponent(redirectUri(52798)));
    const stored = JSON.parse(require("node:fs").readFileSync(storagePath, "utf8"));
    expect(stored.accessToken).toBe("access-token");
    expect(stored.refreshToken).toBe("refresh-token");
    rmSync(dir, { recursive: true, force: true });
  });

  it("omits the client secret entirely for secret-less public clients", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    const fetchImpl = vi.fn(async () => tokenJson());
    const service = createPoeOAuthService({
      fetchImpl,
      credentialsPath: credentialsFile(dir, { clientSecret: "" }),
      storagePath,
    });
    await service.exchangeAuthorizationCode("the-code", 52798, "pkce-verifier-1");
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).not.toContain("client_secret");
    expect(body).toContain("code_verifier=pkce-verifier-1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("surfaces GGG error descriptions and refreshes with the refresh token", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "code already used" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return tokenJson({ access_token: "new-access" });
    });
    const service = createPoeOAuthService({
      fetchImpl,
      credentialsPath: credentialsFile(dir),
      storagePath,
    });
    await expect(service.exchangeAuthorizationCode("used-code")).rejects.toThrow("code already used");
    writeFileSync(storagePath, JSON.stringify({ accessToken: "old", refreshToken: "refresh-1", scope: "s", expiresAt: 0 }), "utf8");
    const refreshed = await service.refreshStoredSession();
    expect(refreshed.accessToken).toBe("new-access");
    const body = String(fetchImpl.mock.calls[1][1].body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=refresh-1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports oauth status from the stored session", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    const service = createPoeOAuthService({
      credentialsPath: credentialsFile(dir),
      storagePath,
    });
    expect(service.authStatus()).toEqual({ connected: false, scope: "", username: "" });
    writeFileSync(storagePath, JSON.stringify({ accessToken: "a", refreshToken: "r", scope: "account:stashes", username: "Nova#1234", expiresAt: 999 }), "utf8");
    expect(service.authStatus()).toEqual({ connected: true, scope: "account:stashes", username: "Nova#1234" });
    service.clearStoredSession();
    expect(service.authStatus().connected).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("PoE OAuth authorize flow", () => {
  function pendingWindow() {
    let resolveClose = () => undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    return {
      url: "",
      closed,
      close() {
        resolveClose();
      },
    };
  }

  it("opens the GGG authorize window, captures the code and stores the token", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    const windowHandle = pendingWindow();
    let capturedState = "";
    const startCallbackListener = vi.fn(async ({ state }: { state: string }) => {
      capturedState = state;
      return {
        port: 52798,
        callback: Promise.resolve({ code: "auth-code", state, error: "" }),
        close: vi.fn(),
      };
    });
    const createAuthWindow = vi.fn(({ url }: { url: string }) => {
      windowHandle.url = url;
      return windowHandle;
    });
    const fetchImpl = vi.fn(async () => tokenJson());
    const service = createPoeOAuthService({
      fetchImpl,
      credentialsPath: credentialsFile(dir),
      storagePath,
      startCallbackListener,
      createAuthWindow,
    });
    const summary = await service.authorize({});
    expect(summary.scope).toContain("account:stashes");
    expect(createAuthWindow).toHaveBeenCalledTimes(1);
    expect(windowHandle.url).toContain("https://www.pathofexile.com/oauth/authorize");
    expect(windowHandle.url).toContain("response_type=code");
    expect(windowHandle.url).toContain(`state=${capturedState}`);
    expect(windowHandle.url).toContain(encodeURIComponent("account:stashes account:characters"));
    expect(windowHandle.url).toContain(encodeURIComponent(redirectUri(52798)));
    expect(windowHandle.url).toContain("code_challenge=");
    expect(windowHandle.url).toContain("code_challenge_method=S256");
    const stored = JSON.parse(require("node:fs").readFileSync(storagePath, "utf8"));
    expect(stored.accessToken).toBe("access-token");
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a mismatched state and a declined authorization", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    const startCallbackListener = vi.fn(async () => ({
      port: 52798,
      callback: Promise.resolve({ code: "x", state: "different", error: "" }),
      close: vi.fn(),
    }));
    const createAuthWindow = vi.fn(({ url }: { url: string }) => pendingWindowWith(url));
    const service = createPoeOAuthService({
      credentialsPath: credentialsFile(dir),
      storagePath,
      startCallbackListener,
      createAuthWindow,
    });
    await expect(service.authorize({})).rejects.toThrow("state did not match");

    const deniedListener = vi.fn(async () => ({
      port: 52798,
      callback: Promise.resolve({ code: "", state: "s", error: "access_denied" }),
      close: vi.fn(),
    }));
    const deniedService = createPoeOAuthService({
      credentialsPath: credentialsFile(dir),
      storagePath,
      startCallbackListener: deniedListener,
      createAuthWindow: vi.fn(({ url }: { url: string }) => pendingWindowWith(url)),
    });
    await expect(deniedService.authorize({})).rejects.toThrow("declined");
    rmSync(dir, { recursive: true, force: true });

    function pendingWindowWith(url: string) {
      let resolveClose = () => undefined;
      const closed = new Promise<void>((resolve) => {
        resolveClose = resolve;
      });
      return { url, closed, close: () => resolveClose() };
    }
  });

  it("turns a closed authorization window into a clear error and stops the listener", async () => {
    const dir = tempDir();
    const closeListener = vi.fn();
    const startCallbackListener = vi.fn(async () => ({
      port: 52798,
      callback: new Promise(() => undefined),
      close: closeListener,
    }));
    let resolveWindowClose = () => undefined;
    const closed = new Promise<void>((resolve) => {
      resolveWindowClose = resolve;
    });
    const service = createPoeOAuthService({
      credentialsPath: credentialsFile(dir),
      storagePath: path.join(dir, "poe-oauth.json"),
      startCallbackListener,
      createAuthWindow: () => ({ url: "https://x", closed, close: () => resolveWindowClose() }),
    });
    const pending = service.authorize({});
    resolveWindowClose();
    await expect(pending).rejects.toThrow("closed before connecting");
    expect(closeListener).toHaveBeenCalled();
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs a real loopback listener and captures the callback query", async () => {
    const { startLoopbackListener } = require("../electron/poe-oauth.cjs");
    const listener = await startLoopbackListener({ port: 0, state: "state-xyz" });
    const response = await fetch(`http://127.0.0.1:${listener.port}/callback?code=real-code&state=state-xyz`);
    expect(response.status).toBe(200);
    const outcome = await listener.callback;
    expect(outcome).toEqual({ code: "real-code", state: "state-xyz", error: "" });
    listener.close();
  });
});

describe("PoE OAuth automatic token handling", () => {
  it("runs with the stored token, refreshes once on 401 and retries", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    writeFileSync(
      storagePath,
      JSON.stringify({ accessToken: "first-token", refreshToken: "refresh-1", scope: "account:stashes", expiresAt: Date.now() + 60_000_000 }),
      "utf8",
    );
    const tokenResponses = [() => tokenJson({ access_token: "refreshed-token" })];
    const fetchImpl = vi.fn(async () => (tokenResponses.length > 0 ? tokenResponses.shift()!() : tokenJson()));
    const service = createPoeOAuthService({
      fetchImpl,
      credentialsPath: credentialsFile(dir),
      storagePath,
    });
    const run = vi.fn(async (token: string) => {
      if (token === "first-token") {
        const error = new Error("Stash authorization expired or is invalid.");
        (error as Error & { status?: number }).status = 401;
        throw error;
      }
      return `ok-with-${token}`;
    });
    await expect(service.runWithFreshToken(run)).resolves.toBe("ok-with-refreshed-token");
    expect(run).toHaveBeenCalledTimes(2);
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=refresh-1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires a connection before running and refreshes near expiry", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    const service = createPoeOAuthService({
      credentialsPath: credentialsFile(dir),
      storagePath,
    });
    await expect(service.runWithFreshToken(vi.fn())).rejects.toThrow("Connect Path of Exile first");
    writeFileSync(
      storagePath,
      JSON.stringify({ accessToken: "a", refreshToken: "r", scope: "s", expiresAt: Date.now() - 1000 }),
      "utf8",
    );
    const fetchImpl = vi.fn(async () => tokenJson({ access_token: "fresh" }));
    const refreshing = createPoeOAuthService({
      fetchImpl,
      credentialsPath: credentialsFile(dir),
      storagePath,
    });
    await expect(refreshing.runWithFreshToken(async (token) => token)).resolves.toBe("fresh");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects when the stale session has no refresh token", async () => {
    const dir = tempDir();
    const storagePath = path.join(dir, "poe-oauth.json");
    writeFileSync(storagePath, JSON.stringify({ accessToken: "a", refreshToken: "", scope: "s", expiresAt: 1 }), "utf8");
    const service = createPoeOAuthService({
      credentialsPath: credentialsFile(dir),
      storagePath,
    });
    await expect(service.runWithFreshToken(vi.fn())).rejects.toThrow("connect Path of Exile again");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("PoE stash sync error status contract", () => {
  it("attaches the HTTP status so the OAuth layer can refresh on 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    const service = createPoeStashSyncService({ fetchImpl });
    await expect(
      service.listStashTabs({ realm: "pc", league: "Allflame", accessToken: "expired" }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("form encoding", () => {
  it("encodes query style form pairs", () => {
    expect(formEncode({ a: "x y", b: "z" })).toBe("a=x%20y&b=z");
  });
});