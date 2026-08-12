import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultPriceCheckSettings } from "../lib/price-check/types";
import { PriceCheckSettings } from "./PriceCheckSettings";

function renderSettings(isMobile = false) {
  return renderToStaticMarkup(
    <PriceCheckSettings
      settings={defaultPriceCheckSettings}
      isMobile={isMobile}
      onChange={() => undefined}
      onBack={() => undefined}
    />,
  );
}

describe("PriceCheckSettings completeness", () => {
  it("exposes every user-configurable desktop price-check setting", () => {
    const markup = renderSettings();
    for (const label of [
      "Global shortcut",
      "One-key capture",
      "Open near cursor",
      "Close when focus leaves",
      "Pin new checks",
      "Legacy capture behavior",
      "Online listings",
      "Similar-roll tolerance",
      "Show advanced modifiers",
      "Remember checks",
      "Maximum saved checks",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('type="range"');
    expect(markup).toContain('value="50"');
  });

  it("replaces desktop-only capture and overlay controls on mobile", () => {
    const markup = renderSettings(true);
    expect(markup).toContain("Paste item text");
    expect(markup).not.toContain("Open near cursor");
    expect(markup).not.toContain("Global shortcut");
    expect(markup).toContain("Similar-roll tolerance");
    expect(markup).toContain("Remember checks");
  });
});
