const fs = require("node:fs");
const path = require("node:path");

const RATINGS = new Set(["good", "warn", "bad", "ignore"]);
const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  enabled: true,
  hotkey: "CommandOrControl+Alt+M",
  rules: {},
  customRules: {},
});

function canonicalMapModifier(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/<<[^>]+>>/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/([+-]?)\d[\d,]*(?:\.\d+)?/g, (_whole, sign) => `${sign}#`)
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function sanitizeMapModSettings(value, fallback = DEFAULT_SETTINGS) {
  const source = value && typeof value === "object" ? value : {};
  const rules = {};
  for (const [id, rating] of Object.entries(source.rules || {})) {
    if (/^entry:[a-f0-9]{24}$/i.test(id) && RATINGS.has(rating)) rules[id] = rating;
  }
  const customRules = {};
  for (const [line, rating] of Object.entries(source.customRules || {})) {
    const canonical = canonicalMapModifier(line).slice(0, 500);
    if (canonical && RATINGS.has(rating)) customRules[canonical] = rating;
  }
  const hotkey = typeof source.hotkey === "string" && source.hotkey.trim()
    ? source.hotkey.trim().slice(0, 80)
    : fallback.hotkey;
  return {
    version: 1,
    enabled: source.enabled !== false,
    hotkey,
    rules,
    customRules,
  };
}

function mapModifierDefinitions(pack) {
  if (!pack || typeof pack !== "object" || !Array.isArray(pack.entries) || !Array.isArray(pack.categories)) {
    throw new Error("The bundled map-modifier data has an invalid shape.");
  }
  const category = pack.categories.find((entry) => entry?.id === "map-modifiers");
  if (!category || !Array.isArray(category.entries)) {
    throw new Error("The bundled map-modifier category is missing.");
  }
  const byId = new Map(pack.entries.map((entry) => [entry?.id, entry]));
  return category.entries.flatMap((reference) => {
    const entry = byId.get(reference?.entryId);
    if (!entry || typeof entry.label !== "string" || typeof entry.exact !== "string") return [];
    try {
      return [{
        id: entry.id,
        label: entry.label.slice(0, 500),
        exact: entry.exact,
        canonical: canonicalMapModifier(entry.label),
        pattern: new RegExp(entry.exact, "iu"),
      }];
    } catch {
      return [];
    }
  });
}

function itemClassFromText(text) {
  return /^Item Class:\s*(.+)$/mi.exec(String(text || ""))?.[1]?.trim() || "";
}

function mapIdentity(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const rarity = lines.findIndex((line) => /^Rarity:/i.test(line));
  const separator = lines.indexOf("--------", rarity + 1);
  const identity = lines.slice(rarity + 1, separator < 0 ? rarity + 4 : separator).filter(Boolean);
  return { name: identity[0] || "Copied map", baseType: identity[1] || identity[0] || "" };
}

function likelyUnknownModifier(line) {
  if (!line || line === "--------" || /^(?:Item Class|Rarity|Map Tier|Item Quantity|Item Rarity|Monster Pack Size|Quality|Item Level|Requirements|Limited to|Area Level):/i.test(line)) return false;
  if (/^(?:Corrupted|Unidentified|Mirrored|Split|Synthesised Item|Fractured Item|Blighted Map|Blight-ravaged Map)$/i.test(line)) return false;
  return /(?:%|players|monsters|boss|area |cannot|less |more |increased|reduced|chance|gain|take |deal |resist|reflect|curse|ailment|projectile|cooldown|recovery)/i.test(line);
}

function analyseMapText(text, definitions, settingsValue) {
  const settings = sanitizeMapModSettings(settingsValue);
  const itemClass = itemClassFromText(text);
  if (itemClass !== "Maps") {
    return {
      ok: false,
      error: itemClass ? `Expected Item Class: Maps, received ${itemClass}.` : "Copy a Path of Exile map first.",
      itemClass,
      ...mapIdentity(text),
      overall: "unknown",
      results: [],
    };
  }
  const results = [];
  const seen = new Set();
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const normalized = line.normalize("NFKC").replace(/[−–—]/g, "-").toLocaleLowerCase();
    const definition = definitions.find((entry) => entry.pattern.test(normalized));
    if (definition) {
      if (seen.has(definition.id)) continue;
      seen.add(definition.id);
      results.push({
        id: definition.id,
        label: definition.label,
        line,
        rating: settings.rules[definition.id] || "unset",
        known: true,
      });
      continue;
    }
    const canonical = canonicalMapModifier(line);
    const customRating = settings.customRules[canonical];
    if ((customRating || likelyUnknownModifier(line)) && !seen.has(`custom:${canonical}`)) {
      seen.add(`custom:${canonical}`);
      results.push({
        id: `custom:${canonical}`,
        label: line,
        line,
        rating: customRating || "unset",
        known: false,
        canonical,
      });
    }
  }
  const ratings = new Set(results.map((entry) => entry.rating));
  const overall = ratings.has("bad")
    ? "bad"
    : ratings.has("warn")
      ? "warn"
      : results.length > 0 && results.every((entry) => entry.rating === "good" || entry.rating === "ignore") && ratings.has("good")
        ? "good"
        : "unknown";
  return { ok: true, ...mapIdentity(text), itemClass, overall, results };
}

function createMapModCheckService({ settingsPath, dataPath }) {
  let definitions = null;
  let settings = null;
  const ensureDefinitions = () => {
    if (!definitions) definitions = mapModifierDefinitions(JSON.parse(fs.readFileSync(dataPath, "utf8")));
    return definitions;
  };
  const load = () => {
    if (settings) return settings;
    try {
      settings = sanitizeMapModSettings(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
    } catch {
      settings = sanitizeMapModSettings(DEFAULT_SETTINGS);
    }
    return settings;
  };
  const save = (value) => {
    const next = sanitizeMapModSettings(value, load());
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const temporary = `${settingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(temporary, settingsPath);
    settings = next;
    return settings;
  };
  return {
    getDefinitions: () => ensureDefinitions().map(({ pattern: _pattern, ...entry }) => entry),
    getSettings: load,
    saveSettings: save,
    analyse: (text) => analyseMapText(String(text || "").slice(0, 256 * 1024), ensureDefinitions(), load()),
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  analyseMapText,
  canonicalMapModifier,
  createMapModCheckService,
  mapModifierDefinitions,
  sanitizeMapModSettings,
};
