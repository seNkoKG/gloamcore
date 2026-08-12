import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  CRAFT_OF_EXILE_PARTITION,
  CRAFT_OF_EXILE_URL,
  allowedExternalUrl,
  allowedNavigationUrl,
  canWriteClipboard,
  createCraftOfExileView,
  fitViewBounds,
  shouldBlockAds,
  syncAdBlocking,
} = require("../electron/craft-of-exile-window.cjs");

function fakeAdBlocker() {
  let enabled = false;
  return {
    disableBlockingInSession: vi.fn(() => {
      enabled = false;
    }),
    enableBlockingInSession: vi.fn(() => {
      enabled = true;
    }),
    isBlockingEnabled: vi.fn(() => enabled),
  };
}

class FakeWebContentsView {
  static latest: FakeWebContentsView;
  options: Record<string, unknown>;
  handlers = new Map<string, (...args: unknown[]) => void>();
  popupHandler: ((details: { url: string }) => { action: string }) | null = null;
  permissionCheckHandler: ((
    webContents: unknown,
    permission: string,
    requestingOrigin: string,
    details?: { requestingUrl?: string },
  ) => boolean) | null = null;
  permissionRequestHandler: ((
    webContents: unknown,
    permission: string,
    callback: (allowed: boolean) => void,
    details?: { requestingUrl?: string },
  ) => void) | null = null;
  setBackgroundColor = vi.fn();
  setBorderRadius = vi.fn();
  setVisible = vi.fn();
  craftOfExileReady!: Promise<boolean>;
  webContents = {
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers.set(event, handler);
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers.set(event, handler);
    }),
    setWindowOpenHandler: vi.fn((handler: (
      details: { url: string },
    ) => { action: string }) => {
      this.popupHandler = handler;
    }),
    session: {
      setPermissionCheckHandler: vi.fn((handler: FakeWebContentsView["permissionCheckHandler"]) => {
        this.permissionCheckHandler = handler;
      }),
      setPermissionRequestHandler: vi.fn((
        handler: FakeWebContentsView["permissionRequestHandler"],
      ) => {
        this.permissionRequestHandler = handler;
      }),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        this.handlers.set(`session:${event}`, handler);
      }),
      cookies: {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          this.handlers.set(`cookies:${event}`, handler);
        }),
        flushStore: vi.fn(async () => undefined),
      },
    },
  };

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeWebContentsView.latest = this;
  }
}

