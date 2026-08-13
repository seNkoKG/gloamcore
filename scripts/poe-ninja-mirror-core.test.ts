import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_LEAGUES,
  MAX_RECOVERY_RETAINED_PAYLOAD_AGE_MS,
  MAX_RETAINED_PAYLOAD_AGE_MS,
  MAX_ROUTE_BYTES,
  marketRoutes,
  parseManifestText,
  parseCategoryCatalog,
  publishMirrorGeneration,
  retainedPayloadsForGeneration,
  routeFile,
  validateMirrorManifest,
  validateLeagues,
  validateOverviewPayload,
  validateOutputLocation,
  validateOutputFilesystemLocation,
} from "./poe-ninja-mirror-core.mjs";

function generation(now: number, label: string) {
  const payloads = new Map<string, string>();
  const routes = Array.from({ length: 46 }, (_, index) => {
    const text = JSON.stringify({ lines: [{ id: `${label}-${index}` }] });
    const sha256 = createHash("sha256").update(text).digest("hex");
    const file = routeFile(sha256);
    payloads.set(file, text);
    return {
      league: "Standard",
      type: `Type ${index}`,
      source: "exchange",
      file,
      upstreamEtag: `W/\"${label}-${index}\"`,
      checkedAt: now,
      sourceUpdatedAt: now,
      nextRefreshAt: now + 30 * 60 * 1000,
      bytes: Buffer.byteLength(text),
      sha256,
    };
  });
  return {
    payloads,
    manifest: {
      schemaVersion: 1,
      generatedAt: now,
      cadenceMs: 30 * 60 * 1000,
      leagueSnapshot: {
        data: [{ id: "Standard", name: "Standard" }],
        upstreamEtag: 'W/"leagues"',
        checkedAt: now,
        sourceUpdatedAt: now,
        nextRefreshAt: now + 30 * 60 * 1000,
      },
      routes,
      retainedPayloads: [] as Array<{
        file: string;
        bytes: number;
        sha256: string;
        lastReferencedAt: number;
      }>,
    },
  };
}

