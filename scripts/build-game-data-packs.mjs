import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "public", "data", "game", "v1");
const sourceLock = JSON.parse(fs.readFileSync(path.join(projectRoot, "scripts", "game-data-sources.json"), "utf8"));

if (sourceLock.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(sourceLock.gameVersion)
  || !sourceLock.atlas || sourceLock.atlas.linkFormat?.version !== 6
  || !/^https:\/\/web\.poecdn\.com\//.test(sourceLock.atlas.linkFormat?.url || "")
  || !/^[a-f0-9]{64}$/.test(sourceLock.atlas.linkFormat?.sha256 || "")
  || !sourceLock.navigator || Object.keys(sourceLock.navigator.files || {}).length !== 13) {
  throw new Error("The game-data source lock has an unsupported schema.");
}

export const GAME_VERSION = sourceLock.gameVersion;
export const ATLAS_SOURCE = sourceLock.atlas;
export const NAVIGATOR_SOURCE = sourceLock.navigator;

const NAVIGATOR_ART = {
  kill: {
    name: "Deal with the Bandits quest icon",
    url: "https://www.poewiki.net/images/9/9a/Deal_with_the_Bandits_quest_icon.png",
    source: "https://www.poewiki.net/wiki/Deal_with_the_Bandits",
  },
  alira: {
    name: "Alira",
    url: "https://www.poewiki.net/images/0/09/Alira_monster_screenshot.jpg",
    source: "https://www.poewiki.net/wiki/Alira",
  },
  kraityn: {
    name: "Kraityn",
    url: "https://www.poewiki.net/images/6/65/Kraityn_monster_screenshot.jpg",
    source: "https://www.poewiki.net/wiki/Kraityn",
  },
  oak: {
    name: "Oak",
    url: "https://www.poewiki.net/images/d/d0/Oak_monster_screenshot.jpg",
    source: "https://www.poewiki.net/wiki/Oak",
  },
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchPinned(url, expectedSha256, maximumBytes, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "GloamCore-game-data-builder" },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Source request failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maximumBytes) {
    throw new Error(`Source size is outside the reviewed limit: ${url}`);
  }
  const actual = sha256(bytes);
  if (actual !== expectedSha256) {
    throw new Error(`Source checksum changed for ${url}. Expected ${expectedSha256}; received ${actual}.`);
  }
  return bytes;
}

