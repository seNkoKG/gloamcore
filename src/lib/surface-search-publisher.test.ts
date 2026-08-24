import { describe, expect, it, vi } from "vitest";
import { createSurfaceSearchPublisher } from "./surface-search-publisher";
import type { PublishableSurfaceSearchGroup } from "./surface-search-publisher";
import type { SurfaceSearchIndexUpdate } from "../types";

function group(signature: string, name = signature): PublishableSurfaceSearchGroup {
  return {
    id: "market",
    signature,
    league: "Current",
    fetchedAt: 1_000,
    rows: [{
      key: name,
      name,
      categoryId: "currency",
      categoryLabel: "Currency",
      source: "exchange",
      league: "Current",
      chaosValue: 1,
      divineValue: 0,
      change: 0,
      volume: 1,
      listingCount: null,
      lowConfidence: false,
    }],
  };
}

describe("surface search publisher", () => {
  it("commits signatures only after acknowledgement and resets after failure", async () => {
    const updates: SurfaceSearchIndexUpdate[] = [];
    const send = vi.fn(async (update: SurfaceSearchIndexUpdate) => {
      updates.push(update);
      if (updates.length === 1) throw new Error("transport failed");
    });
    const publisher = createSurfaceSearchPublisher("dashboard", send);
    const desired = new Map([["market", group("v1")]]);

    await expect(publisher.publish(desired)).rejects.toThrow("transport failed");
    await expect(publisher.publish(desired)).resolves.toBe(2);

    expect(updates).toMatchObject([
      { revision: 1, reset: true },
      { revision: 2, reset: true },
    ]);
    expect(updates[1].replace).toHaveLength(1);
  });

  it("serializes deltas and skips a snapshot that is already acknowledged", async () => {
    const updates: SurfaceSearchIndexUpdate[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const send = vi.fn(async (update: SurfaceSearchIndexUpdate) => {
      updates.push(update);
      if (updates.length === 1) await first;
    });
    const publisher = createSurfaceSearchPublisher("dashboard", send);
    const initial = new Map([["market", group("v1")]]);
    const changed = new Map([["market", group("v2")]]);

    const firstPublish = publisher.publish(initial);
    const secondPublish = publisher.publish(changed);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await expect(firstPublish).resolves.toBe(1);
    await expect(secondPublish).resolves.toBe(2);
    await expect(publisher.publish(changed)).resolves.toBe(2);

    expect(send).toHaveBeenCalledTimes(2);
    expect(updates[1]).toMatchObject({ revision: 2, reset: false });
  });
});
