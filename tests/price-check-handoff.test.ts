import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  assignCaptureIdentity,
  canReadPriceCheckCapture,
  createDashboardCapture,
  sanitizePriceCheckDashboardSnapshot,
  sendPriceCheckCaptureToWindow,
} = require("../electron/price-check-handoff.cjs") as {
  assignCaptureIdentity(
    capture: Record<string, unknown>,
    captureId: number,
  ): Record<string, unknown>;
  canReadPriceCheckCapture(
    sender: unknown,
    windows: { mainWindow?: FakeWindow; priceCheckWindow?: FakeWindow },
  ): boolean;
  sendPriceCheckCaptureToWindow(
    window: FakeWindow | undefined,
    capture: unknown,
  ): boolean;
  sanitizePriceCheckDashboardSnapshot(
    value: unknown,
  ): Record<string, unknown> | null;
  createDashboardCapture(
    capture: Record<string, unknown> | null,
    snapshot: unknown,
    handoffId: number,
  ): Record<string, unknown> | null;
};

type FakeWebContents = {
  isDestroyed: ReturnType<typeof vi.fn>;
  isLoadingMainFrame: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

type FakeWindow = {
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: FakeWebContents;
};

function fakeWindow({ loading = false } = {}): FakeWindow {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      isLoadingMainFrame: vi.fn(() => loading),
      once: vi.fn(),
      send: vi.fn(),
    },
  };
}

