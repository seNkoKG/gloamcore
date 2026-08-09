import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const packageJson = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const USER_AGENT = `PoE-Economy-Widget/${packageJson.version} (local regex data builder)`;

const OFFICIAL = {
  items: "https://www.pathofexile.com/api/trade/data/items",
  stats: "https://www.pathofexile.com/api/trade/data/stats",
  static: "https://www.pathofexile.com/api/trade/data/static",
};
const NUMBER = "\\d[\\d,]*(?:\\.\\d+)?";
const argv = process.argv.slice(2);
const options = {
  basePack: "src/lib/price-check/base-types-v1.json",
  statPack: "public/data/price-check/stats-v1.json",
  items: OFFICIAL.items,
  stats: OFFICIAL.stats,
  static: OFFICIAL.static,
  cargoUrl: "https://www.poewiki.net/w/api.php",
  output: "public/data/toolkit/regex-v1.json",
};

for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (name === "--help") {
    console.log("node scripts/build-regex-data.mjs [--base-pack FILE] [--stat-pack FILE] [--items FILE_OR_URL] [--stats FILE_OR_URL] [--static FILE_OR_URL] [--cargo-url URL] [--pob-data FILE_OR_URL] [--pob-version VERSION] [--output FILE]");
    process.exit(0);
  }
  if (!name.startsWith("--") || index + 1 >= argv.length) {
    throw new Error(`Invalid argument: ${name}`);
  }
  const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (!Object.hasOwn(options, key) && !["pobData", "pobVersion"].includes(key)) {
    throw new Error(`Unknown option: ${name}`);
  }
  options[key] = argv[index + 1];
  index += 1;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalized(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function exactPattern(value) {
  const clean = normalized(value);
  let pattern = "^";
  let cursor = 0;
  for (const match of clean.matchAll(/([+-]?)#/g)) {
    pattern += escapeRegex(clean.slice(cursor, match.index));
    pattern += match[1] === "+"
      ? `\\+${NUMBER}`
      : match[1] === "-"
        ? `-${NUMBER}`
        : NUMBER;
    cursor = match.index + match[0].length;
  }
  return `${pattern}${escapeRegex(clean.slice(cursor))}$`;
}

function stableId(value) {
  return `entry:${sha256(normalized(value)).slice(0, 24)}`;
}

function slug(value) {
  return normalized(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "other";
}

async function readSource(specification) {
  if (/^https?:\/\//i.test(specification)) {
    const response = await fetch(specification, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`${specification} returned HTTP ${response.status}`);
    }
    const text = await response.text();
    return {
      text,
      url: specification,
      retrievedAt: new Date().toISOString(),
      etag: response.headers.get("etag") || undefined,
      lastModified: response.headers.get("last-modified") || undefined,
    };
  }
  return { text: await fs.readFile(path.resolve(specification), "utf8") };
}

async function cargoRows(cargoUrl, tables, fields, where) {
  const rows = [];
  const pages = [];
  const retrievedAt = new Date().toISOString();
  for (let offset = 0;; offset += 500) {
    const url = new URL(cargoUrl);
    url.search = new URLSearchParams({
      action: "cargoquery",
      format: "json",
      formatversion: "2",
      limit: "500",
      offset: String(offset),
      tables,
      fields,
      where,
      order_by: "_pageName",
    });
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) throw new Error(`PoE Wiki Cargo returned HTTP ${response.status}`);
    const text = await response.text();
    pages.push(text);
    const payload = parseJson(text, `PoE Wiki Cargo ${tables}`);
    if (payload.error) {
      throw new Error(`PoE Wiki Cargo ${tables}: ${payload.error.info || payload.error.code}`);
    }
    const batch = (payload.cargoquery || []).map((entry) => entry.title || {});
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  return { rows, retrievedAt, source: pages.join("\n") };
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function luaString(value) {
  return value.replace(/\\([\\"])/g, "$1").replace(/\\n/g, "\n");
}

function pobTemplate(value) {
  return luaString(value)
    .replace(/\(\s*%d\s+to\s+%d\s*\)/gi, "#")
    .replace(/\(\s*-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?\s*\)/g, "#")
    .replace(/%d/g, "#")
    .replace(/%%/g, "%")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePobMapMods(source) {
  const result = [];
  let affix = "unknown";
  for (const line of source.split(/\r?\n/)) {
    const declaration = /^\s*\["((?:\\.|[^"\\])+)"\]\s*=\s*\{/.exec(line);
    if (declaration) affix = luaString(declaration[1]);
    if (line.includes("tooltipLines")) {
      let lineIndex = 0;
      for (const match of line.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
        const text = pobTemplate(match[1]);
        if (text) result.push({ affix, text, ref: `${affix}:tooltip:${lineIndex}` });
        lineIndex += 1;
      }
    }
    const comment = /^\s*\["((?:\\.|[^"\\])+)"\]\s*=\s*\{\s*\},\s*--\s*(.+?)\s*$/.exec(line);
    if (comment) {
      const text = pobTemplate(comment[2]);
      if (text) result.push({
        affix: luaString(comment[1]),
        text,
        ref: `${luaString(comment[1])}:comment`,
      });
    }
  }
  return result;
}

function decodeCargoText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function cargoTemplate(value) {
  return decodeCargoText(value)
    .replace(/\(\s*[+-]?\d[\d,]*(?:\.\d+)?\s*(?:-|to)\s*[+-]?\d[\d,]*(?:\.\d+)?\s*\)/gi, "#")
    .replace(/\+\d[\d,]*(?:\.\d+)?/g, "+#")
    .replace(/-\d[\d,]*(?:\.\d+)?/g, "-#")
    .replace(/\d[\d,]*(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function isCargoRewardLine(value) {
  return (
    /increased (?:quantity|rarity) of items found/i.test(value) ||
    /increased pack size/i.test(value) ||
    /\(hidden\)/i.test(value) ||
    /#% more (?:currency|maps|scarabs) found in area/i.test(value) ||
    /chance for rare monsters to fracture on death/i.test(value)
  );
}

function cargoValue(record, key) {
  return record[key] ?? record[key.replace(/_/g, " ")];
}

function candidatesAtLength(value, length) {
  const result = new Set();
  for (let start = 0; start + length <= value.length; start += 1) {
    const candidate = value.slice(start, start + length);
    if (
      candidate.startsWith(" ") ||
      candidate.endsWith(" ") ||
      candidate.includes("#") ||
      !/[\p{L}\p{N}]/u.test(candidate)
    ) continue;
    result.add(candidate);
  }
  return result;
}

function numericSkeleton(value) {
  return normalized(value)
    .replace(/[+-]?\d[\d,]*(?:\.\d+)?/g, "#")
    .replace(/[+-]?#/g, "#");
}

function templateWitnesses(value) {
  const clean = normalized(value);
  return [0, 1, 42, 999].map((number) => clean
    .replace(/\+#/g, `+${number}`)
    .replace(/-#/g, `-${number}`)
    .replace(/#/g, String(number)));
}

function verifyExactPatterns(entryIds, entriesById) {
  const buckets = new Map();
  for (const entryId of entryIds) {
    const entry = entriesById.get(entryId);
    const key = numericSkeleton(entry.searchText);
    const bucket = buckets.get(key) || [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    for (const entry of bucket) {
      const expression = new RegExp(entry.exact, "iu");
      const own = templateWitnesses(entry.searchText);
      if (!own.some((value) => expression.test(value))) {
        throw new Error(`Exact pattern does not match ${entry.label}: ${entry.exact}`);
      }
      for (const other of bucket) {
        if (other.id === entry.id) continue;
        if (templateWitnesses(other.searchText).some((value) => expression.test(value))) {
          throw new Error(`Exact pattern collision in category: ${entry.label} / ${other.label}`);
        }
      }
    }
  }
}

function deduplicateRenderedFamilies(entryIds, entriesById) {
  const buckets = new Map();
  for (const entryId of entryIds) {
    const entry = entriesById.get(entryId);
    const key = numericSkeleton(entry.searchText);
    const bucket = buckets.get(key) || [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }
  const result = [];
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) =>
      (right.searchText.match(/#/g)?.length || 0) - (left.searchText.match(/#/g)?.length || 0) ||
      left.label.localeCompare(right.label)
    );
    const kept = [];
    for (const entry of bucket) {
      const witnesses = templateWitnesses(entry.searchText);
      const parent = kept.find((candidate) => {
        const expression = new RegExp(candidate.exact, "iu");
        return witnesses.every((value) => expression.test(value));
      });
      if (!parent) {
        kept.push(entry);
        continue;
      }
      parent.sourceIds = [...new Set([...parent.sourceIds, ...entry.sourceIds])];
      parent.sourceRefs = [...new Set([...parent.sourceRefs, ...entry.sourceRefs])];
      parent.tags = [...new Set([...parent.tags, ...entry.tags])];
      for (const [key, values] of Object.entries(entry.metadata || {})) {
        parent.metadata[key] = [...new Set([...(parent.metadata[key] || []), ...values])];
      }
    }
    result.push(...kept.map((entry) => entry.id));
  }
  return result;
}

function optimizeCategory(entryIds, entriesById) {
  const texts = entryIds.map((entryId) => normalized(entriesById.get(entryId).searchText));
  const unresolved = new Set(entryIds.map((_, index) => index));
  const patterns = new Array(entryIds.length);
  const longest = Math.min(32, Math.max(0, ...texts.map((text) => text.length)));

  for (let length = 3; length <= longest && unresolved.size; length += 1) {
    const counts = new Map();
    for (const text of texts) {
      for (const candidate of candidatesAtLength(text, length)) {
        counts.set(candidate, Math.min(2, (counts.get(candidate) || 0) + 1));
      }
    }
    for (const index of [...unresolved]) {
      const candidate = [...candidatesAtLength(texts[index], length)]
        .sort((left, right) => left.localeCompare(right))
        .find((value) => counts.get(value) === 1);
      if (!candidate) continue;
      patterns[index] = escapeRegex(candidate);
      unresolved.delete(index);
    }
  }
  for (const index of unresolved) patterns[index] = entriesById.get(entryIds[index]).exact;
  verifyExactPatterns(entryIds, entriesById);
  return {
    refs: entryIds.map((entryId, index) => ({ entryId, optimized: patterns[index] })),
    exactFallbacks: unresolved.size,
  };
}

const MAP_SPAWN_TAGS = [
  "low_tier_map",
  "mid_tier_map",
  "top_tier_map",
  "uber_tier_map",
  "primordial_map",
];
const [
  baseSource,
  statSource,
  itemsSource,
  statsSource,
  staticSource,
  cargoWeights,
  cargoMods,
] = await Promise.all([
  readSource(options.basePack),
  readSource(options.statPack),
  readSource(options.items),
  readSource(options.stats),
  readSource(options.static),
  cargoRows(
    options.cargoUrl,
    "mod_spawn_weights",
    "_pageName=page,tag,value",
    `value > 0 AND tag IN (${MAP_SPAWN_TAGS.map((tag) => `"${tag}"`).join(",")})`,
  ),
  cargoRows(
    options.cargoUrl,
    "mods",
    "_pageName=page,id,name,mod_groups,generation_type,stat_text_raw",
    "domain=5",
  ),
]);
const basePack = parseJson(baseSource.text, options.basePack);
const statPack = parseJson(statSource.text, options.statPack);
const officialItems = parseJson(itemsSource.text, options.items);
const officialStats = parseJson(statsSource.text, options.stats);
const officialStatic = parseJson(staticSource.text, options.static);
if (!Array.isArray(basePack.baseTypes) || !Array.isArray(statPack.entries)) {
  throw new Error("Bundled price-check packs do not have the expected schema.");
}
for (const [label, value] of [
  ["items", officialItems],
  ["stats", officialStats],
  ["static", officialStatic],
]) {
  if (!Array.isArray(value.result)) throw new Error(`Official ${label} response has no result array.`);
}

const sources = [
  {
    id: "price-check-base-types",
    label: "Bundled price-check base-type pack",
    kind: "bundled-pack",
    inputSha256: sha256(baseSource.text),
    upstream: {
      project: String(basePack.source?.project || "unknown"),
      repository: String(basePack.source?.repository || "unknown"),
      commit: String(basePack.source?.commit || "unknown"),
      dataUpdatedAt: String(basePack.source?.dataUpdatedAt || "unknown"),
    },
  },
  {
    id: "price-check-stats",
    label: "Bundled price-check stat pack",
    kind: "bundled-pack",
    inputSha256: sha256(statSource.text),
    upstream: {
      project: String(statPack.source?.project || "unknown"),
      repository: String(statPack.source?.repository || "unknown"),
      commit: String(statPack.source?.commit || "unknown"),
      dataUpdatedAt: String(statPack.source?.dataUpdatedAt || "unknown"),
    },
  },
  ...[
    ["ggg-trade-items", "GGG Trade item data", itemsSource],
    ["ggg-trade-stats", "GGG Trade stat data", statsSource],
    ["ggg-trade-static", "GGG Trade static data", staticSource],
  ].map(([id, label, source]) => ({
    id,
    label,
    kind: "official-endpoint",
    inputSha256: sha256(source.text),
    url: source.url,
    retrievedAt: source.retrievedAt || new Date().toISOString(),
    upstream: {
      ...(source.etag ? { etag: source.etag } : {}),
      ...(source.lastModified ? { lastModified: source.lastModified } : {}),
    },
  })),
];
const cargoPages = new Set(cargoWeights.rows.map((entry) => String(entry.page || "")));
const cargoMapMods = cargoMods.rows.filter((entry) =>
  cargoPages.has(String(entry.page || "")) &&
  ["1", "2"].includes(String(cargoValue(entry, "generation_type") || ""))
);
if (cargoPages.size < 1 || cargoMapMods.length < 1) {
  throw new Error("PoE Wiki Cargo returned no positively weighted map modifiers.");
}
sources.push({
  id: "poe-wiki-cargo-map-mods",
  label: "PoE Wiki Cargo map modifier data",
  kind: "wiki-cargo",
  inputSha256: sha256(`${cargoWeights.source}\n${cargoMods.source}`),
  url: options.cargoUrl,
  retrievedAt: [cargoWeights.retrievedAt, cargoMods.retrievedAt].sort().at(-1),
  upstream: {
    tables: "mods,mod_spawn_weights",
    positiveSpawnWeightRows: cargoWeights.rows.length,
    matchedModifierRows: cargoMapMods.length,
    matchedPages: cargoPages.size,
  },
});

let pobMods = [];
if (options.pobData) {
  const pobSource = await readSource(options.pobData);
  pobMods = parsePobMapMods(pobSource.text);
  let version = options.pobVersion;
  if (!version && !/^https?:\/\//i.test(options.pobData)) {
    try {
      const manifest = await fs.readFile(
        path.resolve(path.dirname(options.pobData), "..", "manifest.xml"),
        "utf8",
      );
      version = /<Version\b[^>]*\bnumber="([^"]+)"/.exec(manifest)?.[1];
    } catch {
      version = undefined;
    }
  }
  sources.push({
    id: "path-of-building-map-mods",
    label: "Path of Building Community map modifier data",
    kind: "path-of-building",
    inputSha256: sha256(pobSource.text),
    repository: "https://github.com/PathOfBuildingCommunity/PathOfBuilding",
    version,
    upstream: { file: "Data/ModMap.lua", license: "MIT" },
  });
}

const entriesByKey = new Map();
const entriesById = new Map();
function registerEntry(
  label,
  searchText,
  sourceId,
  { refs = [], tags = [], metadata = {} } = {},
) {
  const clean = String(searchText || "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  const key = normalized(clean);
  let entry = entriesByKey.get(key);
  if (!entry) {
    entry = {
      id: stableId(key),
      label: String(label || clean).replace(/\s+/g, " ").trim(),
      searchText: clean,
      exact: exactPattern(clean),
      sourceIds: [],
      sourceRefs: [],
      tags: [],
      metadata: {},
    };
    entriesByKey.set(key, entry);
    entriesById.set(entry.id, entry);
  }
  entry.sourceIds = [...new Set([...entry.sourceIds, sourceId])];
  entry.sourceRefs = [...new Set([...entry.sourceRefs, ...refs.filter(Boolean)])];
  entry.tags = [...new Set([...entry.tags, ...tags.filter(Boolean)])];
  for (const [key, values] of Object.entries(metadata)) {
    entry.metadata[key] = [...new Set([
      ...(entry.metadata[key] || []),
      ...values.map(String).filter(Boolean),
    ])];
  }
  return entry.id;
}

const baseTypeIds = basePack.baseTypes.map((name) =>
  registerEntry(name, name, "price-check-base-types", { tags: ["base-type"] })
).filter(Boolean);
const mapAreaIds = Object.entries(basePack.mapAreaTradeDiscriminators || {}).map(
  ([name, discriminator]) => registerEntry(name, `${name} Map`, "price-check-base-types", {
    refs: [String(discriminator)],
    tags: ["map-name", "map-area"],
  }),
).filter(Boolean);

const itemGroups = new Map();
for (const group of officialItems.result) {
  const ids = [];
  for (const item of Array.isArray(group.entries) ? group.entries : []) {
    const text = String(item.name || item.text || item.type || "").trim();
    const id = registerEntry(text, text, "ggg-trade-items", {
      refs: [String(item.disc || item.type || text)],
      tags: [String(group.id || "item"), item.flags?.unique ? "unique" : "base"],
    });
    if (id) ids.push(id);
  }
  itemGroups.set(String(group.id), [...new Set(ids)]);
}

const statPackPatternsById = new Map();
for (const entry of statPack.entries) {
  for (const candidate of Array.isArray(entry.candidates) ? entry.candidates : []) {
    const values = statPackPatternsById.get(candidate.id) || [];
    values.push(entry.pattern);
    statPackPatternsById.set(candidate.id, values);
  }
}
const statGroups = new Map();
for (const group of officialStats.result) {
  if (group.id === "pseudo") continue;
  const ids = [];
  for (const stat of Array.isArray(group.entries) ? group.entries : []) {
    const text = String(stat.text || "").trim();
    if (!text) continue;
    const variants = stat.option?.options?.length && text.includes("#")
      ? stat.option.options.map((option) => text.replace("#", String(option.text || option.id)))
      : [text];
    for (const variant of variants) {
      const bundled = statPackPatternsById.has(stat.id);
      const id = registerEntry(variant, variant, "ggg-trade-stats", {
        refs: [String(stat.id)],
        tags: [String(group.id || stat.type || "stat"), String(stat.type || "stat")],
      });
      if (id && bundled) {
        const entry = entriesById.get(id);
        entry.sourceIds = [...new Set([...entry.sourceIds, "price-check-stats"])];
      }
      if (id) ids.push(id);
    }
  }
  statGroups.set(String(group.id), [...new Set(ids)]);
}

const staticGroups = new Map();
for (const group of officialStatic.result) {
  const ids = [];
  for (const item of Array.isArray(group.entries) ? group.entries : []) {
    const text = String(item.text || "").trim();
    const id = registerEntry(text, text, "ggg-trade-static", {
      refs: [String(item.id || text)],
      tags: [String(group.id || "static")],
    });
    if (id) ids.push(id);
  }
  staticGroups.set(String(group.id), [...new Set(ids)]);
}

const canonicalStatPatterns = new Map(statPack.entries.map((entry) => [
  normalized(entry.pattern).replace(/\+#/g, "#").replace(/\bminus #/g, "#"),
  entry,
]));
const weightsByPage = new Map();
for (const weight of cargoWeights.rows) {
  const page = String(weight.page || "");
  const values = weightsByPage.get(page) || [];
  values.push({
    tag: String(weight.tag || ""),
    value: String(weight.value || ""),
  });
  weightsByPage.set(page, values);
}
const mapModIds = [];
const mapEntriesByCanonical = new Map();
let discardedCargoRows = 0;
for (const mod of cargoMapMods) {
  const page = String(mod.page || "");
  const affix = decodeCargoText(cargoValue(mod, "name"));
  const modGroup = String(cargoValue(mod, "mod_groups") || "unknown");
  const generationType = String(cargoValue(mod, "generation_type") || "");
  const spawnWeights = weightsByPage.get(page) || [];
  const lines = decodeCargoText(cargoValue(mod, "stat_text_raw"))
    .split(/<br\s*\/?\s*>/i)
    .map(cargoTemplate)
    .filter((line) => line && !isCargoRewardLine(line));
  if (!lines.length) discardedCargoRows += 1;
  for (const line of lines) {
    const canonical = normalized(line).replace(/\+#/g, "#").replace(/\bminus #/g, "#");
    const stat = canonicalStatPatterns.get(canonical);
    const id = registerEntry(line, line, "poe-wiki-cargo-map-mods", {
      refs: [
        page,
        String(cargoValue(mod, "id") || ""),
        ...(stat?.candidates || []).map((candidate) => candidate.id),
      ],
      tags: [
        "map-modifier",
        affix,
        modGroup,
        ...spawnWeights.map((weight) => weight.tag),
      ],
      metadata: {
        "spawn-tags": spawnWeights.map((weight) => weight.tag),
        "spawn-weights": spawnWeights.map((weight) => `${weight.tag}:${weight.value}`),
        "mod-groups": [modGroup],
        "generation-types": [generationType],
        affixes: [affix],
        "source-pages": [page],
      },
    });
    if (id && stat) {
      const entry = entriesById.get(id);
      entry.sourceIds = [...new Set([...entry.sourceIds, "price-check-stats"])];
    }
    if (id) {
      mapModIds.push(id);
      mapEntriesByCanonical.set(canonical, id);
    }
  }
}
let pobMatchedMapLines = 0;
for (const mod of pobMods) {
  const canonical = normalized(mod.text).replace(/\+#/g, "#").replace(/\bminus #/g, "#");
  const id = mapEntriesByCanonical.get(canonical);
  if (!id) continue;
  const entry = entriesById.get(id);
  entry.sourceIds = [...new Set([...entry.sourceIds, "path-of-building-map-mods"])];
  entry.sourceRefs = [...new Set([...entry.sourceRefs, mod.ref])];
  entry.tags = [...new Set([...entry.tags, mod.affix])];
  entry.metadata.affixes = [...new Set([...(entry.metadata.affixes || []), mod.affix])];
  pobMatchedMapLines += 1;
}

const categories = [];
function addCategory({
  id,
  label,
  kind,
  section,
  description,
  aliases = [],
  defaultMode = "want",
}, rawEntryIds) {
  const entryIds = [...new Set(rawEntryIds.filter(Boolean))]
    .filter((entryId) => entriesById.has(entryId))
    .sort((left, right) => entriesById.get(left).label.localeCompare(entriesById.get(right).label));
  const exactSeen = new Set();
  const exactDeduplicated = entryIds.filter((entryId) => {
    const exact = entriesById.get(entryId).exact;
    if (exactSeen.has(exact)) return false;
    exactSeen.add(exact);
    return true;
  });
  const deduplicated = deduplicateRenderedFamilies(exactDeduplicated, entriesById);
  const { refs, exactFallbacks } = optimizeCategory(deduplicated, entriesById);
  const sourceIds = [...new Set(deduplicated.flatMap((entryId) =>
    entriesById.get(entryId).sourceIds
  ))];
  categories.push({
    id,
    label,
    kind,
    section,
    description,
    sourceIds,
    search: {
      placeholder: `Search ${label.toLowerCase()}...`,
      aliases,
      defaultMode,
      supportsWant: true,
      supportsAvoid: true,
      supportsMatchAny: true,
      supportsMatchAll: true,
      supportsExact: true,
      supportsOptimized: true,
    },
    optimization: {
      algorithm: "shortest-unique-literal-v1",
      universeSha256: sha256(deduplicated.map((entryId) =>
        `${entryId}\0${normalized(entriesById.get(entryId).searchText)}`
      ).join("\n")),
      verified: true,
      exactFallbacks,
    },
    entries: refs,
  });
}

const allItemIds = [...baseTypeIds, ...itemGroups.values().flatMap((ids) => ids)];
const mapNameIds = [
  ...mapAreaIds,
  ...(staticGroups.get("MapsSpecial") || []),
  ...(staticGroups.get("MapsUnique") || []),
  ...(itemGroups.get("map") || []).filter((entryId) => {
    const entry = entriesById.get(entryId);
    return entry.tags.includes("unique") && /\bmap\b/i.test(entry.searchText);
  }),
];
addCategory({
  id: "map-modifiers",
  label: "Map modifiers",
  kind: "modifier",
  section: "core",
  description: "Visible effect lines from every positively weighted map Area modifier returned by the PoE Wiki Cargo queries.",
  aliases: ["maps", "map mods", "danger mods"],
  defaultMode: "avoid",
}, mapModIds);
addCategory({
  id: "items",
  label: "Items",
  kind: "item",
  section: "core",
  description: "Item names and base types from the bundled base pack and official Trade item groups.",
  aliases: ["bases", "base types", "uniques"],
}, allItemIds);
addCategory({
  id: "map-names",
  label: "Map names",
  kind: "map-name",
  section: "core",
  description: "Current regular, special, and unique map names exposed by official Trade data.",
  aliases: ["maps", "atlas"],
}, mapNameIds);
addCategory({
  id: "gems",
  label: "Gems",
  kind: "gem",
  section: "core",
  description: "Gem names exposed by the official Trade item endpoint.",
  aliases: ["skill gems", "support gems", "transfigured gems"],
}, itemGroups.get("gem") || []);

const ancestorIds = staticGroups.get("Ancestor") || [];
const convenience = [
  ["beasts", "Beasts", "beast", staticGroups.get("Beasts") || []],
  ["runegrafts", "Runegrafts", "runegraft", staticGroups.get("Runegrafts") || []],
  ["tattoos", "Tattoos", "tattoo", ancestorIds.filter((id) => /tattoo/i.test(entriesById.get(id).searchText))],
  ["omens", "Omens", "omen", ancestorIds.filter((id) => /^omen\b/i.test(entriesById.get(id).searchText))],
  ["scarabs", "Scarabs", "scarab", (staticGroups.get("Fragments") || []).filter((id) => /scarab/i.test(entriesById.get(id).searchText))],
  ["heist", "Heist", "contracts blueprints", [
    ...(staticGroups.get("Heist") || []),
    ...(itemGroups.get("heistmission") || []),
    ...(itemGroups.get("heistequipment") || []),
  ]],
  ["expedition", "Expedition", "logbooks artifacts", [
    ...(staticGroups.get("Expedition") || []),
    ...(itemGroups.get("logbook") || []),
  ]],
  ["jewels", "Jewels", "jewel cluster abyss", itemGroups.get("jewel") || []],
];
for (const [id, label, aliases, ids] of convenience) {
  addCategory({
    id,
    label,
    kind: "mechanic",
    section: "mechanic",
    description: `${label} names exposed by the relevant official Trade categories.`,
    aliases: aliases.split(" "),
  }, ids);
}

for (const group of officialItems.result) {
  addCategory({
    id: `trade-item-${slug(group.id)}`,
    label: String(group.label || group.id),
    kind: group.id === "gem" ? "gem" : "item",
    section: "official-items",
    description: `Official Trade item category ${group.id}.`,
    aliases: [String(group.id)],
  }, itemGroups.get(String(group.id)) || []);
}
for (const group of officialStats.result) {
  if (group.id === "pseudo") continue;
  addCategory({
    id: `trade-stat-${slug(group.id)}`,
    label: `${String(group.label || group.id)} modifiers`,
    kind: "modifier",
    section: "official-stats",
    description: `Display strings from the official Trade ${group.id} stat category.`,
    aliases: [String(group.id), "modifiers", "stats"],
  }, statGroups.get(String(group.id)) || []);
}
for (const group of officialStatic.result) {
  const ids = staticGroups.get(String(group.id)) || [];
  if (!ids.length) continue;
  addCategory({
    id: `trade-static-${slug(group.id)}`,
    label: String(group.label || group.id),
    kind: "mechanic",
    section: "official-static",
    description: `Official Trade static category ${group.id}.`,
    aliases: [String(group.id)],
  }, ids);
}

const generatedAt = new Date().toISOString();
const officialRetrievedAt = [itemsSource, statsSource, staticSource]
  .map((source) => source.retrievedAt)
  .filter(Boolean)
  .sort()
  .at(-1) || generatedAt;
const usedEntryIds = new Set(categories.flatMap((category) =>
  category.entries.map((entry) => entry.entryId)
));
const entries = [...entriesById.values()]
  .filter((entry) => usedEntryIds.has(entry.id))
  .map((entry) => ({
    ...entry,
    ...(entry.sourceRefs.length ? {} : { sourceRefs: undefined }),
    ...(entry.tags.length ? {} : { tags: undefined }),
    ...(Object.keys(entry.metadata).length ? {} : { metadata: undefined }),
  }))
  .sort((left, right) => left.id.localeCompare(right.id));
const payload = {
  schema: 1,
  game: "poe1",
  generatedAt,
  update: {
    command: "node scripts/build-regex-data.mjs [--pob-data <PathOfBuilding>/Data/ModMap.lua]",
    officialRetrievedAt,
  },
  coverage: {
    mapModifiers: {
      positiveSpawnWeightRows: cargoWeights.rows.length,
      matchedPages: cargoPages.size,
      matchedModifierRows: cargoMapMods.length,
      searchableEffectLines: categories.find((category) =>
        category.id === "map-modifiers"
      )?.entries.length || 0,
      discardedRewardOnlyRows: discardedCargoRows,
      spawnTagCounts: Object.fromEntries(MAP_SPAWN_TAGS.map((tag) => [
        tag,
        cargoWeights.rows.filter((entry) => entry.tag === tag).length,
      ])),
      ...(options.pobData ? { pobCorroboratedLines: pobMatchedMapLines } : {}),
    },
    officialTrade: {
      itemGroups: officialItems.result.length,
      statGroups: officialStats.result.length,
      staticGroups: officialStatic.result.length,
    },
  },
  sources,
  limitations: [
    `The map query considered all ${cargoPages.size} Area-modifier pages with positive low-, mid-, top-, uber-, or primordial-map spawn weights returned by Cargo at build time; this is source coverage, not a claim that the wiki cannot lag a game patch.`,
    "Quantity, rarity, pack-size, hidden implementation, and reward-only lines are excluded from map modifier search entries; equal numeric tier variants collapse to one searchable template.",
    options.pobData
      ? `${pobMatchedMapLines} Cargo map effect lines were independently corroborated by the supplied Path of Building ModMap file.`
      : "No optional Path of Building ModMap file was supplied for independent map-line corroboration.",
    "Pseudo Trade stats are excluded because they are derived search filters rather than literal in-game item lines.",
    "The pack targets Path of Exile 1. GGG documents only limited Path of Exile 2 API coverage.",
  ],
  entries,
  categories,
};

const output = path.resolve(options.output);
const serialized = `${JSON.stringify(payload)}\n`;
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, serialized, "utf8");
console.log(JSON.stringify({
  output,
  entries: entries.length,
  categories: categories.length,
  mapModifiers: new Set(mapModIds).size,
  cargoMapRows: cargoMapMods.length,
  mapNames: categories.find((category) => category.id === "map-names")?.entries.length || 0,
  gems: categories.find((category) => category.id === "gems")?.entries.length || 0,
  bytes: Buffer.byteLength(serialized),
  sha256: crypto.createHash("sha256").update(serialized).digest("hex"),
}));
