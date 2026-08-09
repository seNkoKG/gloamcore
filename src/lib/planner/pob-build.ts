export interface ImportedPassiveSpec {
  id: string;
  title: string;
  treeVersion: string;
  classId: number;
  ascendClassId: number;
  secondaryAscendClassId: number;
  nodes: number[];
  masteryEffects: Record<number, number>;
  sockets?: Record<number, number>;
  extendedHashes?: number[];
  skillOverrides?: Record<number, Record<string, unknown>>;
  jewelData?: Record<number, Record<string, unknown>>;
}

export interface ImportedPobItem {
  id: number;
  text: string;
  name: string;
  baseType: string;
  slot: string;
  equipped: boolean;
}

export interface ImportedPobGem {
  name: string;
  skillId: string;
  gemId?: string;
  variantId?: string;
  level: number;
  quality: number;
  enabled: boolean;
  enableGlobal1?: boolean;
  enableGlobal2?: boolean;
  count?: number;
}

export interface ImportedPobSkillGroup {
  id: string;
  slot: string;
  label: string;
  enabled: boolean;
  includeInFullDps: boolean;
  imbuedSupport?: string;
  mainActiveSkill?: number;
  mainActiveSkillCalcs?: number;
  groupCount?: number;
  source?: string;
  gems: ImportedPobGem[];
}

export type PobStatCategory =
  | "offence"
  | "defence"
  | "recovery"
  | "resources"
  | "resistances"
  | "attributes"
  | "charges"
  | "other";

export interface ImportedPobStat {
  name: string;
  label: string;
  value: number;
  category: PobStatCategory;
  percent: boolean;
}

