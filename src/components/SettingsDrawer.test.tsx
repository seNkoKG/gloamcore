import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultDesktopShortcuts } from "../lib/shortcuts";
import { defaultPriceCheckSettings } from "../lib/price-check/types";
import { SettingsDrawer } from "./SettingsDrawer";

vi.mock("../lib/bridge", () => ({
  bridge: {
    getUpdateState: async () => ({
      status: "unconfigured",
      currentVersion: "test",
      message: "",
      feedConfigured: false,
    }),
    onUpdateState: () => () => undefined,
  },
}));
vi.mock("../lib/platform", () => ({ isMobileApp: false }));

describe("SettingsDrawer shortcuts", () => {
  it("exposes every binding and the functional startup option", () => {
    const markup = renderToStaticMarkup(
      <SettingsDrawer
        settings={{
          alwaysOnTop: true,
          opacity: 1,
          compact: false,
          clickThrough: false,
          startMinimized: false,
          autoCheckUpdates: false,
          shortcuts: defaultDesktopShortcuts,
          priceCheck: defaultPriceCheckSettings,
        }}
        density="compact"
        refreshMinutes={10}
        onClose={() => undefined}
        onSettings={async () => undefined}
        onDensity={() => undefined}
        onRefreshMinutes={() => undefined}
      />,
    );

    expect(markup).toContain("Start minimized");
    expect(markup).toContain("Search game data");
    expect(markup).toContain("Focus item search");
    expect(markup).toContain("Price check hovered item");
    expect(markup.match(/shortcut-editor/g)).toHaveLength(6);
    expect(markup).toContain("Toggle with Ctrl + Shift + L");
    expect(markup).toContain('role="group" aria-label="Row density"');
    expect(markup).toContain('aria-pressed="true"');
  });
});
