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

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback;
}

function sha256(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
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

async function cargoRowsForTag(tag) {
  const rows = [];
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
      where: `mod_spawn_weights.tag='${tag.replaceAll("'", "\\'")}'`,
      limit: "500",
      offset: String(offset),
    });
    const response = await fetch(`${WIKI_API}?${parameters}`);
    if (!response.ok) throw new Error(`PoE Wiki Cargo returned HTTP ${response.status} for ${tag}.`);
    const payload = await response.json();
    if (payload.error) throw new Error(`PoE Wiki Cargo failed for ${tag}: ${payload.error.info}`);
    const page = (payload.cargoquery || []).map((entry) => entry.title || {});
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}

const pobPath = argument("--pob-data", DEFAULT_POB_DATA);
const statsPath = argument("--stats", DEFAULT_STATS);
const outputPath = argument("--output", DEFAULT_OUTPUT);
const pobSource = fs.readFileSync(pobPath, "utf8");
const statsSource = fs.readFileSync(statsPath, "utf8");
const pob = parseLuaTable(pobSource);
const stats = JSON.parse(statsSource);
const large = pob?.jewels?.["Large Cluster Jewel"];
if (!large?.skills || !pob?.notableSortOrder) throw new Error("PoB ClusterJewels.lua has an unsupported shape.");

const bases = Object.entries(large.skills).map(([tag, skill]) => {
  const enchantText = (skill.enchant || []).join("\n");
  const enchant = exactCandidate(stats.entries, enchantText, "enchant");
  if (!enchant) throw new Error(`No exact official trade enchant ID for PoB large-cluster base ${tag}.`);
  return {
    tag,
    name: skill.name,
    enchant: skill.enchant,
    // The suffix is the official trade API's discriminator for multi-line
    // cluster enchants. Removing it silently searches the wrong base.
    enchantTradeId: enchant.id,
  };
});
if (bases.length !== 17) throw new Error(`Expected 17 large-cluster bases; found ${bases.length}.`);

const cargoByBase = new Map();
for (const base of bases) {
  process.stdout.write(`Fetching ${base.name}...\n`);
  cargoByBase.set(base.tag, await cargoRowsForTag(base.tag));
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
      if (!trade) throw new Error(`No exact official trade stat ID for cluster notable ${name}.`);
      notable = { name, sortOrder, tradeId: trade.id, variants: [] };
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
if (notables.length !== 107) throw new Error(`Expected 107 large-cluster notables; found ${notables.length}.`);

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
      tables: ["mods", "mod_spawn_weights"],
      fetchedAt: new Date().toISOString(),
    },
    officialTradeStats: {
      file: "public/data/price-check/stats-v1.json",
      localSha256: sha256(statsSource),
    },
  },
  passiveCountTradeId: passiveCount.id.split("|")[0],
  bases,
  notables,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, "utf8");
process.stdout.write(`Wrote ${notables.length} notables across ${bases.length} bases to ${outputPath}.\n`);
