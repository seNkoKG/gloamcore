import { describe, expect, it } from "vitest";
import type { RegexDataCategory } from "./regex-data";
import { pruneRegexSelections } from "./regex-profile-state";

function category(overrides: Partial<RegexDataCategory> = {}): RegexDataCategory {
  return {
    id: "maps",
    label: "Maps",
    kind: "modifier",
    section: "core",
    description: "",
    sourceIds: [],
    entries: [{ entryId: "current", optimized: "current" }],
    search: {
      placeholder: "Search",
      aliases: [],
      defaultMode: "avoid",
      supportsAvoid: true,
      supportsWant: true,
      supportsMatchAny: true,
      supportsMatchAll: true,
      supportsExact: true,
      supportsOptimized: true,
    },
    optimization: { algorithm: "shortest-unique-literal-v1", universeSha256: "test", verified: true, exactFallbacks: 0 },
    ...overrides,
  };
}

describe("regex profile selection pruning", () => {
  it("removes stale IDs, missing categories, and no-longer-supported modes", () => {
    const result = pruneRegexSelections({
      maps: { current: "avoid", removed: "want" },
      missing: { orphan: "avoid" },
      wantless: { valid: "want" },
    }, [
      category(),
      category({
        id: "wantless",
        entries: [{ entryId: "valid", optimized: "valid" }],
        search: { ...category().search, supportsWant: false },
      }),
    ]);

    expect(result.selections).toEqual({ maps: { current: "avoid" } });
    expect(result.removed).toBe(3);
  });
});
