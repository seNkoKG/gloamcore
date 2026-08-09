const DEFAULT_DESKTOP_SHORTCUTS = Object.freeze({
  toggleWidget: "CommandOrControl+Shift+E",
  toggleClickThrough: "CommandOrControl+Shift+L",
  instantSearch: "CommandOrControl+Shift+Space",
  focusItemSearch: "/",
  gameDataSearch: "CommandOrControl+K",
});

const SHORTCUT_KEYS = Object.freeze(Object.keys(DEFAULT_DESKTOP_SHORTCUTS));
const GLOBAL_SHORTCUT_KEYS = new Set([
  "toggleWidget",
  "toggleClickThrough",
  "instantSearch",
  "priceCheck",
]);
const MODIFIER_ALIASES = new Map([
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
const NAMED_KEYS = new Map([
  ["space", "space"], ["tab", "tab"], ["enter", "enter"],
  ["return", "enter"], ["escape", "escape"], ["esc", "escape"],
  ["backspace", "backspace"], ["delete", "delete"], ["insert", "insert"],
  ["home", "home"], ["end", "end"], ["pageup", "pageup"],
  ["pagedown", "pagedown"], ["up", "arrowup"], ["down", "arrowdown"],
  ["left", "arrowleft"], ["right", "arrowright"], ["plus", "+"],
  ["slash", "/"],
]);

function shortcutPlatform(platform = process.platform) {
  return platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : "win32";
}

function parseShortcut(value, platform = process.platform) {
  const shortcut = String(value || "").trim();
  if (!shortcut) return { error: "Enter a shortcut." };
  if (shortcut === "/") return { modifiers: [], key: "/", identity: "/" };
  if (!/^[A-Za-z0-9+]+$/.test(shortcut)) {
    return { error: "Use key names joined with + (for example Ctrl+Shift+E)." };
  }
  const tokens = shortcut.split("+").map((token) => token.toLowerCase());
  if (tokens.some((token) => !token)) return { error: "Use one key after the modifiers." };
  const modifiers = [];
  const keys = [];
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES.get(token);
    if (modifier) modifiers.push(modifier);
    else if (/^[a-z0-9]$/.test(token) || /^f(?:[1-9]|1\d|2[0-4])$/.test(token)) keys.push(token);
    else if (NAMED_KEYS.has(token)) keys.push(NAMED_KEYS.get(token));
    else return { error: `Unknown shortcut key: ${token}.` };
  }
  if (new Set(modifiers).size !== modifiers.length) {
    return { error: "Do not repeat modifier keys." };
  }
  if (keys.length !== 1) return { error: "Use exactly one key after the modifiers." };
  const normalizedPlatform = shortcutPlatform(platform);
  const normalizedModifiers = modifiers
    .map((modifier) => modifier === "primary"
      ? normalizedPlatform === "darwin" ? "command" : "control"
      : modifier)
    .sort();
  if (new Set(normalizedModifiers).size !== normalizedModifiers.length) {
    return { error: "Do not repeat equivalent modifier keys." };
  }
  return {
    modifiers: normalizedModifiers,
    key: keys[0],
    identity: [...normalizedModifiers, keys[0]].join("+"),
  };
}

function validateShortcut(value, options = {}) {
  const parsed = parseShortcut(value, options.platform);
  if (parsed.error) return parsed.error;
  if (options.global && parsed.modifiers.length === 0) {
    return "Global shortcuts need Ctrl, Alt, Shift, or another modifier.";
  }
  const platform = shortcutPlatform(options.platform);
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
  ) return "Ctrl+C is reserved for copying the hovered item.";
  return "";
}

function validateShortcutPlan({ shortcuts, priceCheck }, platform = process.platform) {
  const entries = [
    ...SHORTCUT_KEYS.map((key) => [key, shortcuts?.[key]]),
    ["priceCheck", priceCheck?.hotkey],
  ];
  const owners = new Map();
  for (const [key, value] of entries) {
    const error = validateShortcut(value, {
      global: GLOBAL_SHORTCUT_KEYS.has(key),
      priceCheck: key === "priceCheck",
      platform,
    });
    if (error) return `${key}: ${error}`;
    if (key === "priceCheck" && !priceCheck?.enabled) continue;
    const identity = parseShortcut(value, platform).identity;
    const owner = owners.get(identity);
    if (owner) return `${key}: Shortcut is already assigned to ${owner}.`;
    owners.set(identity, key);
  }
  return "";
}

