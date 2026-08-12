import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  WEALTHY_EXILE_AD_CLEANUP_CSS,
  WEALTHY_EXILE_AD_CLEANUP_SCRIPT,
  installWealthyExileAdCleanup,
  shouldBlockAds,
} = require("./wealthy-exile-window.cjs");

describe("Wealthy Exile ad cleanup", () => {
  it("targets the current Nitro side rails and Google ad frames", () => {
    expect(WEALTHY_EXILE_AD_CLEANUP_CSS).toContain("wealthy-exile-nitro-ad-left");
    expect(WEALTHY_EXILE_AD_CLEANUP_CSS).toContain("wealthy-exile-nitro-ad-right");
    expect(WEALTHY_EXILE_AD_CLEANUP_CSS).toContain('iframe[aria-label="Advertisement"]');
    expect(WEALTHY_EXILE_AD_CLEANUP_SCRIPT).toContain("MutationObserver");
    expect(() => new Function(WEALTHY_EXILE_AD_CLEANUP_SCRIPT)).not.toThrow();
  });

  it("injects only into the Wealthy Exile origin on every document load", async () => {
    const handlers = new Map<string, () => void>();
    const executeJavaScript = vi.fn(async () => true);
    const contents = {
      isDestroyed: () => false,
      getURL: () => "https://wealthyexile.com/stash",
      executeJavaScript,
      on: (event: string, handler: () => void) => handlers.set(event, handler),
    };
    installWealthyExileAdCleanup(contents);
    handlers.get("dom-ready")?.();
    handlers.get("did-finish-load")?.();
    await Promise.resolve();
    expect(executeJavaScript).toHaveBeenCalledTimes(2);
    expect(shouldBlockAds("https://www.pathofexile.com/login")).toBe(false);
  });
});