export interface ImportedPobBuild {
  xml: string;
  level: number;
  className: string;
  ascendancyName: string;
  targetVersion: string;
  mainSocketGroup: number;
  bandit: string;
  activeSpec: number;
  activeItemSet: number;
  activeSkillSet: number;
  specs: ImportedPassiveSpec[];
  items: ImportedPobItem[];
  skillGroups: ImportedPobSkillGroup[];
  config: Record<string, string | number | boolean>;
  playerStats: ImportedPobStat[];
  statSource: "pob-engine" | "pob-snapshot" | "character-api" | "none";
  notes: string;
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function attributes(source: string) {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return result;
}

function optionalBooleanAttribute(value: string | undefined) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function optionalNumberAttribute(value: string | undefined) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberList(value = "") {
  return Array.from(value.matchAll(/\d+/g), (match) => Number(match[0]));
}

function masteryMap(value = "") {
  return Object.fromEntries(
    Array.from(value.matchAll(/\{(\d+),(\d+)\}/g), (match) => [Number(match[1]), Number(match[2])]),
  );
}

function itemIdentity(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const rarityIndex = lines.findIndex((line) => /^Rarity:/i.test(line));
  const separator = lines.indexOf("--------", rarityIndex + 1);
  const candidates = lines.slice(rarityIndex + 1, separator < 0 ? rarityIndex + 4 : separator).filter(Boolean);
  if (candidates.length >= 2) return { name: candidates[0], baseType: candidates[1] };
  return { name: candidates[0] || "Imported item", baseType: candidates[0] || "" };
}

function valueFromInput(attrs: Record<string, string>) {
  if (attrs.boolean != null) return attrs.boolean === "true";
  if (attrs.number != null) return Number(attrs.number);
  return attrs.string ?? attrs.value ?? "";
}

function selectedSetBody(section: string, element: string, selectedId: number) {
  const sets = Array.from(section.matchAll(new RegExp(`<${element}\\b([^>]*)>([\\s\\S]*?)<\\/${element}>`, "gi")));
  const selected = sets.find((match) => Number(attributes(match[1]).id) === selectedId) || sets[0];
  return selected?.[2] || "";
}

const PERCENT_STATS = /(?:Chance|Percent|Resist|Reduction|Avoid|Suppress|Block|Dodge|MovementSpeed|HitChance|CritChance|Inc$|More$|Multiplier$)/i;

export function pobStatPercent(name: string) {
  return PERCENT_STATS.test(name) && !/(?:Multiplier|Mod$)/i.test(name);
}

export function pobStatLabel(name: string) {
  const aliases: Record<string, string> = {
    FullDPS: "Full DPS",
    CombinedDPS: "Combined DPS",
    TotalDPS: "Hit DPS",
    TotalDotDPS: "Total DoT DPS",
    TotalEHP: "Effective hit pool",
    PhysicalMaximumHitTaken: "Physical max hit",
    FireMaximumHitTaken: "Fire max hit",
    ColdMaximumHitTaken: "Cold max hit",
    LightningMaximumHitTaken: "Lightning max hit",
    ChaosMaximumHitTaken: "Chaos max hit",
    EnergyShield: "Energy shield",
    EffectiveMovementSpeedMod: "Movement speed multiplier",
  };
  if (aliases[name]) return aliases[name];
  return name
    .replace(/^Spec:/, "Passive tree: ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bDps\b/gi, "DPS")
    .replace(/\bDot\b/gi, "DoT")
    .trim();
}

export function pobInputLabel(name: string) {
  const label = name
    .replace(/[_:-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "PoB input";
}

export function pobStatCategory(name: string): PobStatCategory {
  if (/(?:DPS|Damage|Hit|Speed|Crit|Accuracy|AreaOfEffect|Cooldown|Impale|Bleed|Ignite|Poison)/i.test(name) && !/(?:Taken|MaximumHit)/i.test(name)) return "offence";
  if (/(?:Regen|Leech|Recovery|Recoup)/i.test(name)) return "recovery";
  if (/(?:Life|Mana|EnergyShield|Ward|Rage|Cost|Reservation)/i.test(name)) return "resources";
  if (/(?:FireResist|ColdResist|LightningResist|ChaosResist)/i.test(name)) return "resistances";
  if (/^(?:Str|Dex|Int|ReqStr|ReqDex|ReqInt|Devotion)$/i.test(name)) return "attributes";
  if (/(?:Charges|Rage|Fortification)/i.test(name)) return "charges";
  if (/(?:EHP|Armour|Evasion|Taken|MaximumHit|Block|Dodge|Suppress|Avoid|Reduction|Evade|Stun)/i.test(name)) return "defence";
  return "other";
}

function parsePlayerStats(buildBody: string): ImportedPobStat[] {
  return Array.from(buildBody.matchAll(/<PlayerStat\b([^>]*?)\/>/gi), (match) => {
    const value = attributes(match[1]);
    const name = value.stat || "Unknown";
    return {
      name,
      label: pobStatLabel(name),
      value: Number(value.value) || 0,
      category: pobStatCategory(name),
      percent: pobStatPercent(name),
    };
  });
}

export function parsePobXml(xml: string): ImportedPobBuild {
  if (!/<PathOfBuilding\b/i.test(xml)) throw new Error("This XML has no PathOfBuilding root.");
  const buildMatch = /<Build\b([^>]*)>([\s\S]*?)<\/Build>|<Build\b([^>]*)\/>/i.exec(xml);
  const build = attributes(buildMatch?.[1] || buildMatch?.[3] || "");
  const buildBody = buildMatch?.[2] || "";
  const itemsSection = /<Items\b([^>]*)>([\s\S]*?)<\/Items>/i.exec(xml);
  const itemsAttrs = attributes(itemsSection?.[1] || "");
  const activeItemSet = Number(itemsAttrs.activeItemSet) || 1;
  const itemSetBody = selectedSetBody(itemsSection?.[2] || "", "ItemSet", activeItemSet);
  const itemSlots = new Map<number, string>();
  for (const match of itemSetBody.matchAll(/<(?:Slot|SocketIdURL)\b([^>]*?)\/>/gi)) {
    const value = attributes(match[1]);
    const itemId = Number(value.itemId);
    if (itemId > 0 && !itemSlots.has(itemId)) itemSlots.set(itemId, value.name || "Equipped");
  }
  const skillsSection = /<Skills\b([^>]*)>([\s\S]*?)<\/Skills>/i.exec(xml);
  const skillsAttrs = attributes(skillsSection?.[1] || "");
  const activeSkillSet = Number(skillsAttrs.activeSkillSet) || 1;
  const skillSetBody = selectedSetBody(skillsSection?.[2] || "", "SkillSet", activeSkillSet) || skillsSection?.[2] || "";
  const treeSection = /<Tree\b([^>]*)>([\s\S]*?)<\/Tree>/i.exec(xml);
  const treeAttrs = attributes(treeSection?.[1] || "");
  const activeSpec = Number(treeAttrs.activeSpec) || 1;
  const specs: ImportedPassiveSpec[] = Array.from(
    (treeSection?.[2] || xml).matchAll(/<Spec\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Spec>)/gi),
    (match, index) => {
      const value = attributes(match[1]);
      const sockets = Object.fromEntries(Array.from((match[2] || "").matchAll(/<Socket\b([^>]*?)\/>/gi), (socket) => {
        const socketValue = attributes(socket[1]);
        return [Number(socketValue.nodeId), Number(socketValue.itemId)];
      }).filter(([nodeId, itemId]) => Number(nodeId) > 0 && Number(itemId) > 0));
      const skillOverrides = Object.fromEntries(Array.from((match[2] || "").matchAll(/<Override\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Override>)/gi), (override) => {
        const overrideValue = attributes(override[1]);
        const stats = decodeXml(override[2] || "").replace(/<[^>]+>/g, "\n").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        return [Number(overrideValue.nodeId), {
          name: overrideValue.dn || overrideValue.name || "Imported passive override",
          icon: overrideValue.icon || "",
          activeEffectImage: overrideValue.activeEffectImage || "",
          stats,
        }];
      }).filter(([nodeId]) => Number(nodeId) > 0));
      if (index === activeSpec - 1) {
        for (const [nodeId, itemId] of Object.entries(sockets)) {
          if (!itemSlots.has(Number(itemId))) itemSlots.set(Number(itemId), `Jewel ${nodeId}`);
        }
      }
      return {
        id: `spec-${index}-${value.title || "default"}`,
        title: value.title || `Tree ${index + 1}`,
        treeVersion: value.treeVersion || "",
        classId: Number(value.classId) || 0,
        ascendClassId: Number(value.ascendClassId) || 0,
        secondaryAscendClassId: Number(value.secondaryAscendClassId) || 0,
        nodes: numberList(value.nodes),
        masteryEffects: masteryMap(value.masteryEffects),
        sockets,
        skillOverrides,
      };
    },
  );
  const items: ImportedPobItem[] = Array.from(
    (itemsSection?.[2] || "").matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/gi),
    (match, index) => {
      const value = attributes(match[1]);
      const text = decodeXml(match[2]).trim();
      const id = Number(value.id) || index + 1;
      const slot = itemSlots.get(id) || "";
      return { id, text, slot, equipped: Boolean(slot), ...itemIdentity(text) };
    },
  );
  const skillGroups: ImportedPobSkillGroup[] = Array.from(
    skillSetBody.matchAll(/<Skill\b([^>]*?)>([\s\S]*?)<\/Skill>/gi),
    (match, index) => {
      const value = attributes(match[1]);
      const gems: ImportedPobGem[] = Array.from(match[2].matchAll(/<Gem\b([^>]*?)(?:\/\s*>|>[\s\S]*?<\/Gem\s*>)/gi), (gem) => {
        const attrs = attributes(gem[1]);
        return {
          name: attrs.nameSpec || attrs.name || "Unknown gem",
          skillId: attrs.skillId || "",
          gemId: attrs.gemId || undefined,
          variantId: attrs.variantId || undefined,
          level: Number(attrs.level) || 1,
          quality: Number(attrs.quality) || 0,
          enabled: attrs.enabled !== "false",
          enableGlobal1: optionalBooleanAttribute(attrs.enableGlobal1),
          enableGlobal2: optionalBooleanAttribute(attrs.enableGlobal2),
          count: optionalNumberAttribute(attrs.count),
        };
      });
      return {
        id: `skill-${index + 1}`,
        slot: value.slot || "",
        label: value.label || value.slot || "Socket group",
        enabled: value.enabled !== "false",
        includeInFullDps: value.includeInFullDPS === "true",
        imbuedSupport: value.imbuedSupport || undefined,
        mainActiveSkill: optionalNumberAttribute(value.mainActiveSkill),
        mainActiveSkillCalcs: optionalNumberAttribute(value.mainActiveSkillCalcs),
        groupCount: optionalNumberAttribute(value.groupCount),
        source: value.source || undefined,
        gems,
      };
    },
  );
  const config: Record<string, string | number | boolean> = {};
  const configSection = /<Config\b([^>]*)>([\s\S]*?)<\/Config>/i.exec(xml);
  const configAttrs = attributes(configSection?.[1] || "");
  const activeConfigSet = Number(configAttrs.activeConfigSet) || 1;
  const configBody = selectedSetBody(configSection?.[2] || "", "ConfigSet", activeConfigSet) || configSection?.[2] || "";
  for (const match of configBody.matchAll(/<Input\b([^>]*?)(?:\/\s*>|>[\s\S]*?<\/Input\s*>)/gi)) {
    const value = attributes(match[1]);
    if (value.name) config[value.name] = valueFromInput(value);
  }
  const notes = decodeXml(/<Notes>([\s\S]*?)<\/Notes>/i.exec(xml)?.[1] || "").trim();
  if (!specs.length) {
    specs.push({
      id: "spec-default",
      title: "Default",
      treeVersion: "",
      classId: 0,
      ascendClassId: 0,
      secondaryAscendClassId: 0,
      nodes: [],
      masteryEffects: {},
      sockets: {},
    });
  }
  const playerStats = parsePlayerStats(buildBody);
  return {
    xml,
    level: Number(build.level) || 1,
    className: build.className || "Scion",
    ascendancyName: build.ascendClassName || build.ascendancyName || "",
    targetVersion: build.targetVersion || "3_0",
    mainSocketGroup: Number(build.mainSocketGroup) || 1,
    bandit: build.bandit || "None",
    activeSpec,
    activeItemSet,
    activeSkillSet,
    specs,
    items,
    skillGroups,
    config,
    playerStats,
    statSource: playerStats.length ? "pob-snapshot" : "none",
    notes,
  };
}

export function encodePobXmlForShare(xml: string) {
  return xml;
}

function escapeXmlAttribute(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlText(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function optionalXmlAttribute(name: string, value: string | number | boolean | undefined) {
  return value === undefined ? "" : ` ${name}="${escapeXmlAttribute(value)}"`;
}

function updateXmlAttributes(opening: string, patch: Record<string, unknown>) {
  let output = opening;
  for (const [name, raw] of Object.entries(patch)) {
    const value = escapeXmlAttribute(raw);
    const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(["'])[^"']*\\2`, "i");
    if (pattern.test(output)) output = output.replace(pattern, `$1"${value}"`);
    else output = output.replace(/\s*\/?\s*>$/, (ending) => ` ${name}="${value}"${ending}`);
  }
  return output;
}

function removeXmlAttributes(opening: string, names: string[]) {
  if (!names.length) return opening;
  const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return opening.replace(new RegExp(`\\s(?:${alternatives})\\s*=\\s*(["'])[^"']*\\1`, "gi"), "");
}

function elementBlocks(source: string, tag: string) {
  return Array.from(source.matchAll(new RegExp(`<${tag}\\b[^>]*(?:\\/\\s*>|>[\\s\\S]*?<\\/${tag}\\s*>)`, "gi")));
}

function elementOpening(block: string, tag: string) {
  return new RegExp(`^<${tag}\\b[^>]*\\/?>`, "i").exec(block)?.[0] || `<${tag}>`;
}

function elementBody(block: string, tag: string) {
  const opening = elementOpening(block, tag);
  if (/\/\s*>$/.test(opening)) return "";
  return block.slice(opening.length).replace(new RegExp(`<\\/${tag}\\s*>$`, "i"), "");
}

function pairedElement(opening: string, body: string, tag: string) {
  return `${opening.replace(/\/\s*>$/, ">")}${body}</${tag}>`;
}

function appendXmlChildren(body: string, children: string[]) {
  if (!children.length) return body;
  const separator = body && !body.endsWith("\n") ? "\n" : "";
  return `${body}${separator}${children.join("\n")}`;
}

function patchSectionSet(
  section: string,
  sectionTag: string,
  setTag: string,
  activeId: number,
  patchBody: (body: string) => string,
  outerPatch: Record<string, unknown>,
  adoptExistingBody: boolean,
) {
  const opening = updateXmlAttributes(elementOpening(section, sectionTag), outerPatch);
  let body = elementBody(section, sectionTag);
  const sets = elementBlocks(body, setTag);
  const selected = sets.find((match) => Number(attributes(elementOpening(match[0], setTag)).id) === activeId) || sets[0];
  if (selected && selected.index != null) {
    const block = selected[0];
    const patched = pairedElement(
      elementOpening(block, setTag),
      patchBody(elementBody(block, setTag)),
      setTag,
    );
    body = `${body.slice(0, selected.index)}${patched}${body.slice(selected.index + block.length)}`;
  } else {
    const setBody = patchBody(adoptExistingBody ? body : "");
    const created = `<${setTag} id="${activeId}">${setBody}</${setTag}>`;
    body = adoptExistingBody ? created : appendXmlChildren(body, [created]);
  }
  return pairedElement(opening, body, sectionTag);
}

function inputElement(name: string, value: string | number | boolean, indent = "\t\t\t") {
  const typed = typeof value === "boolean"
    ? `boolean="${value}"`
    : typeof value === "number"
      ? `number="${Number.isFinite(value) ? value : 0}"`
      : `string="${escapeXmlAttribute(value)}"`;
  return `${indent}<Input name="${escapeXmlAttribute(name)}" ${typed}/>`;
}

function patchConfigSetBody(body: string, config: ImportedPobBuild["config"]) {
  const seen = new Set<string>();
  let output = body.replace(/<Input\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Input\s*>)/gi, (block) => {
    const opening = elementOpening(block, "Input");
    const name = attributes(opening).name;
    if (!name) return block;
    if (!Object.prototype.hasOwnProperty.call(config, name)) return "";
    seen.add(name);
    const value = config[name];
    const typeName = typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string";
    const cleanOpening = removeXmlAttributes(opening, ["boolean", "number", "string", "value"]);
    return block.replace(opening, updateXmlAttributes(cleanOpening, {
      name,
      [typeName]: typeof value === "number" && !Number.isFinite(value) ? 0 : value,
    }));
  });
  output = appendXmlChildren(output, Object.entries(config)
    .filter(([name]) => !seen.has(name))
    .map(([name, value]) => inputElement(name, value)));
  return output;
}

function patchConfigSection(section: string, config: ImportedPobBuild["config"]) {
  const outer = attributes(elementOpening(section, "Config"));
  const activeId = Math.max(1, Number(outer.activeConfigSet) || 1);
  return patchSectionSet(
    section,
    "Config",
    "ConfigSet",
    activeId,
    (body) => patchConfigSetBody(body, config),
    { activeConfigSet: activeId },
    true,
  );
}

function serializeConfig(config: ImportedPobBuild["config"]) {
  const inputs = Object.entries(config).map(([name, value]) => inputElement(name, value)).join("\n");
  return `<Config activeConfigSet="1">\n\t\t<ConfigSet id="1">${inputs ? `\n${inputs}\n\t\t` : ""}</ConfigSet>\n\t</Config>`;
}

function gemElement(gem: ImportedPobGem, indent = "\t\t\t\t") {
  return `${indent}<Gem nameSpec="${escapeXmlAttribute(gem.name)}" skillId="${escapeXmlAttribute(gem.skillId)}"${optionalXmlAttribute("gemId", gem.gemId)}${optionalXmlAttribute("variantId", gem.variantId)} level="${gem.level}" quality="${gem.quality}" enabled="${gem.enabled}"${optionalXmlAttribute("enableGlobal1", gem.enableGlobal1)}${optionalXmlAttribute("enableGlobal2", gem.enableGlobal2)}${optionalXmlAttribute("count", gem.count)}/>`;
}

function patchGemBlock(block: string, gem: ImportedPobGem) {
  const opening = elementOpening(block, "Gem");
  const patch: Record<string, unknown> = {
    nameSpec: gem.name,
    skillId: gem.skillId,
    level: gem.level,
    quality: gem.quality,
    enabled: gem.enabled,
  };
  if (gem.gemId !== undefined) patch.gemId = gem.gemId;
  if (gem.variantId !== undefined) patch.variantId = gem.variantId;
  if (gem.enableGlobal1 !== undefined) patch.enableGlobal1 = gem.enableGlobal1;
  if (gem.enableGlobal2 !== undefined) patch.enableGlobal2 = gem.enableGlobal2;
  if (gem.count !== undefined) patch.count = gem.count;
  return block.replace(opening, updateXmlAttributes(opening, patch));
}

function patchSkillBlock(block: string, group: ImportedPobSkillGroup) {
  const originalOpening = elementOpening(block, "Skill");
  const patch: Record<string, unknown> = {
    label: group.label,
    slot: group.slot,
    enabled: group.enabled,
    includeInFullDPS: group.includeInFullDps,
  };
  if (group.imbuedSupport !== undefined) patch.imbuedSupport = group.imbuedSupport;
  if (group.mainActiveSkill !== undefined) patch.mainActiveSkill = group.mainActiveSkill;
  if (group.mainActiveSkillCalcs !== undefined) patch.mainActiveSkillCalcs = group.mainActiveSkillCalcs;
  if (group.groupCount !== undefined) patch.groupCount = group.groupCount;
  if (group.source !== undefined) patch.source = group.source;
  const opening = updateXmlAttributes(originalOpening, patch);
  let body = elementBody(block, "Skill");
  let gemIndex = 0;
  body = body.replace(/<Gem\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Gem\s*>)/gi, (gemBlock) => {
    const gem = group.gems[gemIndex++];
    return gem ? patchGemBlock(gemBlock, gem) : gemBlock;
  });
  body = appendXmlChildren(body, group.gems.slice(gemIndex).map((gem) => gemElement(gem)));
  return pairedElement(opening, body, "Skill");
}

function skillElement(group: ImportedPobSkillGroup, indent = "\t\t\t") {
  const gems = group.gems.map((gem) => gemElement(gem)).join("\n");
  return `${indent}<Skill label="${escapeXmlAttribute(group.label)}" slot="${escapeXmlAttribute(group.slot)}" enabled="${group.enabled}" includeInFullDPS="${group.includeInFullDps}"${optionalXmlAttribute("imbuedSupport", group.imbuedSupport)}${optionalXmlAttribute("mainActiveSkill", group.mainActiveSkill)}${optionalXmlAttribute("mainActiveSkillCalcs", group.mainActiveSkillCalcs)}${optionalXmlAttribute("groupCount", group.groupCount)}${optionalXmlAttribute("source", group.source)}>${gems ? `\n${gems}\n${indent}` : ""}</Skill>`;
}

function patchSkillSetBody(body: string, groups: ImportedPobSkillGroup[]) {
  let groupIndex = 0;
  let output = body.replace(/<Skill\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Skill\s*>)/gi, (block) => {
    const group = groups[groupIndex++];
    return group ? patchSkillBlock(block, group) : block;
  });
  output = appendXmlChildren(output, groups.slice(groupIndex).map((group) => skillElement(group)));
  return output;
}

function patchSkillsSection(section: string, build: ImportedPobBuild) {
  const outer = attributes(elementOpening(section, "Skills"));
  const activeId = Math.max(1, Number(build.activeSkillSet) || Number(outer.activeSkillSet) || 1);
  return patchSectionSet(
    section,
    "Skills",
    "SkillSet",
    activeId,
    (body) => patchSkillSetBody(body, build.skillGroups),
    { activeSkillSet: activeId },
    true,
  );
}

function serializeSkills(build: ImportedPobBuild) {
  const activeId = Math.max(1, Number(build.activeSkillSet) || 1);
  const groups = build.skillGroups.map((group) => skillElement(group)).join("\n");
  return `<Skills activeSkillSet="${activeId}">\n\t\t<SkillSet id="${activeId}">${groups ? `\n${groups}\n\t\t` : ""}</SkillSet>\n\t</Skills>`;
}

function desiredEquipmentSlots(build: ImportedPobBuild) {
  const desired = new Map<string, number>();
  for (const item of build.items) {
    if (item.equipped && item.slot && !/^Jewel \d+$/i.test(item.slot)) desired.set(item.slot, item.id);
  }
  return desired;
}

function patchItemSetBody(body: string, build: ImportedPobBuild) {
  const desired = desiredEquipmentSlots(build);
  const seen = new Set<string>();
  let output = body.replace(/<Slot\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Slot\s*>)/gi, (block) => {
    const opening = elementOpening(block, "Slot");
    const name = attributes(opening).name;
    if (!name) return block;
    const itemId = desired.get(name);
    if (!itemId || seen.has(name)) return "";
    seen.add(name);
    return block.replace(opening, updateXmlAttributes(opening, { name, itemId }));
  });
  output = appendXmlChildren(output, Array.from(desired)
    .filter(([name]) => !seen.has(name))
    .map(([name, itemId]) => `\t\t\t<Slot name="${escapeXmlAttribute(name)}" itemId="${itemId}"/>`));
  return output;
}

function patchItemsSection(section: string, build: ImportedPobBuild) {
  const outer = attributes(elementOpening(section, "Items"));
  const activeId = Math.max(1, Number(build.activeItemSet) || Number(outer.activeItemSet) || 1);
  return patchSectionSet(
    section,
    "Items",
    "ItemSet",
    activeId,
    (body) => patchItemSetBody(body, build),
    { activeItemSet: activeId },
    false,
  );
}

function serializeItems(build: ImportedPobBuild) {
  const items = build.items.map((item) => `\t\t<Item id="${item.id}">${escapeXmlText(item.text)}</Item>`).join("\n");
  const slots = build.items.filter((item) => item.equipped && item.slot && !/^Jewel \d+$/i.test(item.slot)).map((item) => `\t\t\t<Slot name="${escapeXmlAttribute(item.slot)}" itemId="${item.id}"/>`).join("\n");
  const activeId = Math.max(1, Number(build.activeItemSet) || 1);
  return `<Items activeItemSet="${activeId}">${items ? `\n${items}` : ""}\n\t\t<ItemSet id="${activeId}">${slots ? `\n${slots}\n\t\t` : ""}</ItemSet>\n\t</Items>`;
}

function serializeTree(specs: ImportedPassiveSpec[], activeSpecId: string) {
  const activeIndex = Math.max(0, specs.findIndex((spec) => spec.id === activeSpecId));
  const rows = specs.map((spec) => {
    const opening = `\t\t<Spec title="${escapeXmlAttribute(spec.title)}" treeVersion="${escapeXmlAttribute(spec.treeVersion)}" classId="${spec.classId}" ascendClassId="${spec.ascendClassId}" secondaryAscendClassId="${spec.secondaryAscendClassId}" nodes="${spec.nodes.join(",")}" masteryEffects="${Object.entries(spec.masteryEffects).map(([node, effect]) => `{${node},${effect}}`).join(",")}"`;
    const sockets = Object.entries(spec.sockets || {}).map(([nodeId, itemId]) => `\t\t\t\t<Socket nodeId="${nodeId}" itemId="${itemId}"/>`).join("\n");
    const overrides = Object.entries(spec.skillOverrides || {}).map(([nodeId, raw]) => {
      const override = record(raw);
      const name = override.name || override.dn || "Imported passive override";
      const stats = (Array.isArray(override.stats) ? override.stats : Array.isArray(override.sd) ? override.sd : []).map(escapeXmlText).join("\n");
      return `\t\t\t\t<Override nodeId="${nodeId}" dn="${escapeXmlAttribute(name)}" icon="${escapeXmlAttribute(override.icon)}" activeEffectImage="${escapeXmlAttribute(override.activeEffectImage)}">${stats ? `\n${stats}\n\t\t\t\t` : ""}</Override>`;
    }).join("\n");
    const children = [
      sockets ? `\t\t\t<Sockets>\n${sockets}\n\t\t\t</Sockets>` : "",
      overrides ? `\t\t\t<Overrides>\n${overrides}\n\t\t\t</Overrides>` : "",
    ].filter(Boolean).join("\n");
    return children ? `${opening}>\n${children}\n\t\t</Spec>` : `${opening}/>`;
  }).join("\n");
  return `<Tree activeSpec="${activeIndex + 1}">${rows ? `\n${rows}\n\t` : ""}</Tree>`;
}

function patchSocketSetBody(body: string, sockets: Record<number, number>) {
  const desired = new Map(Object.entries(sockets).map(([nodeId, itemId]) => [Number(nodeId), Number(itemId)]));
  const seen = new Set<number>();
  let output = body.replace(/<Socket\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Socket\s*>)/gi, (block) => {
    const opening = elementOpening(block, "Socket");
    const nodeId = Number(attributes(opening).nodeId);
    const itemId = desired.get(nodeId);
    if (!nodeId || !itemId || seen.has(nodeId)) return "";
    seen.add(nodeId);
    return block.replace(opening, updateXmlAttributes(opening, { nodeId, itemId }));
  });
  output = appendXmlChildren(output, Array.from(desired)
    .filter(([nodeId]) => !seen.has(nodeId))
    .map(([nodeId, itemId]) => `\t\t\t\t<Socket nodeId="${nodeId}" itemId="${itemId}"/>`));
  return output;
}

