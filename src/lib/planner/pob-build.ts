export interface ImportedPassiveSpec {
  id: string;
  title: string;
  treeVersion: string;
  classId: number;
  ascendClassId: number;
  secondaryAscendClassId: number;
  nodes: number[];
  masteryEffects: Record<number, number>;
  clusterHashFormatVersion?: number;
  unknownAttributes?: Record<string, string>;
  unknownChildren?: string[];
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
  /** Official game artwork URL. Kept outside PoB XML and stored only in the user's local workspace. */
  icon?: string;
  /** Authoritative in-game inventory-cell dimensions. Kept outside PoB XML. */
  width?: number;
  height?: number;
  /** PoB-owned child records such as legacy ModRange entries, preserved losslessly until raw text is edited. */
  xmlChildren?: string[];
}

export interface ImportedPobItemSetSlot {
  itemId: number;
  active?: boolean;
  itemPbUrl?: string;
}

export interface ImportedPobItemSet {
  id: number;
  title: string;
  useSecondWeaponSet: boolean;
  slots: Record<string, ImportedPobItemSetSlot>;
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
  skillPart?: number;
  skillPartCalcs?: number;
  skillStageCount?: number;
  skillStageCountCalcs?: number;
  skillMineCount?: number;
  skillMineCountCalcs?: number;
  skillMinion?: string;
  skillMinionCalcs?: string;
  skillMinionItemSet?: number;
  skillMinionItemSetCalcs?: number;
  skillMinionSkill?: number;
  skillMinionSkillCalcs?: number;
  /** Official game artwork URL. Kept outside PoB XML and stored only in the user's local workspace. */
  icon?: string;
  support?: boolean;
}

export function importedPobGemArtworkKey(
  gem: Pick<ImportedPobGem, "name" | "gemId" | "variantId">,
) {
  return `${gem.name}\u0000${gem.gemId || ""}\u0000${gem.variantId || ""}`;
}

export interface ImportedPobActiveSkill {
  index: number;
  name: string;
  parts?: string[];
  sourceGemIndex?: number;
  stages?: { min: number; max: number };
  mine?: boolean;
  minions?: Array<{ label: string; minionId?: string; itemSetId?: number }>;
  minionSkills?: string[];
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
  activeSkills?: ImportedPobActiveSkill[];
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
  itemSets: ImportedPobItemSet[];
  skillGroups: ImportedPobSkillGroup[];
  config: Record<string, string | number | boolean>;
  playerStats: ImportedPobStat[];
  statSource: "pob-engine" | "pob-snapshot" | "none";
  notes: string;
}

export interface PobPlannerSetSummary {
  id: number;
  title: string;
  entryCount: number;
  active: boolean;
}

export interface PobCustomModifierBlock {
  title: string;
  enabled: boolean;
  text: string;
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

function uniqueNumberList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((entry) => Number.isSafeInteger(entry) && entry >= 0))];
}

/** Accepts only the numeric version family used by Path of Exile 1 builds. */
export function isPoe1PobVersion(value: unknown) {
  const version = typeof value === "string" ? value.trim() : "";
  return !version || /^[1-9]\d*(?:[._]\d+)*$/.test(version);
}

export function withPassiveSpecAllocation(
  spec: ImportedPassiveSpec,
  allocation: Iterable<number>,
) {
  const nodes = new Set([...allocation].map(Number)
    .filter((entry) => Number.isSafeInteger(entry) && entry >= 0));

  const masteryEffects = Object.fromEntries(Object.entries(spec.masteryEffects)
    .filter(([nodeId]) => nodes.has(Number(nodeId))));
  return {
    ...spec,
    nodes: [...nodes],
    masteryEffects,
  };
}

export function itemIdentityFromPobText(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const rarityIndex = lines.findIndex((line) => /^Rarity:/i.test(line));
  const separator = lines.indexOf("--------", rarityIndex + 1);
  const candidates = lines.slice(rarityIndex + 1, separator < 0 ? rarityIndex + 4 : separator).filter(Boolean);
  if (candidates.length >= 2) return { name: candidates[0], baseType: candidates[1] };
  return { name: candidates[0] || "Imported item", baseType: candidates[0] || "" };
}

function safeItemXmlChildren(body: string) {
  return Array.from(body.matchAll(/<ModRange\b[^>]*\/\s*>/gi), (match) => match[0]);
}

function itemRawText(body: string) {
  return decodeXml(body.replace(/<ModRange\b[^>]*\/\s*>/gi, "")).trim();
}

export function trustedPoeIconUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "web.poecdn.com"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function inventoryDimension(value: unknown, maximum: number) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= maximum
    ? numeric
    : undefined;
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

const KNOWN_SPEC_ATTRIBUTES = new Set([
  "title",
  "treeVersion",
  "classId",
  "ascendClassId",
  "secondaryAscendClassId",
  "nodes",
  "masteryEffects",
  "clusterHashFormatVersion",
]);

function preservedSpecChildren(body: string) {
  return Array.from(body.matchAll(/<([:\w.-]+)\b[^>]*(?:\/\s*>|>[\s\S]*?<\/\1\s*>)/gi), (match) => ({
    tag: match[1],
    xml: match[0],
  })).filter(({ tag }) => !/^(?:Sockets|Overrides)$/i.test(tag))
    .map(({ xml }) => xml);
}

