import { describe, expect, it } from "vitest";
import { sandboxedPluginUrl, trustedToolkitExternalUrl } from "./external-links";

describe("toolkit external links", () => {
  it("matches the desktop trusted-reference policy", () => {
    expect(trustedToolkitExternalUrl("https://www.pathofexile.com/trade")).not.toBeNull();
    expect(trustedToolkitExternalUrl("https://poe.ninja/poe1/economy")).not.toBeNull();
    expect(trustedToolkitExternalUrl("https://example.com/guide")).toBeNull();
    expect(trustedToolkitExternalUrl("https://poe.ninja.example.com/steal")).toBeNull();
    expect(trustedToolkitExternalUrl("https://poe.ninja:444/path")).toBeNull();
    expect(trustedToolkitExternalUrl("https://user@poe.ninja/path")).toBeNull();
  });

  it("accepts arbitrary standard HTTPS only for the origin-isolated plugin frame", () => {
    expect(sandboxedPluginUrl("https://example.com/tool")).not.toBeNull();
    expect(sandboxedPluginUrl("http://example.com/tool")).toBeNull();
    expect(sandboxedPluginUrl("https://user:pass@example.com/tool")).toBeNull();
  });
});