function patchSpecSockets(block: string, sockets: Record<number, number>) {
  const originalOpening = elementOpening(block, "Spec");
  let body = elementBody(block, "Spec");
  const containers = elementBlocks(body, "Sockets");
  const container = containers[0];
  if (container && container.index != null) {
    const patched = pairedElement(
      elementOpening(container[0], "Sockets"),
      patchSocketSetBody(elementBody(container[0], "Sockets"), sockets),
      "Sockets",
    );
    body = `${body.slice(0, container.index)}${patched}${body.slice(container.index + container[0].length)}`;
  } else if (Object.keys(sockets).length) {
    body = appendXmlChildren(body, [
      `<Sockets>${patchSocketSetBody("", sockets)}</Sockets>`,
    ]);
  }
  return pairedElement(originalOpening, body, "Spec");
}

export function specsWithActiveJewelLoadout(
  build: ImportedPobBuild,
  specs: ImportedPassiveSpec[],
  activeSpecId: string,
) {
  const activeIndex = Math.max(0, specs.findIndex((spec) => spec.id === activeSpecId));
  const itemById = new Map(build.items.map((item) => [item.id, item]));
  return specs.map((spec, index) => {
    if (index !== activeIndex) return spec;
    const sockets = { ...(spec.sockets || {}) };
    for (const [rawNodeId, rawItemId] of Object.entries(sockets)) {
      const item = itemById.get(Number(rawItemId));
      if (item && !item.equipped) delete sockets[Number(rawNodeId)];
    }
    for (const item of build.items) {
      const match = /^Jewel (\d+)$/i.exec(item.slot);
      if (item.equipped && match) sockets[Number(match[1])] = item.id;
    }
    return { ...spec, sockets };
  });
}

