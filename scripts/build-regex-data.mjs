import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const packageJson = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const USER_AGENT = `GloamCore/${packageJson.version} (local regex data builder)`;

const NUMBER = "\\d[\\d,]*(?:\\.\\d+)?";
const argv = process.argv.slice(2);
const options = {
  basePack: "src/lib/price-check/base-types-v1.json",
  statPack: "public/data/price-check/stats-v1.json",
  cargoUrl: "https://www.poewiki.net/w/api.php",
  output: "public/data/toolkit/regex-v1.json",
  reoptimizeExisting: undefined,
};

for (let index = 0; index < argv.length; index += 1) {
  const name = argv[index];
  if (name === "--help") {
    console.log("node scripts/build-regex-data.mjs [--base-pack FILE] [--stat-pack FILE] [--cargo-url URL] [--pob-data FILE] [--pob-version VERSION] [--reoptimize-existing PACK] [--output FILE]");
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
  return { text: await fs.readFile(path.resolve(specification), "utf8") };
}

async function cargoRows(cargoUrl, tables, fields, where) {
  const rows = [];
  const pages = [];
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
  return { rows, source: pages.join("\n") };
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
      /\p{N}/u.test(candidate) ||
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

function verifyPinnedPoe1Packs(basePack, statPack) {
  const expectedProject = "Awakened PoE Trade";
  const expectedRepository = "https://github.com/SnosMe/awakened-poe-trade";
  const sources = [basePack?.source, statPack?.source];
  if (sources.some((source) =>
    source?.project !== expectedProject ||
    source?.repository !== expectedRepository ||
    !/^[0-9a-f]{40}$/i.test(String(source?.commit || "")) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(source?.dataUpdatedAt || ""))
  )) {
    throw new Error("Bundled regex inputs must be pinned Awakened PoE Trade snapshots.");
  }
  if (sources[0].commit !== sources[1].commit ||
      sources[0].dataUpdatedAt !== sources[1].dataUpdatedAt) {
    throw new Error("Bundled base-type and stat packs come from different source snapshots.");
  }
  if (!Array.isArray(basePack.baseTypes) ||
      !basePack.itemProfiles || typeof basePack.itemProfiles !== "object" ||
      !basePack.uniqueProfiles || typeof basePack.uniqueProfiles !== "object" ||
      !basePack.gemProfiles || typeof basePack.gemProfiles !== "object" ||
      !Array.isArray(statPack.entries)) {
    throw new Error("Bundled regex inputs do not have the expected PoE 1 schemas.");
  }
  return {
    project: expectedProject,
    repository: expectedRepository,
    commit: sources[0].commit,
    dataUpdatedAt: sources[0].dataUpdatedAt,
  };
}

function verifyExistingPackProvenance(payload) {
  if (payload?.game !== "poe1" || !Array.isArray(payload.sources)) {
    throw new Error("Existing regex pack is not a Path of Exile 1 data pack.");
  }
  const allowedKinds = new Set(["bundled-pack", "path-of-building", "wiki-cargo"]);
  if (payload.sources.some((source) => !allowedKinds.has(source?.kind))) {
    throw new Error("Existing regex pack has unsupported source provenance.");
  }
  const bundled = payload.sources.filter((source) => source.kind === "bundled-pack");
  const ids = new Set(bundled.map((source) => source.id));
  if (bundled.length !== 2 ||
      !ids.has("price-check-base-types") ||
      !ids.has("price-check-stats") ||
      new Set(bundled.map((source) => source.upstream?.project)).size !== 1 ||
      new Set(bundled.map((source) => source.upstream?.repository)).size !== 1 ||
      new Set(bundled.map((source) => source.upstream?.commit)).size !== 1 ||
      new Set(bundled.map((source) => source.upstream?.dataUpdatedAt)).size !== 1 ||
      bundled[0]?.upstream?.project !== "Awakened PoE Trade" ||
      bundled[0]?.upstream?.repository !== "https://github.com/SnosMe/awakened-poe-trade" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(String(payload.update?.sourceUpdatedAt || "")) ||
      !payload.coverage?.bundledSources) {
    throw new Error("Existing regex pack does not contain one pinned bundled source family.");
  }
}

const FULL_TOOLTIP_TEMPLATES = [
  "Item Class: Maps",
  "Item Class: Currency",
  "Rarity: Normal",
  "Rarity: Magic",
  "Rarity: Rare",
  "Rarity: Unique",
  "Map Tier: #",
  "Item Level: #",
  "Level: #",
  "Quality: +#%",
  "Quality: +#% (augmented)",
  "Armour: #",
  "Armour: # (augmented)",
  "Evasion Rating: #",
  "Evasion Rating: # (augmented)",
  "Energy Shield: #",
  "Energy Shield: # (augmented)",
  "Ward: #",
  "Ward: # (augmented)",
  "Physical Damage: #-#",
  "Physical Damage: #-# (augmented)",
  "Elemental Damage: #-#",
  "Elemental Damage: #-# (augmented)",
  "Chaos Damage: #-#",
  "Chaos Damage: #-# (augmented)",
  "Critical Strike Chance: #%",
  "Critical Strike Chance: #% (augmented)",
  "Attacks per Second: #",
  "Attacks per Second: # (augmented)",
  "Weapon Range: #",
  "Chance to Block: #%",
  "Chance to Block: #% (augmented)",
  "Item Quantity: +#%",
  "Item Quantity: +#% (augmented)",
  "Item Rarity: +#%",
  "Item Rarity: +#% (augmented)",
  "Monster Pack Size: +#%",
  "Monster Pack Size: +#% (augmented)",
  "More Maps: +#%",
  "Stack Size: #/#",
  "Experience: #/#",
  "Str: #",
  "Dex: #",
  "Int: #",
  "Radius: Small",
  "Radius: Medium",
  "Radius: Large",
  "Radius: Variable",
  "Sockets: R-R-R",
  "Requirements:",
  "Corrupted",
  "Unidentified",
  "Mirrored",
  "Split",
  "Fractured Item",
  "Synthesised Item",
  "Scourged",
  "Foulborn",
  "Vestigial",
  "Blighted",
  "Blight-ravaged",
];

function buildFullTooltipCorpus(entriesById) {
  const rows = [];
  for (const entry of entriesById.values()) {
    for (const text of templateWitnesses(entry.searchText)) {
      rows.push({ family: numericSkeleton(entry.searchText), text });
    }
  }
  FULL_TOOLTIP_TEMPLATES.forEach((template, index) => {
    const family = numericSkeleton(template) || `tooltip:${index}`;
    for (const text of templateWitnesses(template)) rows.push({ family, text });
  });
  return [...new Map(rows.map((row) => [`${row.family}\0${row.text}`, row])).values()]
    .sort((left, right) => left.family.localeCompare(right.family) || left.text.localeCompare(right.text));
}

function verifyExactPatterns(entryIds, entriesById, corpus) {
  for (const entryId of entryIds) {
    const entry = entriesById.get(entryId);
    const expression = new RegExp(entry.exact, "iu");
    const own = templateWitnesses(entry.searchText);
    if (!own.some((value) => expression.test(value))) {
      throw new Error(`Exact pattern does not match ${entry.label}: ${entry.exact}`);
    }
    const family = numericSkeleton(entry.searchText);
    const collision = corpus.find((row) =>
      row.family !== family && expression.test(row.text)
    );
    if (collision) {
      throw new Error(`Exact pattern collision in full tooltip corpus: ${entry.label} / ${collision.text}`);
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

function optimizeFullTooltip(entryIds, entriesById, corpus) {
  const texts = entryIds.map((entryId) => normalized(entriesById.get(entryId).searchText));
  const unresolved = new Set(entryIds.map((_, index) => index));
  const patterns = new Array(entryIds.length);
  const longest = Math.min(32, Math.max(0, ...texts.map((text) => text.length)));

  for (let length = 3; length <= longest && unresolved.size; length += 1) {
    const wanted = new Set();
    for (const index of unresolved) {
      for (const candidate of candidatesAtLength(texts[index], length)) wanted.add(candidate);
    }
    const owners = new Map();
    for (const row of corpus) {
      for (const candidate of candidatesAtLength(row.text, length)) {
        if (!wanted.has(candidate)) continue;
        const owner = owners.get(candidate);
        if (owner === undefined) owners.set(candidate, row.family);
        else if (owner !== row.family) owners.set(candidate, null);
      }
    }
    for (const index of [...unresolved]) {
      const candidate = [...candidatesAtLength(texts[index], length)]
        .sort((left, right) => left.localeCompare(right))
        .find((value) => owners.get(value) === numericSkeleton(entriesById.get(entryIds[index]).searchText));
      if (!candidate) continue;
      patterns[index] = escapeRegex(candidate);
      unresolved.delete(index);
    }
  }
  for (const index of unresolved) patterns[index] = entriesById.get(entryIds[index]).exact;
  verifyExactPatterns([...unresolved].map((index) => entryIds[index]), entriesById, corpus);
  return {
    patterns: new Map(entryIds.map((entryId, index) => [entryId, patterns[index]])),
    exactFallbackIds: new Set([...unresolved].map((index) => entryIds[index])),
  };
}

if (options.reoptimizeExisting) {
  const input = path.resolve(options.reoptimizeExisting);
  const original = await fs.readFile(input, "utf8");
  const payload = parseJson(original, input);
  if (!Array.isArray(payload.entries) || !Array.isArray(payload.categories)) {
    throw new Error("Existing regex pack does not contain entries and categories arrays.");
  }
  verifyExistingPackProvenance(payload);
  const existingEntriesById = new Map(payload.entries.map((entry) => [entry.id, entry]));
  const corpus = buildFullTooltipCorpus(existingEntriesById);
  const corpusSha256 = sha256(corpus.map((row) => `${row.family}\0${row.text}`).join("\n"));
  const optimization = optimizeFullTooltip(
    [...existingEntriesById.keys()],
    existingEntriesById,
    corpus,
  );
  payload.categories = payload.categories.map((category) => ({
    ...category,
    optimization: {
      algorithm: "shortest-full-tooltip-literal-v2",
      corpusSha256,
      corpusLines: corpus.length,
      verified: true,
      exactFallbacks: category.entries.filter((reference) =>
        optimization.exactFallbackIds.has(reference.entryId)
      ).length,
    },
    entries: category.entries.map((reference) => ({
      entryId: reference.entryId,
      optimized: optimization.patterns.get(reference.entryId) ||
        existingEntriesById.get(reference.entryId)?.exact,
    })),
  }));
  const limitation = `Optimized fragments were collision-checked against ${corpus.length} rendered full-tooltip corpus lines spanning names, bases, headers, properties, status flags, modifiers, and numeric template witnesses.`;
  payload.limitations = [
    ...(Array.isArray(payload.limitations) ? payload.limitations : []).filter((entry) =>
      !String(entry).startsWith("Optimized fragments were collision-checked against ")
    ),
    limitation,
  ];
  payload.update = {
    ...payload.update,
    command: `node scripts/build-regex-data.mjs --reoptimize-existing ${options.reoptimizeExisting} --output ${options.output}`,
  };
  const output = path.resolve(options.output);
  const serialized = `${JSON.stringify(payload)}\n`;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, serialized, "utf8");
  console.log(JSON.stringify({
    output,
    entries: payload.entries.length,
    categories: payload.categories.length,
    corpusLines: corpus.length,
    bytes: Buffer.byteLength(serialized),
    sha256: sha256(serialized),
  }));
  process.exit(0);
}

const MAP_SPAWN_TAGS = [
  "low_tier_map",
  "mid_tier_map",
  "top_tier_map",
  "uber_tier_map",
  "primordial_map",
];
if ([options.basePack, options.statPack, options.pobData].filter(Boolean).some((value) =>
  /^https?:\/\//i.test(value)
)) {
  throw new Error("Bundled and optional Path of Building inputs must be local files.");
}
const cargoEndpoint = new URL(options.cargoUrl);
if (cargoEndpoint.protocol !== "https:" ||
    cargoEndpoint.hostname !== "www.poewiki.net" ||
    cargoEndpoint.pathname !== "/w/api.php") {
  throw new Error("Map modifier data must come from the PoE Wiki Cargo endpoint.");
}
const [
  baseSource,
  statSource,
  cargoWeights,
  cargoMods,
] = await Promise.all([
  readSource(options.basePack),
  readSource(options.statPack),
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
const sourceSnapshot = verifyPinnedPoe1Packs(basePack, statPack);

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

function registerProfileRecord(record, tagsForProfile) {
  const ids = [];
  for (const [name, rawProfiles] of Object.entries(record || {})) {
    const profiles = Array.isArray(rawProfiles) ? rawProfiles : [rawProfiles];
    const refs = profiles.flatMap((profile) => [profile?.tradeTag, profile?.baseType]).filter(Boolean);
    const tags = profiles.flatMap((profile) => tagsForProfile(profile || {}));
    const id = registerEntry(name, name, "price-check-base-types", { refs, tags });
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

const itemProfileIds = registerProfileRecord(basePack.itemProfiles, (profile) => [
  "item",
  profile.exchangeable ? "exchangeable" : "",
]);
const uniqueProfileIds = registerProfileRecord(basePack.uniqueProfiles, (profile) => [
  "item",
  "unique",
  profile.baseType || "",
]);
const gemProfileIds = registerProfileRecord(basePack.gemProfiles, (profile) => [
  "gem",
  profile.transfigured ? "transfigured" : "",
]);

const statGroups = new Map();
for (const stat of statPack.entries) {
  const candidates = (Array.isArray(stat.candidates) ? stat.candidates : [])
    .filter((candidate) => candidate?.kind !== "pseudo");
  if (!candidates.length) continue;
  const text = String(candidates[0].matcherText || candidates[0].ref || stat.pattern || "").trim();
  const kinds = [...new Set(candidates.map((candidate) => String(candidate.kind || "modifier")))];
  const id = registerEntry(text, text, "price-check-stats", {
    refs: candidates.map((candidate) => String(candidate.id || "")).filter(Boolean),
    tags: kinds,
  });
  if (!id) continue;
  for (const kind of kinds) {
    const ids = statGroups.get(kind) || [];
    ids.push(id);
    statGroups.set(kind, ids);
  }
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

const fullTooltipCorpus = buildFullTooltipCorpus(entriesById);
const fullTooltipCorpusSha256 = sha256(fullTooltipCorpus.map((row) =>
  `${row.family}\0${row.text}`
).join("\n"));
const fullTooltipOptimization = optimizeFullTooltip(
  [...entriesById.keys()],
  entriesById,
  fullTooltipCorpus,
);

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
  const refs = deduplicated.map((entryId) => ({
    entryId,
    optimized: fullTooltipOptimization.patterns.get(entryId) || entriesById.get(entryId).exact,
  }));
  const exactFallbacks = deduplicated.filter((entryId) =>
    fullTooltipOptimization.exactFallbackIds.has(entryId)
  ).length;
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
      algorithm: "shortest-full-tooltip-literal-v2",
      corpusSha256: fullTooltipCorpusSha256,
      corpusLines: fullTooltipCorpus.length,
      verified: true,
      exactFallbacks,
    },
    entries: refs,
  });
}

const allItemIds = [...baseTypeIds, ...itemProfileIds, ...uniqueProfileIds];
const mapNameIds = [
  ...mapAreaIds,
  ...baseTypeIds.filter((entryId) => /\bmap\b/i.test(entriesById.get(entryId).searchText)),
  ...uniqueProfileIds.filter((entryId) => /\bmap\b/i.test(entriesById.get(entryId).tags.join(" "))),
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
  description: "Item names and base types from the pinned Awakened PoE Trade base pack.",
  aliases: ["bases", "base types", "uniques"],
}, allItemIds);
addCategory({
  id: "map-names",
  label: "Map names",
  kind: "map-name",
  section: "core",
  description: "Map names and discriminators from the pinned Awakened PoE Trade base pack.",
  aliases: ["maps", "atlas"],
}, mapNameIds);
addCategory({
  id: "gems",
  label: "Gems",
  kind: "gem",
  section: "core",
  description: "Gem names from the pinned Awakened PoE Trade base pack.",
  aliases: ["skill gems", "support gems", "transfigured gems"],
}, gemProfileIds);

const mechanicSourceIds = [...new Set([...itemProfileIds, ...uniqueProfileIds, ...baseTypeIds])];
const convenience = [
  ["runegrafts", "Runegrafts", "runegraft", mechanicSourceIds.filter((id) => /runegraft/i.test(entriesById.get(id).searchText))],
  ["tattoos", "Tattoos", "tattoo", mechanicSourceIds.filter((id) => /tattoo/i.test(entriesById.get(id).searchText))],
  ["omens", "Omens", "omen", mechanicSourceIds.filter((id) => /^omen\b/i.test(entriesById.get(id).searchText))],
  ["scarabs", "Scarabs", "scarab", mechanicSourceIds.filter((id) => /scarab/i.test(entriesById.get(id).searchText))],
  ["heist", "Heist", "contracts blueprints", mechanicSourceIds.filter((id) => /\b(?:contract|blueprint|heist)\b/i.test(entriesById.get(id).searchText))],
  ["expedition", "Expedition", "logbooks artifacts", mechanicSourceIds.filter((id) => /\b(?:logbook|artifact)\b/i.test(entriesById.get(id).searchText))],
  ["jewels", "Jewels", "jewel cluster abyss", mechanicSourceIds.filter((id) => /\bjewel\b/i.test(entriesById.get(id).searchText))],
  ["exchangeable", "Exchangeable items", "currency bulk", itemProfileIds.filter((id) => entriesById.get(id).tags.includes("exchangeable"))],
  ["uniques", "Unique items", "unique", uniqueProfileIds],
];
for (const [id, label, aliases, ids] of convenience) {
  addCategory({
    id,
    label,
    kind: "mechanic",
    section: "mechanic",
    description: `${label} names from the pinned Awakened PoE Trade base pack.`,
    aliases: aliases.split(" "),
  }, ids);
}

const statLabels = {
  crafted: "Crafted",
  enchant: "Enchant",
  explicit: "Explicit",
  fractured: "Fractured",
  imbued: "Imbued",
  implicit: "Implicit",
  veiled: "Veiled",
};
for (const [kind, ids] of [...statGroups].sort(([left], [right]) => left.localeCompare(right))) {
  addCategory({
    id: `bundled-stat-${slug(kind)}`,
    label: `${statLabels[kind] || kind} modifiers`,
    kind: "modifier",
    section: "bundled-stats",
    description: `${statLabels[kind] || kind} modifier text from the pinned Awakened PoE Trade stat pack.`,
    aliases: [kind, "modifiers", "stats"],
  }, ids);
}

const sourceUpdatedAt = `${sourceSnapshot.dataUpdatedAt}T00:00:00.000Z`;
const generatedAt = [basePack.generatedAt, statPack.generatedAt]
  .filter((value) => !Number.isNaN(Date.parse(value)))
  .sort()
  .at(-1) || sourceUpdatedAt;
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
    sourceUpdatedAt,
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
    bundledSources: {
      baseTypes: basePack.baseTypes.length,
      itemProfiles: Object.keys(basePack.itemProfiles).length,
      uniqueProfiles: Object.keys(basePack.uniqueProfiles).length,
      gemProfiles: Object.keys(basePack.gemProfiles).length,
      statPatterns: statPack.entries.filter((entry) =>
        (entry.candidates || []).some((candidate) => candidate.kind !== "pseudo")
      ).length,
    },
  },
  sources,
  limitations: [
    `The map query considered all ${cargoPages.size} Area-modifier pages with positive low-, mid-, top-, uber-, or primordial-map spawn weights returned by Cargo at build time; this is source coverage, not a claim that the wiki cannot lag a game patch.`,
    "Quantity, rarity, pack-size, hidden implementation, and reward-only lines are excluded from map modifier search entries; equal numeric tier variants collapse to one searchable template.",
    options.pobData
      ? `${pobMatchedMapLines} Cargo map effect lines were independently corroborated by the supplied Path of Building ModMap file.`
      : "No optional Path of Building ModMap file was supplied for independent map-line corroboration.",
    "Pseudo stats are excluded because they are derived search filters rather than literal in-game item lines.",
    `Optimized fragments were collision-checked against ${fullTooltipCorpus.length} rendered full-tooltip corpus lines spanning names, bases, headers, properties, status flags, modifiers, and numeric template witnesses.`,
    "The pack targets Path of Exile 1 and uses only pinned Awakened PoE Trade snapshots plus current PoE Wiki map-modifier records.",
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
