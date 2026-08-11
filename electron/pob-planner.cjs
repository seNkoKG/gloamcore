const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const MAX_TREE_BYTES = 32 * 1024 * 1024;
const MAX_BUILD_BYTES = 24 * 1024 * 1024;
const MAX_TREE_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TREE_ASSET_FILES = 256;

class LuaTableReader {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  error(message) {
    throw new Error(`${message} at Lua offset ${this.index}.`);
  }

  skip() {
    while (this.index < this.source.length) {
      if (/\s/.test(this.source[this.index])) {
        this.index += 1;
        continue;
      }
      if (this.source.startsWith("--[[", this.index)) {
        const end = this.source.indexOf("]]", this.index + 4);
        this.index = end < 0 ? this.source.length : end + 2;
        continue;
      }
      if (this.source.startsWith("--", this.index)) {
        const end = this.source.indexOf("\n", this.index + 2);
        this.index = end < 0 ? this.source.length : end + 1;
        continue;
      }
      break;
    }
  }

  consume(value) {
    this.skip();
    if (!this.source.startsWith(value, this.index)) return false;
    this.index += value.length;
    return true;
  }

  string() {
    const quote = this.source[this.index++];
    let result = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index++];
      if (character === quote) return result;
      if (character !== "\\") {
        result += character;
        continue;
      }
      const escaped = this.source[this.index++];
      if (escaped === "n") result += "\n";
      else if (escaped === "r") result += "\r";
      else if (escaped === "t") result += "\t";
      else if (escaped === "z") this.skip();
      else result += escaped;
    }
    this.error("Unterminated Lua string");
  }

  number() {
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.index),
    );
    if (!match) this.error("Invalid Lua number");
    this.index += match[0].length;
    return Number(match[0]);
  }

  identifier() {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.index));
    if (!match) this.error("Expected Lua identifier");
    this.index += match[0].length;
    return match[0];
  }

  value() {
    this.skip();
    const character = this.source[this.index];
    if (character === '"' || character === "'") return this.string();
    if (character === "{") return this.table();
    if (character === "-" || character === "+" || /\d/.test(character || "")) {
      return this.number();
    }
    const identifier = this.identifier();
    if (identifier === "true") return true;
    if (identifier === "false") return false;
    if (identifier === "nil") return null;
    this.error(`Unsupported Lua value ${identifier}`);
  }

  table() {
    if (!this.consume("{")) this.error("Expected Lua table");
    const values = new Map();
    let nextIndex = 1;
    while (true) {
      this.skip();
      if (this.consume("}")) break;
      let key;
      const entryStart = this.index;
      if (this.consume("[")) {
        key = this.value();
        if (!this.consume("]") || !this.consume("=")) this.error("Invalid keyed Lua field");
      } else {
        const identifierMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.index));
        if (identifierMatch) {
          this.index += identifierMatch[0].length;
          this.skip();
          if (this.consume("=")) key = identifierMatch[0];
          else this.index = entryStart;
        }
      }
      if (key == null) key = nextIndex;
      const value = this.value();
      values.set(key, value);
      if (typeof key === "number" && key >= nextIndex) nextIndex = key + 1;
      this.skip();
      this.consume(",");
      this.consume(";");
    }
    const numeric = [...values.keys()].every((key) => Number.isInteger(key) && key >= 1);
    if (numeric) {
      const maximum = Math.max(0, ...values.keys());
      if (maximum === values.size) {
        return Array.from({ length: maximum }, (_, index) => values.get(index + 1));
      }
    }
    return Object.fromEntries([...values].map(([key, value]) => [String(key), value]));
  }

  read() {
    this.skip();
    if (this.source.startsWith("return", this.index)) this.index += 6;
    const value = this.value();
    this.skip();
    return value;
  }
}

function parseLuaTable(source) {
  return new LuaTableReader(source).read();
}

