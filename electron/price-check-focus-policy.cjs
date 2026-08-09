"use strict";

/**
 * A passive price preview never owns foreground input, so closing it must not
 * issue another Windows foreground request. Only return focus after an
 * interactive overlay actually owned it.
 */
function shouldRestorePriceCheckTargetFocus({
  requested,
  attached,
  overlayFocused,
  interactive,
} = {}) {
  return Boolean(
    requested &&
    attached &&
    overlayFocused &&
    interactive,
  );
}

function shouldAcceptPriceCheckOverlayFocus({
  visible,
  mode,
  activationPending,
  interactive,
  passivePanelHitTest,
} = {}) {
  if (!visible || mode === "hidden") return false;
  if (mode === "passive") return Boolean(passivePanelHitTest);
  return Boolean(activationPending || interactive);
}

function priceCheckPointerExitDisposition({
  visible,
  mode,
  pinned,
  closeOnBlur,
} = {}) {
  if (!visible || mode !== "promoted") return "ignore";
  return pinned || !closeOnBlur ? "passive" : "hide";
}

function priceCheckPassiveInteractionArea({ host, panel } = {}) {
  if (!host || !panel) return null;
  const x = Number(host.x) + Number(panel.x);
  const y = Number(host.y);
  const width = Number(panel.width);
  const height = Number(host.height);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) return null;
  // Awakened's WidgetAreaTracker watches the full-height column occupied by
  // the price widget, not merely its current rendered card rectangle. Holding
  // the price-check modifier while entering this column promotes the overlay.
  // Pointer hover alone is passive. The native-shaped card receives clicks
  // directly, while this wider column exists only for held-modifier entry.
  return { x, y, width, height };
}

function priceCheckPassivePanelArea({ host, panel } = {}) {
  if (!host || !panel) return null;
  const x = Number(host.x) + Number(panel.x);
  const y = Number(host.y) + Number(panel.y);
  const width = Number(panel.width);
  const height = Number(panel.height);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) return null;
  return { x, y, width, height };
}

function priceCheckBlurDisposition({
  visible,
  overlayFocused,
  targetFocused,
  otherApplicationWindowFocused,
  mode,
  pinned,
  closeOnBlur,
} = {}) {
  if (!visible || overlayFocused) return "ignore";
  if (otherApplicationWindowFocused || !targetFocused) return "hide";
  return mode === "passive" || pinned || !closeOnBlur ? "passive" : "hide";
}

function shouldRestartPriceCheckPanelWatch({
  current,
  expired,
  visible,
  mode,
  expectedMode,
  quitting,
} = {}) {
  return Boolean(
    current &&
    expired &&
    visible &&
    mode === expectedMode &&
    !quitting,
  );
}

function shouldArmPriceCheckPassiveWatch({
  win32,
  current,
  visible,
  mode,
  windowAvailable,
  panelAvailable,
  attached,
  hasAccess,
  targetFocused,
} = {}) {
  return Boolean(
    win32 &&
    current &&
    visible &&
    mode === "passive" &&
    windowAvailable &&
    panelAvailable &&
    attached &&
    hasAccess &&
    targetFocused,
  );
}

module.exports = {
  priceCheckBlurDisposition,
  priceCheckPassiveInteractionArea,
  priceCheckPassivePanelArea,
  priceCheckPointerExitDisposition,
  shouldAcceptPriceCheckOverlayFocus,
  shouldArmPriceCheckPassiveWatch,
  shouldRestartPriceCheckPanelWatch,
  shouldRestorePriceCheckTargetFocus,
};
