import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("QuickSearchSurface freshness", () => {
  it("starts a new bounded market query whenever the hidden window regains focus", () => {
    const source = readFileSync(new URL("./QuickSearchSurface.tsx", import.meta.url), "utf8");
    const focusHandler = /const focus = \(\) => \{[\s\S]*?\n    \};/.exec(source)?.[0];
    expect(focusHandler).toContain("setFocusRevision");
    expect(source).toMatch(
      /\[commands\.length, focusRevision, query, state\?\.league, state\?\.searchRevision\]/,
    );
    expect(source).toContain("setMarketSearch(null)");
  });

  it("never renders market rows from an earlier request key", () => {
    const source = readFileSync(new URL("./QuickSearchSurface.tsx", import.meta.url), "utf8");
    expect(source).toContain("keyedMarketSearch?.requestKey === searchKey");
    expect(source).toContain("setMarketSearch({ requestKey: searchKey, result })");
    expect(source).toContain("searching || !currentSearchSettled");
  });
});
