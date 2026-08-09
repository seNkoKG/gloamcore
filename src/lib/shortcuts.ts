import type { DesktopShortcutSettings } from "../types";

export const defaultDesktopShortcuts: DesktopShortcutSettings = Object.freeze({
  toggleWidget: "CommandOrControl+Shift+E",
  toggleClickThrough: "CommandOrControl+Shift+L",
  instantSearch: "CommandOrControl+Shift+Space",
  focusItemSearch: "/",
  gameDataSearch: "CommandOrControl+K",
});

export type ShortcutDraft = DesktopShortcutSettings & { priceCheck: string };
export type ShortcutDraftKey = keyof ShortcutDraft;

const modifierAliases = new Map<string, string>([
  ["commandorcontrol", "primary"],
  ["cmdorctrl", "primary"],
  ["command", "command"],
  ["cmd", "command"],
  ["control", "control"],
  ["ctrl", "control"],
  ["alt", "alt"],
  ["option", "alt"],
  ["altgr", "alt-gr"],
  ["shift", "shift"],
  ["super", "super"],
]);

const namedKeys = new Map<string, string>([
  ["space", "space"],
  ["tab", "tab"],
  ["enter", "enter"],
  ["return", "enter"],
  ["escape", "escape"],
  ["esc", "escape"],
  ["backspace", "backspace"],
  ["delete", "delete"],
  ["insert", "insert"],
  ["home", "home"],
  ["end", "end"],
  ["pageup", "pageup"],
  ["pagedown", "pagedown"],
  ["up", "arrowup"],
  ["down", "arrowdown"],
  ["left", "arrowleft"],
  ["right", "arrowright"],
  ["plus", "+"],
  ["slash", "/"],
]);

const globalShortcutKeys = new Set<ShortcutDraftKey>([
  "toggleWidget",
  "toggleClickThrough",
  "instantSearch",
  "priceCheck",
]);

export type ShortcutPlatform = "win32" | "darwin" | "linux";

function runtimeShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator !== "undefined") {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes("mac")) return "darwin";
    if (platform.includes("linux")) return "linux";
  }
  return "win32";
}

function parsedShortcut(
  value: string,
  platform: ShortcutPlatform = runtimeShortcutPlatform(),
) {
  const shortcut = value.trim();
  if (!shortcut) return { error: "Enter a shortcut." } as const;
  if (shortcut === "/") {
    return { modifiers: [] as string[], key: "/", identity: "/" } as const;
  }
  if (!/^[A-Za-z0-9+]+$/.test(shortcut)) {
    return {
      error: "Use key names joined with + (for example Ctrl+Shift+E).",
    } as const;
  }
  const tokens = shortcut.split("+").map((token) => token.toLowerCase());
  if (tokens.some((token) => !token)) {
    return { error: "Use one key after the modifiers." } as const;
  }
  const modifiers: string[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    const modifier = modifierAliases.get(token);
    if (modifier) modifiers.push(modifier);
    else if (/^[a-z0-9]$/.test(token) || /^f(?:[1-9]|1\d|2[0-4])$/.test(token)) {
      keys.push(token);
    } else {
      const named = namedKeys.get(token);
      if (named) keys.push(named);
      else return { error: `Unknown shortcut key: ${token}.` } as const;
    }
  }
  if (new Set(modifiers).size !== modifiers.length) {
    return { error: "Do not repeat modifier keys." } as const;
  }
  if (keys.length !== 1) {
    return { error: "Use exactly one key after the modifiers." } as const;
  }
  const normalizedModifiers = modifiers
    .map((modifier) => modifier === "primary"
      ? platform === "darwin" ? "command" : "control"
      : modifier)
    .sort();
  if (new Set(normalizedModifiers).size !== normalizedModifiers.length) {
    return { error: "Do not repeat equivalent modifier keys." } as const;
  }
  return {
    modifiers: normalizedModifiers,
    key: keys[0],
    identity: [...normalizedModifiers, keys[0]].join("+"),
  } as const;
}

export function shortcutIdentity(
  value: string,
  platform: ShortcutPlatform = runtimeShortcutPlatform(),
) {
  const parsed = parsedShortcut(value, platform);
  return "error" in parsed ? "" : parsed.identity;
}

