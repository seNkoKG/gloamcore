import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const mirror = require("../electron/poe-ninja-mirror.cjs") as {
  isPoeNinjaMirrorManifest(value: unknown, now?: number): boolean;
  mirrorEnvelopeTimes(value: Record<string, number>, now?: number): {
    fetchedAt: number;
    expiresAt: number;
  };
};

function manifest(now: number) {
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
      source: "exchange",
      file: `routes/${index.toString(16).padStart(64, "0")}.json`,
      upstreamEtag: null,
      checkedAt: now,
      sourceUpdatedAt: now - 1_000,
      nextRefreshAt: now + 30 * 60 * 1000,
      bytes: 10,
      sha256: index.toString(16).padStart(64, "0"),
    })),
  };
}

describe("desktop market mirror contract", () => {
  it("accepts a complete bounded manifest", () => {
    const now = Date.now();
    const value = manifest(now);
    expect(mirror.isPoeNinjaMirrorManifest(value, now)).toBe(true);
    value.routes[1] = {
      ...value.routes[1],
      file: value.routes[0].file,
      bytes: value.routes[0].bytes,
      sha256: value.routes[0].sha256,
    };
    expect(mirror.isPoeNinjaMirrorManifest(value, now)).toBe(true);
  });

  it("rejects unbounded refresh times and snapshots older than two hours", () => {
    const now = Date.now();
    const value = manifest(now);
    value.leagueSnapshot.nextRefreshAt = Number.MAX_SAFE_INTEGER;
    expect(mirror.isPoeNinjaMirrorManifest(value, now)).toBe(false);
    const oversized = manifest(now);
    oversized.routes[0].bytes = 16 * 1024 * 1024 + 1;
    expect(mirror.isPoeNinjaMirrorManifest(oversized, now)).toBe(false);
    const mutablePath = manifest(now);
    mutablePath.routes[0].file = `routes/${"f".repeat(64)}.json`;
    expect(mirror.isPoeNinjaMirrorManifest(mutablePath, now)).toBe(false);
    expect(mirror.isPoeNinjaMirrorManifest({
      ...manifest(now),
      retainedPayloads: [{
        file: `routes/${"f".repeat(64)}.json`,
        sha256: "f".repeat(64),
        bytes: 10,
        lastReferencedAt: now - 1,
      }],
    }, now)).toBe(true);
    expect(() => mirror.mirrorEnvelopeTimes({
      checkedAt: now - 2 * 60 * 60 * 1000 - 1,
      sourceUpdatedAt: now - 2 * 60 * 60 * 1000 - 1,
      nextRefreshAt: now,
    }, now)).toThrow(/too old/i);
  });
});
