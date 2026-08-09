import { beforeAll, describe, expect, it, vi } from "vitest";

let normalizedSourceForCategory: typeof import("./App")["normalizedSourceForCategory"];
let sourceByCategoryWith: typeof import("./App")["sourceByCategoryWith"];

beforeAll(async () => {
  vi.stubGlobal("window", {
    location: { search: "" },
    poeWidget: undefined,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  ({ normalizedSourceForCategory, sourceByCategoryWith } = await import("./App"));
});

describe("market navigation source normalization", () => {
  it("routes a stale Faustus selection to the category's supported source", () => {
    expect(normalizedSourceForCategory("currency", "faustus")).toBe("exchange");
    expect(normalizedSourceForCategory("unique-jewels", "faustus")).toBe(
      "stash-item",
    );
  });

  it("keeps supported alternate sources unchanged", () => {
    expect(normalizedSourceForCategory("currency", "stash-currency")).toBe(
      "stash-currency",
    );
    expect(normalizedSourceForCategory("unique-jewels", "stash-item")).toBe(
      "stash-item",
    );
  });

  it("merges a source change into the latest category map", () => {
    const current = {
      currency: "stash-currency",
      fragments: "exchange",
    } as const;

    expect(sourceByCategoryWith(current, "fragments", "stash-currency")).toEqual({
      currency: "stash-currency",
      fragments: "stash-currency",
    });
  });
});