export function validateShortcut(
  value: string,
  options: {
    global?: boolean;
    priceCheck?: boolean;
    platform?: ShortcutPlatform;
  } = {},
) {
  const parsed = parsedShortcut(value, options.platform);
  if ("error" in parsed) return parsed.error || "Invalid shortcut.";
  if (options.global && parsed.modifiers.length === 0) {
    return "Global shortcuts need Ctrl, Alt, Shift, or another modifier.";
  }
  const platform = options.platform || runtimeShortcutPlatform();
  if (platform === "darwin" && parsed.modifiers.includes("super")) {
    return "Use Command instead of Super on macOS.";
  }
  if (platform !== "darwin" && parsed.modifiers.includes("command")) {
    return "Use Ctrl, CommandOrControl, or Super on Windows and Linux.";
  }
  if (
    options.priceCheck &&
    parsed.key === "c" &&
    parsed.modifiers.length === 1 &&
    parsed.modifiers[0] === "control"
  ) {
    return "Ctrl+C is reserved for copying the hovered item.";
  }
  return "";
}

export function validateShortcutDraft(
  draft: ShortcutDraft,
  options: { platform?: ShortcutPlatform; priceCheckEnabled?: boolean } = {},
) {
  const errors = {} as Partial<Record<ShortcutDraftKey, string>>;
  const owners = new Map<string, ShortcutDraftKey>();
  for (const [key, value] of Object.entries(draft) as Array<
    [ShortcutDraftKey, string]
  >) {
    const error = validateShortcut(value, {
      global: globalShortcutKeys.has(key),
      priceCheck: key === "priceCheck",
      platform: options.platform,
    });
    if (error) {
      errors[key] = error;
      continue;
    }
    if (key === "priceCheck" && options.priceCheckEnabled === false) continue;
    const identity = shortcutIdentity(value, options.platform);
    const owner = owners.get(identity);
    if (owner) {
      errors[key] = "Already assigned to another action.";
      errors[owner] = "Already assigned to another action.";
    } else {
      owners.set(identity, key);
    }
  }
  return errors;
}

export function shortcutEventMatches(
  event: KeyboardEvent,
  accelerator: string,
  platform: ShortcutPlatform = runtimeShortcutPlatform(),
) {
  const parsed = parsedShortcut(accelerator, platform);
  if ("error" in parsed) return false;
  const modifiers = new Set(parsed.modifiers);
  const altGraph = event.getModifierState?.("AltGraph") || false;
  const effectiveControl = event.ctrlKey && !altGraph;
  const effectiveAlt = event.altKey && !altGraph;
  if (modifiers.has("alt-gr") !== altGraph) return false;
  if (modifiers.has("control") !== effectiveControl) return false;
  if ((modifiers.has("command") || modifiers.has("super")) !== event.metaKey) {
    return false;
  }
  if (modifiers.has("alt") !== effectiveAlt) return false;
  if (modifiers.has("shift") !== event.shiftKey) return false;
  const eventKey = event.key.toLowerCase();
  const normalizedEventKey = namedKeys.get(eventKey) || eventKey;
  return normalizedEventKey === parsed.key;
}

export function formatShortcut(value: string) {
  if (value.trim() === "/") return "/";
  return value
    .replace(/CommandOrControl|CmdOrCtrl/gi, "Ctrl")
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean)
    .join(" + ");
}

export function shortcutFromKeyboardEvent(
  event: KeyboardEvent | React.KeyboardEvent,
  platform: ShortcutPlatform = runtimeShortcutPlatform(),
) {
  if (["Control", "Shift", "Alt", "AltGraph", "Meta"].includes(event.key)) return "";
  const modifiers: string[] = [];
  const altGraph = event.getModifierState?.("AltGraph") || false;
  if (altGraph) modifiers.push("AltGr");
  if (event.ctrlKey && !altGraph) modifiers.push("Ctrl");
  if (event.metaKey) modifiers.push(platform === "darwin" ? "Command" : "Super");
  if (event.altKey && !altGraph) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  const named: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Enter: "Enter",
    Escape: "Escape",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Tab: "Tab",
    "+": "Plus",
  };
  const rawKey = event.key === "/" && modifiers.length ? "Slash" : named[event.key] || event.key;
  const key = /^f\d+$/i.test(rawKey)
    ? rawKey.toUpperCase()
    : rawKey.length === 1 && rawKey !== "/"
      ? rawKey.toUpperCase()
      : rawKey;
  return [...modifiers, key].join("+");
}
