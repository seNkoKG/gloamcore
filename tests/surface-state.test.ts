import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { sanitizeSurfaceAlert, sanitizeSurfaceAlerts } = require("../electron/surface-state.cjs") as {
  sanitizeSurfaceAlert: (
    value: unknown,
    fallbackLeague?: string,
  ) => Record<string, unknown> | null;
  sanitizeSurfaceAlerts: (
    value: unknown,
    fallbackLeague?: string,
  ) => Array<Record<string, unknown>>;
};

const validAlert = {
  key: "currency:divine",
  name: "Divine Orb",
  icon: "https://example.test/divine.png",
  current: 196.5,
  target: 200,
  unit: "chaos",
  categoryId: "currency",
  source: "exchange",
  league: "Mercenaries",
};

describe("desktop surface-state validation", () => {
  it("preserves a valid tray alert without fabricating a market-row price", () => {
    expect(sanitizeSurfaceAlert(validAlert, "Fallback League")).toEqual(validAlert);
  });

  it("keeps a valid alert while dropping a corrupt peer", () => {
    expect(sanitizeSurfaceAlerts([
      validAlert,
      { ...validAlert, key: "corrupt", current: 0 },
    ])).toEqual([validAlert]);
  });

  it.each([
    ["zero current", { current: 0 }],
    ["negative target", { target: -1 }],
    ["invalid current", { current: Number.NaN }],
    ["invalid unit", { unit: "mirror" }],
    ["missing identity", { key: "" }],
    ["invalid source", { source: "unknown" }],
  ])("drops a corrupt alert: %s", (_label, patch) => {
    expect(sanitizeSurfaceAlert({ ...validAlert, ...patch })).toBeNull();
  });
});
