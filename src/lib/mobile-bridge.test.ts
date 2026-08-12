import { describe, expect, it } from "vitest";
import {
  isOverviewPayload,
  isWikiCargoPayload,
  isWikiImagePayload,
  sanitizeStoredMobileSettings,
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

  it("repairs corrupt persisted settings instead of returning invalid runtime types", () => {
    const result = sanitizeStoredMobileSettings({
      alwaysOnTop: "false",
      opacity: "zero",
      compact: true,
      shortcuts: { toggleWidget: 42 },
      priceCheck: {
        enabled: "yes",
        hotkey: 12,
        rollTolerance: "NaN",
        maxHistory: Number.POSITIVE_INFINITY,
      },
    });

    expect(result).toMatchObject({
      alwaysOnTop: false,
      opacity: 1,
      compact: true,
      shortcuts: {
        toggleWidget: "CommandOrControl+Shift+E",
      },
      priceCheck: {
        enabled: true,
        hotkey: "CommandOrControl+D",
        rollTolerance: 10,
        maxHistory: 50,
        captureMode: "auto-copy",
      },
    });
    expect(typeof result.alwaysOnTop).toBe("boolean");
    expect(typeof result.opacity).toBe("number");
    expect(typeof result.priceCheck.rollTolerance).toBe("number");
  });
});
