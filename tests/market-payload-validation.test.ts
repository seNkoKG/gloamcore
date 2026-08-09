import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isOverviewPayload, isWikiCargoPayload, isWikiImageMetadataPayload } = require(
  "../electron/market-payload-validation.cjs",
) as Record<string, (value: unknown) => boolean>;

describe("desktop remote payload validation", () => {
  it("accepts a structurally safe economy payload", () => {
    expect(isOverviewPayload({
      items: [{ id: 1 }],
      currencyDetails: [{ name: "Chaos Orb" }],
      core: { items: [{ id: 1 }], rates: { 1: 1 } },
      lines: [{
        explicitModifiers: [{ text: "+(1-2) to Strength" }],
        sparkLine: { data: [null, 1, 2] },
      }],
    })).toBe(true);
  });

  it.each([
    { lines: [], items: [null] },
    { lines: [], currencyDetails: [null] },
    { lines: [], core: { items: [null], rates: {} } },
    { lines: [], core: { items: [], rates: [] } },
    { lines: [{ explicitModifiers: [null] }] },
    { lines: [{ sparkLine: { data: ["bad"] } }] },
  ])("rejects a corrupt overview before normalization", (payload) => {
    expect(isOverviewPayload(payload)).toBe(false);
  });

  it("rejects malformed wiki rows before tooltip/image normalization", () => {
    expect(isWikiCargoPayload({ cargoquery: [{ title: {} }] })).toBe(true);
    expect(isWikiCargoPayload({ cargoquery: [null] })).toBe(false);
    expect(isWikiImageMetadataPayload({
      query: { pages: [{ imageinfo: [{}] }] },
    })).toBe(true);
    expect(isWikiImageMetadataPayload({
      query: { pages: [{ imageinfo: [null] }] },
    })).toBe(false);
  });
});
