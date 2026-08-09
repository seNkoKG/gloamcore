import { describe, expect, it } from "vitest";
import {
  isOverviewPayload,
  isWikiCargoPayload,
  isWikiImagePayload,
} from "./mobile-bridge";

describe("mobile response payload validation", () => {
  it("requires every market line and associated array entry to be an object", () => {
    expect(isOverviewPayload({ lines: [] })).toBe(true);
    expect(isOverviewPayload({ lines: [null] })).toBe(false);
    expect(isOverviewPayload({ lines: [{}], items: [null] })).toBe(false);
    expect(
      isOverviewPayload({
        lines: [{ id: "one", sparkline: { data: [1, null, 2] } }],
        core: { items: [{ id: "one" }], rates: {} },
      }),
    ).toBe(true);
    expect(
      isOverviewPayload({ lines: [{ id: "one", explicitModifiers: "invalid" }] }),
    ).toBe(false);
  });

  it("rejects malformed Wiki row collections before caching them", () => {
    expect(isWikiCargoPayload({ cargoquery: [{ title: { name: "Divine Orb" } }] }))
      .toBe(true);
    expect(isWikiCargoPayload({ cargoquery: [null] })).toBe(false);
    expect(isWikiImagePayload({ query: { pages: [{ imageinfo: [] }] } })).toBe(
      true,
    );
    expect(isWikiImagePayload({ query: { pages: [null] } })).toBe(false);
  });
});