/** Mirrors PoB's selected tree-spec socket set into the Items-tab loadout. */
export function itemsWithPassiveSpecLoadout(
  items: readonly ImportedPobItem[],
  spec: ImportedPassiveSpec | null | undefined,
) {
  const socketByItem = new Map<number, number>();
  for (const [rawNodeId, rawItemId] of Object.entries(spec?.sockets || {})) {
    const nodeId = Number(rawNodeId);
    const itemId = Number(rawItemId);
    if (nodeId > 0 && itemId > 0) socketByItem.set(itemId, nodeId);
  }
  return items.map((item) => {
    const nodeId = socketByItem.get(item.id);
    if (nodeId) return { ...item, slot: `Jewel ${nodeId}`, equipped: true };
    return /^Jewel \d+$/i.test(item.slot) ? { ...item, equipped: false } : item;
  });
}

function patchTree(source: string, specs: ImportedPassiveSpec[], activeSpecId: string) {
  const activeIndex = Math.max(0, specs.findIndex((spec) => spec.id === activeSpecId));
  let specIndex = 0;
  let output = source.replace(/<Spec\b[^>]*(?:\/>|>[\s\S]*?<\/Spec>)/gi, (block) => {
    const spec = specs[specIndex++];
    if (!spec) return block;
    const socketPatched = patchSpecSockets(block, spec.sockets || {});
    return socketPatched.replace(/^<Spec\b[^>]*\/?>/i, (opening) => updateXmlAttributes(opening, {
      title: spec.title,
      treeVersion: spec.treeVersion,
      classId: spec.classId,
      ascendClassId: spec.ascendClassId,
      secondaryAscendClassId: spec.secondaryAscendClassId,
      nodes: spec.nodes.join(","),
      masteryEffects: Object.entries(spec.masteryEffects).map(([node, effect]) => `{${node},${effect}}`).join(","),
    }));
  });
  if (specIndex < specs.length) {
    const extra = serializeTree(specs.slice(specIndex), specs[specIndex]?.id || "")
      .replace(/^<Tree\b[^>]*>/i, "")
      .replace(/<\/Tree>$/i, "")
      .trim();
    output = output.replace(/<\/Tree>$/i, `${extra ? `\n\t\t${extra.replace(/\n/g, "\n\t\t")}` : ""}\n\t</Tree>`);
  }
  return output.replace(/^<Tree\b[^>]*>/i, (opening) => updateXmlAttributes(opening, { activeSpec: activeIndex + 1 }));
}

