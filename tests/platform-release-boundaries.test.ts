import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

describe("desktop platform release boundaries", () => {
  it("keeps every literal preload invocation backed by exactly one main handler", () => {
    const preload = read("electron/preload.cjs");
    const main = read("electron/main.cjs");
    const invokes = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((match) => match[1]);
    const handlers = [...main.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(invokes).size).toBe(invokes.length);
    expect(new Set(handlers).size).toBe(handlers.length);
    expect(invokes.filter((channel) => !handlers.includes(channel))).toEqual([]);
    expect(handlers.filter((channel) => !invokes.includes(channel))).toEqual([]);

    const subscriptions = [...preload.matchAll(/ipcRenderer\.on\("([^"]+)"/g)]
      .map((match) => match[1]);
    const senders = `${main}\n${read("electron/renderer-command-queue.cjs")}`;
    expect(subscriptions.filter((channel) => !senders.includes(`"${channel}"`))).toEqual([]);
  });

  it("ships only browser handoffs for GGG Trade searches", () => {
    expect(existsSync(join(root, "electron/official-trade-listings.cjs"))).toBe(false);
    const runtime = [
      "electron/main.cjs",
      "electron/preload.cjs",
      "src/PriceCheckApp.tsx",
      "src/lib/bridge.ts",
      "src/types.ts",
    ].map(read).join("\n");
    for (const route of ["search", "fetch", "exchange"]) {
      expect(runtime).not.toContain(["/api/trade", route].join("/"));
    }
    expect(runtime).not.toContain(["price-check:get", "official-listings"].join("-"));
    expect(runtime).not.toContain(["get", "Official", "Trade", "Listings"].join(""));
  });

  it("has no rejected GGG account/OAuth runtime or example credential debris", () => {
    for (const removed of [
      "electron/poe-oauth.cjs",
      "electron/poe-stash-sync.cjs",
      "electron/poe-character-import.cjs",
      "oauth-credentials.example.json",
    ]) expect(existsSync(join(root, removed)), removed).toBe(false);

    const runtime = [
      "electron/main.cjs",
      "electron/preload.cjs",
      "electron/pob-engine-dispatch.cjs",
      "electron/pob-engine-dispatch-worker.cjs",
      "electron/pob-engine-bridge.cjs",
      "electron/pob-engine-worker.lua",
      "src/lib/bridge.ts",
      "src/lib/mobile-bridge.ts",
    ].map(read).join("\n");
    for (const forbidden of [
      /oauth:(?:connect|status|disconnect)/i,
      /stash:(?:get-leagues|list-tabs|get-tab|sync|progress)/i,
      /planner:(?:list-characters|get-character|import-character-pob)/i,
      /poe-(?:oauth|stash-sync|character-import)\.cjs/i,
      /importPobCharacter/,
      /["']import-character["']/,
    ]) expect(runtime).not.toMatch(forbidden);
  });

  it("retains ignore protection for developer-local OAuth request material", () => {
    const ignore = read(".gitignore");
    expect(ignore).toMatch(/^oauth-credentials\.json$/m);
    expect(ignore).toMatch(/^oauth-credentials\.\*\.json$/m);
    expect(ignore).toMatch(/^ggg-oauth-request\.txt$/m);
    expect(ignore).not.toMatch(/^!oauth-credentials/m);
  });

  it("keeps event-log path authorization behind the native picker", () => {
    const contract = read("src/types.ts");
    expect(contract).toContain("startPoeEventLog(): Promise<PoeEventLogState>");
    expect(contract).not.toMatch(/startPoeEventLog\([^)]*(?:path|string)/i);
  });

  it("pins current CI actions to immutable commits and the pnpm 11 successor", () => {
    const workflows = [
      read(".github/workflows/ci.yml"),
      read(".github/workflows/pages.yml"),
    ].join("\n");
    const uses = [...workflows.matchAll(/\buses:\s+([^\s#]+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    expect(workflows).toContain(
      "pnpm/setup@84cb39b217b10273981911c288cd62326dc7c6d2 # v2.0.2",
    );
    expect(workflows).not.toContain("pnpm/action-setup@");
    expect(workflows).toContain("runtime: node@24.14.0");
    expect(workflows).toContain("version: 11.16.0");
  });

  it("revalidates the complete PoE window identity immediately before stash-scroll input", () => {
    const source = read("native/GloamCoreInput.cs");
    const hook = source.slice(
      source.indexOf("private static IntPtr StashMouseHook"),
      source.indexOf("private static int WatchStashScroll"),
    );
    const sendInput = hook.lastIndexOf("SendInput(");
    const finalRead = hook.lastIndexOf("TryReadForegroundIdentity", sendInput);
    const finalIdentityMatch = hook.lastIndexOf("IdentityMatches(", sendInput);
    const earlierBoundsRead = hook.indexOf("GetWindowRect(");
    expect(earlierBoundsRead).toBeGreaterThanOrEqual(0);
    expect(finalRead).toBeGreaterThan(earlierBoundsRead);
    expect(finalIdentityMatch).toBeGreaterThan(finalRead);
    expect(sendInput).toBeGreaterThan(finalIdentityMatch);
    expect(hook.slice(finalIdentityMatch, sendInput)).toContain("foreground.ProcessId");
    expect(hook.slice(finalIdentityMatch, sendInput)).toContain("foreground.ProcessName");
    expect(hook.slice(finalIdentityMatch, sendInput)).toContain("foreground.Title");
  });

  it("keeps the shipped source tree single-game", () => {
    const sequel = String(1 + 1);
    const sequelRoman = "i".repeat(Number(sequel));
    const sequelWord = ["t", "w", "o"].join("");
    const sequelMarkers = [`${sequel}(?![.\\d])`, sequelRoman, sequelWord].join("|");
    const forbidden = new RegExp([
      `path\\s+of\\s+exile\\s*(?:${sequelMarkers})\\b`,
      `pathofexile(?:${sequelMarkers})\\b`,
      `\\bpoe\\s*(?:${sequelMarkers})\\b`,
      `\\bpob\\s*(?:${sequelMarkers})\\b`,
    ].join("|"), "i");
    const textExtensions = new Set([
      ".cjs", ".cs", ".css", ".gradle", ".html", ".js", ".json", ".lua",
      ".md", ".mjs", ".ps1", ".swift", ".ts", ".tsx", ".txt", ".xml",
      ".yaml", ".yml",
    ]);
    const files = execFileSync("git", [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ], { cwd: root })
      .toString("utf8")
      .split("\0")
      .filter((file) =>
        file &&
        existsSync(join(root, file)) &&
        textExtensions.has(extname(file).toLowerCase()),
      );
    const violations = files.filter((file) => forbidden.test(read(file)));
    expect(violations).toEqual([]);
  });
});