export function parsePobXml(xml: string): ImportedPobBuild {
  if (!/<PathOfBuilding\b/i.test(xml)) throw new Error("This XML has no PathOfBuilding root.");
  const buildMatch = /<Build\b([^>]*)>([\s\S]*?)<\/Build>|<Build\b([^>]*)\/>/i.exec(xml);
  const build = attributes(buildMatch?.[1] || buildMatch?.[3] || "");
  const buildBody = buildMatch?.[2] || "";
  const itemsSection = /<Items\b([^>]*)>([\s\S]*?)<\/Items>/i.exec(xml);
  const itemsAttrs = attributes(itemsSection?.[1] || "");
  const activeItemSet = Number(itemsAttrs.activeItemSet) || 1;
  const itemSets: ImportedPobItemSet[] = Array.from(
    (itemsSection?.[2] || "").matchAll(/<ItemSet\b([^>]*?)>([\s\S]*?)<\/ItemSet>/gi),
    (match, index) => {
      const value = attributes(match[1]);
      const slots: Record<string, ImportedPobItemSetSlot> = {};
      for (const slotMatch of match[2].matchAll(/<Slot\b([^>]*?)\/>/gi)) {
        const slot = attributes(slotMatch[1]);
        if (!slot.name) continue;
        slots[slot.name] = {
          itemId: Math.max(0, Number(slot.itemId) || 0),
          ...(slot.active != null ? { active: slot.active === "true" } : {}),
          ...(slot.itemPbURL ? { itemPbUrl: slot.itemPbURL } : {}),
        };
      }
      return {
        id: Math.max(1, Number(value.id) || index + 1),
        title: value.title || `Item set ${index + 1}`,
        useSecondWeaponSet: value.useSecondWeaponSet === "true",
        slots,
      };
    },
  );
  if (!itemSets.length) itemSets.push({ id: activeItemSet, title: "Default", useSecondWeaponSet: itemsAttrs.useSecondWeaponSet === "true", slots: {} });
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
      const body = match[2] || "";
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
      const unknownAttributes = Object.fromEntries(Object.entries(value)
        .filter(([name]) => !KNOWN_SPEC_ATTRIBUTES.has(name) && !/InternalId$/i.test(name)));
      const unknownChildren = preservedSpecChildren(body);
      const treeVersion = value.treeVersion || "";
      const explicitClusterVersion = optionalNumberAttribute(value.clusterHashFormatVersion);
      const clusterHashFormatVersion = explicitClusterVersion
        ?? (value.nodes != null ? 1 : 2);
      if (index === activeSpec - 1) {
        for (const [nodeId, itemId] of Object.entries(sockets)) {
          if (!itemSlots.has(Number(itemId))) itemSlots.set(Number(itemId), `Jewel ${nodeId}`);
        }
      }
      return {
        id: `spec-${index}-${value.title || "default"}`,
        title: value.title || `Tree ${index + 1}`,
        treeVersion,
        classId: Number(value.classId) || 0,
        ascendClassId: Number(value.ascendClassId) || 0,
        secondaryAscendClassId: Number(value.secondaryAscendClassId) || 0,
        nodes: numberList(value.nodes),
        masteryEffects: masteryMap(value.masteryEffects),
        ...(clusterHashFormatVersion != null ? { clusterHashFormatVersion } : {}),
        ...(Object.keys(unknownAttributes).length ? { unknownAttributes } : {}),
        ...(unknownChildren.length ? { unknownChildren } : {}),
        sockets,
        skillOverrides,
      };
    },
  );
  if (!isPoe1PobVersion(build.targetVersion)
    || specs.some((spec) => !isPoe1PobVersion(spec.treeVersion))) {
    throw new Error("This build does not target Path of Exile 1.");
  }
  const items: ImportedPobItem[] = Array.from(
    (itemsSection?.[2] || "").matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/gi),
    (match, index) => {
      const value = attributes(match[1]);
      const text = itemRawText(match[2]);
      const id = Number(value.id) || index + 1;
      const slot = itemSlots.get(id) || "";
      const xmlChildren = safeItemXmlChildren(match[2]);
      return { id, text, slot, equipped: Boolean(slot), ...itemIdentityFromPobText(text), ...(xmlChildren.length ? { xmlChildren } : {}) };
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
          skillPart: optionalNumberAttribute(attrs.skillPart),
          skillPartCalcs: optionalNumberAttribute(attrs.skillPartCalcs),
          skillStageCount: optionalNumberAttribute(attrs.skillStageCount),
          skillStageCountCalcs: optionalNumberAttribute(attrs.skillStageCountCalcs),
          skillMineCount: optionalNumberAttribute(attrs.skillMineCount),
          skillMineCountCalcs: optionalNumberAttribute(attrs.skillMineCountCalcs),
          skillMinion: attrs.skillMinion || undefined,
          skillMinionCalcs: attrs.skillMinionCalcs || undefined,
          skillMinionItemSet: optionalNumberAttribute(attrs.skillMinionItemSet),
          skillMinionItemSetCalcs: optionalNumberAttribute(attrs.skillMinionItemSetCalcs),
          skillMinionSkill: optionalNumberAttribute(attrs.skillMinionSkill),
          skillMinionSkillCalcs: optionalNumberAttribute(attrs.skillMinionSkillCalcs),
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
      clusterHashFormatVersion: 2,
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
    itemSets,
    skillGroups,
    config,
    playerStats,
    statSource: playerStats.length ? "pob-snapshot" : "none",
    notes,
  };
}

function passiveJewelSlot(slot: string) {
  return /^Jewel \d+$/i.test(slot) || /Abyssal Socket/i.test(slot);
}

export function withActivePobItemSet(build: ImportedPobBuild, itemSetId: number) {
  const itemSet = build.itemSets.find((entry) => entry.id === itemSetId) || build.itemSets[0];
  if (!itemSet) return build;
  const slotByItem = new Map<number, string>();
  for (const [slot, value] of Object.entries(itemSet.slots)) {
    if (value.itemId > 0 && !slotByItem.has(value.itemId)) slotByItem.set(value.itemId, slot);
  }
  return {
    ...build,
    activeItemSet: itemSet.id,
    items: build.items.map((item) => {
      if (passiveJewelSlot(item.slot)) return item;
      const slot = slotByItem.get(item.id) || "";
      return { ...item, slot, equipped: Boolean(slot) };
    }),
  };
}

export function withPobItemEquipped(build: ImportedPobBuild, itemId: number, slotName: string) {
  const targetSet = build.itemSets.find((entry) => entry.id === build.activeItemSet) || build.itemSets[0];
  if (!targetSet) return build;
  const normalizedSlot = slotName.trim().slice(0, 160);
  const slots = Object.fromEntries(Object.entries(targetSet.slots).map(([name, slot]) => [name, slot.itemId === itemId ? { ...slot, itemId: 0 } : slot]));
  if (normalizedSlot) slots[normalizedSlot] = { ...(slots[normalizedSlot] || {}), itemId };
  const itemSets = build.itemSets.map((itemSet) => itemSet.id === targetSet.id ? { ...itemSet, slots } : itemSet);
  return withActivePobItemSet({ ...build, itemSets }, targetSet.id);
}

export function withPobItemText(item: ImportedPobItem, text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  return {
    ...item,
    text: normalized,
    ...itemIdentityFromPobText(normalized),
    xmlChildren: [],
  };
}

