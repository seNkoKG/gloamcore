import type { DesktopShortcutSettings } from "../../types";
import { shortcutIdentity, validateShortcut } from "../shortcuts";

/**
 * Validates an Electron accelerator used by the price-check overlay.
 * Returns an empty string when valid, otherwise a short message suitable for UI.
 */
export function validatePriceCheckHotkey(
  value: string,
  shortcuts?: DesktopShortcutSettings,
): string {
  const error = validateShortcut(value, { global: true, priceCheck: true });
  if (error || !shortcuts) return error;
  const identity = shortcutIdentity(value);
  if (Object.values(shortcuts).some((shortcut) => shortcutIdentity(shortcut) === identity)) {
    return "That shortcut is already assigned to another action.";
  }
  return "";
}

export function formatPriceCheckHotkey(value: string): string {
  return value
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/CmdOrCtrl/gi, "Ctrl")
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean)
    .join(" + ");
}
