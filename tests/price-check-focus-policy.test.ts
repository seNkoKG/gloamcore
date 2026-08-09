import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  priceCheckBlurDisposition,
  priceCheckPassiveInteractionArea,
  priceCheckPassivePanelArea,
  priceCheckPointerExitDisposition,
  shouldAcceptPriceCheckOverlayFocus,
  shouldArmPriceCheckPassiveWatch,
  shouldRestartPriceCheckPanelWatch,
  shouldRestorePriceCheckTargetFocus,
} = require("../electron/price-check-focus-policy.cjs") as {
  priceCheckBlurDisposition(input: {
    visible: boolean;
    overlayFocused: boolean;
    targetFocused: boolean;
    otherApplicationWindowFocused: boolean;
    mode: string;
    pinned: boolean;
    closeOnBlur: boolean;
  }): "ignore" | "passive" | "hide";
  priceCheckPassiveInteractionArea(input: {
    host: { x: number; y: number; width: number; height: number };
    panel: { x: number; y: number; width: number; height: number };
  }): { x: number; y: number; width: number; height: number } | null;
  priceCheckPassivePanelArea(input: {
    host: { x: number; y: number; width: number; height: number };
    panel: { x: number; y: number; width: number; height: number };
  }): { x: number; y: number; width: number; height: number } | null;
  priceCheckPointerExitDisposition(input: {
    visible: boolean;
    mode: string;
    pinned: boolean;
    closeOnBlur: boolean;
  }): "ignore" | "passive" | "hide";
  shouldAcceptPriceCheckOverlayFocus(input: {
    visible: boolean;
    mode: string;
    activationPending: boolean;
    interactive: boolean;
    passivePanelHitTest?: boolean;
  }): boolean;
  shouldArmPriceCheckPassiveWatch(input: {
    win32: boolean;
    current: boolean;
    visible: boolean;
    mode: string;
    windowAvailable: boolean;
    panelAvailable: boolean;
    attached: boolean;
    hasAccess: boolean;
    targetFocused: boolean;
    overlayFocused?: boolean;
  }): boolean;
  shouldRestartPriceCheckPanelWatch(input: {
    current: boolean;
    expired: boolean;
    visible: boolean;
    mode: string;
    expectedMode: string;
    quitting: boolean;
  }): boolean;
  shouldRestorePriceCheckTargetFocus(input: {
    requested: boolean;
    attached: boolean;
    overlayFocused: boolean;
    interactive: boolean;
  }): boolean;
};

describe("price-check overlay blur policy", () => {
  const locked = {
    visible: true,
    overlayFocused: false,
    targetFocused: true,
    otherApplicationWindowFocused: false,
    mode: "locked",
    pinned: false,
    closeOnBlur: true,
  };

  it("hides without restoring when another application window owns focus", () => {
    expect(priceCheckBlurDisposition({
      ...locked,
      pinned: true,
      otherApplicationWindowFocused: true,
    })).toBe("hide");
    expect(priceCheckBlurDisposition({ ...locked, targetFocused: false })).toBe("hide");
  });

  it("demotes only a retained overlay that blurred back to the game", () => {
    expect(priceCheckBlurDisposition({ ...locked, pinned: true })).toBe("passive");
    expect(priceCheckBlurDisposition({ ...locked, closeOnBlur: false })).toBe("passive");
    expect(priceCheckBlurDisposition({ ...locked, mode: "passive" })).toBe("passive");
    expect(priceCheckBlurDisposition(locked)).toBe("hide");
  });
});