export function withoutPobItem(build: ImportedPobBuild, itemId: number) {
  const itemSets = build.itemSets.map((itemSet) => ({
    ...itemSet,
    slots: Object.fromEntries(Object.entries(itemSet.slots).map(([name, slot]) => [name, slot.itemId === itemId ? { ...slot, itemId: 0 } : slot])),
  }));
  const specs = build.specs.map((spec) => ({
    ...spec,
    sockets: Object.fromEntries(Object.entries(spec.sockets || {}).filter(([, socketItemId]) => socketItemId !== itemId)),
  }));
  return withActivePobItemSet({ ...build, itemSets, specs, items: build.items.filter((item) => item.id !== itemId) }, build.activeItemSet);
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
  return `${indent}<Gem nameSpec="${escapeXmlAttribute(gem.name)}" skillId="${escapeXmlAttribute(gem.skillId)}"${optionalXmlAttribute("gemId", gem.gemId)}${optionalXmlAttribute("variantId", gem.variantId)} level="${gem.level}" quality="${gem.quality}" enabled="${gem.enabled}"${optionalXmlAttribute("enableGlobal1", gem.enableGlobal1)}${optionalXmlAttribute("enableGlobal2", gem.enableGlobal2)}${optionalXmlAttribute("count", gem.count)}${optionalXmlAttribute("skillPart", gem.skillPart)}${optionalXmlAttribute("skillPartCalcs", gem.skillPartCalcs)}${optionalXmlAttribute("skillStageCount", gem.skillStageCount)}${optionalXmlAttribute("skillStageCountCalcs", gem.skillStageCountCalcs)}${optionalXmlAttribute("skillMineCount", gem.skillMineCount)}${optionalXmlAttribute("skillMineCountCalcs", gem.skillMineCountCalcs)}${optionalXmlAttribute("skillMinion", gem.skillMinion)}${optionalXmlAttribute("skillMinionCalcs", gem.skillMinionCalcs)}${optionalXmlAttribute("skillMinionItemSet", gem.skillMinionItemSet)}${optionalXmlAttribute("skillMinionItemSetCalcs", gem.skillMinionItemSetCalcs)}${optionalXmlAttribute("skillMinionSkill", gem.skillMinionSkill)}${optionalXmlAttribute("skillMinionSkillCalcs", gem.skillMinionSkillCalcs)}/>`;
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
  if (gem.skillPart !== undefined) patch.skillPart = gem.skillPart;
  if (gem.skillPartCalcs !== undefined) patch.skillPartCalcs = gem.skillPartCalcs;
  if (gem.skillStageCount !== undefined) patch.skillStageCount = gem.skillStageCount;
  if (gem.skillStageCountCalcs !== undefined) patch.skillStageCountCalcs = gem.skillStageCountCalcs;
  if (gem.skillMineCount !== undefined) patch.skillMineCount = gem.skillMineCount;
  if (gem.skillMineCountCalcs !== undefined) patch.skillMineCountCalcs = gem.skillMineCountCalcs;
  if (gem.skillMinion !== undefined) patch.skillMinion = gem.skillMinion;
  if (gem.skillMinionCalcs !== undefined) patch.skillMinionCalcs = gem.skillMinionCalcs;
  if (gem.skillMinionItemSet !== undefined) patch.skillMinionItemSet = gem.skillMinionItemSet;
  if (gem.skillMinionItemSetCalcs !== undefined) patch.skillMinionItemSetCalcs = gem.skillMinionItemSetCalcs;
  if (gem.skillMinionSkill !== undefined) patch.skillMinionSkill = gem.skillMinionSkill;
  if (gem.skillMinionSkillCalcs !== undefined) patch.skillMinionSkillCalcs = gem.skillMinionSkillCalcs;
  const selectorAttributes = [
    "skillPart", "skillPartCalcs", "skillStageCount", "skillStageCountCalcs",
    "skillMineCount", "skillMineCountCalcs", "skillMinion", "skillMinionCalcs",
    "skillMinionItemSet", "skillMinionItemSetCalcs", "skillMinionSkill", "skillMinionSkillCalcs",
  ] as const;
  const updatedOpening = removeXmlAttributes(
    updateXmlAttributes(opening, patch),
    selectorAttributes.filter((name) => gem[name] === undefined),
  );
  return block.replace(opening, updatedOpening);
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
    return gem ? patchGemBlock(gemBlock, gem) : "";
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
    return group ? patchSkillBlock(block, group) : "";
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

function itemElement(item: ImportedPobItem, indent = "\t\t") {
  const children = (item.xmlChildren || []).filter((child) => /^<ModRange\b[^>]*\/\s*>$/i.test(child.trim()));
  const suffix = children.length ? `\n${children.map((child) => `${indent}\t${child.trim()}`).join("\n")}\n${indent}` : "";
  return `${indent}<Item id="${item.id}">${escapeXmlText(item.text)}${suffix}</Item>`;
}

function patchItemBlock(block: string, item: ImportedPobItem) {
  const originalOpening = elementOpening(block, "Item");
  const opening = updateXmlAttributes(originalOpening, { id: item.id });
  const originalChildren = safeItemXmlChildren(elementBody(block, "Item"));
  const children = (item.xmlChildren ?? originalChildren).filter((child) => /^<ModRange\b[^>]*\/\s*>$/i.test(child.trim()));
  const body = `${escapeXmlText(item.text)}${children.length ? `\n${children.map((child) => `\t\t\t${child.trim()}`).join("\n")}\n\t\t` : ""}`;
  return pairedElement(opening, body, "Item");
}

function effectiveItemSets(build: ImportedPobBuild) {
  const fallback = [{
    id: Math.max(1, Number(build.activeItemSet) || 1),
    title: "Default",
    useSecondWeaponSet: false,
    slots: Object.fromEntries(Array.from(desiredEquipmentSlots(build), ([name, itemId]) => [name, { itemId }])),
  }] satisfies ImportedPobItemSet[];
  const itemSets = build.itemSets.length ? build.itemSets : fallback;
  const desired = desiredEquipmentSlots(build);
  return itemSets.map((itemSet) => {
    if (itemSet.id !== build.activeItemSet) return itemSet;
    const slots = Object.fromEntries(Object.entries(itemSet.slots).map(([name, slot]) => [name, { ...slot, itemId: desired.get(name) || 0 }]));
    for (const [name, itemId] of desired) slots[name] = { ...(slots[name] || {}), itemId };
    return { ...itemSet, slots };
  });
}

function patchItemSetBody(body: string, itemSet: ImportedPobItemSet, validItemIds: ReadonlySet<number>) {
  const desired = new Map(Object.entries(itemSet.slots).map(([name, slot]) => [name, {
    ...slot,
    itemId: validItemIds.has(slot.itemId) ? slot.itemId : 0,
  }]));
  const seen = new Set<string>();
  let output = body.replace(/<Slot\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Slot\s*>)/gi, (block) => {
    const opening = elementOpening(block, "Slot");
    const name = attributes(opening).name;
    if (!name) return block;
    const slot = desired.get(name);
    if (!slot || slot.itemId <= 0 || seen.has(name)) return "";
    seen.add(name);
    let updated = updateXmlAttributes(opening, { name, itemId: slot.itemId });
    if (slot.active !== undefined) updated = updateXmlAttributes(updated, { active: slot.active });
    else updated = removeXmlAttributes(updated, ["active"]);
    if (slot.itemPbUrl) updated = updateXmlAttributes(updated, { itemPbURL: slot.itemPbUrl });
    else updated = removeXmlAttributes(updated, ["itemPbURL"]);
    return block.replace(opening, updated);
  });
  output = appendXmlChildren(output, Array.from(desired)
    .filter(([name, slot]) => slot.itemId > 0 && !seen.has(name))
    .map(([name, slot]) => `\t\t\t<Slot name="${escapeXmlAttribute(name)}" itemId="${slot.itemId}"${optionalXmlAttribute("itemPbURL", slot.itemPbUrl)}${optionalXmlAttribute("active", slot.active)}/>`));
  return output;
}