function json(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON.`, { cause: error });
  }
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
  return number;
}

export function buildAtlasPack(raw, rawSha256 = ATLAS_SOURCE.sha256) {
  if (raw?.tree !== "Atlas" || !raw.nodes || !raw.groups) {
    throw new Error("The official Atlas export has an unsupported schema.");
  }
  const skillsPerOrbit = raw.constants?.skillsPerOrbit;
  const orbitRadii = raw.constants?.orbitRadii;
  if (!Array.isArray(skillsPerOrbit) || !Array.isArray(orbitRadii)) {
    throw new Error("The official Atlas export is missing orbit geometry.");
  }
  const nodes = Object.entries(raw.nodes).filter(([rawId]) => /^\d+$/.test(rawId)).map(([rawId, source]) => {
    const id = Number(rawId);
    const group = raw.groups[String(source.group)];
    const orbit = Number(source.orbit);
    const orbitIndex = Number(source.orbitIndex);
    const slots = Number(skillsPerOrbit[orbit]);
    const radius = Number(orbitRadii[orbit]);
    if (!Number.isSafeInteger(id) || !group || !Number.isSafeInteger(orbit) || !Number.isSafeInteger(orbitIndex) || !slots || !Number.isFinite(radius)) {
      throw new Error(`Atlas node ${rawId} has invalid identity or geometry.`);
    }
    const angle = orbitIndex * Math.PI * 2 / slots;
    return {
      id,
      name: String(source.name || ""),
      icon: String(source.icon || ""),
      stats: Array.isArray(source.stats) ? source.stats.map(String) : [],
      reminderText: Array.isArray(source.reminderText) ? source.reminderText.map(String) : [],
      flavourText: Array.isArray(source.flavourText) ? source.flavourText.map(String) : [],
      x: Number((finite(group.x, `Atlas group ${source.group} x`) + Math.sin(angle) * radius).toFixed(3)) || 0,
      y: Number((finite(group.y, `Atlas group ${source.group} y`) - Math.cos(angle) * radius).toFixed(3)) || 0,
      neighbors: [...new Set([...(source.out || []), ...(source.in || [])].map(Number))],
      notable: source.isNotable === true,
      keystone: source.isKeystone === true,
      mastery: source.isMastery === true,
      gateway: source.isWormhole === true,
      grantedPoints: Math.max(0, Number(source.grantedPassivePoints) || 0),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    for (const neighborId of node.neighbors) {
      const neighbor = byId.get(neighborId);
      if (!neighbor) throw new Error(`Atlas node ${node.id} references missing node ${neighborId}.`);
      if (!neighbor.neighbors.includes(node.id)) neighbor.neighbors.push(node.id);
    }
    node.neighbors.sort((left, right) => left - right);
  }
  const roots = nodes.filter((node) => !node.name && !node.stats.length && node.neighbors.length > 1);
  if (roots.length !== 1) throw new Error(`Expected one Atlas root node; found ${roots.length}.`);
  const totalPoints = Number(raw.points?.totalPoints);
  if (!Number.isSafeInteger(totalPoints) || totalPoints <= 0) throw new Error("The Atlas point budget is invalid.");
  return {
    schemaVersion: 1,
    game: "poe1",
    gameVersion: GAME_VERSION,
    source: {
      name: "Grinding Gear Games Atlas tree export",
      url: `https://github.com/grindinggear/atlastree-export/releases/tag/${GAME_VERSION}`,
      revision: ATLAS_SOURCE.revision,
      releasedAt: ATLAS_SOURCE.releasedAt,
      rawSha256,
    },
    rootId: roots[0].id,
    totalPoints,
    linkFormat: ATLAS_SOURCE.linkFormat,
    bounds: {
      minX: finite(raw.min_x, "Atlas min_x"),
      minY: finite(raw.min_y, "Atlas min_y"),
      maxX: finite(raw.max_x, "Atlas max_x"),
      maxY: finite(raw.max_y, "Atlas max_y"),
    },
    sprites: Object.fromEntries([
      "background",
      "normalActive",
      "notableActive",
      "keystoneActive",
      "wormholeActive",
      "normalInactive",
      "notableInactive",
      "keystoneInactive",
      "wormholeInactive",
      "mastery",
      "groupBackground",
      "startNode",
      "frame",
      "line",
      "atlasBackground",
    ].flatMap((kind) => {
      const scales = raw.sprites?.[kind];
      if (!scales || typeof scales !== "object") return [];
      const scale = Object.keys(scales).map(Number).filter(Number.isFinite).sort((left, right) => right - left)[0];
      const sprite = scales[String(scale)];
      if (!sprite?.filename || !sprite?.coords) return [];
      return [[kind, {
        filename: String(sprite.filename),
        width: finite(sprite.w, `${kind} sprite width`),
        height: finite(sprite.h, `${kind} sprite height`),
        coords: sprite.coords,
      }]];
    })),
    nodes: nodes.sort((left, right) => left.id - right.id),
  };
}

function leagueStartRouteLines(raw) {
  const stack = [{ enabled: true, conditions: [] }];
  const lines = [];
  for (const sourceLine of String(raw).replace(/\r\n?/g, "\n").split("\n")) {
    const directive = sourceLine.trim();
    const condition = /^#if(n?)def\s+([A-Z_]+)$/.exec(directive);
    if (condition) {
      const parent = stack.at(-1);
      const negated = condition[1] === "n";
      const name = condition[2];
      const resolved = name === "LEAGUE_START" ? !negated : true;
      stack.push({
        enabled: parent.enabled && resolved,
        conditions: name === "LEAGUE_START" ? parent.conditions : [...parent.conditions, `${negated ? "!" : ""}${name}`],
      });
      continue;
    }
    if (directive === "#endif") { if (stack.length === 1) throw new Error("Route contains an unmatched #endif."); stack.pop(); continue; }
    const current = stack.at(-1);
    if (current.enabled) lines.push({ line: sourceLine, conditions: current.conditions });
  }
  if (stack.length !== 1) throw new Error("Route contains an unclosed conditional.");
  return lines;
}