function sanitizeDesktopShortcuts(value, fallback = DEFAULT_DESKTOP_SHORTCUTS) {
  const source = value && typeof value === "object" ? value : {};
  const sanitized = {};
  for (const key of SHORTCUT_KEYS) {
    const candidate = typeof source[key] === "string"
      ? source[key].trim().slice(0, 80)
      : "";
    sanitized[key] = candidate || fallback[key] || DEFAULT_DESKTOP_SHORTCUTS[key];
  }
  return sanitized;
}

/**
 * Replaces a set of OS-global accelerators atomically. On any failed
 * registration, every attempted candidate is removed and the prior set is
 * restored before returning.
 */
function replaceGlobalShortcutSet({ globalShortcut, previous, next, callbacks }) {
  const unregisterSet = (values) => {
    for (const value of Object.values(values || {})) {
      if (value) globalShortcut.unregister(value);
    }
  };
  const registerSet = (values) => {
    const registered = {};
    for (const [key, value] of Object.entries(values || {})) {
      const callback = callbacks[key];
      if (!value || typeof callback !== "function") continue;
      let accepted = false;
      try {
        accepted = globalShortcut.register(value, callback);
      } catch {
        accepted = false;
      }
      if (!accepted) return { registered, failedKey: key, failedAccelerator: value };
      registered[key] = value;
    }
    return { registered, failedKey: "", failedAccelerator: "" };
  };

  unregisterSet(previous);
  const attempted = registerSet(next);
  if (!attempted.failedKey) return { ok: true, registered: attempted.registered };
  unregisterSet(attempted.registered);
  const rollback = registerSet(previous);
  return {
    ok: false,
    registered: rollback.registered,
    failedKey: attempted.failedKey,
    failedAccelerator: attempted.failedAccelerator,
    rollbackComplete: !rollback.failedKey,
  };
}

function replaceGlobalShortcutPlan({
  globalShortcut,
  previousDesktop,
  nextDesktop,
  callbacks,
  probeAccelerator = "",
}) {
  const desktop = replaceGlobalShortcutSet({
    globalShortcut,
    previous: previousDesktop,
    next: nextDesktop,
    callbacks,
  });
  if (!desktop.ok || !probeAccelerator) return desktop;

  let probeAccepted = false;
  try {
    probeAccepted = globalShortcut.register(probeAccelerator, () => undefined);
  } catch {
    probeAccepted = false;
  }
  if (probeAccepted) {
    globalShortcut.unregister(probeAccelerator);
    return desktop;
  }

  const rollback = replaceGlobalShortcutSet({
    globalShortcut,
    previous: desktop.registered,
    next: previousDesktop,
    callbacks,
  });
  return {
    ok: false,
    registered: rollback.registered,
    failedKey: "priceCheck",
    failedAccelerator: probeAccelerator,
    rollbackComplete: rollback.ok,
  };
}

function registerGlobalShortcutSetBestEffort({ globalShortcut, next, callbacks }) {
  const registered = {};
  const failures = [];
  for (const [key, accelerator] of Object.entries(next || {})) {
    const callback = callbacks[key];
    if (!accelerator || typeof callback !== "function") continue;
    let accepted = false;
    try {
      accepted = globalShortcut.register(accelerator, callback);
    } catch {
      accepted = false;
    }
    if (accepted) registered[key] = accelerator;
    else failures.push({ key, accelerator });
  }
  return { registered, failures };
}

module.exports = {
  DEFAULT_DESKTOP_SHORTCUTS,
  SHORTCUT_KEYS,
  parseShortcut,
  registerGlobalShortcutSetBestEffort,
  replaceGlobalShortcutPlan,
  replaceGlobalShortcutSet,
  sanitizeDesktopShortcuts,
  validateShortcut,
  validateShortcutPlan,
};
