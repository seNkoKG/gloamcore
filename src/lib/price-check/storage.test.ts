import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPriceCheckHistory,
  loadPriceCheckHistory,
  schedulePriceCheckHistorySave,
  savePriceCheckHistory,
} from "./storage";
import type { PriceCheckHistoryEntry } from "./types";

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
  vi.useRealTimers();
});

describe("price-check history storage", () => {
  it("rejects malformed storage and round-trips valid entries", () => {
    memory.set("ninja-lens:price-check-history:v1", "not json");
    expect(loadPriceCheckHistory()).toEqual([]);
    const entry = {
      id: "one",
      checkedAt: 42,
      league: "Current",
      item: {},
      estimate: {},
    } as PriceCheckHistoryEntry;
    savePriceCheckHistory([entry]);
    expect(loadPriceCheckHistory()).toEqual([entry]);
    clearPriceCheckHistory();
    expect(loadPriceCheckHistory()).toEqual([]);
  });

  it("defers and coalesces capture-path history persistence", () => {
    vi.useFakeTimers();
    const first = {
      id: "first",
      checkedAt: 42,
      league: "Current",
      item: {},
      estimate: {},
    } as PriceCheckHistoryEntry;
    const latest = { ...first, id: "latest", checkedAt: 43 };

    schedulePriceCheckHistorySave([first]);
    schedulePriceCheckHistorySave([latest]);
    expect(memory.has("ninja-lens:price-check-history:v1")).toBe(false);

    vi.runAllTimers();
    expect(loadPriceCheckHistory()).toEqual([latest]);
  });

  it("does not let a pending capture save repopulate cleared history", () => {
    vi.useFakeTimers();
    const entry = {
      id: "pending",
      checkedAt: 42,
      league: "Current",
      item: {},
      estimate: {},
    } as PriceCheckHistoryEntry;

    schedulePriceCheckHistorySave([entry]);
    clearPriceCheckHistory();
    vi.runAllTimers();

    expect(loadPriceCheckHistory()).toEqual([]);
  });
});
