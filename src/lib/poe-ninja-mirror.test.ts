import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { PoeNinjaMirrorManifest } from "./poe-ninja-mirror";
import {
  isPoeNinjaMirrorManifest,
  mirrorEnvelopeTimes,
  mirrorRouteForRequest,
  mirrorRouteUrl,
  verifyMirrorPayloadText,
} from "./poe-ninja-mirror";

function manifest(now = Date.now()): PoeNinjaMirrorManifest {
  return {
    schemaVersion: 1,
    generatedAt: now,
    cadenceMs: 30 * 60 * 1000,
    leagueSnapshot: {
      data: [{ id: "Standard", name: "Standard" }],
      upstreamEtag: 'W/"leagues"',
      checkedAt: now,
      sourceUpdatedAt: now - 1_000,
      nextRefreshAt: now + 30 * 60 * 1000,
    },
    routes: Array.from({ length: 46 }, (_, index) => ({
      league: "Standard",
      type: `Type ${index}`,
      source: "exchange" as const,
      file: `routes/${index.toString(16).padStart(64, "0")}.json`,
      upstreamEtag: `W/"${index}"`,
      checkedAt: now,
      sourceUpdatedAt: now - 1_000,
      nextRefreshAt: now + 30 * 60 * 1000,
      bytes: 100,
      sha256: index.toString(16).padStart(64, "0"),
    })),
  };
}

describe("owned poe.ninja mirror client contract", () => {
  it("validates a complete league route matrix and resolves only owned URLs", () => {
    const value = manifest();
    expect(isPoeNinjaMirrorManifest(value)).toBe(true);
    value.routes[1] = {
      ...value.routes[1],
      file: value.routes[0].file,
      bytes: value.routes[0].bytes,
      sha256: value.routes[0].sha256,
    };
    expect(isPoeNinjaMirrorManifest(value)).toBe(true);
    const route = mirrorRouteForRequest(value, {
      league: "Standard",
      source: "exchange",
      type: "Type 4",
    });
    expect(mirrorRouteUrl(route)).toBe(
      `https://senkokg.github.io/gloamcore/data/poe-ninja/v1/${route.file}`,
    );
  });

  it("rejects invalid manifests and bounds delayed snapshots to one day", () => {
    const value = manifest();
    expect(isPoeNinjaMirrorManifest({ ...value, routes: value.routes.slice(1) })).toBe(false);
    expect(isPoeNinjaMirrorManifest({
      ...value,
      routes: [
        { ...value.routes[0], bytes: 16 * 1024 * 1024 + 1 },
        ...value.routes.slice(1),
      ],
    })).toBe(false);
    expect(isPoeNinjaMirrorManifest({
      ...value,
      leagueSnapshot: { ...value.leagueSnapshot, nextRefreshAt: Number.MAX_SAFE_INTEGER },
    })).toBe(false);
    expect(isPoeNinjaMirrorManifest({
      ...value,
      routes: [
        { ...value.routes[0], file: `routes/${"f".repeat(64)}.json` },
        ...value.routes.slice(1),
      ],
    })).toBe(false);
    expect(isPoeNinjaMirrorManifest({
      ...value,
      retainedPayloads: [{
        file: `routes/${"f".repeat(64)}.json`,
        sha256: "f".repeat(64),
        bytes: 10,
        lastReferencedAt: value.generatedAt - 1,
      }],
    })).toBe(true);
    expect(isPoeNinjaMirrorManifest({
      ...value,
      retainedPayloads: [{
        file: `routes/${"f".repeat(64)}.json`,
        sha256: "f".repeat(64),
        bytes: 10,
        lastReferencedAt: value.generatedAt - 24 * 60 * 60 * 1000 - 1,
      }],
    })).toBe(false);
    expect(mirrorEnvelopeTimes({
      checkedAt: value.generatedAt - 2 * 60 * 60 * 1000 - 1,
      sourceUpdatedAt: value.generatedAt - 2 * 60 * 60 * 1000 - 1,
      nextRefreshAt: value.generatedAt,
    }, value.generatedAt).stale).toBe(true);
    expect(() => mirrorEnvelopeTimes({
      checkedAt: value.generatedAt - 24 * 60 * 60 * 1000 - 1,
      sourceUpdatedAt: value.generatedAt - 24 * 60 * 60 * 1000 - 1,
      nextRefreshAt: value.generatedAt,
    }, value.generatedAt)).toThrow(/too old/i);
  });

  it("verifies mirrored bytes against the manifest digest", async () => {
    const text = '{"lines":[]}';
    const route = {
      bytes: new TextEncoder().encode(text).byteLength,
      sha256: createHash("sha256").update(text).digest("hex"),
    };
    await expect(verifyMirrorPayloadText(text, route)).resolves.toBe(text);
    await expect(verifyMirrorPayloadText(`${text}\n`, route)).rejects.toThrow(/size/i);
  });

  it("keeps every end-user economy transport on the owned origin", async () => {
    const [main, mobile, browser, vite, html, workflow] = await Promise.all([
      fs.readFile(new URL("../../electron/main.cjs", import.meta.url), "utf8"),
      fs.readFile(new URL("./mobile-bridge.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("./bridge.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../vite.config.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../index.html", import.meta.url), "utf8"),
      fs.readFile(new URL("../../.github/workflows/pages.yml", import.meta.url), "utf8"),
    ]);
    for (const runtime of [main, mobile, browser, vite]) {
      expect(runtime).not.toMatch(/https:\/\/poe\.ninja\/poe1\/api\/economy/);
    }
    expect(vite).not.toContain('"/poe-api"');
    const boundedBrowserReader = /async function browserMirrorBytes[\s\S]*?\n}\n\nfunction decodeBrowserMirrorJson/.exec(browser)?.[0];
    expect(boundedBrowserReader).toContain("response.body.getReader()");
    expect(boundedBrowserReader).not.toContain("response.arrayBuffer()");
    expect(html).toMatch(/connect-src[^;]*https:\/\/senkokg\.github\.io/);
    expect(html).not.toMatch(/connect-src[^;]*https:\/\/poe\.ninja/);
    expect(workflow).toContain('cron: "7,37 * * * *"');
    expect(workflow).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
    expect(workflow).toContain("node-version: 24.14.0");
  });
});
