import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  AD_BLOCK_CACHE_MAX_AGE_MS,
  WEALTHY_EXILE_PARTITION,
  WEALTHY_EXILE_URL,
  allowedNavigationUrl,
  createWealthyExileView,
  fitViewBounds,
  loadWealthyExileAdBlocker,
  shouldBlockAds,
  syncAdBlocking,
} = require("../electron/wealthy-exile-window.cjs");

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
  permissionHandler: ((webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null = null;
  setBackgroundColor = vi.fn();
  setBorderRadius = vi.fn();
  setVisible = vi.fn();
  webContents = {
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers.set(event, handler);
    }),
    setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: string }) => {
      this.popupHandler = handler;
    }),
    session: {
      storagePath: "C:\\test\\wealthy-exile",
      setPermissionRequestHandler: vi.fn((handler: (
        webContents: unknown,
        permission: string,
        callback: (allowed: boolean) => void,
      ) => void) => {
        this.permissionHandler = handler;
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

describe("Wealthy Exile navigation boundary", () => {
  it("allows only Wealthy Exile and its required sign-in hosts", () => {
    expect(WEALTHY_EXILE_PARTITION).toMatch(/^persist:/);
    expect(allowedNavigationUrl("https://wealthyexile.com/stash")?.hostname).toBe("wealthyexile.com");
    expect(allowedNavigationUrl("https://www.pathofexile.com/oauth/authorize")?.hostname)
      .toBe("www.pathofexile.com");
    expect(allowedNavigationUrl("https://steamcommunity.com/openid/login")?.hostname)
      .toBe("steamcommunity.com");
    expect(allowedNavigationUrl("https://steamcommunity.com/login/home")?.hostname)
      .toBe("steamcommunity.com");
    expect(allowedNavigationUrl("https://steamcommunity.com.evil.example/openid/login")).toBeNull();
    expect(allowedNavigationUrl("http://wealthyexile.com/stash")).toBeNull();
    expect(allowedNavigationUrl("https://wealthyexile.com.evil.example/stash")).toBeNull();
    expect(allowedNavigationUrl("https://user@wealthyexile.com/stash")).toBeNull();
    expect(shouldBlockAds("https://wealthyexile.com/stash")).toBe(true);
    expect(shouldBlockAds("https://www.pathofexile.com/login")).toBe(false);
    expect(shouldBlockAds("https://steamcommunity.com/openid/login")).toBe(false);
  });

  it("blocks ads only on Wealthy Exile and preserves OAuth navigation", async () => {
    const blocker = fakeAdBlocker();
    createWealthyExileView({
      WebContentsView: FakeWebContentsView,
      loadAdBlocker: vi.fn(async () => blocker),
    });
    const view = FakeWebContentsView.latest;
    const preferences = view.options.webPreferences as Record<string, unknown>;

    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: WEALTHY_EXILE_PARTITION,
    });
    expect(preferences).not.toHaveProperty("preload");
    expect(view.setVisible).toHaveBeenCalledWith(false);
    await vi.waitFor(() => {
      expect(view.webContents.loadURL).toHaveBeenCalledWith(WEALTHY_EXILE_URL);
    });
    expect(blocker.enableBlockingInSession).toHaveBeenCalledWith(view.webContents.session);

    const blocked = { preventDefault: vi.fn() };
    view.handlers.get("will-navigate")?.(blocked, "https://evil.example/");
    expect(blocked.preventDefault).toHaveBeenCalledOnce();

    expect(view.popupHandler?.({ url: "https://evil.example/" })).toEqual({ action: "deny" });
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(view.popupHandler?.({ url: "https://www.pathofexile.com/login" })).toEqual({ action: "deny" });
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith("https://www.pathofexile.com/login");
    expect(blocker.disableBlockingInSession).toHaveBeenCalledWith(view.webContents.session);

    const allowed = { preventDefault: vi.fn() };
    view.handlers.get("will-redirect")?.(allowed, WEALTHY_EXILE_URL);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    expect(blocker.enableBlockingInSession).toHaveBeenCalledTimes(2);

    const permission = vi.fn();
    view.permissionHandler?.(null, "clipboard-read", permission);
    expect(permission).toHaveBeenCalledWith(false);
    view.handlers.get("cookies:changed")?.();
    expect(view.webContents.session.cookies.flushStore).toHaveBeenCalledOnce();
  });

  it("still opens Wealthy Exile when filter loading fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createWealthyExileView({
      WebContentsView: FakeWebContentsView,
      loadAdBlocker: vi.fn(async () => {
        throw new Error("filter host unavailable");
      }),
    });
    const view = FakeWebContentsView.latest;

    await vi.waitFor(() => {
      expect(view.webContents.loadURL).toHaveBeenCalledWith(WEALTHY_EXILE_URL);
    });
    expect(warning).toHaveBeenCalledWith(
      "Wealthy Exile ad blocking unavailable:",
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("still opens Wealthy Exile when filter loading stalls", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      createWealthyExileView({
        WebContentsView: FakeWebContentsView,
        loadAdBlocker: vi.fn(() => new Promise(() => undefined)),
        adBlockTimeoutMs: 25,
      });
      const view = FakeWebContentsView.latest;

      await vi.advanceTimersByTimeAsync(25);
      expect(view.webContents.loadURL).toHaveBeenCalledWith(WEALTHY_EXILE_URL);
      expect(warning).toHaveBeenCalledWith(
        "Wealthy Exile ad blocking unavailable:",
        expect.objectContaining({ message: "ad filter loading timed out" }),
      );
    } finally {
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it("uses a fresh cached filter engine without a network request", async () => {
    const cached = fakeAdBlocker();
    const ElectronBlocker = {
      deserialize: vi.fn(() => cached),
      fromPrebuiltAdsOnly: vi.fn(),
    };

    const result = await loadWealthyExileAdBlocker(
      { storagePath: "C:\\test\\wealthy-exile" },
      {
        ElectronBlocker,
        now: () => 50_000,
        readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
        stat: vi.fn(async () => ({ mtimeMs: 50_000 - AD_BLOCK_CACHE_MAX_AGE_MS + 1 })),
      },
    );

    expect(result).toBe(cached);
    expect(ElectronBlocker.fromPrebuiltAdsOnly).not.toHaveBeenCalled();
  });

  it("refreshes stale filters and falls back to cache if refresh fails", async () => {
    const cached = fakeAdBlocker();
    const updated = { ...fakeAdBlocker(), serialize: vi.fn(() => new Uint8Array([4, 5, 6])) };
    const writeFile = vi.fn(async () => undefined);
    const ElectronBlocker = {
      deserialize: vi.fn(() => cached),
      fromPrebuiltAdsOnly: vi.fn(async () => updated),
    };
    const dependencies = {
      ElectronBlocker,
      mkdir: vi.fn(async () => undefined),
      now: () => 100_000,
      readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      stat: vi.fn(async () => ({ mtimeMs: 100_000 - AD_BLOCK_CACHE_MAX_AGE_MS - 1 })),
      writeFile,
    };

    await expect(loadWealthyExileAdBlocker(
      { storagePath: "C:\\test\\wealthy-exile" },
      dependencies,
    )).resolves.toBe(updated);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/ads-only\.bin$/),
      new Uint8Array([4, 5, 6]),
    );

    ElectronBlocker.fromPrebuiltAdsOnly.mockRejectedValueOnce(new Error("offline"));
    await expect(loadWealthyExileAdBlocker(
      { storagePath: "C:\\test\\wealthy-exile" },
      dependencies,
    )).resolves.toBe(cached);
  });

  it("does not re-register an unchanged blocking state", () => {
    const blocker = fakeAdBlocker();
    const session = {};

    syncAdBlocking(blocker, session, WEALTHY_EXILE_URL);
    syncAdBlocking(blocker, session, WEALTHY_EXILE_URL);
    syncAdBlocking(blocker, session, "https://steamcommunity.com/openid/login");
    syncAdBlocking(blocker, session, "https://steamcommunity.com/openid/login");

    expect(blocker.enableBlockingInSession).toHaveBeenCalledOnce();
    expect(blocker.disableBlockingInSession).toHaveBeenCalledOnce();
  });

  it("clips renderer bounds to the main window content area", () => {
    expect(fitViewBounds(
      { x: -10.4, y: 40.2, width: 500.7, height: 700.8 },
      { width: 460, height: 600 },
    )).toEqual({ x: 0, y: 40, width: 460, height: 560 });
    expect(fitViewBounds({ x: 500, y: 0, width: 100, height: 100 }, { width: 460, height: 600 }))
      .toBeNull();
    expect(fitViewBounds({ x: 0, y: 0, width: Number.NaN, height: 100 }, { width: 460, height: 600 }))
      .toBeNull();
  });
});