/** Produces a PoB-compatible document while preserving untouched sections when possible. */
export function serializePobXml(
  build: ImportedPobBuild,
  specs: ImportedPassiveSpec[] = build.specs,
  activeSpecId = specs[0]?.id || "",
) {
  const effectiveSpecs = specsWithActiveJewelLoadout(build, specs, activeSpecId);
  let xml = build.xml.trim();
  if (!xml) {
    const playerStats = build.playerStats.map((stat) => `\t\t<PlayerStat stat="${escapeXmlAttribute(stat.name)}" value="${stat.value}"/>`).join("\n");
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<PathOfBuilding>\n\t<Build level="${build.level}" className="${escapeXmlAttribute(build.className)}" ascendClassName="${escapeXmlAttribute(build.ascendancyName)}" targetVersion="${escapeXmlAttribute(build.targetVersion)}" mainSocketGroup="${build.mainSocketGroup}" bandit="${escapeXmlAttribute(build.bandit)}">${playerStats ? `\n${playerStats}\n\t` : ""}</Build>\n\t${serializeConfig(build.config)}\n\t${serializeTree(effectiveSpecs, activeSpecId)}\n\t${serializeSkills(build)}\n\t<Notes>${escapeXmlText(build.notes)}</Notes>\n\t${serializeItems(build)}\n</PathOfBuilding>`;
    return xml;
  }

  xml = xml.replace(/<Build\b[^>]*>/i, (opening) => updateXmlAttributes(opening, {
    level: build.level,
    className: build.className,
    ascendClassName: build.ascendancyName,
    targetVersion: build.targetVersion,
    mainSocketGroup: build.mainSocketGroup,
    bandit: build.bandit,
  }));
  const originalTree = /<Tree\b[\s\S]*?<\/Tree>/i.exec(xml)?.[0];
  const tree = originalTree
    ? patchTree(originalTree, effectiveSpecs, activeSpecId)
    : serializeTree(effectiveSpecs, activeSpecId);
  xml = /<Tree\b[\s\S]*?<\/Tree>/i.test(xml)
    ? xml.replace(/<Tree\b[\s\S]*?<\/Tree>/i, tree)
    : xml.replace(/<\/PathOfBuilding>/i, `\t${tree}\n</PathOfBuilding>`);
  const originalConfig = /<Config\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Config\s*>)/i.exec(xml)?.[0];
  const config = originalConfig ? patchConfigSection(originalConfig, build.config) : serializeConfig(build.config);
  xml = originalConfig
    ? xml.replace(originalConfig, config)
    : xml.replace(/<\/PathOfBuilding>/i, `\t${config}\n</PathOfBuilding>`);
  const originalSkills = /<Skills\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Skills\s*>)/i.exec(xml)?.[0];
  const skills = originalSkills ? patchSkillsSection(originalSkills, build) : serializeSkills(build);
  xml = originalSkills
    ? xml.replace(originalSkills, skills)
    : xml.replace(/<\/PathOfBuilding>/i, `\t${skills}\n</PathOfBuilding>`);
  const originalItems = /<Items\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Items\s*>)/i.exec(xml)?.[0];
  const items = originalItems ? patchItemsSection(originalItems, build) : serializeItems(build);
  xml = originalItems
    ? xml.replace(originalItems, items)
    : xml.replace(/<\/PathOfBuilding>/i, `\t${items}\n</PathOfBuilding>`);
  xml = /<Notes>[\s\S]*?<\/Notes>/i.test(xml)
    ? xml.replace(/<Notes>[\s\S]*?<\/Notes>/i, `<Notes>${escapeXmlText(build.notes)}</Notes>`)
    : xml.replace(/<\/PathOfBuilding>/i, `\t<Notes>${escapeXmlText(build.notes)}</Notes>\n</PathOfBuilding>`);
  return xml;
}

export function emptyPobBuild(className = "Scion"): ImportedPobBuild {
  return {
    xml: "",
    level: 1,
    className,
    ascendancyName: "",
    targetVersion: "3_0",
    mainSocketGroup: 1,
    bandit: "None",
    activeSpec: 1,
    activeItemSet: 1,
    activeSkillSet: 1,
    specs: [],
    items: [],
    skillGroups: [],
    config: {},
    playerStats: [],
    statSource: "none",
    notes: "",
  };
}

function finiteInteger(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : fallback;
}

function numericRecord(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([rawKey, rawValue]) => {
    const key = finiteInteger(rawKey, -1);
    const numeric = finiteInteger(rawValue, -1);
    return key >= 0 && numeric >= 0 ? [[key, numeric]] : [];
  }));
}

function objectRecord(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([rawKey, rawValue]) => {
    const key = finiteInteger(rawKey, -1);
    return key >= 0 && rawValue && typeof rawValue === "object"
      ? [[key, rawValue as Record<string, unknown>]]
      : [];
  }));
}

/** Runtime-safe normalisation for JSON workspaces written by any planner version. */
export function normalizeImportedPassiveSpecs(value: unknown): ImportedPassiveSpec[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawSpec, index) => {
    if (!rawSpec || typeof rawSpec !== "object") return [];
    const spec = record(rawSpec);
    const nodes = Array.isArray(spec.nodes)
      ? [...new Set(spec.nodes.map((entry) => finiteInteger(entry, -1)).filter((entry) => entry >= 0))]
      : [];
    const extendedHashes = Array.isArray(spec.extendedHashes)
      ? [...new Set(spec.extendedHashes.map((entry) => finiteInteger(entry, -1)).filter((entry) => entry >= 0))]
      : undefined;
    return [{
      id: typeof spec.id === "string" && spec.id.trim() ? spec.id.slice(0, 160) : `spec-${index + 1}`,
      title: typeof spec.title === "string" && spec.title.trim() ? spec.title.slice(0, 160) : `Tree ${index + 1}`,
      treeVersion: typeof spec.treeVersion === "string" ? spec.treeVersion.slice(0, 40) : "",
      classId: finiteInteger(spec.classId),
      ascendClassId: finiteInteger(spec.ascendClassId),
      secondaryAscendClassId: finiteInteger(spec.secondaryAscendClassId),
      nodes,
      masteryEffects: numericRecord(spec.masteryEffects),
      sockets: numericRecord(spec.sockets),
      ...(extendedHashes ? { extendedHashes } : {}),
      ...(spec.skillOverrides && typeof spec.skillOverrides === "object" ? { skillOverrides: objectRecord(spec.skillOverrides) } : {}),
      ...(spec.jewelData && typeof spec.jewelData === "object" ? { jewelData: objectRecord(spec.jewelData) } : {}),
    }];
  });
}

/** Backfills and validates workspaces written by earlier Ninja Lens planners. */
export function normalizeImportedPobBuild(value: Partial<ImportedPobBuild> | null | undefined) {
  if (!value || typeof value !== "object") return null;
  const source = record(value);
  const className = typeof source.className === "string" && source.className.trim() ? source.className : "Scion";
  const fallback = emptyPobBuild(className);
  const items = Array.isArray(source.items) ? source.items.flatMap((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object") return [];
    const item = record(rawItem);
    const itemText = typeof item.text === "string" ? item.text : "";
    const identity = itemIdentity(itemText);
    const slot = typeof item.slot === "string" ? item.slot : "";
    return [{
      id: Math.max(1, finiteInteger(item.id, index + 1)),
      text: itemText,
      name: typeof item.name === "string" && item.name.trim() ? item.name : identity.name,
      baseType: typeof item.baseType === "string" && item.baseType.trim() ? item.baseType : identity.baseType,
      slot,
      equipped: typeof item.equipped === "boolean" ? item.equipped : Boolean(slot),
    }];
  }) : [];
  const skillGroups = Array.isArray(source.skillGroups) ? source.skillGroups.flatMap((rawGroup, groupIndex) => {
    if (!rawGroup || typeof rawGroup !== "object") return [];
    const group = record(rawGroup);
    const gems = Array.isArray(group.gems) ? group.gems.flatMap((rawGem) => {
      if (!rawGem || typeof rawGem !== "object") return [];
      const gem = record(rawGem);
      return [{
        name: typeof gem.name === "string" && gem.name.trim() ? gem.name : "Unknown gem",
        skillId: typeof gem.skillId === "string" ? gem.skillId : "",
        ...(typeof gem.gemId === "string" ? { gemId: gem.gemId } : {}),
        ...(typeof gem.variantId === "string" ? { variantId: gem.variantId } : {}),
        level: Math.max(1, finiteInteger(gem.level, 1)),
        quality: Math.max(0, finiteInteger(gem.quality)),
        enabled: gem.enabled !== false,
        ...(typeof gem.enableGlobal1 === "boolean" ? { enableGlobal1: gem.enableGlobal1 } : {}),
        ...(typeof gem.enableGlobal2 === "boolean" ? { enableGlobal2: gem.enableGlobal2 } : {}),
        ...(Number.isFinite(Number(gem.count)) ? { count: Number(gem.count) } : {}),
      }];
    }) : [];
    const slot = typeof group.slot === "string" ? group.slot : "";
    return [{
      id: typeof group.id === "string" && group.id ? group.id : `skill-${groupIndex + 1}`,
      slot,
      label: typeof group.label === "string" && group.label ? group.label : slot || "Socket group",
      enabled: group.enabled !== false,
      includeInFullDps: Boolean(group.includeInFullDps),
      ...(typeof group.imbuedSupport === "string" ? { imbuedSupport: group.imbuedSupport } : {}),
      ...(Number.isFinite(Number(group.mainActiveSkill)) ? { mainActiveSkill: Number(group.mainActiveSkill) } : {}),
      ...(Number.isFinite(Number(group.mainActiveSkillCalcs)) ? { mainActiveSkillCalcs: Number(group.mainActiveSkillCalcs) } : {}),
      ...(Number.isFinite(Number(group.groupCount)) ? { groupCount: Number(group.groupCount) } : {}),
      ...(typeof group.source === "string" ? { source: group.source } : {}),
      gems,
    }];
  }) : [];
  const config = Object.fromEntries(Object.entries(record(source.config)).filter((entry): entry is [string, string | number | boolean] => (
    typeof entry[1] === "string" || typeof entry[1] === "boolean" || (typeof entry[1] === "number" && Number.isFinite(entry[1]))
  )));
  const categories = new Set<PobStatCategory>(["offence", "defence", "recovery", "resources", "resistances", "attributes", "charges", "other"]);
  const playerStats = Array.isArray(source.playerStats) ? source.playerStats.flatMap((rawStat) => {
    if (!rawStat || typeof rawStat !== "object") return [];
    const stat = record(rawStat);
    const name = typeof stat.name === "string" ? stat.name : "";
    const numeric = Number(stat.value);
    if (!name || !Number.isFinite(numeric)) return [];
    return [{
      name,
      label: typeof stat.label === "string" && stat.label ? stat.label : pobStatLabel(name),
      value: numeric,
      category: categories.has(stat.category as PobStatCategory) ? stat.category as PobStatCategory : pobStatCategory(name),
      percent: typeof stat.percent === "boolean" ? stat.percent : pobStatPercent(name),
    }];
  }) : [];
  const statSource = source.statSource === "pob-engine" || source.statSource === "pob-snapshot" || source.statSource === "character-api" || source.statSource === "none"
    ? source.statSource
    : playerStats.length ? "pob-snapshot" : "none";
  return {
    ...fallback,
    xml: typeof source.xml === "string" ? source.xml : "",
    level: Math.max(1, finiteInteger(source.level, 1)),
    className,
    ascendancyName: typeof source.ascendancyName === "string" ? source.ascendancyName : "",
    targetVersion: typeof source.targetVersion === "string" ? source.targetVersion : fallback.targetVersion,
    mainSocketGroup: Math.max(1, finiteInteger(source.mainSocketGroup, 1)),
    bandit: typeof source.bandit === "string" ? source.bandit : fallback.bandit,
    activeSpec: Math.max(1, finiteInteger(source.activeSpec, 1)),
    activeItemSet: Math.max(1, finiteInteger(source.activeItemSet, 1)),
    activeSkillSet: Math.max(1, finiteInteger(source.activeSkillSet, 1)),
    specs: normalizeImportedPassiveSpecs(source.specs),
    items,
    skillGroups,
    config,
    playerStats,
    statSource,
    notes: typeof source.notes === "string" ? source.notes : "",
  } satisfies ImportedPobBuild;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