describe("price-check capture handoff", () => {
  it("allows only the main dashboard and compact overlay to read the capture", () => {
    const mainWindow = fakeWindow();
    const priceCheckWindow = fakeWindow();
    const otherWindow = fakeWindow();

    expect(
      canReadPriceCheckCapture(mainWindow.webContents, {
        mainWindow,
        priceCheckWindow,
      }),
    ).toBe(true);
    expect(
      canReadPriceCheckCapture(priceCheckWindow.webContents, {
        mainWindow,
        priceCheckWindow,
      }),
    ).toBe(true);
    expect(
      canReadPriceCheckCapture(otherWindow.webContents, {
        mainWindow,
        priceCheckWindow,
      }),
    ).toBe(false);
  });

  it("pushes the current capture to an already-loaded dashboard", () => {
    const mainWindow = fakeWindow();
    const capture = { text: "Item Class: Belts", capturedAt: 42, validPrefix: true };

    expect(sendPriceCheckCaptureToWindow(mainWindow, capture)).toBe(true);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      "price-check:capture",
      capture,
    );
  });

  it("defers the capture until a loading dashboard is ready", () => {
    const mainWindow = fakeWindow({ loading: true });
    const capture = { text: "Item Class: Belts", capturedAt: 42, validPrefix: true };

    expect(sendPriceCheckCaptureToWindow(mainWindow, capture)).toBe(true);
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    expect(mainWindow.webContents.once).toHaveBeenCalledWith(
      "did-finish-load",
      expect.any(Function),
    );

    const callback = mainWindow.webContents.once.mock.calls[0]?.[1] as () => void;
    callback();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      "price-check:capture",
      capture,
    );
  });

  it("does not throw when a renderer disappears during handoff", () => {
    const mainWindow = fakeWindow();
    mainWindow.webContents.send.mockImplementation(() => {
      throw new Error("renderer gone");
    });

    expect(
      sendPriceCheckCaptureToWindow(mainWindow, {
        text: "Item Class: Belts",
        capturedAt: 42,
        validPrefix: true,
      }),
    ).toBe(false);
  });

  it("keeps only bounded user-editable query state", () => {
    const snapshot = sanitizePriceCheckDashboardSnapshot({
      captureId: 7,
      capturedAt: 42,
      league: "  Keepers\0ignored  ",
      mode: "similar",
      identity: "exact",
      status: "any",
      rollTolerance: 75,
      filters: [
        {
          modifierId: "explicit.stat_1",
          enabled: true,
          mode: "range",
          min: 95,
          max: 85,
          tradeId: "attacker-controlled-id",
          explanation: "attacker-controlled-copy",
        },
        {
          modifierId: "explicit.stat_1",
          enabled: false,
          mode: "exact",
          min: 1,
        },
        {
          modifierId: "explicit.stat_2",
          enabled: true,
          mode: "presence",
          min: 5,
        },
      ],
      itemFilters: {
        itemLevel: 86,
        itemLevelMax: 100,
        corrupted: false,
        veiled: true,
        vestigial: true,
        foil: true,
        "influence:hunter": true,
        "influence:searing exarch": true,
        prototypePollution: "blocked",
      },
      tradeQuery: { attackerControlled: true },
    });

    expect(snapshot).toEqual({
      captureId: 7,
      capturedAt: 42,
      league: "Keepers",
      mode: "similar",
      identity: "exact",
      status: "any",
      rollTolerance: 50,
      filters: [
        {
          modifierId: "explicit.stat_1",
          enabled: true,
          mode: "range",
          min: 85,
          max: 95,
        },
        {
          modifierId: "explicit.stat_2",
          enabled: true,
          mode: "presence",
        },
      ],
      itemFilters: {
        itemLevel: 86,
        itemLevelMax: 100,
        corrupted: false,
        veiled: true,
        vestigial: true,
        foil: true,
        "influence:hunter": true,
        "influence:searing exarch": true,
      },
    });
  });

  it("preserves every planner-produced cross-family item filter and Logbook mode", () => {
    const itemFilters = {
      itemLevel: 86,
      itemLevelMax: 100,
      quality: 30,
      gemLevel: 21,
      links: 6,
      mapTier: 16,
      memoryStrands: 72,
      sentinelCharge: 12,
      stackSize: 40,
      areaLevel: 78,
      areaLevelMax: 83,
      heistWings: 4,
      "heistJob:lockpicking": 5,
      "heistJob:brute force": 4,
      "heistJob:perception": 3,
      "heistJob:demolition": 2,
      "heistJob:counter-thaumaturgy": 5,
      "heistJob:trap disarmament": 4,
      "heistJob:agility": 3,
      "heistJob:deception": 2,
      "heistJob:engineering": 1,
      heistPriceless: true,
      imbuedGem: false,
      mapCompletionReward: "  The Squire\0discarded  ",
      scryingMapArea: "  Undersea Groves\0discarded  ",
      mapBlighted: "Blight-ravaged",
      rarity: "magic",
      tradeCurrency: "chaos_divine",
      listed: "2weeks",
      corrupted: false,
      mirrored: false,
      split: false,
      fractured: false,
      synthesised: false,
      veiled: true,
      foulborn: false,
      vestigial: false,
      foil: true,
      identified: false,
      "influence:hunter": true,
      "influence:eater of worlds": true,
      "heistJob:hacking": 5,
      prototypePollution: "blocked",
    };
    const snapshot = sanitizePriceCheckDashboardSnapshot({
      captureId: 7,
      capturedAt: 42,
      league: "Allflame",
      mode: "III",
      identity: "exact",
      status: "available",
      rollTolerance: 10,
      filters: [],
      itemFilters,
    });

    const expected = { ...itemFilters };
    delete (expected as Record<string, unknown>)["heistJob:hacking"];
    delete (expected as Record<string, unknown>).prototypePollution;
    expected.mapCompletionReward = "The Squire";
    expected.scryingMapArea = "Undersea Groves";
    expect(snapshot).toMatchObject({ mode: "III", itemFilters: expected });
    expect((snapshot?.itemFilters as Record<string, unknown>))
      .not.toHaveProperty("heistJob:hacking");
  });

  it.each(["I", "II", "III", "IV", "V"])(
    "accepts Awakened Logbook dashboard mode %s",
    (mode) => {
      expect(sanitizePriceCheckDashboardSnapshot({
        captureId: 1,
        capturedAt: 2,
        league: "Allflame",
        mode,
        identity: "exact",
        status: "available",
        rollTolerance: 10,
        filters: [],
        itemFilters: { areaLevel: 83 },
      })).not.toBeNull();
    },
  );

  it("accepts Awakened's rare-map Bulk dashboard mode", () => {
    expect(sanitizePriceCheckDashboardSnapshot({
      captureId: 1,
      capturedAt: 2,
      league: "Allflame",
      mode: "bulk",
      identity: "exact",
      status: "available",
      rollTolerance: 10,
      filters: [],
      itemFilters: { mapTier: 16, corrupted: true },
    })).toMatchObject({
      mode: "bulk",
      identity: "exact",
      itemFilters: { mapTier: 16, corrupted: true },
    });
  });

  it("preserves an exact Timeless seed through the Electron dashboard handoff", () => {
    const seedEdit = {
      modifierId: "mod-lethal-pride-kaom-seed",
      enabled: true,
      mode: "exact",
      min: 12476,
      max: 12476,
    };
    const snapshot = {
      captureId: 19,
      capturedAt: 84,
      league: "Allflame",
      mode: "similar",
      identity: "exact",
      status: "available",
      rollTolerance: 10,
      filters: [seedEdit],
      itemFilters: {},
    };

    const sanitized = sanitizePriceCheckDashboardSnapshot(snapshot);
    expect(sanitized?.filters).toEqual([seedEdit]);

    const capture = {
      text: "Item Class: Jewels\nRarity: Unique\nLethal Pride\nTimeless Jewel",
      captureId: 19,
      capturedAt: 84,
      validPrefix: true,
    };
    const handoff = createDashboardCapture(capture, snapshot, 11);
    expect(handoff?.dashboardSnapshot).toMatchObject({
      handoffId: 11,
      filters: [seedEdit],
    });
  });

  it("attaches edits only to the exact active capture without mutating it", () => {
    const capture = {
      text: "Item Class: Body Armours",
      captureId: 7,
      capturedAt: 42,
      validPrefix: true,
    };
    const snapshot = {
      captureId: 7,
      capturedAt: 42,
      league: "Keepers",
      mode: "exact",
      identity: "exact",
      status: "available",
      rollTolerance: 0,
      filters: [],
      itemFilters: { itemLevel: 86 },
    };

    const handoff = createDashboardCapture(capture, snapshot, 3);
    expect(handoff).not.toBe(capture);
    expect(handoff?.dashboardSnapshot).toEqual({ ...snapshot, handoffId: 3 });
    expect(capture).not.toHaveProperty("dashboardSnapshot");

    expect(
      createDashboardCapture(capture, { ...snapshot, captureId: 6 }, 4),
    ).toBe(capture);
    expect(
      createDashboardCapture(capture, { ...snapshot, capturedAt: 41 }, 5),
    ).toBe(capture);
  });

  it("assigns a fresh identity to a clipboard retry without mutating raw data", () => {
    const capture = {
      text: "Item Class: Jewels",
      capturedAt: 84,
      validPrefix: true,
    };
    const identified = assignCaptureIdentity(capture, 9);

    expect(identified).toEqual({ ...capture, captureId: 9 });
    expect(identified).not.toBe(capture);
    expect(capture).not.toHaveProperty("captureId");
  });
});