describe("poe.ninja static mirror contract", () => {
  it("keeps the release matrix at 44 categories and 46 routes", async () => {
    const source = await fs.readFile(new URL("../src/config/categories.ts", import.meta.url), "utf8");
    const catalog = parseCategoryCatalog(source);
    const routes = marketRoutes(catalog);
    expect(catalog).toHaveLength(44);
    expect(routes).toHaveLength(46);
    expect(new Set(routes.map(({ source, type }) => `${source}:${type}`)).size).toBe(46);
    expect(MAX_ROUTE_BYTES).toBe(16 * 1024 * 1024);
  });

  it("uses immutable content-addressed route files", () => {
    const first = createHash("sha256").update("first").digest("hex");
    const second = createHash("sha256").update("second").digest("hex");
    expect(routeFile(first)).toBe(`routes/${first}.json`);
    expect(routeFile(first)).not.toBe(routeFile(second));
    expect(() => routeFile("not-a-digest")).toThrow(/digest/i);
  });

  it("keeps retained routes inside the released client compatibility window", () => {
    expect(MAX_RETAINED_PAYLOAD_AGE_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("accepts an older manifest for recovery without republishing incompatible routes", () => {
    const now = Date.now();
    const previous = generation(now, "previous").manifest;
    const text = JSON.stringify({
      ...previous,
      retainedPayloads: [{
        file: routeFile("f".repeat(64)),
        bytes: 10,
        sha256: "f".repeat(64),
        lastReferencedAt: now - 3 * 60 * 60 * 1000,
      }],
    });
    expect(parseManifestText(text)).toBeNull();
    const recovery = parseManifestText(text, {
      maxRetainedPayloadAgeMs: MAX_RECOVERY_RETAINED_PAYLOAD_AGE_MS,
    });
    expect(recovery).not.toBeNull();
    expect(retainedPayloadsForGeneration(recovery, previous.routes, now)).toEqual([]);
  });

  it("keeps old and new manifests loadable across a mixed Pages deployment", { timeout: 30_000 }, async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "gloamcore-mirror-race-"));
    try {
      const siteRoot = path.join(temporary, "site");
      const output = path.join(siteRoot, "data", "poe-ninja", "v1");
      await fs.mkdir(siteRoot, { recursive: true });
      const first = generation(Date.now() - MAX_RETAINED_PAYLOAD_AGE_MS, "old");
      await publishMirrorGeneration({
        output,
        siteRoot,
        projectRoot: process.cwd(),
        manifest: first.manifest,
        payloads: first.payloads,
      });

      const second = generation(first.manifest.generatedAt + 30 * 60 * 1000, "new");
      second.manifest.retainedPayloads = retainedPayloadsForGeneration(
        first.manifest,
        second.manifest.routes,
        second.manifest.generatedAt,
      );
      for (const payload of second.manifest.retainedPayloads) {
        second.payloads.set(payload.file, first.payloads.get(payload.file)!);
      }
      await publishMirrorGeneration({
        output,
        siteRoot,
        projectRoot: process.cwd(),
        manifest: second.manifest,
        payloads: second.payloads,
      });

      const oldRoute = first.manifest.routes[0];
      const newRoute = second.manifest.routes[0];
      expect(await fs.readFile(path.join(output, oldRoute.file), "utf8"))
        .toBe(first.payloads.get(oldRoute.file));
      expect(await fs.readFile(path.join(output, newRoute.file), "utf8"))
        .toBe(second.payloads.get(newRoute.file));
      expect(validateMirrorManifest(JSON.parse(
        await fs.readFile(path.join(output, "manifest.json"), "utf8"),
      ))).toBe(true);
      const publishedManifest = await fs.readFile(path.join(output, "manifest.json"), "utf8");
      const corruptPayloads = new Map(second.payloads);
      corruptPayloads.set(newRoute.file, "corrupt");
      await expect(publishMirrorGeneration({
        output,
        siteRoot,
        projectRoot: process.cwd(),
        manifest: second.manifest,
        payloads: corruptPayloads,
      })).rejects.toThrow(/integrity/i);
      expect(await fs.readFile(path.join(output, "manifest.json"), "utf8"))
        .toBe(publishedManifest);

      const third = generation(
        first.manifest.generatedAt + MAX_RETAINED_PAYLOAD_AGE_MS + 1,
        "latest",
      );
      third.manifest.retainedPayloads = retainedPayloadsForGeneration(
        second.manifest,
        third.manifest.routes,
        third.manifest.generatedAt,
      );
      for (const payload of third.manifest.retainedPayloads) {
        third.payloads.set(payload.file, second.payloads.get(payload.file)!);
      }
      await publishMirrorGeneration({
        output,
        siteRoot,
        projectRoot: process.cwd(),
        manifest: third.manifest,
        payloads: third.payloads,
      });
      await expect(fs.stat(path.join(output, oldRoute.file))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.stat(path.join(output, newRoute.file))).resolves.toBeDefined();
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it("accepts the current four leagues without freezing future rotations to four", () => {
    expect(validateLeagues([
      { id: "Allflame", name: "Allflame" },
      { id: "Hardcore Allflame", name: "Hardcore Allflame" },
      { id: "Standard", name: "Standard" },
      { id: "Hardcore", name: "Hardcore" },
    ])).toHaveLength(4);
    expect(validateLeagues([{ id: "Standard", name: "Standard" }])).toHaveLength(1);
    expect(() => validateLeagues(Array.from(
      { length: MAX_ACTIVE_LEAGUES + 1 },
      (_, index) => ({ id: `League ${index}`, name: `League ${index}` }),
    ))).toThrow(/between 1 and/i);
  });

  it("rejects malformed market payloads and incomplete manifests", () => {
    expect(validateOverviewPayload({ lines: [{ id: 1 }] })).toBe(true);
    expect(validateOverviewPayload({ lines: [null] })).toBe(false);
    expect(validateOverviewPayload({ lines: [], core: { rates: [] } })).toBe(false);
    expect(validateMirrorManifest({ schemaVersion: 1, routes: [] })).toBe(false);
  });

  it("rejects an output outside the site root before the builder performs I/O", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "gloamcore-mirror-path-"));
    try {
      const siteRoot = path.join(temporary, "site");
      const outside = path.join(temporary, "outside");
      const routes = path.join(outside, "routes");
      await fs.mkdir(routes, { recursive: true });
      const sentinel = path.join(routes, "keep.txt");
      await fs.writeFile(sentinel, "keep", "utf8");
      expect(() => validateOutputLocation(outside, siteRoot, process.cwd())).toThrow(/child/i);
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("./build-poe-ninja-mirror.mjs", import.meta.url)),
        "--output",
        outside,
        "--site-root",
        siteRoot,
      ], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(await fs.readFile(sentinel, "utf8")).toBe("keep");
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it("accepts the workflow's not-yet-created output descendants", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "gloamcore-mirror-new-"));
    try {
      const siteRoot = path.join(temporary, "pages-site");
      const output = path.join(siteRoot, "data", "poe-ninja", "v1");
      await fs.mkdir(siteRoot, { recursive: true });
      await expect(
        validateOutputFilesystemLocation(output, siteRoot, process.cwd()),
      ).resolves.toBe(path.resolve(output));
      await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it("does not follow an existing output junction to an outside sentinel", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "gloamcore-mirror-link-"));
    try {
      const siteRoot = path.join(temporary, "site");
      const outside = path.join(temporary, "outside");
      const output = path.join(siteRoot, "mirror");
      const outsideRoutes = path.join(outside, "routes");
      await fs.mkdir(siteRoot, { recursive: true });
      await fs.mkdir(outsideRoutes, { recursive: true });
      const sentinel = path.join(outsideRoutes, "keep.txt");
      await fs.writeFile(sentinel, "keep", "utf8");
      try {
        await fs.symlink(outside, output, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
          return;
        }
        throw error;
      }
      await expect(
        validateOutputFilesystemLocation(output, siteRoot, process.cwd()),
      ).rejects.toThrow(/symbolic link/i);
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("./build-poe-ninja-mirror.mjs", import.meta.url)),
        "--output",
        output,
        "--site-root",
        siteRoot,
      ], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(await fs.readFile(sentinel, "utf8")).toBe("keep");
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
});