describe("Craft of Exile browser boundary", () => {
  it("keeps navigation on strict first-party and Patreon HTTPS hosts", () => {
    expect(CRAFT_OF_EXILE_PARTITION).toMatch(/^persist:/);
    expect(allowedNavigationUrl(CRAFT_OF_EXILE_URL)?.hostname)
      .toBe("beta.craftofexile.com");
    expect(allowedNavigationUrl("https://www.craftofexile.com/en/")?.hostname)
      .toBe("www.craftofexile.com");
    expect(allowedNavigationUrl("https://www.patreon.com/oauth2/authorize")?.hostname)
      .toBe("www.patreon.com");
    expect(allowedNavigationUrl("http://beta.craftofexile.com/")).toBeNull();
    expect(allowedNavigationUrl("https://beta.craftofexile.com:444/")).toBeNull();
    expect(allowedNavigationUrl("https://user@beta.craftofexile.com/")).toBeNull();
    expect(allowedNavigationUrl("https://beta.craftofexile.com.evil.example/"))
      .toBeNull();
    expect(shouldBlockAds(CRAFT_OF_EXILE_URL)).toBe(true);
    expect(shouldBlockAds("https://www.patreon.com/oauth2/authorize")).toBe(false);
  });

  it("allows only explicit external destinations", () => {
    expect(allowedExternalUrl("https://www.pathofexile.com/")?.hostname)
      .toBe("www.pathofexile.com");
    expect(allowedExternalUrl("https://discord.gg/craftofexile")?.hostname)
      .toBe("discord.gg");
    expect(allowedExternalUrl("https://www.youtube.com/watch?v=test")?.hostname)
      .toBe("www.youtube.com");
    expect(allowedExternalUrl("http://discord.gg/craftofexile")).toBeNull();
    expect(allowedExternalUrl("https://discord.gg.evil.example/craftofexile"))
      .toBeNull();
    expect(allowedExternalUrl("https://evil.example/")).toBeNull();
  });

  it("uses a sandboxed profile and denies popups, webviews, and downloads", async () => {
    const openExternal = vi.fn(async () => undefined);
    const blocker = fakeAdBlocker();
    createCraftOfExileView({
      WebContentsView: FakeWebContentsView,
      openExternal,
      loadAdBlocker: vi.fn(async () => blocker),
      loadTimeoutMs: 100,
    });
    const view = FakeWebContentsView.latest;
    const preferences = view.options.webPreferences as Record<string, unknown>;

    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: CRAFT_OF_EXILE_PARTITION,
    });
    expect(preferences).not.toHaveProperty("preload");
    expect(view.setVisible).toHaveBeenCalledWith(false);
    await vi.waitFor(() => {
      expect(view.webContents.loadURL).toHaveBeenCalledWith(CRAFT_OF_EXILE_URL);
    });
    expect(blocker.enableBlockingInSession)
      .toHaveBeenCalledWith(view.webContents.session);

    const blocked = { preventDefault: vi.fn() };
    view.handlers.get("will-navigate")?.(blocked, "https://evil.example/");
    expect(blocked.preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).not.toHaveBeenCalled();

    const external = { preventDefault: vi.fn() };
    view.handlers.get("will-redirect")?.(external, "https://discord.gg/craftofexile");
    expect(external.preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith("https://discord.gg/craftofexile");

    expect(view.popupHandler?.({ url: "https://www.patreon.com/oauth2/authorize" }))
      .toEqual({ action: "deny" });
    expect(view.webContents.loadURL)
      .toHaveBeenLastCalledWith("https://www.patreon.com/oauth2/authorize");
    expect(blocker.disableBlockingInSession)
      .toHaveBeenCalledWith(view.webContents.session);
    expect(view.popupHandler?.({ url: "https://evil.example/" }))
      .toEqual({ action: "deny" });

    const webviewEvent = { preventDefault: vi.fn() };
    view.handlers.get("will-attach-webview")?.(webviewEvent);
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce();
    const downloadEvent = { preventDefault: vi.fn() };
    view.handlers.get("session:will-download")?.(downloadEvent);
    expect(downloadEvent.preventDefault).toHaveBeenCalledOnce();

    view.handlers.get("cookies:changed")?.();
    expect(view.webContents.session.cookies.flushStore).toHaveBeenCalledOnce();
  });

  it("permits only first-party clipboard writes", () => {
    createCraftOfExileView({
      WebContentsView: FakeWebContentsView,
      loadAdBlocker: vi.fn(async () => fakeAdBlocker()),
      loadTimeoutMs: 100,
    });
    const view = FakeWebContentsView.latest;
    const contents = view.webContents;

    expect(canWriteClipboard(
      "clipboard-sanitized-write",
      "https://beta.craftofexile.com/",
    )).toBe(true);
    expect(canWriteClipboard("clipboard-read", CRAFT_OF_EXILE_URL)).toBe(false);
    expect(canWriteClipboard(
      "clipboard-sanitized-write",
      "https://www.patreon.com/",
    )).toBe(false);

    expect(view.permissionCheckHandler?.(
      contents,
      "clipboard-sanitized-write",
      CRAFT_OF_EXILE_URL,
      { requestingUrl: CRAFT_OF_EXILE_URL },
    )).toBe(true);
    expect(view.permissionCheckHandler?.(
      contents,
      "clipboard-read",
      CRAFT_OF_EXILE_URL,
      { requestingUrl: CRAFT_OF_EXILE_URL },
    )).toBe(false);
    expect(view.permissionCheckHandler?.(
      {},
      "clipboard-sanitized-write",
      CRAFT_OF_EXILE_URL,
      { requestingUrl: CRAFT_OF_EXILE_URL },
    )).toBe(false);

    const allowed = vi.fn();
    view.permissionRequestHandler?.(
      contents,
      "clipboard-sanitized-write",
      allowed,
      { requestingUrl: CRAFT_OF_EXILE_URL },
    );
    expect(allowed).toHaveBeenCalledWith(true);
    const denied = vi.fn();
    view.permissionRequestHandler?.(
      contents,
      "clipboard-read",
      denied,
      { requestingUrl: CRAFT_OF_EXILE_URL },
    );
    expect(denied).toHaveBeenCalledWith(false);
  });

  it("keeps the view hidden until the main document finishes loading", async () => {
    const view = createCraftOfExileView({
      WebContentsView: FakeWebContentsView,
      loadAdBlocker: vi.fn(async () => fakeAdBlocker()),
      loadTimeoutMs: 100,
    }) as FakeWebContentsView;
    let settled = false;
    void view.craftOfExileReady.then(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(view.webContents.loadURL).toHaveBeenCalledWith(CRAFT_OF_EXILE_URL);
    });
    expect(settled).toBe(false);
    view.handlers.get("did-finish-load")?.();
    await expect(view.craftOfExileReady).resolves.toBe(true);
  });

  it("reports failed and timed-out main document loads", async () => {
    const failed = createCraftOfExileView({
      WebContentsView: FakeWebContentsView,
      loadAdBlocker: vi.fn(async () => fakeAdBlocker()),
      loadTimeoutMs: 100,
    }) as FakeWebContentsView;
    await vi.waitFor(() => {
      expect(failed.webContents.loadURL).toHaveBeenCalledWith(CRAFT_OF_EXILE_URL);
    });
    failed.handlers.get("did-fail-load")?.(
      null,
      -105,
      "NAME_NOT_RESOLVED",
      CRAFT_OF_EXILE_URL,
      true,
    );
    await expect(failed.craftOfExileReady).resolves.toBe(false);

    vi.useFakeTimers();
    try {
      const timedOut = createCraftOfExileView({
        WebContentsView: FakeWebContentsView,
        loadAdBlocker: vi.fn(async () => fakeAdBlocker()),
        loadTimeoutMs: 25,
      }) as FakeWebContentsView;
      const readiness = timedOut.craftOfExileReady;
      await vi.advanceTimersByTimeAsync(25);
      await expect(readiness).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails open when the ads-only filter cannot load", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      createCraftOfExileView({
        WebContentsView: FakeWebContentsView,
        loadAdBlocker: vi.fn(async () => {
          throw new Error("filter host unavailable");
        }),
        loadTimeoutMs: 100,
      });
      const view = FakeWebContentsView.latest;
      await vi.waitFor(() => {
        expect(view.webContents.loadURL).toHaveBeenCalledWith(CRAFT_OF_EXILE_URL);
      });
      expect(warning).toHaveBeenCalledWith(
        "Craft of Exile ad blocking unavailable:",
        expect.any(Error),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("does not re-register an unchanged blocking state", () => {
    const blocker = fakeAdBlocker();
    const session = {};

    syncAdBlocking(blocker, session, CRAFT_OF_EXILE_URL);
    syncAdBlocking(blocker, session, CRAFT_OF_EXILE_URL);
    syncAdBlocking(blocker, session, "https://www.patreon.com/oauth2/authorize");
    syncAdBlocking(blocker, session, "https://www.patreon.com/oauth2/authorize");

    expect(blocker.enableBlockingInSession).toHaveBeenCalledOnce();
    expect(blocker.disableBlockingInSession).toHaveBeenCalledOnce();
  });

  it("clips renderer bounds to the main window content area", () => {
    expect(fitViewBounds(
      { x: -10.4, y: 40.2, width: 500.7, height: 700.8 },
      { width: 460, height: 600 },
    )).toEqual({ x: 0, y: 40, width: 460, height: 560 });
    expect(fitViewBounds(
      { x: 500, y: 0, width: 100, height: 100 },
      { width: 460, height: 600 },
    )).toBeNull();
    expect(fitViewBounds(
      { x: 0, y: 0, width: Number.NaN, height: 100 },
      { width: 460, height: 600 },
    )).toBeNull();
  });
});