function itemSetElement(itemSet: ImportedPobItemSet, validItemIds: ReadonlySet<number>, indent = "\t\t") {
  const slots = Object.entries(itemSet.slots).filter(([, slot]) => slot.itemId > 0).map(([name, rawSlot]) => {
    const slot = { ...rawSlot, itemId: validItemIds.has(rawSlot.itemId) ? rawSlot.itemId : 0 };
    return `${indent}\t<Slot name="${escapeXmlAttribute(name)}" itemId="${slot.itemId}"${optionalXmlAttribute("itemPbURL", slot.itemPbUrl)}${optionalXmlAttribute("active", slot.active)}/>`;
  }).join("\n");
  return `${indent}<ItemSet id="${itemSet.id}" title="${escapeXmlAttribute(itemSet.title)}" useSecondWeaponSet="${itemSet.useSecondWeaponSet}">${slots ? `\n${slots}\n${indent}` : ""}</ItemSet>`;
}

function patchItemsSection(section: string, build: ImportedPobBuild) {
  const originalOpening = elementOpening(section, "Items");
  const outer = attributes(originalOpening);
  const itemSets = effectiveItemSets(build);
  const activeId = itemSets.some((itemSet) => itemSet.id === build.activeItemSet)
    ? build.activeItemSet
    : itemSets[0]?.id || Math.max(1, Number(outer.activeItemSet) || 1);
  const opening = updateXmlAttributes(originalOpening, { activeItemSet: activeId });
  let body = elementBody(section, "Items");
  const itemsById = new Map(build.items.map((item) => [item.id, item]));
  const seenItems = new Set<number>();
  body = body.replace(/<Item\b[^>]*(?:\/\s*>|>[\s\S]*?<\/Item\s*>)/gi, (block) => {
    const id = Number(attributes(elementOpening(block, "Item")).id);
    const item = itemsById.get(id);
    if (!item || seenItems.has(id)) return "";
    seenItems.add(id);
    return patchItemBlock(block, item);
  });
  body = appendXmlChildren(body, build.items.filter((item) => !seenItems.has(item.id)).map((item) => itemElement(item)));

  const validItemIds = new Set(build.items.map((item) => item.id));
  const setsById = new Map(itemSets.map((itemSet) => [itemSet.id, itemSet]));
  const seenSets = new Set<number>();
  body = body.replace(/<ItemSet\b[^>]*(?:\/\s*>|>[\s\S]*?<\/ItemSet\s*>)/gi, (block) => {
    const id = Number(attributes(elementOpening(block, "ItemSet")).id);
    const itemSet = setsById.get(id);
    if (!itemSet || seenSets.has(id)) return "";
    seenSets.add(id);
    const originalSetOpening = elementOpening(block, "ItemSet");
    let setOpening = updateXmlAttributes(originalSetOpening, {
      id: itemSet.id,
      title: itemSet.title,
    });
    if (itemSet.useSecondWeaponSet || /\suseSecondWeaponSet\s*=/i.test(originalSetOpening)) {
      setOpening = updateXmlAttributes(setOpening, { useSecondWeaponSet: itemSet.useSecondWeaponSet });
    }
    const setBody = patchItemSetBody(elementBody(block, "ItemSet"), itemSet, validItemIds);
    return pairedElement(setOpening, setBody, "ItemSet");
  });
  body = appendXmlChildren(body, itemSets.filter((itemSet) => !seenSets.has(itemSet.id)).map((itemSet) => itemSetElement(itemSet, validItemIds)));
  return pairedElement(opening, body, "Items");
}

function serializeItems(build: ImportedPobBuild) {
  const items = build.items.map((item) => itemElement(item)).join("\n");
  const validItemIds = new Set(build.items.map((item) => item.id));
  const itemSets = effectiveItemSets(build);
  const activeId = itemSets.some((itemSet) => itemSet.id === build.activeItemSet) ? build.activeItemSet : itemSets[0]?.id || 1;
  const sets = itemSets.map((itemSet) => itemSetElement(itemSet, validItemIds)).join("\n");
  return `<Items activeItemSet="${activeId}">${items ? `\n${items}` : ""}${sets ? `\n${sets}` : ""}\n\t</Items>`;
}

function specAttributePatch(spec: ImportedPassiveSpec) {
  const patch: Record<string, unknown> = {
    title: spec.title,
    treeVersion: spec.treeVersion,
    classId: spec.classId,
    ascendClassId: spec.ascendClassId,
    secondaryAscendClassId: spec.secondaryAscendClassId,
    nodes: spec.nodes.join(","),
    masteryEffects: Object.entries(spec.masteryEffects).map(([node, effect]) => `{${node},${effect}}`).join(","),
  };
  if (spec.clusterHashFormatVersion !== undefined) patch.clusterHashFormatVersion = spec.clusterHashFormatVersion;
  return patch;
}

