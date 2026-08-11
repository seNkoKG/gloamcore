import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseLuaTable } = require("../electron/pob-planner.cjs");

const WIKI_API = "https://www.poewiki.net/w/api.php";
const DEFAULT_POB_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "Path of Building Community",
  "Data",
  "ClusterJewels.lua",
);
const DEFAULT_STATS = path.resolve("public/data/price-check/stats-v1.json");
const DEFAULT_OUTPUT = path.resolve("public/data/toolkit/cluster-back-v1.json");
const PACKAGE_METADATA = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const USER_AGENT = `GloamCore/${PACKAGE_METADATA.version} (+https://github.com/seNkoKG/gloamcore; cluster-data-builder)`;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback;
}

function sha256(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

let wikiNextRequestAt = 0;

async function wikiFetch(url, attempt = 0) {
  const delay = Math.max(0, wikiNextRequestAt - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  wikiNextRequestAt = Date.now() + 250;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });
  if (response.status === 429 && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(30_000, retryAfter * 1_000)
      : Math.min(30_000, 2_000 * 2 ** attempt);
    process.stdout.write(`PoE Wiki rate limit; retrying in ${Math.round(waitMs / 1_000)}s...\n`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return wikiFetch(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`PoE Wiki returned HTTP ${response.status}.`);
  return response;
}

function cleanWikiText(value) {
  return String(value || "")
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGroups(value) {
  return [...new Set(String(value || "")
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function exactCandidate(entries, ref, kind) {
  for (const entry of entries) {
    for (const candidate of entry.candidates || []) {
      if (candidate.kind === kind && candidate.ref === ref) return candidate;
    }
  }
  return null;
}

async function cargoRowsForTags(tags) {
  const rows = [];
  const quoted = tags.map((tag) => `'${tag.replaceAll("'", "\\'")}'`).join(",");
  for (let offset = 0; ; offset += 500) {
    const parameters = new URLSearchParams({
      action: "cargoquery",
      format: "json",
      origin: "*",
      tables: "mods,mod_spawn_weights",
      join_on: "mods._pageName=mod_spawn_weights._pageName",
      fields: [
        "mods._pageName=page",
        "mods.id=id",
        "mods.name=name",
        "mods.stat_text=stat_text",
        "mods.generation_type=generation_type",
        "mods.mod_groups=mod_groups",
        "mod_spawn_weights.tag=spawn_tag",
        "mod_spawn_weights.value=spawn_weight",
      ].join(","),
      where: `mod_spawn_weights.tag IN (${quoted})`,
      limit: "500",
      offset: String(offset),
    });
    const response = await wikiFetch(`${WIKI_API}?${parameters}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`PoE Wiki Cargo failed for cluster bases: ${payload.error.info}`);
    const page = (payload.cargoquery || []).map((entry) => entry.title || {});
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}

async function cargoPassiveIcons(names) {
  const icons = new Map();
  for (let index = 0; index < names.length; index += 35) {
    const batch = names.slice(index, index + 35);
    const quoted = batch.map((name) => `'${name.replaceAll("'", "\\'")}'`).join(",");
    const parameters = new URLSearchParams({
      action: "cargoquery",
      format: "json",
      origin: "*",
      tables: "passive_skills",
      fields: "name,icon",
      where: `name IN (${quoted})`,
      limit: "500",
    });
    const response = await wikiFetch(`${WIKI_API}?${parameters}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`PoE Wiki passive icon lookup failed: ${payload.error.info}`);
    for (const entry of payload.cargoquery || []) {
      const row = entry.title || {};
      if (row.name && row.icon) icons.set(cleanWikiText(row.name), String(row.icon));
    }
  }
  return icons;
}

async function imageUrls(fileTitles) {
  const urls = new Map();
  const titles = [...new Set(fileTitles)];
  for (let index = 0; index < titles.length; index += 40) {
    const batch = titles.slice(index, index + 40);
    const parameters = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      prop: "imageinfo",
      iiprop: "url",
      titles: batch.join("|"),
    });
    const response = await wikiFetch(`${WIKI_API}?${parameters}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`PoE Wiki image lookup failed: ${payload.error.info}`);
    for (const page of Object.values(payload.query?.pages || {})) {
      const url = page.imageinfo?.[0]?.url;
      if (page.title && url) urls.set(page.title, url);
    }
  }
  return urls;
}

function iconFileName(title, url) {
  const readable = title
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 72);
  const extension = path.extname(new URL(url).pathname).toLowerCase() || ".png";
  return `${readable}-${sha256(title).slice(0, 10)}${extension}`;
}

async function bundlePassiveIcons(notables, outputPath) {
  process.stdout.write("Resolving passive notable artwork...\n");
  const titlesByName = await cargoPassiveIcons(notables.map((notable) => notable.name));
  const missingNames = notables.map((notable) => notable.name).filter((name) => !titlesByName.has(name));
  if (missingNames.length) throw new Error(`PoE Wiki has no passive icon for: ${missingNames.join(", ")}`);
  const urlsByTitle = await imageUrls(titlesByName.values());
  const missingTitles = [...new Set(titlesByName.values())].filter((title) => !urlsByTitle.has(title));
  if (missingTitles.length) throw new Error(`PoE Wiki has no image URL for: ${missingTitles.join(", ")}`);

  const iconDirectory = path.join(path.dirname(outputPath), "cluster-icons");
  fs.mkdirSync(iconDirectory, { recursive: true });
  const bundledByTitle = new Map();
  for (const title of new Set(titlesByName.values())) {
    const url = urlsByTitle.get(title);
    const fileName = iconFileName(title, url);
    const destination = path.join(iconDirectory, fileName);
    if (!fs.existsSync(destination)) {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`Passive icon download returned HTTP ${response.status} for ${title}.`);
      fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
    }
    bundledByTitle.set(title, `data/toolkit/cluster-icons/${fileName}`);
  }
  return new Map(notables.map((notable) => {
    const title = titlesByName.get(notable.name);
    return [notable.name, bundledByTitle.get(title)];
  }));
}

async function bundleClusterJewelIcons(itemNames, outputPath) {
  const parameters = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    origin: "*",
    tables: "items",
    fields: "name,inventory_icon,metadata_id,is_in_game,removal_version",
    where: `name IN (${itemNames.map((name) => `"${name}"`).join(",")}) AND is_in_game=1 AND removal_version IS NULL`,
    limit: "20",
  });
  const response = await wikiFetch(`${WIKI_API}?${parameters}`);
  const payload = await response.json();
  const iconDirectory = path.join(path.dirname(outputPath), "cluster-icons");
  fs.mkdirSync(iconDirectory, { recursive: true });
  const titlesByName = new Map((payload.cargoquery || []).map((entry) => {
    const row = entry.title || {};
    return [row.name, row["inventory icon"] || row.inventory_icon];
  }));
  const missing = itemNames.filter((name) => !titlesByName.get(name));
  if (missing.length) throw new Error(`PoE Wiki has no inventory artwork for: ${missing.join(", ")}`);
  const urls = await imageUrls(titlesByName.values());
  const bundled = new Map();
  for (const name of itemNames) {
    const title = titlesByName.get(name);
    const url = urls.get(title);
    if (!url) throw new Error(`PoE Wiki has no image URL for ${name} artwork.`);
    const fileName = iconFileName(title, url);
    const destination = path.join(iconDirectory, fileName);
    if (!fs.existsSync(destination)) {
      const artwork = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!artwork.ok) throw new Error(`${name} artwork returned HTTP ${artwork.status}.`);
      fs.writeFileSync(destination, Buffer.from(await artwork.arrayBuffer()));
    }
    bundled.set(name, `data/toolkit/cluster-icons/${fileName}`);
  }
  return bundled;
}

const pobPath = argument("--pob-data", DEFAULT_POB_DATA);
const statsPath = argument("--stats", DEFAULT_STATS);
const outputPath = argument("--output", DEFAULT_OUTPUT);
const pobSource = fs.readFileSync(pobPath, "utf8");
const statsSource = fs.readFileSync(statsPath, "utf8");
const pob = parseLuaTable(pobSource);
const stats = JSON.parse(statsSource);
if (!pob?.notableSortOrder) throw new Error("PoB ClusterJewels.lua has an unsupported shape.");

async function buildSizeData(itemType, expectedBases) {
  const jewel = pob?.jewels?.[itemType];
  if (!jewel?.skills || !Number.isFinite(jewel.minNodes) || !Number.isFinite(jewel.maxNodes)) {
    throw new Error(`PoB has no supported ${itemType} definition.`);
  }
  const size = itemType.split(" ")[0].toLowerCase();
  const bases = Object.entries(jewel.skills).map(([tag, skill]) => {
    const enchantText = (skill.enchant || []).join("\n");
    const enchant = exactCandidate(stats.entries, enchantText, "enchant");
    if (!enchant) throw new Error(`No exact official trade enchant ID for PoB ${size}-cluster base ${tag}.`);
    return {
      tag,
      name: skill.name,
      enchant: skill.enchant,
      // The suffix is the official trade API's discriminator for multi-line
      // cluster enchants. Removing it silently searches the wrong base.
      enchantTradeId: enchant.id,
    };
  });
  if (bases.length !== expectedBases) throw new Error(`Expected ${expectedBases} ${size}-cluster bases; found ${bases.length}.`);

  process.stdout.write(`Fetching ${size} cluster modifier rows...\n`);
  const cargoByBase = new Map(bases.map((base) => [base.tag, []]));
  for (const row of await cargoRowsForTags(bases.map((base) => base.tag))) {
    const rows = cargoByBase.get(row.spawn_tag);
    if (rows) rows.push(row);
  }
  const notableMap = new Map();
  for (const base of bases) {
    for (const row of cargoByBase.get(base.tag) || []) {
      const text = cleanWikiText(row.stat_text);
      const match = /^1 Added Passive Skill is (.+)$/i.exec(text);
      if (!match) continue;
      const name = cleanWikiText(match[1]);
      const sortOrder = Number(pob.notableSortOrder[name]);
      if (!Number.isFinite(sortOrder)) throw new Error(`PoB has no notableSortOrder for ${name}.`);
      let notable = notableMap.get(name);
      if (!notable) {
        const trade = exactCandidate(stats.entries, `1 Added Passive Skill is ${name}`, "explicit");
        notable = { name, sortOrder, tradeId: trade?.id || "", variants: [] };
        notableMap.set(name, notable);
      }
      const variant = {
        baseTag: base.tag,
        generationType: Number(row.generation_type),
        groups: parseGroups(row.mod_groups),
        weight: Number(row.spawn_weight),
        modId: String(row.id || row.page || ""),
      };
      const key = JSON.stringify(variant);
      if (!notable.variants.some((candidate) => JSON.stringify(candidate) === key)) notable.variants.push(variant);
    }
  }
  const notables = [...notableMap.values()]
    .map((notable) => ({
      ...notable,
      variants: notable.variants.sort((a, b) => a.baseTag.localeCompare(b.baseTag)
        || b.weight - a.weight
        || a.generationType - b.generationType),
      legacyOnly: !notable.variants.some((variant) => variant.weight > 0),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const unsearchableCurrent = notables.filter((notable) => !notable.legacyOnly && !notable.tradeId);
  if (unsearchableCurrent.length) {
    throw new Error(`No exact official trade stat ID for current ${size} notables: ${unsearchableCurrent.map((notable) => notable.name).join(", ")}`);
  }
  if (!notables.length) throw new Error(`No current notables found for ${itemType}.`);
  return {
    size,
    itemType,
    minNodes: Number(jewel.minNodes),
    maxNodes: Number(jewel.maxNodes),
    bases,
    notables,
  };
}

const largeData = await buildSizeData("Large Cluster Jewel", 17);
if (largeData.notables.length !== 107) throw new Error(`Expected 107 large-cluster notables; found ${largeData.notables.length}.`);
const iconsByName = await bundlePassiveIcons(largeData.notables, outputPath);
for (const notable of largeData.notables) notable.icon = iconsByName.get(notable.name);
const jewelIcons = await bundleClusterJewelIcons(
  [largeData.itemType],
  outputPath,
);
largeData.jewelIcon = jewelIcons.get(largeData.itemType);

const passiveCount = exactCandidate(stats.entries, "Adds # Passive Skills", "enchant");
if (!passiveCount) throw new Error("No exact official trade stat ID for cluster passive count.");

const output = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source: {
    pathOfBuilding: {
      repository: "https://github.com/PathOfBuildingCommunity/PathOfBuilding",
      file: "src/Data/ClusterJewels.lua",
      localSha256: sha256(pobSource),
    },
    poeWikiCargo: {
      endpoint: WIKI_API,
      tables: ["mods", "mod_spawn_weights", "passive_skills"],
      fetchedAt: new Date().toISOString(),
    },
    officialTradeStats: {
      file: "public/data/price-check/stats-v1.json",
      localSha256: sha256(statsSource),
    },
  },
  passiveCountTradeId: passiveCount.id.split("|")[0],
  largeJewelIcon: largeData.jewelIcon,
  bases: largeData.bases,
  notables: largeData.notables,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, "utf8");
process.stdout.write(`Wrote ${largeData.notables.length} notables across ${largeData.bases.length} large-cluster bases to ${outputPath}.\n`);
