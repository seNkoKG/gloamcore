"use strict";

/**
 * A passive price preview never owns foreground input, so closing it must not
 * issue another Windows foreground request. Focus restoration is reserved for
 * the explicit locked/editor mode after that mode actually owned foreground.
 * Blur and Alt-Tab also pass focusTarget=false and skip the handoff.
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
} = {}) {
  if (!visible || mode === "hidden") return false;
  // Normal Ctrl+D previews are native non-activating windows. Mouse controls
  // remain usable, but a card click must never take foreground from the game.
  if (mode === "passive") return false;
  return Boolean(activationPending || interactive);
}

function shouldRecoverRejectedPassiveFocus({
  accepted,
  visible,
  mode,
  attached,
} = {}) {
  return Boolean(!accepted && visible && mode === "passive" && attached);
}

function priceCheckOverlayOwnsCaptureContext({
  visible,
  mode,
  focused,
  interactive,
} = {}) {
  // Passive cards are native non-activating surfaces. Electron can still emit
  // a transient focus event when a shaped region receives a mouse click, but
  // that stale bit must not block the following Ctrl+D capture.
  return Boolean(
    visible &&
    mode !== "passive" &&
    focused &&
    interactive,
  );
}

function priceCheckTargetCanCapture({
  configured,
  attached,
  hasAccess,
  targetFocused,
  visible,
  mode,
  overlayFocused,
} = {}) {
  return Boolean(
    configured &&
    attached &&
    hasAccess &&
    targetFocused &&
    (!visible || mode === "passive" || !overlayFocused),
  );
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
  priceCheckOverlayOwnsCaptureContext,
  priceCheckTargetCanCapture,
  shouldAcceptPriceCheckOverlayFocus,
  shouldArmPriceCheckPassiveWatch,
  shouldRecoverRejectedPassiveFocus,
  shouldRestartPriceCheckPanelWatch,
  shouldRestorePriceCheckTargetFocus,
};
