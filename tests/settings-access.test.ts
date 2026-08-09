import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { canAccessSettings } = require("../electron/settings-access.cjs") as {
  canAccessSettings(
    sender: unknown,
    windows: { mainWindow?: FakeWindow; priceCheckWindow?: FakeWindow },
  ): boolean;
};

type FakeWindow = {
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>;
  };
};

function fakeWindow(): FakeWindow {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { isDestroyed: vi.fn(() => false) },
  };
}

describe("settings IPC access", () => {
  it("allows only the dashboard and price-check settings renderers", () => {
    const mainWindow = fakeWindow();
    const priceCheckWindow = fakeWindow();
    const auxiliaryWindow = fakeWindow();

    expect(
      canAccessSettings(mainWindow.webContents, { mainWindow, priceCheckWindow }),
    ).toBe(true);
    expect(
      canAccessSettings(priceCheckWindow.webContents, {
        mainWindow,
        priceCheckWindow,
      }),
    ).toBe(true);
    expect(
      canAccessSettings(auxiliaryWindow.webContents, {
        mainWindow,
        priceCheckWindow,
      }),
    ).toBe(false);
  });

  it("rejects destroyed or missing renderer windows", () => {
    const mainWindow = fakeWindow();
    mainWindow.isDestroyed.mockReturnValue(true);

    expect(canAccessSettings(mainWindow.webContents, { mainWindow })).toBe(false);
    expect(canAccessSettings(undefined, {})).toBe(false);
  });
});
