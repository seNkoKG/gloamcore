import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Faustus public CDN transport policy", () => {
  it("does not forge an OAuth-style User-Agent on desktop or mobile", async () => {
    const [desktop, mobile] = await Promise.all([
      fs.readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
      fs.readFile(new URL("../src/lib/mobile-bridge.ts", import.meta.url), "utf8"),
    ]);
    const desktopHour = /function getFaustusHour[\s\S]*?\n}\n/.exec(desktop)?.[0];
    const remoteReader = /async function getCachedRemoteJsonUncoalesced[\s\S]*?\n}\n\nasync function getCachedRemoteJson/.exec(desktop)?.[0];
    const mobileOverview = /async function getMobileFaustusOverview[\s\S]*?\n}\n\nexport const mobileBridge/.exec(mobile)?.[0];

    expect(desktopHour).toContain("sendUserAgent: false");
    expect(remoteReader).toContain('if (sendUserAgent) headers["User-Agent"] = USER_AGENT;');
    expect(mobileOverview).toContain("FAUSTUS_API_ROOT");
    expect(mobileOverview).not.toContain("User-Agent");
  });
});
