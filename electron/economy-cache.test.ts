import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const cacheModule = require("./economy-cache.cjs") as {
  DEFAULT_DISK_MAX_BYTES: number;
  DEFAULT_MAX_FILE_BYTES: number;
  DEFAULT_MEMORY_MAX_BYTES: number;
  DEFAULT_SWEEP_YIELD_EVERY: number;
  cacheFilename(key: string): string;
  legacyCacheFilename(key: string): string;
  createEconomyCache(options: Record<string, unknown>): {
    deleteMemory(key: string): void;
    get(key: string, options?: Record<string, unknown>): Promise<CacheEnvelope | null>;
    memoryStats(): { entries: number; bytes: number };
    set(
      key: string,
      value: CacheEnvelope,
      options?: { staleUntil?: number | null; sizeHint?: number | null },
    ): Promise<unknown>;
    sweep(): Promise<Record<string, number>>;
  };
};

type CacheEnvelope = {
  data: unknown;
  etag?: string;
  fetchedAt: number;
  expiresAt: number;
};

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gloamcore-cache-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function envelope(data: unknown, fetchedAt = 1_000, expiresAt = 2_000): CacheEnvelope {
  return { data, fetchedAt, expiresAt };
}

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("economy cache", () => {
  it("uses exact-key hashed filenames even when legacy names collide", async () => {
    const directory = await temporaryDirectory();
    const cache = cacheModule.createEconomyCache({ directory });
    const leftKey = "wiki:a/b";
    const rightKey = "wiki:a?b";

    expect(cacheModule.legacyCacheFilename(leftKey))
      .toBe(cacheModule.legacyCacheFilename(rightKey));
    expect(cacheModule.cacheFilename(leftKey)).not.toBe(cacheModule.cacheFilename(rightKey));

    await cache.set(leftKey, envelope("left"));
    await cache.set(rightKey, envelope("right"));
    const reloaded = cacheModule.createEconomyCache({ directory });

    await expect(reloaded.get(leftKey)).resolves.toMatchObject({ data: "left" });
    await expect(reloaded.get(rightKey)).resolves.toMatchObject({ data: "right" });
    expect((await fs.readdir(directory)).sort()).toEqual([
      cacheModule.cacheFilename(leftKey),
      cacheModule.cacheFilename(rightKey),
    ].sort());
  });

  it("does not read or migrate ambiguous legacy filenames without authorization", async () => {
    const directory = await temporaryDirectory();
    const leftKey = "wiki:a/b";
    const rightKey = "wiki:a?b";
    const legacyTarget = path.join(directory, cacheModule.legacyCacheFilename(leftKey));
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(legacyTarget, JSON.stringify(envelope("left-only")), "utf8");

    const cache = cacheModule.createEconomyCache({ directory });
    await expect(cache.get(rightKey)).resolves.toBeNull();
    expect(await exists(legacyTarget)).toBe(true);
    expect(await exists(path.join(directory, cacheModule.cacheFilename(rightKey)))).toBe(false);
  });

  it("rejects a checksum mismatch anywhere in the persisted envelope", async () => {
    const directory = await temporaryDirectory();
    const key = "checksummed";
    const target = path.join(directory, cacheModule.cacheFilename(key));
    const cache = cacheModule.createEconomyCache({ directory });
    await cache.set(key, { ...envelope({ rows: [1] }), etag: "first" });

    const record = JSON.parse(await fs.readFile(target, "utf8"));
    record.envelope.fetchedAt += 1;
    await fs.writeFile(target, JSON.stringify(record), "utf8");

    const reloaded = cacheModule.createEconomyCache({ directory });
    await expect(reloaded.get(key)).resolves.toBeNull();
    expect(await exists(target)).toBe(false);
  });

  it("validates legacy values before migrating them into the exact-key format", async () => {
    const directory = await temporaryDirectory();
    const key = "legacy-route";
    const legacyTarget = path.join(directory, cacheModule.legacyCacheFilename(key));
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(legacyTarget, JSON.stringify(envelope({ rows: [1] }, 1_000, 1_100)));
    const cache = cacheModule.createEconomyCache({ directory, now: () => 1_100 });

    await expect(cache.get(key, {
      validate: (candidate: CacheEnvelope) => Array.isArray((candidate.data as { rows?: unknown }).rows),
      legacyStaleUntil: (candidate: CacheEnvelope) => candidate.fetchedAt + 200,
    })).resolves.toMatchObject({ data: { rows: [1] } });

    const migratedTarget = path.join(directory, cacheModule.cacheFilename(key));
    const migrated = JSON.parse(await fs.readFile(migratedTarget, "utf8"));
    expect(migrated).toMatchObject({ key, staleUntil: 1_200 });
    expect(await exists(legacyTarget)).toBe(false);

    const rejectedKey = "legacy-wrong";
    const rejectedTarget = path.join(directory, cacheModule.legacyCacheFilename(rejectedKey));
    await fs.writeFile(rejectedTarget, JSON.stringify(envelope("wrong")));
    await expect(cache.get(rejectedKey, {
      validate: (candidate: CacheEnvelope) => typeof candidate.data === "object",
    })).resolves.toBeNull();
    expect(await exists(rejectedTarget)).toBe(true);
    expect(await exists(path.join(directory, cacheModule.cacheFilename(rejectedKey)))).toBe(false);
  });

  it("migrates an authorized signed v3 mirror legacy entry", async () => {
    const directory = await temporaryDirectory();
    const key = "v3-mirror-Keepers-stash-item-UniqueWeapon";
    const expectedSha256 = "a".repeat(64);
    const expectedBytes = 321;
    const legacyTarget = path.join(directory, cacheModule.legacyCacheFilename(key));
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(legacyTarget, JSON.stringify({
      ...envelope({ lines: [{ id: 1 }] }, 1_000, 1_100),
      integritySha256: expectedSha256,
      integrityBytes: expectedBytes,
    }), "utf8");
    const cache = cacheModule.createEconomyCache({
      directory,
      now: () => 1_100,
      obsoletePatterns: [/^poe1-leagues\.json$/i],
    });

    await cache.sweep();
    expect(await exists(legacyTarget)).toBe(true);
    await expect(cache.get(key)).resolves.toBeNull();
    await expect(cache.get(key, {
      allowUnsafeLegacyMigration: true,
      validate: (candidate: CacheEnvelope & {
        integritySha256?: string;
        integrityBytes?: number;
      }) => candidate.integritySha256 === expectedSha256 &&
        candidate.integrityBytes === expectedBytes,
      legacyStaleUntil: (candidate: CacheEnvelope) => candidate.fetchedAt + 200,
    })).resolves.toMatchObject({ data: { lines: [{ id: 1 }] } });

    const migratedTarget = path.join(directory, cacheModule.cacheFilename(key));
    expect(await exists(legacyTarget)).toBe(false);
    expect(JSON.parse(await fs.readFile(migratedTarget, "utf8")))
      .toMatchObject({ key, staleUntil: 1_200 });
  });

  it("touches memory entries as an LRU and honors its independent byte budget", async () => {
    const directory = await temporaryDirectory();
    const cache = cacheModule.createEconomyCache({
      directory,
      memoryMaxEntries: 2,
      memoryMaxBytes: 1024 * 1024,
    });
    await cache.set("a", envelope("a"));
    await cache.set("b", envelope("b"));
    await cache.get("a");
    await cache.set("c", envelope("c"));
    await Promise.all(["a", "b", "c"].map((key) =>
      fs.unlink(path.join(directory, cacheModule.cacheFilename(key))),
    ));

    await expect(cache.get("a")).resolves.toMatchObject({ data: "a" });
    await expect(cache.get("b")).resolves.toBeNull();
    await expect(cache.get("c")).resolves.toMatchObject({ data: "c" });

    const oversizedDirectory = await temporaryDirectory();
    const oversized = cacheModule.createEconomyCache({
      directory: oversizedDirectory,
      memoryMaxBytes: 256,
    });
    await oversized.set("large", envelope("x".repeat(2_048)));
    expect(oversized.memoryStats()).toEqual({ entries: 0, bytes: 0 });
    await expect(oversized.get("large")).resolves.toMatchObject({ data: expect.any(String) });
    expect(oversized.memoryStats()).toEqual({ entries: 0, bytes: 0 });
  });

  it("keeps disk-oversized values in memory and removes an older disk copy", async () => {
    const directory = await temporaryDirectory();
    const cache = cacheModule.createEconomyCache({
      directory,
      maxFileBytes: 512,
      memoryMaxBytes: 4 * 1024,
    });
    const target = path.join(directory, cacheModule.cacheFilename("large"));
    await cache.set("large", envelope("small"));
    expect(await exists(target)).toBe(true);

    await expect(cache.set("large", envelope("x".repeat(2_048))))
      .resolves.toMatchObject({ persisted: false });
    expect(await exists(target)).toBe(false);
    expect(cache.memoryStats().entries).toBe(1);
    await expect(cache.get("large")).resolves.toMatchObject({ data: expect.any(String) });

    const reloaded = cacheModule.createEconomyCache({ directory, maxFileBytes: 512 });
    await expect(reloaded.get("large")).resolves.toBeNull();
  });

  it("uses a network size hint to bypass synchronous encoding for a large response", async () => {
    const directory = await temporaryDirectory();
    const cache = cacheModule.createEconomyCache({
      directory,
      maxFileBytes: 512,
      memoryMaxBytes: 4 * 1024,
    });
    const data = {
      toJSON() {
        throw new Error("large response should not be stringified");
      },
    };

    await expect(cache.set("hinted", envelope(data), { sizeHint: 1_024 }))
      .resolves.toMatchObject({ persisted: false });
    await expect(cache.get("hinted")).resolves.toMatchObject({ data });
    expect(await exists(path.join(directory, cacheModule.cacheFilename("hinted"))))
      .toBe(false);
  });

  it("sweeps hard-expired, invalid, retired, and abandoned files without using HTTP expiry", async () => {
    const directory = await temporaryDirectory();
    const clock = Date.now();
    let sweepClock = clock - 10;
    const yielded = vi.fn(async () => undefined);
    const cache = cacheModule.createEconomyCache({
      directory,
      now: () => sweepClock,
      obsoletePatterns: [/^poe1-leagues\.json$/i],
      yieldControl: yielded,
    });
    await cache.set("hard-expired", envelope("dead", clock - 1_000, clock + 50_000), {
      staleUntil: clock - 1,
    });
    await cache.set("at-boundary", envelope("boundary", clock - 1_000, clock - 500), {
      staleUntil: clock,
    });
    await cache.set("unbounded", envelope("stale", clock - 100_000, clock - 50_000), {
      staleUntil: null,
    });
    await fs.writeFile(path.join(directory, "invalid.json"), "{broken", "utf8");
    await fs.writeFile(
      path.join(directory, "poe1-leagues.json"),
      JSON.stringify(envelope("retired", clock - 1_000, clock + 1_000)),
    );
    const temporary = path.join(directory, "orphan.json.1.test.tmp");
    await fs.writeFile(temporary, "orphan", "utf8");
    await fs.utimes(temporary, new Date(clock - 2 * 60 * 60 * 1000), new Date(clock - 2 * 60 * 60 * 1000));

    sweepClock = clock;
    yielded.mockClear();
    const result = await cache.sweep();
    expect(result).toMatchObject({
      removedExpired: 1,
      removedInvalid: 1,
      removedObsolete: 1,
      removedTemporary: 1,
    });
    expect(yielded).toHaveBeenCalledTimes(result.scanned);
    expect(await exists(path.join(directory, cacheModule.cacheFilename("hard-expired")))).toBe(false);
    expect(await exists(path.join(directory, cacheModule.cacheFilename("at-boundary")))).toBe(true);
    expect(await exists(path.join(directory, cacheModule.cacheFilename("unbounded")))).toBe(true);
  });

  it("enforces entry and byte quotas before concurrent awaited writes resolve", async () => {
    const directory = await temporaryDirectory();
    const cache = cacheModule.createEconomyCache({
      directory,
      diskMaxEntries: 2,
      diskMaxBytes: 1024 * 1024,
    });
    await Promise.all([
      cache.set("oldest", envelope("old", 1_000, 2_000)),
      cache.set("middle", envelope("middle", 2_000, 3_000)),
      cache.set("newest", envelope("new", 3_000, 4_000)),
    ]);

    expect(await exists(path.join(directory, cacheModule.cacheFilename("oldest")))).toBe(false);
    expect(await exists(path.join(directory, cacheModule.cacheFilename("middle")))).toBe(true);
    expect(await exists(path.join(directory, cacheModule.cacheFilename("newest")))).toBe(true);

    const probeDirectory = await temporaryDirectory();
    const probe = cacheModule.createEconomyCache({ directory: probeDirectory });
    await probe.set("byte-oldest", envelope("a".repeat(512), 1_000, 2_000));
    const recordBytes = (await fs.stat(
      path.join(probeDirectory, cacheModule.cacheFilename("byte-oldest")),
    )).size;
    const byteDirectory = await temporaryDirectory();
    const byteCache = cacheModule.createEconomyCache({
      directory: byteDirectory,
      diskMaxEntries: 10,
      diskMaxBytes: recordBytes * 2,
    });
    await byteCache.set("byte-oldest", envelope("a".repeat(512), 1_000, 2_000));
    await byteCache.set("byte-middle", envelope("b".repeat(512), 2_000, 3_000));
    await byteCache.set("byte-newest", envelope("c".repeat(512), 3_000, 4_000));
    expect(await exists(path.join(byteDirectory, cacheModule.cacheFilename("byte-oldest"))))
      .toBe(false);
    expect(await exists(path.join(byteDirectory, cacheModule.cacheFilename("byte-middle"))))
      .toBe(true);
    expect(await exists(path.join(byteDirectory, cacheModule.cacheFilename("byte-newest"))))
      .toBe(true);
  });

  it("reports when the just-written record is immediately evicted by policy", async () => {
    const directory = await temporaryDirectory();
    const cache = cacheModule.createEconomyCache({
      directory,
      diskMaxEntries: 0,
      diskMaxBytes: 1024 * 1024,
    });

    await expect(cache.set("memory-only-by-quota", envelope("value")))
      .resolves.toMatchObject({ persisted: false });
    expect(await exists(path.join(
      directory,
      cacheModule.cacheFilename("memory-only-by-quota"),
    ))).toBe(false);
    await expect(cache.get("memory-only-by-quota"))
      .resolves.toMatchObject({ data: "value" });
  });

  it("serializes same-key writes and leaves no shared temporary file", async () => {
    const directory = await temporaryDirectory();
    let identifier = 0;
    const cache = cacheModule.createEconomyCache({
      directory,
      randomId: () => `write-${identifier += 1}`,
    });
    await Promise.all([
      cache.set("race", envelope("first")),
      cache.set("race", envelope("second")),
    ]);

    const reloaded = cacheModule.createEconomyCache({ directory });
    await expect(reloaded.get("race")).resolves.toMatchObject({ data: "second" });
    expect((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a linked cache root and never follows linked child directories", async () => {
    const base = await temporaryDirectory();
    const realRoot = path.join(base, "real-root");
    const linkedRoot = path.join(base, "linked-root");
    await fs.mkdir(realRoot);
    await fs.symlink(realRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    const linkedCache = cacheModule.createEconomyCache({ directory: linkedRoot });
    await expect(linkedCache.sweep()).rejects.toThrow(/safe regular directory/i);
    await fs.unlink(linkedRoot);

    const outside = path.join(base, "outside");
    const cacheRoot = path.join(base, "cache");
    await fs.mkdir(outside);
    await fs.mkdir(cacheRoot);
    const sentinel = path.join(outside, "sentinel.json");
    await fs.writeFile(sentinel, "outside", "utf8");
    const linkedChild = path.join(cacheRoot, "escape.json");
    await fs.symlink(outside, linkedChild, process.platform === "win32" ? "junction" : "dir");
    const cache = cacheModule.createEconomyCache({ directory: cacheRoot });
    await cache.sweep();
    expect(await fs.readFile(sentinel, "utf8")).toBe("outside");
    expect(await exists(linkedChild)).toBe(true);
    await fs.unlink(linkedChild);
  });

  it("caps disk records at 24 MiB while retaining large responses in memory", () => {
    const maximumMarketPayload = 64 * 1024 * 1024;
    expect(cacheModule.DEFAULT_MAX_FILE_BYTES).toBe(24 * 1024 * 1024);
    expect(cacheModule.DEFAULT_SWEEP_YIELD_EVERY).toBe(1);
    expect(cacheModule.DEFAULT_MEMORY_MAX_BYTES).toBeGreaterThan(maximumMarketPayload);
    expect(cacheModule.DEFAULT_DISK_MAX_BYTES).toBeGreaterThan(maximumMarketPayload);
  });

  it("keeps the existing main-process stale fallback policies", async () => {
    const source = await fs.readFile(new URL("./main.cjs", import.meta.url), "utf8");
    expect(source).toContain("const MAX_MARKET_STALE_MS = 2 * 60 * 60 * 1000;");
    expect(source).toContain("maxStaleMs = Number.POSITIVE_INFINITY");
    expect([...source.matchAll(/maxStaleMs:\s*([A-Z_]+)/g)].map((match) => match[1]))
      .toEqual(["MAX_ACTIONABLE_MIRROR_AGE_MS", "MAX_MARKET_STALE_MS"]);
    expect(source).toContain("expectedSha256: route.sha256");
    expect(source).toContain("allowUnsafeLegacyMigration: Boolean(expectedSha256)");
    expect(source).toContain("writeDiskCacheBestEffort(key, value, maxStaleMs, body.length)");
    expect(source).toContain("sourceBytes: body.length");
    const retiredPatterns = /const RETIRED_CACHE_PATTERNS = Object\.freeze\(\[[\s\S]*?\]\);/
      .exec(source)?.[0];
    expect(retiredPatterns).not.toMatch(/exchange\|stash/);

    const artwork = /async function getCachedRemoteImageDataUrl[\s\S]*?\n}\n\nfunction getMirrorManifest/.exec(source)?.[0];
    expect(artwork).toContain("legacyStaleUntil: null");
    expect(artwork).toContain("return cached?.data;");
  });
});
