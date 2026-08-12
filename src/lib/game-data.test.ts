import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fetchGameDataBundle,
  isAtlasDataPack,
  isGameDataManifest,
  isNavigatorDataPack,
} from "./game-data";

const dataRoot = resolve(process.cwd(), "public", "data", "game", "v1");
const manifestBytes = readFileSync(resolve(dataRoot, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const atlasBytes = readFileSync(resolve(dataRoot, manifest.packs.atlas.file));
const navigatorBytes = readFileSync(resolve(dataRoot, manifest.packs.navigator.file));

function packFetch(overrides: Record<string, Uint8Array> = {}) {
  const bodies: Record<string, Uint8Array> = {
    "manifest.json": manifestBytes,
    [manifest.packs.atlas.file]: atlasBytes,
    [manifest.packs.navigator.file]: navigatorBytes,
    ...overrides,
  };
  return (async (input: string | URL | Request) => {
    const name = new URL(String(input)).pathname.split("/").at(-1) || "";
    const body = bodies[name];
    return body
      ? new Response(body, { status: 200, headers: { "content-length": String(body.byteLength) } })
      : new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("patch-safe game data", () => {
  it("accepts the generated manifest and both complete PoE 3.29 packs", async () => {
    expect(isGameDataManifest(manifest)).toBe(true);
    expect(isAtlasDataPack(JSON.parse(atlasBytes.toString("utf8")), manifest.gameVersion)).toBe(true);
    expect(isNavigatorDataPack(JSON.parse(navigatorBytes.toString("utf8")), manifest.gameVersion)).toBe(true);
    const bundle = await fetchGameDataBundle("https://example.test/data/game/v1", "remote", packFetch());
    expect(bundle.manifest.gameVersion).toBe(manifest.gameVersion);
    expect(bundle.atlas.nodes.length).toBeGreaterThan(900);
    expect(bundle.navigator.acts).toHaveLength(10);
    expect(bundle.navigator.art.bandits.alira.url).toContain("poewiki.net/images/");
  });

  it("rejects a corrupt pack before parsing or activation", async () => {
    const corrupt = new Uint8Array(atlasBytes);
    corrupt[100] ^= 1;
    await expect(fetchGameDataBundle(
      "https://example.test/data/game/v1",
      "remote",
      packFetch({ [manifest.packs.atlas.file]: corrupt }),
    )).rejects.toThrow("integrity verification failed");
  });

  it("rejects an Atlas graph with a one-way or missing edge", () => {
    const atlas = JSON.parse(atlasBytes.toString("utf8"));
    atlas.nodes[0].neighbors = [999_999];
    expect(isAtlasDataPack(atlas, manifest.gameVersion)).toBe(false);
  });

  it("rejects Atlas art packs that cannot render the official node and path layers", () => {
    const atlas = JSON.parse(atlasBytes.toString("utf8"));
    delete atlas.sprites.frame.coords.NotableFrameAllocated;
    expect(isAtlasDataPack(atlas, manifest.gameVersion)).toBe(false);
  });
});
