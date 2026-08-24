const PRICE_CHECK_SCROLLABLE_SELECTOR =
  ".pc-content, .pc-panel, .pc-history, .pc-settings";

/**
 * Resets both nested price-check scrollers and the mobile workspace. The full
 * checker uses an inner scrolling panel inside `.main-content`, so resetting
 * only one of them can reopen the screen at its previous bottom position.
 */
export function resetPriceCheckSurfaceScroll(root: HTMLElement | null) {
  if (!root) return;
  root.scrollTop = 0;
  for (const scroller of root.querySelectorAll<HTMLElement>(
    PRICE_CHECK_SCROLLABLE_SELECTOR,
  )) {
    scroller.scrollTop = 0;
  }
  const workspace = root.closest<HTMLElement>(".main-content");
  if (workspace && workspace !== root) workspace.scrollTop = 0;
}
