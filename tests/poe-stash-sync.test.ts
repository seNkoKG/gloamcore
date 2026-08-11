import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createPoeStashSyncService,
  flattenLeafTabs,
  validatedStashRequest,
} = require("../electron/poe-stash-sync.cjs");
const { version: appVersion } = require("../package.json");

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function leagueEntry(id = "Allflame") {
  return { id, name: `${id} League`, url: `https://pathofexile.com/league/${id}` };
}

describe("PoE stash sync service", () => {
  it("validates realms, league and rejects newline-bearing tokens", () => {
    expect(() => validatedStashRequest({ realm: "heroku", league: "Allflame", accessToken: "x" }))
      .toThrow("realm");
    expect(() => validatedStashRequest({ realm: "pc", accessToken: "x" }))
      .toThrow("League name");
    expect(() => validatedStashRequest({ realm: "pc", league: "Allflame" }))
      .toThrow("OAuth access token");
    const request = validatedStashRequest({ realm: "pc", league: "Al lflame\n", accessToken: "a\nb" });
    expect(request.league).toBe("Al lflame");
    expect(request.accessToken).toBe("ab");
  });

  it("lists leaf stash tabs against the official stash endpoint with Bearer auth", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.pathofexile.com/stash/Allflame");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
      expect((init.headers as Record<string, string>)["User-Agent"]).toBe(`GloamCore/${appVersion}`);
      return json({
        stashes: [
          { id: "folder-1", name: "Folders", type: "Folder", index: 0, children: [
            { id: "tab-1", name: "Currency", type: "CurrencyStash", index: 0 },
          ] },
          { id: "tab-2", name: "Cards", type: "DivinationCardStash", index: 1, children: [
            { id: "sub-1", name: "The Doctor", type: "DivinationCardStash", index: 0 },
          ] },
          { id: "tab-3", name: "Maps", type: "MapStash", index: 2 },
        ],
      });
    });
    const service = createPoeStashSyncService({ fetchImpl });
    const tabs = await service.listStashTabs({ realm: "pc", league: "Allflame", accessToken: "token" });
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toMatchObject({ id: "tab-1", name: "Currency", type: "CurrencyStash", path: ["Folders"] });
    expect(tabs[1]).toMatchObject({ id: "sub-1", name: "The Doctor", path: ["Cards"] });
    expect(tabs[2]).toMatchObject({ id: "tab-3", name: "Maps", path: [] });
  });

  it("reports no tabs for an empty unanswered league", async () => {
    const fetchImpl = vi.fn(async () => json({ stashes: [] }));
    const service = createPoeStashSyncService({ fetchImpl });
    await expect(service.listStashTabs({ realm: "pc", league: "Ghost", accessToken: "token" }))
      .rejects.toThrow(/no stash tabs/);
  });

  it("fetches a single tab with an URL-encoded tab id", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.pathofexile.com/stash/Allflame/a%20b%26c");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
      return json({
        stash: {
          id: "a b&c",
          name: "Currency",
          type: "CurrencyStash",
          index: 3,
          items: [
            { id: "i1", name: "", typeLine: "Chaos Orb", frameType: 5, stackSize: 12 },
          ],
        },
      });
    });
    const service = createPoeStashSyncService({ fetchImpl });
    const tab = await service.getStashTab({ realm: "pc", league: "Allflame", accessToken: "token" }, "a b&c");
    expect(tab).toMatchObject({ id: "a b&c", name: "Currency", type: "CurrencyStash", index: 3 });
    expect(tab.items).toHaveLength(1);
    expect(tab.items[0].typeLine).toBe("Chaos Orb");
  });

  it("syncs every selected tab sequentially with progress events", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://api.pathofexile.com/stash/Allflame") {
        return json({ stashes: [
          { id: "t1", name: "Currency", type: "CurrencyStash", index: 0 },
          { id: "t2", name: "Maps", type: "MapStash", index: 1 },
        ] });
      }
      const tabId = url.split("/").pop();
      return json({ stash: { id: tabId, name: tabId === "t1" ? "Currency" : "Maps", type: "StashTab", index: 0, items: [] } });
    });
    const service = createPoeStashSyncService({ fetchImpl });
    const progress: Array<{ index: number; total: number }> = [];
    const details = await service.syncStash(
      { realm: "pc", league: "Allflame", accessToken: "token" },
      { onProgress: (event) => progress.push(event) },
    );
    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({ id: "t1", name: "Currency" });
    expect(details[1]).toMatchObject({ id: "t2", name: "Maps" });
    expect(progress).toEqual([
      { index: 1, total: 2, tabName: "Currency", path: [] },
      { index: 2, total: 2, tabName: "Maps", path: [] },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("never reuses authenticated stash data across OAuth tokens", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const token = String((init.headers as Record<string, string>).Authorization || "").replace(/^Bearer /, "");
      return json({ stashes: [{ id: `tab-${token}`, name: `Tab ${token}`, type: "StashTab", index: 0 }] });
    });
    const service = createPoeStashSyncService({ fetchImpl });
    await expect(service.listStashTabs({ realm: "pc", league: "Allflame", accessToken: "account-a" }))
      .resolves.toEqual([expect.objectContaining({ name: "Tab account-a" })]);
    await expect(service.listStashTabs({ realm: "pc", league: "Allflame", accessToken: "account-b" }))
      .resolves.toEqual([expect.objectContaining({ name: "Tab account-b" })]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps 403 and 429 responses to actionable messages", async () => {
    const service = createPoeStashSyncService({ fetchImpl: vi.fn(async (_url, init) => Response.json(
      {},
      { status: (init as Record<string, string>).__status as number },
    )) });
    const missingScope = createPoeStashSyncService({
      fetchImpl: vi.fn(async () => new Response("{}", { status: 403 })),
    });
    await expect(missingScope.listStashTabs({ realm: "pc", league: "Allflame", accessToken: "token" }))
      .rejects.toThrow(/account:stashes/);
    const limited = createPoeStashSyncService({
      fetchImpl: vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "12" } })),
    });
    await expect(limited.listStashTabs({ realm: "pc", league: "Allflame", accessToken: "token" }))
      .rejects.toThrow(/retry in 12 seconds/);
  });

  it("fetches main leagues per realm and caches the public response", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://www.pathofexile.com/api/leagues?type=main&realm=xbox");
      return json([leagueEntry("Allflame"), leagueEntry("Hardcore Allflame"), {}]);
    });
    const service = createPoeStashSyncService({ fetchImpl });
    const first = await service.getLeagues({ realm: "xbox" });
    const second = await service.getLeagues({ realm: "xbox" });
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({ id: "Allflame", realm: "xbox" });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported stash realms", async () => {
    const service = createPoeStashSyncService({ fetchImpl: vi.fn() });
    await expect(service.getLeagues({ realm: "poe2" })).rejects.toThrow("realm");
  });

  it("flattenLeafTabs skips malformed entries and empty folders", () => {
    const leaves = flattenLeafTabs([
      { id: "ok", name: "Fine", type: "StashTab", index: 0 },
      null,
      { type: "Folder", name: "Empty Folder", children: [] },
      { name: "No id", type: "StashTab" },
    ]);
    expect(leaves).toEqual([expect.objectContaining({ id: "ok", name: "Fine" })]);
  });
});
