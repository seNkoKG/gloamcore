import { describe, expect, it } from "vitest";
import { resetPriceCheckSurfaceScroll } from "./PriceCheckSurface";

function fakeElement(
  scrollTop: number,
  nested: Array<{ scrollTop: number }> = [],
  workspace?: { scrollTop: number },
) {
  return {
    scrollTop,
    querySelectorAll: () => nested,
    closest: () => workspace ?? null,
  } as unknown as HTMLElement;
}

describe("mobile price-check scroll reset", () => {
  it("resets the workspace and every nested full-surface scroller", () => {
    const panel = { scrollTop: 1_500 };
    const history = { scrollTop: 800 };
    const settings = { scrollTop: 400 };
    const workspace = { scrollTop: 2_000 };
    const content = fakeElement(300, [panel, history, settings], workspace);

    resetPriceCheckSurfaceScroll(content);

    expect(content.scrollTop).toBe(0);
    expect(panel.scrollTop).toBe(0);
    expect(history.scrollTop).toBe(0);
    expect(settings.scrollTop).toBe(0);
    expect(workspace.scrollTop).toBe(0);
  });

  it("is safe before the mobile surface mounts", () => {
    expect(() => resetPriceCheckSurfaceScroll(null)).not.toThrow();
  });
});