function serializedSpecOpening(spec: ImportedPassiveSpec) {
  const attributes = {
    ...(spec.unknownAttributes || {}),
    ...specAttributePatch(spec),
  };
  const serialized = Object.entries(attributes)
    .filter(([name]) => /^[\w:.-]+$/.test(name))
    .map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`)
    .join(" ");
  return `\t\t<Spec ${serialized}`;
}

function safeUnknownSpecChildren(spec: ImportedPassiveSpec) {
  return (spec.unknownChildren || []).filter((child) => (
    /^<([:\w.-]+)\b[^>]*(?:\/\s*>|>[\s\S]*<\/\1\s*>)$/i.test(child.trim())
    && !/^<(?:Sockets|Overrides)\b/i.test(child.trim())
  ));
}

function serializeTree(specs: ImportedPassiveSpec[], activeSpecId: string) {
  const activeIndex = Math.max(0, specs.findIndex((spec) => spec.id === activeSpecId));
  const rows = specs.map((spec) => {
    const opening = serializedSpecOpening(spec);
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
      ...safeUnknownSpecChildren(spec).map((child) => `\t\t\t${child.trim().replace(/\n/g, "\n\t\t\t")}`),
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
    const structured = patchSpecSockets(block, spec.sockets || {});
    return structured.replace(/^<Spec\b[^>]*\/?>/i, (opening) => updateXmlAttributes(opening, specAttributePatch(spec)));
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
    itemSets: [{ id: 1, title: "Default", useSecondWeaponSet: false, slots: {} }],
    skillGroups: [],
    config: {},
    playerStats: [],
    statSource: "none",
    notes: "",
  };
}

function serializedCurrentPobBuild(build: ImportedPobBuild) {
  const activeSpec = build.specs[Math.max(0, Math.min(build.specs.length - 1, build.activeSpec - 1))]
    || build.specs[0];
  return serializePobXml(build, build.specs, activeSpec?.id || "");
}

function restoreLocalPlannerPresentation(next: ImportedPobBuild, previous: ImportedPobBuild) {
  const itemPresentation = new Map(previous.items.map((item) => [item.id, item]));
  const gemPresentation = new Map(previous.skillGroups.flatMap((group) => group.gems.map((gem) => [importedPobGemArtworkKey(gem), gem] as const)));
  const preserveActiveSkills = next.activeSkillSet === previous.activeSkillSet;
  return {
    ...next,
    items: next.items.map((item) => {
      const prior = itemPresentation.get(item.id);
      return prior ? {
        ...item,
        ...(prior.icon ? { icon: prior.icon } : {}),
        ...(prior.width ? { width: prior.width } : {}),
        ...(prior.height ? { height: prior.height } : {}),
      } : item;
    }),
    skillGroups: next.skillGroups.map((group, groupIndex) => ({
      ...group,
      ...(preserveActiveSkills && previous.skillGroups[groupIndex]?.activeSkills
        ? { activeSkills: previous.skillGroups[groupIndex].activeSkills }
        : {}),
      gems: group.gems.map((gem) => {
        const prior = gemPresentation.get(importedPobGemArtworkKey(gem));
        return prior ? {
          ...gem,
          ...(prior.icon ? { icon: prior.icon } : {}),
          ...(typeof prior.support === "boolean" ? { support: prior.support } : {}),
        } : gem;
      }),
    })),
  };
}

function pobSection(xml: string, sectionTag: "Skills" | "Config") {
  return new RegExp(`<${sectionTag}\\b[^>]*(?:\\/\\s*>|>[\\s\\S]*?<\\/${sectionTag}\\s*>)`, "i").exec(xml)?.[0];
}

function pobSetSummaries(
  build: ImportedPobBuild,
  sectionTag: "Skills" | "Config",
  setTag: "SkillSet" | "ConfigSet",
  childTag: "Skill" | "Input",
) {
  const xml = serializedCurrentPobBuild(build);
  const section = pobSection(xml, sectionTag);
  if (!section) return [];
  const activeAttribute = sectionTag === "Skills" ? "activeSkillSet" : "activeConfigSet";
  const activeId = Math.max(1, Number(attributes(elementOpening(section, sectionTag))[activeAttribute]) || 1);
  return elementBlocks(elementBody(section, sectionTag), setTag).flatMap((match, index) => {
    const block = match[0];
    const attrs = attributes(elementOpening(block, setTag));
    const id = Math.max(1, Number(attrs.id) || index + 1);
    return [{
      id,
      title: attrs.title || `${setTag === "SkillSet" ? "Skill set" : "Config set"} ${index + 1}`,
      entryCount: elementBlocks(elementBody(block, setTag), childTag).length,
      active: id === activeId,
    }];
  });
}

export function pobSkillSetSummaries(build: ImportedPobBuild) {
  return pobSetSummaries(build, "Skills", "SkillSet", "Skill");
}

export function pobConfigSetSummaries(build: ImportedPobBuild) {
  return pobSetSummaries(build, "Config", "ConfigSet", "Input");
}

function mutatePobSet(
  build: ImportedPobBuild,
  sectionTag: "Skills" | "Config",
  setTag: "SkillSet" | "ConfigSet",
  activeAttribute: "activeSkillSet" | "activeConfigSet",
  mutate: (body: string, sets: RegExpMatchArray[]) => { body: string; activeId: number } | null,
) {
  const xml = serializedCurrentPobBuild(build);
  const section = pobSection(xml, sectionTag);
  if (!section) return build;
  const originalOpening = elementOpening(section, sectionTag);
  const originalBody = elementBody(section, sectionTag);
  const result = mutate(originalBody, elementBlocks(originalBody, setTag));
  if (!result) return build;
  const opening = updateXmlAttributes(originalOpening, { [activeAttribute]: result.activeId });
  const updatedXml = xml.replace(section, pairedElement(opening, result.body, sectionTag));
  return restoreLocalPlannerPresentation(parsePobXml(updatedXml), build);
}

function switchPobSet(
  build: ImportedPobBuild,
  sectionTag: "Skills" | "Config",
  setTag: "SkillSet" | "ConfigSet",
  activeAttribute: "activeSkillSet" | "activeConfigSet",
  setId: number,
) {
  return mutatePobSet(build, sectionTag, setTag, activeAttribute, (body, sets) => {
    const target = sets.find((match) => Number(attributes(elementOpening(match[0], setTag)).id) === setId);
    return target ? { body, activeId: setId } : null;
  });
}

export function withActivePobSkillSet(build: ImportedPobBuild, setId: number) {
  return switchPobSet(build, "Skills", "SkillSet", "activeSkillSet", setId);
}

export function withActivePobConfigSet(build: ImportedPobBuild, setId: number) {
  return switchPobSet(build, "Config", "ConfigSet", "activeConfigSet", setId);
}

function addPobSet(
  build: ImportedPobBuild,
  sectionTag: "Skills" | "Config",
  setTag: "SkillSet" | "ConfigSet",
  activeAttribute: "activeSkillSet" | "activeConfigSet",
  duplicate: boolean,
) {
  return mutatePobSet(build, sectionTag, setTag, activeAttribute, (body, sets) => {
    const ids = sets.map((match) => Number(attributes(elementOpening(match[0], setTag)).id) || 0);
    const id = Math.max(0, ...ids) + 1;
    const activeId = activeAttribute === "activeSkillSet" ? build.activeSkillSet : Number(attributes(elementOpening(pobSection(serializedCurrentPobBuild(build), sectionTag) || "", sectionTag))[activeAttribute]) || 1;
    const active = sets.find((match) => Number(attributes(elementOpening(match[0], setTag)).id) === activeId) || sets[0];
    const title = `${setTag === "SkillSet" ? "Skill set" : "Config set"} ${sets.length + 1}${duplicate ? " copy" : ""}`;
    let block = `<${setTag} id="${id}" title="${escapeXmlAttribute(title)}"></${setTag}>`;
    if (duplicate && active) {
      const source = active[0];
      const sourceOpening = elementOpening(source, setTag);
      block = source.replace(sourceOpening, updateXmlAttributes(sourceOpening, { id, title }));
    }
    return { body: appendXmlChildren(body, [`\t\t${block}`]), activeId: id };
  });
}

export function addPobSkillSet(build: ImportedPobBuild, duplicate = false) {
  return addPobSet(build, "Skills", "SkillSet", "activeSkillSet", duplicate);
}

export function addPobConfigSet(build: ImportedPobBuild, duplicate = false) {
  return addPobSet(build, "Config", "ConfigSet", "activeConfigSet", duplicate);
}

function removePobSet(
  build: ImportedPobBuild,
  sectionTag: "Skills" | "Config",
  setTag: "SkillSet" | "ConfigSet",
  activeAttribute: "activeSkillSet" | "activeConfigSet",
  setId: number,
) {
  return mutatePobSet(build, sectionTag, setTag, activeAttribute, (body, sets) => {
    if (sets.length <= 1) return null;
    const target = sets.find((match) => Number(attributes(elementOpening(match[0], setTag)).id) === setId);
    if (!target || target.index == null) return null;
    const nextBody = `${body.slice(0, target.index)}${body.slice(target.index + target[0].length)}`;
    const remaining = sets.filter((match) => match !== target);
    const activeId = Number(attributes(elementOpening(remaining[0][0], setTag)).id) || 1;
    return { body: nextBody, activeId };
  });
}

export function withoutPobSkillSet(build: ImportedPobBuild, setId = build.activeSkillSet) {
  return removePobSet(build, "Skills", "SkillSet", "activeSkillSet", setId);
}

export function withoutPobConfigSet(build: ImportedPobBuild, setId: number) {
  return removePobSet(build, "Config", "ConfigSet", "activeConfigSet", setId);
}

function renamePobSet(
  build: ImportedPobBuild,
  sectionTag: "Skills" | "Config",
  setTag: "SkillSet" | "ConfigSet",
  activeAttribute: "activeSkillSet" | "activeConfigSet",
  setId: number,
  title: string,
) {
  const safeTitle = title.trim().slice(0, 160) || (setTag === "SkillSet" ? "Skill set" : "Config set");
  return mutatePobSet(build, sectionTag, setTag, activeAttribute, (body, sets) => {
    const target = sets.find((match) => Number(attributes(elementOpening(match[0], setTag)).id) === setId);
    if (!target || target.index == null) return null;
    const block = target[0];
    const opening = elementOpening(block, setTag);
    const renamed = block.replace(opening, updateXmlAttributes(opening, { title: safeTitle }));
    return {
      body: `${body.slice(0, target.index)}${renamed}${body.slice(target.index + block.length)}`,
      activeId: setId,
    };
  });
}

export function withPobSkillSetTitle(build: ImportedPobBuild, setId: number, title: string) {
  return renamePobSet(build, "Skills", "SkillSet", "activeSkillSet", setId, title);
}

export function withPobConfigSetTitle(build: ImportedPobBuild, setId: number, title: string) {
  return renamePobSet(build, "Config", "ConfigSet", "activeConfigSet", setId, title);
}

export function pobCustomModifierBlocks(build: ImportedPobBuild): PobCustomModifierBlock[] {
  const xml = serializedCurrentPobBuild(build);
  const section = pobSection(xml, "Config");
  if (!section) return [];
  const set = elementBlocks(elementBody(section, "Config"), "ConfigSet")
    .find((match) => Number(attributes(elementOpening(match[0], "ConfigSet")).id) === Number(attributes(elementOpening(section, "Config")).activeConfigSet));
  if (!set) return [];
  return elementBlocks(elementBody(set[0], "ConfigSet"), "CustomModifierBlock").map((match, index) => {
    const attrs = attributes(elementOpening(match[0], "CustomModifierBlock"));
    return {
      title: attrs.title || `Group ${index + 1}`,
      enabled: attrs.enabled !== "false",
      text: decodeXml(elementBody(match[0], "CustomModifierBlock")),
    };
  });
}

export function withPobCustomModifierBlocks(build: ImportedPobBuild, blocks: PobCustomModifierBlock[]) {
  return mutatePobSet(build, "Config", "ConfigSet", "activeConfigSet", (body, sets) => {
    const activeId = Number(attributes(elementOpening(pobSection(serializedCurrentPobBuild(build), "Config") || "", "Config")).activeConfigSet) || 1;
    const target = sets.find((match) => Number(attributes(elementOpening(match[0], "ConfigSet")).id) === activeId);
    if (!target || target.index == null) return null;
    const block = target[0];
    const opening = elementOpening(block, "ConfigSet");
    let setBody = elementBody(block, "ConfigSet").replace(/<CustomModifierBlock\b[^>]*(?:\/\s*>|>[\s\S]*?<\/CustomModifierBlock\s*>)/gi, "");
    setBody = appendXmlChildren(setBody, blocks.slice(0, 64).map((entry) => `\t\t\t<CustomModifierBlock title="${escapeXmlAttribute(entry.title.slice(0, 160) || "Default")}" enabled="${entry.enabled}">${escapeXmlText(entry.text.slice(0, 65_536))}</CustomModifierBlock>`));
    const updated = pairedElement(opening, setBody, "ConfigSet");
    return {
      body: `${body.slice(0, target.index)}${updated}${body.slice(target.index + block.length)}`,
      activeId,
    };
  });
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

function stringRecord(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, rawValue]) => (
    /^[\w:.-]+$/.test(key) && !KNOWN_SPEC_ATTRIBUTES.has(key) && !/InternalId$/i.test(key) && typeof rawValue === "string"
      ? [[key, rawValue.slice(0, 4_096)]]
      : []
  )));
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
    const treeVersion = typeof spec.treeVersion === "string" ? spec.treeVersion.slice(0, 40) : "";
    const clusterHashFormatVersion = finiteInteger(spec.clusterHashFormatVersion, -1);
    const unknownAttributes = stringRecord(spec.unknownAttributes);
    const unknownChildren = Array.isArray(spec.unknownChildren)
      ? spec.unknownChildren.filter((child): child is string => (
          typeof child === "string"
          && child.length <= 65_536
          && /^<([:\w.-]+)\b[^>]*(?:\/\s*>|>[\s\S]*<\/\1\s*>)$/i.test(child.trim())
          && !/^<(?:Sockets|Overrides)\b/i.test(child.trim())
        )).slice(0, 64)
      : undefined;
    return [{
      id: typeof spec.id === "string" && spec.id.trim() ? spec.id.slice(0, 160) : `spec-${index + 1}`,
      title: typeof spec.title === "string" && spec.title.trim() ? spec.title.slice(0, 160) : `Tree ${index + 1}`,
      treeVersion,
      classId: finiteInteger(spec.classId),
      ascendClassId: finiteInteger(spec.ascendClassId),
      secondaryAscendClassId: finiteInteger(spec.secondaryAscendClassId),
      nodes,
      masteryEffects: numericRecord(spec.masteryEffects),
      ...(clusterHashFormatVersion >= 1
        ? { clusterHashFormatVersion }
        : { clusterHashFormatVersion: 2 }),
      ...(Object.keys(unknownAttributes).length ? { unknownAttributes } : {}),
      ...(unknownChildren?.length ? { unknownChildren } : {}),
      sockets: numericRecord(spec.sockets),
      ...(extendedHashes ? { extendedHashes } : {}),
      ...(spec.skillOverrides && typeof spec.skillOverrides === "object" ? { skillOverrides: objectRecord(spec.skillOverrides) } : {}),
      ...(spec.jewelData && typeof spec.jewelData === "object" ? { jewelData: objectRecord(spec.jewelData) } : {}),
    }];
  });
}

/** Backfills and validates workspaces written by earlier planner releases. */
export function normalizeImportedPobBuild(value: Partial<ImportedPobBuild> | null | undefined) {
  if (!value || typeof value !== "object") return null;
  const source = record(value);
  const className = typeof source.className === "string" && source.className.trim() ? source.className : "Scion";
  const sourceXml = typeof source.xml === "string" ? source.xml : "";
  let xmlBuild: ImportedPobBuild | null = null;
  if (sourceXml.trim()) {
    try {
      xmlBuild = parsePobXml(sourceXml);
    } catch {
      return null;
    }
  }
  if (!isPoe1PobVersion(source.targetVersion)) return null;
  const fallback = emptyPobBuild(className);
  const items = Array.isArray(source.items) ? source.items.flatMap((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object") return [];
    const item = record(rawItem);
    const itemText = typeof item.text === "string" ? item.text : "";
    const identity = itemIdentityFromPobText(itemText);
    const slot = typeof item.slot === "string" ? item.slot : "";
    return [{
      id: Math.max(1, finiteInteger(item.id, index + 1)),
      text: itemText,
      name: typeof item.name === "string" && item.name.trim() ? item.name : identity.name,
      baseType: typeof item.baseType === "string" && item.baseType.trim() ? item.baseType : identity.baseType,
      slot,
      equipped: typeof item.equipped === "boolean" ? item.equipped : Boolean(slot),
      ...(trustedPoeIconUrl(item.icon) ? { icon: trustedPoeIconUrl(item.icon) } : {}),
      ...(inventoryDimension(item.width, 4) ? { width: inventoryDimension(item.width, 4) } : {}),
      ...(inventoryDimension(item.height, 6) ? { height: inventoryDimension(item.height, 6) } : {}),
      ...(Array.isArray(item.xmlChildren) ? { xmlChildren: item.xmlChildren.filter((child): child is string => typeof child === "string" && /^<ModRange\b[^>]*\/\s*>$/i.test(child.trim())).slice(0, 256) } : {}),
    }];
  }) : [];
  const itemIds = new Set(items.map((item) => item.id));
  const itemSets = Array.isArray(source.itemSets) ? source.itemSets.flatMap((rawSet, setIndex) => {
    if (!rawSet || typeof rawSet !== "object") return [];
    const itemSet = record(rawSet);
    const slots = Object.fromEntries(Object.entries(record(itemSet.slots)).flatMap(([name, rawSlot]) => {
      if (!name || !rawSlot || typeof rawSlot !== "object") return [];
      const slot = record(rawSlot);
      const itemId = Math.max(0, finiteInteger(slot.itemId));
      return [[name.slice(0, 160), {
        itemId: itemIds.has(itemId) ? itemId : 0,
        ...(typeof slot.active === "boolean" ? { active: slot.active } : {}),
        ...(typeof slot.itemPbUrl === "string" && slot.itemPbUrl.length <= 2_048 ? { itemPbUrl: slot.itemPbUrl } : {}),
      }]];
    }));
    return [{
      id: Math.max(1, finiteInteger(itemSet.id, setIndex + 1)),
      title: typeof itemSet.title === "string" && itemSet.title.trim() ? itemSet.title.slice(0, 160) : `Item set ${setIndex + 1}`,
      useSecondWeaponSet: itemSet.useSecondWeaponSet === true,
      slots,
    }];
  }) : [];
  if (!itemSets.length) {
    const activeItemSet = Math.max(1, finiteInteger(source.activeItemSet, 1));
    itemSets.push({
      id: activeItemSet,
      title: "Default",
      useSecondWeaponSet: false,
      slots: Object.fromEntries(items.filter((item) => item.equipped && item.slot && !/^Jewel \d+$/i.test(item.slot)).map((item) => [item.slot, { itemId: item.id }])),
    });
  }
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
        ...(Number.isFinite(Number(gem.skillPart)) ? { skillPart: Number(gem.skillPart) } : {}),
        ...(Number.isFinite(Number(gem.skillPartCalcs)) ? { skillPartCalcs: Number(gem.skillPartCalcs) } : {}),
        ...(Number.isFinite(Number(gem.skillStageCount)) ? { skillStageCount: Number(gem.skillStageCount) } : {}),
        ...(Number.isFinite(Number(gem.skillStageCountCalcs)) ? { skillStageCountCalcs: Number(gem.skillStageCountCalcs) } : {}),
        ...(Number.isFinite(Number(gem.skillMineCount)) ? { skillMineCount: Number(gem.skillMineCount) } : {}),
        ...(Number.isFinite(Number(gem.skillMineCountCalcs)) ? { skillMineCountCalcs: Number(gem.skillMineCountCalcs) } : {}),
        ...(typeof gem.skillMinion === "string" ? { skillMinion: gem.skillMinion } : {}),
        ...(typeof gem.skillMinionCalcs === "string" ? { skillMinionCalcs: gem.skillMinionCalcs } : {}),
        ...(Number.isFinite(Number(gem.skillMinionItemSet)) ? { skillMinionItemSet: Number(gem.skillMinionItemSet) } : {}),
        ...(Number.isFinite(Number(gem.skillMinionItemSetCalcs)) ? { skillMinionItemSetCalcs: Number(gem.skillMinionItemSetCalcs) } : {}),
        ...(Number.isFinite(Number(gem.skillMinionSkill)) ? { skillMinionSkill: Number(gem.skillMinionSkill) } : {}),
        ...(Number.isFinite(Number(gem.skillMinionSkillCalcs)) ? { skillMinionSkillCalcs: Number(gem.skillMinionSkillCalcs) } : {}),
        ...(trustedPoeIconUrl(gem.icon) ? { icon: trustedPoeIconUrl(gem.icon) } : {}),
        ...(typeof gem.support === "boolean" ? { support: gem.support } : {}),
      }];
    }) : [];
    const activeSkills = Array.isArray(group.activeSkills) ? group.activeSkills.flatMap((rawSkill, skillIndex) => {
      if (!rawSkill || typeof rawSkill !== "object") return [];
      const skill = record(rawSkill);
      const name = typeof skill.name === "string" ? skill.name.trim().slice(0, 200) : "";
      if (!name) return [];
      const parts = Array.isArray(skill.parts)
        ? skill.parts.filter((part): part is string => typeof part === "string" && Boolean(part.trim())).map((part) => part.slice(0, 200)).slice(0, 32)
        : undefined;
      const stages = skill.stages && typeof skill.stages === "object" ? record(skill.stages) : null;
      const stageMin = Math.max(1, finiteInteger(stages?.min, 1));
      const stageMax = Math.max(stageMin, finiteInteger(stages?.max, stageMin));
      const minions = Array.isArray(skill.minions) ? skill.minions.flatMap((rawMinion) => {
        if (!rawMinion || typeof rawMinion !== "object") return [];
        const minion = record(rawMinion);
        const label = typeof minion.label === "string" ? minion.label.trim().slice(0, 200) : "";
        if (!label) return [];
        return [{
          label,
          ...(typeof minion.minionId === "string" ? { minionId: minion.minionId.slice(0, 300) } : {}),
          ...(Number.isFinite(Number(minion.itemSetId)) ? { itemSetId: Number(minion.itemSetId) } : {}),
        }];
      }).slice(0, 128) : undefined;
      const minionSkills = Array.isArray(skill.minionSkills)
        ? skill.minionSkills.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.slice(0, 200)).slice(0, 128)
        : undefined;
      return [{
        index: Math.max(1, finiteInteger(skill.index, skillIndex + 1)),
        name,
        ...(parts?.length ? { parts } : {}),
        ...(Number.isFinite(Number(skill.sourceGemIndex)) ? { sourceGemIndex: Math.max(0, finiteInteger(skill.sourceGemIndex)) } : {}),
        ...(stages ? { stages: { min: stageMin, max: stageMax } } : {}),
        ...(typeof skill.mine === "boolean" ? { mine: skill.mine } : {}),
        ...(minions?.length ? { minions } : {}),
        ...(minionSkills?.length ? { minionSkills } : {}),
      }];
    }) : undefined;
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
      ...(activeSkills?.length ? { activeSkills } : {}),
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
  const statSource = source.statSource === "character-api"
    ? playerStats.length ? "pob-snapshot" : "none"
    : source.statSource === "pob-engine" || source.statSource === "pob-snapshot" || source.statSource === "none"
    ? source.statSource
    : playerStats.length ? "pob-snapshot" : "none";
  const rawSpecs = Array.isArray(source.specs) ? source.specs : [];
  const normalizedSpecs = normalizeImportedPassiveSpecs(rawSpecs);
  if (normalizedSpecs.some((spec) => !isPoe1PobVersion(spec.treeVersion))) return null;
  const specs = normalizedSpecs.length ? normalizedSpecs.map((spec, index) => {
    const rawSpec = record(rawSpecs[index]);
    const xmlSpec = xmlBuild?.specs[index];
    if (!xmlSpec) return spec;
    return {
      ...spec,
      ...(rawSpec.clusterHashFormatVersion === undefined && xmlSpec.clusterHashFormatVersion !== undefined
        ? { clusterHashFormatVersion: xmlSpec.clusterHashFormatVersion }
        : {}),
      ...(rawSpec.unknownAttributes === undefined && xmlSpec.unknownAttributes ? { unknownAttributes: xmlSpec.unknownAttributes } : {}),
      ...(rawSpec.unknownChildren === undefined && xmlSpec.unknownChildren ? { unknownChildren: xmlSpec.unknownChildren } : {}),
    };
  }) : xmlBuild?.specs || [];
  return {
    ...fallback,
    xml: sourceXml,
    level: Math.max(1, finiteInteger(source.level, 1)),
    className,
    ascendancyName: typeof source.ascendancyName === "string" ? source.ascendancyName : "",
    targetVersion: typeof source.targetVersion === "string" ? source.targetVersion : fallback.targetVersion,
    mainSocketGroup: Math.max(1, finiteInteger(source.mainSocketGroup, 1)),
    bandit: typeof source.bandit === "string" ? source.bandit : fallback.bandit,
    activeSpec: Math.max(1, finiteInteger(source.activeSpec, 1)),
    activeItemSet: Math.max(1, finiteInteger(source.activeItemSet, 1)),
    activeSkillSet: Math.max(1, finiteInteger(source.activeSkillSet, 1)),
    specs,
    items,
    itemSets,
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
