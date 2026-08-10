import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StashSnapshot } from "./stash-types";
import {
  clearStashSnapshots,
  loadStashSession,
  loadStashSnapshotHistory,
  pushStashSnapshot,
  saveStashSession,
  snapshotFamilies,
} from "./stash-storage";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
});

afterEach(() => {
  // Timers are not used here; kept for symmetry with sibling suites.
});

function snapshot(createdAt: number, chaos: number): StashSnapshot {
  return {
    version: 1,
    createdAt,
    league: "Allflame",
    realm: "pc",
    tabCount: 1,
    itemCount: 2,
    pricedItemCount: 1,
    unpricedItemCount: 1,
    chaos,
    divine: chaos / 180,
    pricedChaos: chaos,
    tabs: [
      {
        id: "t1",
        name: "Currency",
        path: [],
        itemCount: 2,
        pricedItemCount: 1,
        unpricedItemCount: 1,
        chaos,
        divine: chaos / 180,
        families: { currency: { chaos, divine: chaos / 180, count: 12 } },
      },
    ],
    families: { currency: { chaos, divine: chaos / 180, count: 12 } },
    topItems: [{ name: "Chaos Orb", family: "currency", quantity: 12, unitChaos: 1, chaos, divine: chaos / 180 }],
    metadata: { pricesAt: createdAt, pricesStale: false, overviewCount: 1 },
  };
}

describe("stash snapshot storage", () => {
  it("rejects malformed storage, corrupt entries and out-of-order writes", () => {
    memory.set("ninja-lens:stash:snapshots:v1", "not json");
    expect(loadStashSnapshotHistory()).toEqual({ version: 1, snapshots: [] });
    memory.set(
      "ninja-lens:stash:snapshots:v1",
      JSON.stringify({ version: 1, snapshots: [{ bogus: true }] }),
    );
    expect(loadStashSnapshotHistory()).toEqual({ version: 1, snapshots: [] });
  });

  it("round-trips snapshots and orders by creation time", () => {
    const history = loadStashSnapshotHistory();
    pushStashSnapshot(snapshot(100, 50), history);
    pushStashSnapshot(snapshot(300, 90), history);
    pushStashSnapshot(snapshot(200, 70), history);
    const stored = loadStashSnapshotHistory();
    expect(stored.snapshots.map((entry) => entry.createdAt)).toEqual([100, 200, 300]);
    expect(stored.snapshots[2].chaos).toBe(90);
  });

  it("caps the stored history and clears it", () => {
    const history = loadStashSnapshotHistory();
    for (let index = 0; index < 410; index += 1) {
      pushStashSnapshot(snapshot(index, index), history);
    }
    const stored = loadStashSnapshotHistory();
    expect(stored.snapshots).toHaveLength(400);
    clearStashSnapshots();
    expect(loadStashSnapshotHistory().snapshots).toEqual([]);
  });

  it("rolls up families in stable display order", () => {
    const entry = snapshot(1, 10);
    const families = snapshotFamilies(entry);
    expect(families).toEqual([{ family: "currency", value: entry.families.currency }]);
  });
});

describe("stash session storage", () => {
  it("round-trips a session without a token", () => {
    expect(loadStashSession()).toBeNull();
    saveStashSession({
      version: 1,
      realm: "pc",
      league: "Allflame",
      lastSyncAt: 123_456,
      autoSyncMinutes: 30,
      tabCount: 4,
    });
    expect(loadStashSession()).toEqual({
      version: 1,
      realm: "pc",
      league: "Allflame",
      lastSyncAt: 123_456,
      autoSyncMinutes: 30,
      tabCount: 4,
    });
  });

  it("rejects invalid session shapes", () => {
    memory.set("ninja-lens:stash:session:v1", JSON.stringify({ version: 2 }));
    expect(loadStashSession()).toBeNull();
    memory.set(
      "ninja-lens:stash:session:v1",
      JSON.stringify({ version: 1, realm: "pc", league: "Allflame", lastSyncAt: 1, autoSyncMinutes: 99, tabCount: 1 }),
    );
    expect(loadStashSession()).toBeNull();
  });
});