function routeLabel(raw, areas, quests) {
  const source = raw.trim().replace(/^#sub\s*/, "");
  return source.replace(/\{([^{}]+)\}/g, (_match, body) => {
    const [kind, ...values] = body.split("|");
    if (kind === "enter") return areas[values[0]]?.name || values[0] || "Area";
    if (kind === "waypoint") return `Waypoint: ${areas[values[0]]?.name || values[0] || "Area"}`;
    if (kind === "waypoint_get") return "Activate waypoint";
    if (kind === "quest") return quests[values[0]]?.name || values[0] || "Quest";
    if (kind === "trial") return "Labyrinth trial";
    if (kind === "logout") return "Log out to character selection";
    return values.at(-1) || kind.replaceAll("_", " ");
  }).replace(/\s+#.*$/, "").replace(/\s+/g, " ").trim();
}

function routeKind(raw) {
  if (/\{trial\}/.test(raw)) return "trial";
  if (/\{quest\|/.test(raw) || /^Hand in\b/.test(raw.trim())) return "quest";
  if (/\{waypoint/.test(raw)) return "waypoint";
  if (/\bkill\b|\{arena\|/i.test(raw)) return "boss";
  if (/\{enter\||^\s*➞/.test(raw)) return "travel";
  if (/^\s*#sub\b/.test(raw)) return "note";
  return "action";
}

function acquisitionsFor(quests, gems) {
  const result = new Map(Object.entries(gems).map(([id, gem]) => [id, {
    id,
    name: String(gem.name || id),
    attribute: String(gem.primary_attribute || ""),
    requiredLevel: Math.max(1, Number(gem.required_level) || 1),
    support: gem.is_support === true,
    acquisitions: [],
  }]));
  for (const [questId, quest] of Object.entries(quests)) {
    for (const [offerId, offer] of Object.entries(quest.reward_offers || {})) {
      for (const kind of ["quest", "vendor"]) {
        for (const [gemId, source] of Object.entries(offer[kind] || {})) {
          const gem = result.get(gemId);
          if (!gem) continue;
          gem.acquisitions.push({
            kind,
            act: Number(quest.act),
            questId,
            quest: String(quest.name || questId),
            offerId,
            npc: String(source.npc || offer.quest_npc || ""),
            classes: Array.isArray(source.classes) ? source.classes.map(String).sort() : [],
          });
        }
      }
    }
  }
  for (const gem of result.values()) {
    const seen = new Set();
    gem.acquisitions = gem.acquisitions.filter((entry) => {
      const key = JSON.stringify(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((left, right) => left.act - right.act || left.quest.localeCompare(right.quest) || left.kind.localeCompare(right.kind));
  }
  return [...result.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function buildNavigatorPack({ areas, gems, quests, routes }) {
  if (!areas || !gems || !quests || !Array.isArray(routes) || routes.length !== 10) {
    throw new Error("The Exile Leveling source set is incomplete.");
  }
  const acts = routes.map((raw, index) => {
    const act = index + 1;
    const steps = leagueStartRouteLines(raw).flatMap(({ line, conditions }, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#section")) return [];
      const label = routeLabel(line, areas, quests);
      if (!label) return [];
      const areaIds = [...line.matchAll(/\{(?:enter|waypoint)\|([^|}]+)/g)].map((match) => match[1]);
      const questIds = [...line.matchAll(/\{quest\|([^|}]+)/g)].map((match) => match[1]);
      return [{ id: `a${act}-${lineIndex + 1}`, act, label, kind: routeKind(line), areaIds, questIds, conditions }];
    });
    if (!steps.length) throw new Error(`Act ${act} produced no route steps.`);
    return { act, steps };
  });
  return {
    schemaVersion: 1,
    game: "poe1",
    gameVersion: GAME_VERSION,
    source: {
      name: "Exile Leveling",
      url: `https://github.com/HeartofPhos/exile-leveling/commit/${NAVIGATOR_SOURCE.revision}`,
      revision: NAVIGATOR_SOURCE.revision,
      releasedAt: NAVIGATOR_SOURCE.releasedAt,
      compatibilityEvidence: NAVIGATOR_SOURCE.compatibilityEvidence,
      license: "MIT",
    },
    art: {
      questIcon: {
        name: "Deal with the Bandits quest icon",
        url: "https://www.poewiki.net/images/9/9a/Deal_with_the_Bandits_quest_icon.png",
        source: "https://www.poewiki.net/wiki/Deal_with_the_Bandits",
      },
      bandits: NAVIGATOR_ART,
    },
    classes: ["Scion", "Marauder", "Ranger", "Witch", "Duelist", "Templar", "Shadow"],
    acts,
    areas: Object.values(areas).map((area) => ({
      id: String(area.id || ""),
      name: String(area.name || ""),
      act: Number(area.act) || 0,
      level: Number(area.level) || 0,
      waypoint: area.has_waypoint === true,
      town: area.is_town_area === true,
      recipes: Array.isArray(area.crafting_recipes) ? area.crafting_recipes.map(String) : [],
    })).filter((area) => area.id && area.name).sort((left, right) => left.act - right.act || left.level - right.level || left.name.localeCompare(right.name)),
    gems: acquisitionsFor(quests, gems),
  };
}

function serialized(value) {
  return `${JSON.stringify(value)}\n`;
}

function writeIfChanged(filePath, content) {
  let current = null;
  try { current = fs.readFileSync(filePath, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (current === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

export async function buildGameDataPacks({ fetchImpl = fetch, target = outputRoot } = {}) {
  const atlasBytes = await fetchPinned(ATLAS_SOURCE.url, ATLAS_SOURCE.sha256, 2 * 1024 * 1024, fetchImpl);
  const sourceBytes = {};
  for (const [file, expected] of Object.entries(NAVIGATOR_SOURCE.files)) {
    sourceBytes[file] = await fetchPinned(`${NAVIGATOR_SOURCE.root}/${file}`, expected, 512 * 1024, fetchImpl);
  }
  const atlasText = serialized(buildAtlasPack(json(atlasBytes, "Atlas export")));
  const navigatorText = serialized(buildNavigatorPack({
    areas: json(sourceBytes["json/areas.json"], "areas.json"),
    gems: json(sourceBytes["json/gems.json"], "gems.json"),
    quests: json(sourceBytes["json/quests.json"], "quests.json"),
    routes: Array.from({ length: 10 }, (_, index) => new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes[`routes/act-${index + 1}.txt`])),
  }));
  const packs = {
    atlas: { file: `atlas-${GAME_VERSION}.json`, text: atlasText, sourceRevision: ATLAS_SOURCE.revision },
    navigator: { file: `navigator-${GAME_VERSION}.json`, text: navigatorText, sourceRevision: NAVIGATOR_SOURCE.revision },
  };
  const manifest = {
    schemaVersion: 1,
    game: "poe1",
    gameVersion: GAME_VERSION,
    generatedAt: NAVIGATOR_SOURCE.releasedAt,
    packs: Object.fromEntries(Object.entries(packs).map(([id, pack]) => [id, {
      file: pack.file,
      bytes: Buffer.byteLength(pack.text),
      sha256: sha256(Buffer.from(pack.text)),
      sourceRevision: pack.sourceRevision,
    }])),
  };
  const changes = [];
  for (const [id, pack] of Object.entries(packs)) if (writeIfChanged(path.join(target, pack.file), pack.text)) changes.push(id);
  if (writeIfChanged(path.join(target, "manifest.json"), serialized(manifest))) changes.push("manifest");
  const expectedFiles = new Set(["manifest.json", ...Object.values(packs).map((pack) => pack.file)]);
  for (const file of fs.readdirSync(target)) {
    if (/^(atlas|navigator)-\d+\.\d+\.\d+\.json$/.test(file) && !expectedFiles.has(file)) {
      fs.unlinkSync(path.join(target, file));
      changes.push(`removed:${file}`);
    }
  }
  return { changes, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildGameDataPacks().then(({ changes, manifest }) => {
    console.log(`Built PoE ${manifest.gameVersion} game-data packs: ${changes.length ? changes.join(", ") : "already current"}.`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