function versionParts(value) {
  return value.split("_").map((part) => Number(part) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function normalizeTreeVersion(value) {
  const normalized = String(value || "").trim().replace(/\./g, "_").toLowerCase();
  if (!normalized) return "";
  if (!/^\d+(?:_\d+)+(?:_(?:ruthless|alternate)){0,2}$/.test(normalized)) {
    throw new Error("The requested Path of Building tree version is invalid.");
  }
  return normalized;
}

function requestedTreeVersion(options) {
  const value = normalizeTreeVersion(options.treeVersion || options.version);
  const ruthless = Boolean(options.ruthless || /(?:^|_)ruthless(?:_|$)/.test(value));
  const alternate = Boolean(options.alternate || /(?:^|_)alternate(?:_|$)/.test(value));
  const suffix = `${ruthless ? "_ruthless" : ""}${alternate ? "_alternate" : ""}`;
  const base = value.replace(/_(?:ruthless|alternate)(?:_(?:ruthless|alternate))*$/, "");
  return { requested: base ? `${base}${suffix}` : "", suffix };
}

function findTreeFile(options = {}) {
  const game = options.game === "poe2" ? "poe2" : "poe1";
  const { requested, suffix } = requestedTreeVersion(options);
  const appData = process.env.APPDATA || "";
  const roots = options.pobRoot ? [options.pobRoot] : game === "poe2"
    ? [
        path.join(appData, "Path of Building Community (PoE2)"),
        path.join(appData, "Path of Building 2 Community"),
        path.join(appData, "Path of Building 2"),
      ]
    : [path.join(appData, "Path of Building Community")];
  for (const root of roots) {
    for (const treeRoot of [path.join(root, "TreeData"), path.join(root, "src", "TreeData")]) {
      let entries;
      try {
        entries = fs.readdirSync(treeRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      const available = new Set(entries
        .filter((entry) => entry.isDirectory() && /^\d+(?:_\d+)+(?:_(?:ruthless|alternate)){0,2}$/.test(entry.name))
        .map((entry) => entry.name.toLowerCase()));
      const versions = requested
        ? (available.has(requested) ? [requested] : [])
        : entries
          .filter((entry) => entry.isDirectory() && /^\d+(?:_\d+)+$/.test(entry.name))
          .map((entry) => `${entry.name}${suffix}`)
          .filter((version) => available.has(version.toLowerCase()))
          .sort(compareVersions)
          .reverse();
      for (const version of versions) {
        const filePath = path.join(treeRoot, version, "tree.lua");
        if (fs.existsSync(filePath)) return { filePath, version, root, game };
      }
    }
  }
  if (requested) {
    throw new Error(`Path of Building tree ${requested.replace(/_/g, ".")} was not found. Update PoB Community before importing this build; GloamCore will not display its hashes on a different tree.`);
  }
  throw new Error(game === "poe2"
    ? "Path of Building Community (PoE2) tree data was not found. Install or update PoB2 Community first. GloamCore will never substitute the PoE1 tree."
    : "Path of Building Community tree data was not found. Install or update PoB Community first.");
}

function orbitAngles(nodesInOrbit) {
  if (nodesInOrbit === 16) return [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
  if (nodesInOrbit === 40) return [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350];
  return Array.from({ length: nodesInOrbit }, (_, index) => (360 * index) / nodesInOrbit);
}

function numericEntries(value) {
  if (Array.isArray(value)) return value.map((entry, index) => [index + 1, entry]);
  return Object.entries(value || {}).map(([key, entry]) => [Number(key), entry]);
}

function expansionJewelData(value) {
  if (!value || typeof value !== "object") return null;
  const size = Number(value.size);
  const index = Number(value.index);
  const proxy = Number(value.proxy);
  if (![size, index, proxy].every(Number.isFinite)) return null;
  const parent = Number(value.parent);
  return {
    size,
    index,
    proxy,
    ...(Number.isFinite(parent) ? { parent } : {}),
  };
}

function assetMimeType(fileName) {
  if (/\.jpe?g$/i.test(fileName)) return "image/jpeg";
  if (/\.webp$/i.test(fileName)) return "image/webp";
  return "image/png";
}

function createTreeVisuals(rawSprites, assetRoot) {
  const spriteSets = rawSprites?.sprites || {};
  const sheets = new Map();

  function registerSheet(setName) {
    const set = spriteSets[setName];
    if (!set?.filename) return null;
    const remote = String(set.filename);
    const fileName = path.basename(remote.split(/[?#]/)[0].replace(/\\/g, "/"));
    if (!fileName) return null;
    if (!sheets.has(fileName)) {
      const filePath = path.resolve(assetRoot, fileName);
      let src = remote;
      try {
        if (path.dirname(filePath) !== path.resolve(assetRoot)) throw new Error("Invalid passive-tree asset path.");
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_TREE_ASSET_BYTES) throw new Error("Passive-tree asset is invalid or too large.");
        src = `data:${assetMimeType(fileName)};base64,${fs.readFileSync(filePath).toString("base64")}`;
      } catch {
        // PoB's authoritative CDN URL remains a safe fallback if a local image is missing.
      }
      sheets.set(fileName, {
        src,
        width: Number(set.w) || 0,
        height: Number(set.h) || 0,
      });
    }
    return fileName;
  }

  function rect(setName, name) {
    if (!name) return null;
    const set = spriteSets[setName];
    const value = set?.coords?.[name];
    const sheet = value && registerSheet(setName);
    if (!sheet) return null;
    return {
      sheet,
      x: Number(value.x) || 0,
      y: Number(value.y) || 0,
      w: Number(value.w) || 0,
      h: Number(value.h) || 0,
    };
  }

  function rectMap(setName) {
    const result = {};
    for (const name of Object.keys(spriteSets[setName]?.coords || {})) {
      const value = rect(setName, name);
      if (value) result[name] = value;
    }
    return result;
  }

  function nodeSprites(node) {
    if (node.isMastery) {
      return {
        active: rect("masteryActiveSelected", node.activeIcon) || rect("mastery", node.icon),
        inactive: rect("masteryInactive", node.inactiveIcon) || rect("mastery", node.icon),
      };
    }
    const type = node.isKeystone ? "keystone" : node.isNotable ? "notable" : "normal";
    return {
      active: rect(`${type}Active`, node.icon),
      inactive: rect(`${type}Inactive`, node.icon),
    };
  }

  function commonAssets() {
    const ascendancies = { ...rectMap("ascendancy") };
    for (const setName of Object.keys(spriteSets).filter((name) => /Bloodline$/i.test(name))) {
      Object.assign(ascendancies, rectMap(setName));
    }
    const frames = rectMap("frame");
    const jewels = rectMap("jewel");
    const jewelRadii = rectMap("jewelRadius");
    const startNodes = rectMap("startNode");
    const groupBackgrounds = rectMap("groupBackground");
    const backgrounds = rectMap("background");
    return {
      sheets: Object.fromEntries(sheets),
      backgrounds,
      frames,
      jewels,
      jewelRadii,
      startNodes,
      groupBackgrounds,
      ascendancies,
    };
  }

  return { commonAssets, nodeSprites };
}

function sanitizeTree(
  raw,
  version,
  sourcePath,
  game = "poe1",
  rawSprites = null,
  rawClusterJewels = null,
  rawTattooPassives = null,
) {
  const skillsPerOrbit = raw.constants?.skillsPerOrbit || [1, 6, 16, 16, 40, 72, 72];
  const orbitRadii = raw.constants?.orbitRadii || [0, 82, 162, 335, 493, 662, 846];
  const exactAngles = raw.constants?.orbitAnglesByOrbit;
  const angles = skillsPerOrbit.map(orbitAngles);
  const classes = (raw.classes || []).map((entry, index) => ({
    id: Number.isFinite(Number(entry.integerId)) ? Number(entry.integerId) : index,
    name: String(entry.name || `Class ${index}`),
    ascendancies: (entry.ascendancies || []).map((ascendancy, ascendancyIndex) => ({
      id: ascendancyIndex + 1,
      internalId: String(ascendancy.internalId || ascendancy.id || ""),
      name: String(ascendancy.name || ascendancy.id || `Ascendancy ${ascendancyIndex + 1}`),
    })),
  }));
  const classIdByName = new Map(classes.map((entry) => [entry.name.toLowerCase(), entry.id]));
  const retiredWildwoodAscendancies = new Set(["Warden", "Warlock", "Primalist"]);
  const alternateAscendancies = (raw.alternate_ascendancies || []).map((entry, index) => ({
    id: index + 1,
    internalId: String(entry.id || entry.internalId || ""),
    name: String(entry.name || entry.id || `Alternate ascendancy ${index + 1}`),
  })).filter((entry) => !retiredWildwoodAscendancies.has(entry.internalId));
  const groupRecords = Object.fromEntries(numericEntries(raw.groups).map(([id, group]) => [String(id), {
    id,
    x: Number(group.x) || 0,
    y: Number(group.y) || 0,
    orbits: Array.isArray(group.orbits) ? group.orbits.map(Number).filter(Number.isFinite) : [],
    background: group.background?.image ? {
      image: String(group.background.image),
      isHalfImage: Boolean(group.background.isHalfImage),
    } : null,
    isProxy: Boolean(group.isProxy),
    ascendancyName: null,
    isAscendancyStart: false,
  }]));
  const visualBuilder = rawSprites ? createTreeVisuals(rawSprites, path.dirname(sourcePath)) : null;
  const nodes = Object.entries(raw.nodes || {}).flatMap(([key, node]) => {
    if (key === "root" || !node || node.group == null) return [];
    if (node.isBloodline && retiredWildwoodAscendancies.has(String(node.ascendancyName || ""))) return [];
    const group = groupRecords[String(node.group)];
    // PoB keeps cluster-jewel templates in proxy groups and instantiates them only
    // when a matching jewel is socketed. Rendering those templates directly was
    // the source of the detached rings and stray dots in imported characters.
    if (!group || group.isProxy || node.isProxy) return [];
    const orbit = Number(node.orbit) || 0;
    const orbitIndex = Number(node.orbitIndex) || 0;
    const exactRadians = Number(exactAngles?.[orbit]?.[orbitIndex]);
    const radians = Number.isFinite(exactRadians)
      ? exactRadians
      : ((angles[orbit]?.[orbitIndex] || 0) * Math.PI) / 180;
    const radius = Number(orbitRadii[orbit]) || 0;
    const id = Number(node.skill ?? key);
    if (!Number.isFinite(id)) return [];
    const legacyStart = node.classStartIndex == null ? [] : [Number(node.classStartIndex)];
    const namedStarts = Array.isArray(node.classesStart)
      ? node.classesStart.map((name) => classIdByName.get(String(name).toLowerCase())).filter(Number.isFinite)
      : [];
    const classStartIds = [...new Set([...legacyStart, ...namedStarts])];
    const connections = Array.isArray(node.connections) ? node.connections.map((entry) => Number(entry?.id)).filter(Number.isFinite) : [];
    const masteryEffects = (Array.isArray(node.masteryEffects) ? node.masteryEffects : []).flatMap((effect) => {
      const effectId = Number(effect?.effect);
      return Number.isFinite(effectId) ? [{
        id: effectId,
        stats: (Array.isArray(effect.stats) ? effect.stats : []).map(String),
        reminderText: (Array.isArray(effect.reminderText) ? effect.reminderText : []).map(String),
      }] : [];
    });
    const sprites = visualBuilder?.nodeSprites(node) || { active: null, inactive: null };
    if (node.ascendancyName) group.ascendancyName = String(node.ascendancyName);
    if (node.isAscendancyStart) group.isAscendancyStart = true;
    return [{
      id,
      name: String(node.name || "Passive Skill"),
      stats: Array.isArray(node.stats) ? node.stats.map(String) : [],
      x: group.x + Math.sin(radians) * radius,
      y: group.y - Math.cos(radians) * radius,
      groupId: group.id,
      orbit,
      orbitIndex,
      out: Array.isArray(node.out) ? node.out.map(Number).filter(Number.isFinite) : connections,
      in: Array.isArray(node.in) ? node.in.map(Number).filter(Number.isFinite) : [],
      classStartIndex: classStartIds[0] ?? null,
      classStartIds,
      ascendancyName: node.ascendancyName ? String(node.ascendancyName) : null,
      notable: Boolean(node.isNotable),
      keystone: Boolean(node.isKeystone),
      mastery: Boolean(node.isMastery),
      jewelSocket: Boolean(node.isJewelSocket),
      multipleChoice: Boolean(node.isMultipleChoice || node.isMultipleChoiceOption),
      multipleChoiceOption: Boolean(node.isMultipleChoiceOption),
      bloodline: Boolean(node.isBloodline),
      isBlighted: Boolean(node.isBlighted),
      recipe: (Array.isArray(node.recipe) ? node.recipe : []).map(String),
      reminderText: (Array.isArray(node.reminderText) ? node.reminderText : []).map(String),
      flavourText: (Array.isArray(node.flavourText) ? node.flavourText : []).map(String),
      grantedPassivePoints: Number(node.grantedPassivePoints) || 0,
      masteryEffects: Object.fromEntries(masteryEffects.map((effect) => [effect.id, {
        stats: effect.stats,
        reminderText: effect.reminderText,
      }])),
      ...(masteryEffects.length ? { masteryEffectOrder: masteryEffects.map((effect) => effect.id) } : {}),
      isAscendancyStart: Boolean(node.isAscendancyStart),
      expansionJewel: expansionJewelData(node.expansionJewel),
      spriteActive: sprites.active,
      spriteInactive: sprites.inactive,
    }];
  });
  const retainedGroups = new Set(nodes.map((node) => node.groupId));
  const groups = Object.values(groupRecords).filter((group) => retainedGroups.has(group.id)).map((group) => ({
    id: group.id,
    x: group.x,
    y: group.y,
    orbits: group.orbits,
    background: group.background,
    ascendancyName: group.ascendancyName,
    isAscendancyStart: group.isAscendancyStart,
  }));
  const bounds = {
    minX: Number(raw.min_x) || -15000,
    minY: Number(raw.min_y) || -11000,
    maxX: Number(raw.max_x) || 13000,
    maxY: Number(raw.max_y) || 11000,
  };

  const cluster = rawClusterJewels && game === "poe1" ? (() => {
    const wantedDefinitions = new Set([
      ...Object.keys(rawClusterJewels.notableSortOrder || {}),
      ...(Array.isArray(rawClusterJewels.keystones) ? rawClusterJewels.keystones.map(String) : []),
    ]);
    const definitions = {};
    const proxies = {};
    const socketTemplates = [];
    for (const [key, node] of Object.entries(raw.nodes || {})) {
      if (!node || key === "root") continue;
      const id = Number(node.skill ?? key);
      if (!Number.isFinite(id)) continue;
      const group = groupRecords[String(node.group)];
      if (node.isProxy && group) {
        proxies[id] = {
          id,
          groupId: group.id,
          x: group.x,
          y: group.y,
          orbit: Number(node.orbit) || 0,
          orbitIndex: Number(node.orbitIndex) || 0,
        };
      }
      const expansionJewel = expansionJewelData(node.expansionJewel);
      if (expansionJewel && group?.isProxy) {
        const sprites = visualBuilder?.nodeSprites(node) || { active: null, inactive: null };
        socketTemplates.push({
          id,
          name: String(node.name || "Jewel Socket"),
          groupId: group.id,
          expansionJewel,
          spriteActive: sprites.active,
          spriteInactive: sprites.inactive,
        });
      }
      const name = String(node.name || node.dn || "");
      if (node.group == null && wantedDefinitions.has(name) && !definitions[name]) {
        const sprites = visualBuilder?.nodeSprites(node) || { active: null, inactive: null };
        definitions[name] = {
          name,
          stats: (Array.isArray(node.stats) ? node.stats : Array.isArray(node.sd) ? node.sd : []).map(String),
          notable: Boolean(node.isNotable || node.not),
          keystone: Boolean(node.isKeystone || node.ks),
          reminderText: (Array.isArray(node.reminderText) ? node.reminderText : []).map(String),
          flavourText: (Array.isArray(node.flavourText) ? node.flavourText : []).map(String),
          spriteActive: sprites.active,
          spriteInactive: sprites.inactive,
        };
      }
    }

    const jewels = {};
    for (const [baseType, jewel] of Object.entries(rawClusterJewels.jewels || {})) {
      if (!jewel || typeof jewel !== "object") continue;
      const skills = {};
      for (const [id, skill] of Object.entries(jewel.skills || {})) {
        if (!skill || typeof skill !== "object") continue;
        const sprites = visualBuilder?.nodeSprites({ icon: skill.icon }) || { active: null, inactive: null };
        const masterySprites = skill.masteryIcon
          ? visualBuilder?.nodeSprites({ isMastery: true, icon: skill.masteryIcon }) || { active: null, inactive: null }
          : { active: null, inactive: null };
        skills[id] = {
          id,
          name: String(skill.name || "Cluster Passive"),
          stats: (Array.isArray(skill.stats) ? skill.stats : []).map(String),
          enchant: (Array.isArray(skill.enchant) ? skill.enchant : []).map(String),
          mastery: Boolean(skill.masteryIcon),
          reminderText: (Array.isArray(skill.reminderText) ? skill.reminderText : []).map(String),
          flavourText: (Array.isArray(skill.flavourText) ? skill.flavourText : []).map(String),
          spriteActive: sprites.active,
          spriteInactive: sprites.inactive,
          masterySpriteActive: masterySprites.active,
          masterySpriteInactive: masterySprites.inactive,
        };
      }
      jewels[baseType] = {
        baseType,
        size: String(jewel.size || ""),
        sizeIndex: Number(jewel.sizeIndex) || 0,
        minNodes: Number(jewel.minNodes) || 0,
        maxNodes: Number(jewel.maxNodes) || 0,
        smallIndices: (Array.isArray(jewel.smallIndicies) ? jewel.smallIndicies : []).map(Number),
        notableIndices: (Array.isArray(jewel.notableIndicies) ? jewel.notableIndicies : []).map(Number),
        socketIndices: (Array.isArray(jewel.socketIndicies) ? jewel.socketIndicies : []).map(Number),
        totalIndices: Number(jewel.totalIndicies) || 0,
        skills,
      };
    }

    const tattoos = {};
    for (const [key, tattoo] of Object.entries(rawTattooPassives?.nodes || {})) {
      if (!tattoo || typeof tattoo !== "object") continue;
      const name = String(tattoo.dn || key || "");
      if (!name) continue;
      const notable = Boolean(tattoo.not || tattoo.isNotable);
      const keystone = Boolean(tattoo.ks || tattoo.isKeystone);
      const mastery = Boolean(tattoo.m || tattoo.isMastery);
      const sprites = visualBuilder?.nodeSprites({
        icon: tattoo.icon,
        isNotable: notable,
        isKeystone: keystone,
        isMastery: mastery,
      }) || { active: null, inactive: null };
      tattoos[name] = {
        name,
        stats: (Array.isArray(tattoo.sd) ? tattoo.sd : Array.isArray(tattoo.stats) ? tattoo.stats : []).map(String),
        notable,
        keystone,
        mastery,
        reminderText: (Array.isArray(tattoo.reminderText) ? tattoo.reminderText : []).map(String),
        flavourText: (Array.isArray(tattoo.flavourText) ? tattoo.flavourText : []).map(String),
        spriteActive: sprites.active,
        spriteInactive: sprites.inactive,
      };
    }

    return {
      skillsPerOrbit: skillsPerOrbit.map(Number),
      orbitRadii: orbitRadii.map(Number),
      orbitAngles: skillsPerOrbit.map((count) => orbitAngles(Number(count) || 1)),
      jewels,
      notableSortOrder: Object.fromEntries(Object.entries(rawClusterJewels.notableSortOrder || {}).map(([name, order]) => [name, Number(order)])),
      keystones: Array.isArray(rawClusterJewels.keystones) ? rawClusterJewels.keystones.map(String) : [],
      orbitOffsets: Object.fromEntries(Object.entries(rawClusterJewels.orbitOffsets || {}).map(([proxy, offsets]) => [proxy, Object.fromEntries(Object.entries(offsets || {}).map(([size, offset]) => [size, Number(offset)]))])),
      definitions,
      proxies,
      socketTemplates,
      tattoos,
    };
  })() : undefined;
  return {
    game,
    version,
    sourcePath,
    bounds,
    // This is the same world-size definition used by PoB's PassiveTree class.
    size: Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 1.1,
    classes,
    alternateAscendancies,
    points: {
      total: Number(raw.points?.totalPoints) || 123,
      ascendancy: Number(raw.points?.ascendancyPoints) || 8,
    },
    groups,
    assets: visualBuilder?.commonAssets(),
    cluster,
    nodes,
  };
}

function passiveTreeDescriptor(options = {}) {
  const located = findTreeFile(options);
  const stat = fs.statSync(located.filePath);
  if (!stat.isFile() || stat.size > MAX_TREE_BYTES) throw new Error("PoB passive tree data is invalid or too large.");
  const spritesPath = path.join(path.dirname(located.filePath), "sprites.lua");
  const clusterPath = path.join(located.root, "Data", "ClusterJewels.lua");
  const tattooPath = path.join(located.root, "Data", "TattooPassives.lua");
  let spritesStat = null;
  try {
    spritesStat = fs.statSync(spritesPath);
  } catch {
    // Old PoB trees can legitimately lack generated sprite metadata.
  }
  const optionalStat = (filePath) => {
    try {
      const value = fs.statSync(filePath);
      return value.isFile() && value.size <= MAX_TREE_BYTES ? value : null;
    } catch {
      return null;
    }
  };
  const clusterStat = optionalStat(clusterPath);
  const tattooStat = optionalStat(tattooPath);
  const identity = (filePath, value) => ({
    path: path.resolve(filePath),
    mtimeMs: Number(value?.mtimeMs || 0),
    size: Number(value?.size || 0),
  });
  const assetRoot = path.dirname(located.filePath);
  const assetFiles = fs.readdirSync(assetRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (assetFiles.length > MAX_TREE_ASSET_FILES) {
    throw new Error("PoB passive-tree data contains too many sprite assets.");
  }
  const assetIdentities = assetFiles.map((entry) => {
    const filePath = path.join(assetRoot, entry.name);
    return identity(filePath, fs.statSync(filePath));
  });
  const files = [
    identity(located.filePath, stat),
    identity(spritesPath, spritesStat),
    identity(clusterPath, clusterStat),
    identity(tattooPath, tattooStat),
    ...assetIdentities,
  ];
  return {
    cacheKey: JSON.stringify({ game: located.game, version: located.version, files }),
    game: located.game,
    version: located.version,
    sourcePath: located.filePath,
    located,
    stat,
    spritesPath,
    spritesStat,
    clusterPath,
    clusterStat,
    tattooPath,
    tattooStat,
  };
}

function describePassiveTree(options = {}) {
  const descriptor = passiveTreeDescriptor(options);
  return {
    cacheKey: descriptor.cacheKey,
    game: descriptor.game,
    version: descriptor.version,
    sourcePath: descriptor.sourcePath,
  };
}

const cachedTrees = new Map();
function loadPassiveTreeSnapshot(options = {}) {
  const descriptor = passiveTreeDescriptor(options);
  if (cachedTrees.has(descriptor.cacheKey)) {
    return {
      cacheKey: descriptor.cacheKey,
      game: descriptor.game,
      version: descriptor.version,
      sourcePath: descriptor.sourcePath,
      data: cachedTrees.get(descriptor.cacheKey),
    };
  }
  const {
    located,
    spritesPath,
    spritesStat,
    clusterPath,
    clusterStat,
    tattooPath,
    tattooStat,
  } = descriptor;
  const raw = parseLuaTable(fs.readFileSync(located.filePath, "utf8"));
  const rawSprites = spritesStat?.isFile() && spritesStat.size <= MAX_TREE_BYTES
    ? parseLuaTable(fs.readFileSync(spritesPath, "utf8"))
    : null;
  const rawClusterJewels = clusterStat ? parseLuaTable(fs.readFileSync(clusterPath, "utf8")) : null;
  const rawTattooPassives = tattooStat ? parseLuaTable(fs.readFileSync(tattooPath, "utf8")) : null;
  const data = sanitizeTree(raw, located.version, located.filePath, located.game, rawSprites, rawClusterJewels, rawTattooPassives);
  const current = describePassiveTree(options);
  if (current.cacheKey !== descriptor.cacheKey) {
    const error = new Error("Path of Building passive-tree files changed while they were loading. Retry after its update finishes.");
    error.code = "POB_TREE_CHANGED";
    throw error;
  }
  cachedTrees.clear();
  cachedTrees.set(descriptor.cacheKey, data);
  return { ...current, data };
}

function loadPassiveTree(options = {}) {
  return loadPassiveTreeSnapshot(options).data;
}

function decodePobBuild(input) {
  const text = String(input || "").replace(/\0/g, "").trim();
  if (!text) throw new Error("Paste a Path of Building code or XML build first.");
  if (Buffer.byteLength(text, "utf8") > MAX_BUILD_BYTES) throw new Error("The build input is too large.");
  if (/^<\?xml\b|^<PathOfBuilding\b/i.test(text)) return text;
  if (/^https?:\/\//i.test(text)) throw new Error("Download the build URL before decoding it.");
  const compact = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
  let compressed;
  try {
    compressed = Buffer.from(padded, "base64");
  } catch {
    throw new Error("This is not valid Path of Building base64.");
  }
  try {
    const xml = zlib.inflateSync(compressed, { maxOutputLength: MAX_BUILD_BYTES }).toString("utf8");
    if (!/<PathOfBuilding\b/i.test(xml)) throw new Error("Missing PathOfBuilding root.");
    return xml;
  } catch (error) {
    throw new Error(`Could not decompress this Path of Building code: ${error.message}`);
  }
}

function encodePobBuild(input) {
  const xml = String(input || "").replace(/\0/g, "").trim();
  if (!/<PathOfBuilding\b/i.test(xml)) throw new Error("This XML has no PathOfBuilding root.");
  if (Buffer.byteLength(xml, "utf8") > MAX_BUILD_BYTES) throw new Error("The build XML is too large.");
  const encoded = zlib.deflateSync(Buffer.from(xml, "utf8"), { level: 9 })
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  if (Buffer.byteLength(encoded, "utf8") > MAX_BUILD_BYTES) {
    throw new Error("The encoded Path of Building code is too large to import safely. Remove oversized Notes or item data.");
  }
  return encoded;
}

module.exports = {
  LuaTableReader,
  MAX_BUILD_BYTES,
  describePassiveTree,
  decodePobBuild,
  encodePobBuild,
  findTreeFile,
  loadPassiveTree,
  loadPassiveTreeSnapshot,
  normalizeTreeVersion,
  orbitAngles,
  parseLuaTable,
  sanitizeTree,
};