describe("price-check native panel watcher policy", () => {
  const armable = {
    win32: true,
    current: true,
    visible: true,
    mode: "passive",
    windowAvailable: true,
    panelAvailable: true,
    attached: true,
    hasAccess: true,
    targetFocused: true,
  };

  it("arms from authoritative target focus even when Electron focus is stale", () => {
    expect(shouldArmPriceCheckPassiveWatch({
      ...armable,
      overlayFocused: true,
    })).toBe(true);
  });

  it("does not arm without a current usable passive target", () => {
    expect(shouldArmPriceCheckPassiveWatch({ ...armable, current: false })).toBe(false);
    expect(shouldArmPriceCheckPassiveWatch({ ...armable, mode: "promoted" })).toBe(false);
    expect(shouldArmPriceCheckPassiveWatch({ ...armable, panelAvailable: false })).toBe(false);
    expect(shouldArmPriceCheckPassiveWatch({ ...armable, targetFocused: false })).toBe(false);
  });

  it("tracks the full-height widget column like Awakened", () => {
    const geometry = {
      host: { x: 40, y: 60, width: 1920, height: 1080 },
      panel: { x: 1510, y: 275, width: 360, height: 640 },
    };
    expect(priceCheckPassiveInteractionArea(geometry)).toEqual({
      x: 1550,
      y: 60,
      width: 360,
      height: 1080,
    });
    expect(priceCheckPassivePanelArea(geometry)).toEqual({
      x: 1550,
      y: 335,
      width: 360,
      height: 640,
    });
  });

  it("does not arm a watcher for incomplete or unusable geometry", () => {
    expect(priceCheckPassiveInteractionArea()).toBeNull();
    expect(priceCheckPassiveInteractionArea({
      host: { x: 0, y: 0, width: 1920, height: 0 },
      panel: { x: 0, y: 200, width: 360, height: 600 },
    })).toBeNull();
  });

  it("restarts only a naturally expired current watcher", () => {
    const active = {
      current: true,
      expired: true,
      visible: true,
      mode: "passive",
      expectedMode: "passive",
      quitting: false,
    };
    expect(shouldRestartPriceCheckPanelWatch(active)).toBe(true);
    expect(shouldRestartPriceCheckPanelWatch({ ...active, current: false })).toBe(false);
    expect(shouldRestartPriceCheckPanelWatch({ ...active, expired: false })).toBe(false);
    expect(shouldRestartPriceCheckPanelWatch({ ...active, quitting: true })).toBe(false);
    expect(shouldRestartPriceCheckPanelWatch({ ...active, mode: "hidden" })).toBe(false);
  });
});

describe("price-check promoted pointer exit policy", () => {
  it("returns an unpinned promoted overlay to PoE by hiding it", () => {
    expect(priceCheckPointerExitDisposition({
      visible: true,
      mode: "promoted",
      pinned: false,
      closeOnBlur: true,
    })).toBe("hide");
  });

  it("keeps pinned or retained overlays passive", () => {
    expect(priceCheckPointerExitDisposition({
      visible: true,
      mode: "promoted",
      pinned: true,
      closeOnBlur: true,
    })).toBe("passive");
    expect(priceCheckPointerExitDisposition({
      visible: true,
      mode: "promoted",
      pinned: false,
      closeOnBlur: false,
    })).toBe("passive");
  });

  it("ignores pointer exits outside promoted mode", () => {
    expect(priceCheckPointerExitDisposition({
      visible: true,
      mode: "passive",
      pinned: false,
      closeOnBlur: true,
    })).toBe("ignore");
  });
});

describe("price-check overlay focus policy", () => {
  it("rejects an unsolicited focus event for a passive preview", () => {
    expect(shouldAcceptPriceCheckOverlayFocus({
      visible: true,
      mode: "passive",
      activationPending: false,
      interactive: false,
    })).toBe(false);
  });

  it("accepts the focus created by one click on the native-shaped passive card", () => {
    expect(shouldAcceptPriceCheckOverlayFocus({
      visible: true,
      mode: "passive",
      activationPending: false,
      interactive: false,
      passivePanelHitTest: true,
    })).toBe(true);
  });

  it("accepts only an intentional locked or promoted activation", () => {
    expect(shouldAcceptPriceCheckOverlayFocus({
      visible: true,
      mode: "promoted",
      activationPending: true,
      interactive: false,
    })).toBe(true);
    expect(shouldAcceptPriceCheckOverlayFocus({
      visible: true,
      mode: "locked",
      activationPending: false,
      interactive: true,
    })).toBe(true);
    expect(shouldAcceptPriceCheckOverlayFocus({
      visible: true,
      mode: "locked",
      activationPending: false,
      interactive: false,
    })).toBe(false);
  });
});

describe("price-check focus restoration policy", () => {
  it("does not focus PoE when a passive preview closes", () => {
    expect(shouldRestorePriceCheckTargetFocus({
      requested: true,
      attached: true,
      overlayFocused: false,
      interactive: false,
    })).toBe(false);
  });

  it("returns focus after an interactive overlay closes", () => {
    expect(shouldRestorePriceCheckTargetFocus({
      requested: true,
      attached: true,
      overlayFocused: true,
      interactive: true,
    })).toBe(true);
  });

  it("does not restore from stale interactive state after focus moved elsewhere", () => {
    expect(shouldRestorePriceCheckTargetFocus({
      requested: true,
      attached: true,
      overlayFocused: false,
      interactive: true,
    })).toBe(false);
    expect(shouldRestorePriceCheckTargetFocus({
      requested: true,
      attached: true,
      overlayFocused: true,
      interactive: false,
    })).toBe(false);
  });

  it("never steals focus after an external blur or detach", () => {
    expect(shouldRestorePriceCheckTargetFocus({
      requested: false,
      attached: true,
      overlayFocused: true,
      interactive: true,
    })).toBe(false);
    expect(shouldRestorePriceCheckTargetFocus({
      requested: true,
      attached: false,
      overlayFocused: true,
      interactive: true,
    })).toBe(false);
  });
});
