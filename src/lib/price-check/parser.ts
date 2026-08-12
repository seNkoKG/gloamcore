import type {
  ParsedPoeItem,
  ParsedPoeModifier,
  ParsedPoeSocketGroup,
  PoeItemRarity,
  PoeModifierKind,
} from "./types";
import {
  gemIdentityProfile,
  mapAreaTradeDiscriminator,
  pinnedCraftableItemCategory,
  resolveMagicBaseType,
} from "./magic-base-type";

const SECTION_SEPARATOR = /^-{8,}\s*$/;
const MAX_CLIPBOARD_LENGTH = 256 * 1024;

const PROPERTY_KEYS = new Set([
  "armour",
  "area level",
  "attacks per second",
  "chance to block",
  "chaos damage",
  "critical strike chance",
  "elemental damage",
  "energy shield",
  "evasion rating",
  "experience",
  "charge",
  "corpse level",
  "cost & reservation multiplier",
  "foil variation",
  "item quantity",
  "item rarity",
  "level",
  "links",
  "limited to",
  "mana cost",
  "map tier",
  "map area",
  "monster pack size",
  "physical damage",
  "quality",
  "radius",
  "requires",
  "size",
  "sockets",
  "stack size",
  "talisman tier",
  "weapon range",
  "ward",
  "width",
  "height",
  "heist target",
  "intangibility",
  "memory strands",
  "more currency",
  "more divination cards",
  "more maps",
  "more scarabs",
  "reward",
  "soul gain prevention",
  "souls per use",
  "wings revealed",
]);

const REQUIREMENT_KEYS = new Set([
  "level",
  "str",
  "dex",
  "int",
  "strength",
  "dexterity",
  "intelligence",
  "class",
]);

const FLAG_PATTERNS: Array<{
  key: keyof Pick<
    ParsedPoeItem,
    | "corrupted"
    | "mirrored"
    | "split"
    | "identified"
    | "fractured"
    | "synthesised"
    | "veiled"
    | "foil"
    | "foulborn"
    | "replica"
    | "scourged"
  >;
  pattern: RegExp;
  value?: boolean;
}> = [
  { key: "corrupted", pattern: /^corrupted$/i },
  { key: "corrupted", pattern: /^unmodifiable$/i },
  { key: "mirrored", pattern: /^(?:mirrored|mirrored item)$/i },
  { key: "split", pattern: /^(?:split|split item)$/i },
  { key: "identified", pattern: /^unidentified$/i, value: false },
  { key: "identified", pattern: /^identified$/i, value: true },
  { key: "fractured", pattern: /^fractured item$/i },
  { key: "synthesised", pattern: /^synthesi[sz]ed item$/i },
  { key: "veiled", pattern: /^(?:veiled|veiled item)$/i },
  { key: "foil", pattern: /^foil unique$/i },
  { key: "foulborn", pattern: /^foulborn item$/i },
  { key: "replica", pattern: /^replica item$/i },
  { key: "scourged", pattern: /^(?:scourged|scourged item)$/i },
];

const INFLUENCE_LINE = /^(shaper|elder|crusader|redeemer|hunter|warlord|searing exarch|eater of worlds)(?: influenced)? item$/i;
const INFLUENCE_VALUE = /^(shaper|elder|crusader|redeemer|hunter|warlord|searing exarch|eater of worlds)$/i;
const MODIFIER_SUFFIX = /\s+\((implicit|explicit|crafted|fractured|enchant(?:ed)?|scourge(?:d)?|crucible|rune|imbued|veiled)\)\s*$/i;
const ADVANCED_LINE = /^\{(.+)\}$/;
const ADVANCED_MAGNITUDE = /^(.+?)% Increased$/;
const UNSCALABLE_VALUE = " \u2014 Unscalable Value";

interface AdvancedModifierInfo {
  kind: PoeModifierKind;
  source?: string;
  generation?: ParsedPoeModifier["generation"];
  tier?: string;
  tags: string[];
  rollIncr?: number;
}

function createEmptyItem(rawText: string): ParsedPoeItem {
  return {
    rawText,
    language: "unknown",
    valid: false,
    itemClass: "",
    rarity: "unknown",
    name: "",
    baseType: "",
    sockets: [],
    influences: [],
    corrupted: false,
    mirrored: false,
    split: false,
    identified: true,
    fractured: false,
    synthesised: false,
    veiled: false,
    foil: false,
    foulborn: false,
    vestigial: false,
    replica: false,
    scourged: false,
    properties: {},
    requirements: {},
    modifiers: [],
    flavourText: [],
    reminderText: [],
    unknownSections: [],
    warnings: [],
    errors: [],
  };
}

function splitSections(text: string): string[][] {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "");
  const sections: string[][] = [[]];

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.replace(/[ \t]+$/g, "");
    if (SECTION_SEPARATOR.test(line)) {
      if (sections[sections.length - 1].length) sections.push([]);
    } else if (line.length || sections[sections.length - 1].length) {
      sections[sections.length - 1].push(line);
    }
  }

  return sections
    .map((section) => {
      let start = 0;
      let end = section.length;
      while (start < end && !section[start].trim()) start += 1;
      while (end > start && !section[end - 1].trim()) end -= 1;
      return section.slice(start, end);
    })
    .filter((section) => section.length > 0);
}

const CANNOT_USE_ITEM = "You cannot use this item. Its stats will be ignored";

function normalizeCannotUseItemSections(sections: string[][]) {
  if (
    sections.length < 2 ||
    sections[0][2]?.trim() !== CANNOT_USE_ITEM
  ) return sections;
  const nameplatePrefix = sections[0].slice(0, 2);
  return [
    [...nameplatePrefix, ...sections[1]],
    ...sections.slice(2),
  ];
}

function parseLabel(line: string): { label: string; value: string } | null {
  const match = /^([^:]{1,80}):\s*(.*)$/.exec(line.trim());
  if (!match) return null;
  const rawLabel = match[1].trim();
  // Current PoE clipboard text can wrap newer property names in its inline
  // localization form, for example `[Intangibility|Intangibility]: 8%`.
  // Treat the visible half as the label so a real item property never leaks
  // into the modifier list as an unsupported explicit stat.
  const localized = /^\[([^|\]]+)\|([^\]]+)\]$/.exec(rawLabel);
  const label = localized?.[2]?.trim() || localized?.[1]?.trim() || rawLabel;
  return { label, value: match[2].trim() };
}

function cleanValue(value: string): string {
  return value
    .replace(/\s+\((?:augmented|unmet|gem|implicit)\)\s*$/i, "")
    .trim();
}

function parseNumber(value: string): number | undefined {
  const match = /[-+]?\d[\d,]*(?:\.\d+)?/.exec(value);
  if (!match) return undefined;
  const result = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(result) ? result : undefined;
}

function putRecord(record: Record<string, string>, label: string, value: string): void {
  const previous = record[label];
  if (previous && previous !== value) record[label] = `${previous}\n${value}`;
  else record[label] = value;
}

function mapRarity(value: string, itemClass: string): PoeItemRarity {
  const normalized = value.trim().toLowerCase();
  if (normalized === "normal") return "normal";
  if (normalized === "magic") return "magic";
  if (normalized === "rare") return "rare";
  if (normalized === "unique") return "unique";
  if (normalized === "currency") return "currency";
  if (normalized === "gem") return "gem";
  if (normalized === "divination card") return "divination-card";

  const normalizedClass = itemClass.toLowerCase();
  if (normalizedClass.includes("currency")) return "currency";
  if (normalizedClass.includes("gem")) return "gem";
  if (normalizedClass.includes("divination card")) return "divination-card";
  return "unknown";
}

function normalizePinnedClipboardIdentity(item: ParsedPoeItem) {
  // Magic Flask and Tincture nameplates contain affixes but no second base
  // line. APT resolves that display name against its pinned ITEM catalog
  // before it chooses the Exact preset; retain the display name while making
  // the canonical base available to every downstream consumer immediately.
  if (
    item.rarity === "magic" &&
    /\b(?:flasks?|tinctures?)\b/i.test(item.itemClass)
  ) {
    const baseType = resolveMagicBaseType(item.name);
    if (baseType) item.baseType = baseType;
  }

  // Some game clipboard classes are deliberately broader/differently named
  // than APT's semantic category. Derive only these aliases from the pinned
  // craftable ITEM record, never from an individual item-name branch.
  const category = pinnedCraftableItemCategory(item.name, item.baseType);
  if (category === "Heist Blueprint") item.itemClass = "Heist Blueprints";
  else if (category === "Heist Contract") item.itemClass = "Heist Contracts";
  else if (category === "Invitation") item.itemClass = "Invitations";
  else if (/^captured beasts?$/i.test(item.itemClass.trim())) {
    item.itemClass = "Captured Beasts";
  }
}

function parseNameplate(section: string[], item: ParsedPoeItem): Set<number> {
  const consumed = new Set<number>();
  let rarityText = "";
  const names: string[] = [];

  section.forEach((line, index) => {
    const parsed = parseLabel(line);
    if (parsed?.label.toLowerCase() === "item class") {
      item.itemClass = parsed.value;
      item.language = "en";
      consumed.add(index);
    } else if (parsed?.label.toLowerCase() === "rarity") {
      rarityText = parsed.value;
      item.language = "en";
      consumed.add(index);
    } else if (/^you cannot use this item\b/i.test(line.trim())) {
      item.warnings.push("The copied item cannot currently be used by the character.");
      consumed.add(index);
    } else if (line.trim()) {
      names.push(line.trim());
      consumed.add(index);
    }
  });

  item.rarity = mapRarity(rarityText, item.itemClass);
  item.name = names[0] ?? "";
  if (names.length >= 2) item.baseType = names[1];
  else item.baseType = item.name;

  if (names.length > 2) {
    item.unknownSections.push(names.slice(2));
    item.warnings.push("Extra nameplate lines were preserved for review.");
  }

  if (item.rarity === "unique") {
    // Replica is part of the canonical unique name and must remain there.
    item.replica = /^replica\s+/i.test(item.name);
    // Foulborn is a display prefix; the query planner carries its state while
    // preserving the copied name for UI and local market matching.
    item.foulborn = /^foulborn\s+/i.test(item.name);
    // Vestigial prefixes the base type, not the unique name. Trade expects the
    // canonical base plus its dedicated boolean state.
    const vestigialBase = /^vestigial\s+(.+)$/i.exec(item.baseType);
    if (vestigialBase) {
      item.vestigial = true;
      item.baseType = vestigialBase[1].trim();
    }
  }
  const synthesisedBase = /^synthesi[sz]ed\s+(.+)$/i.exec(item.baseType);
  if (synthesisedBase) {
    const copiedBase = item.baseType;
    item.synthesised = true;
    item.baseType = synthesisedBase[1].trim();
    if (item.name === copiedBase) item.name = item.baseType;
  } else {
    item.synthesised = /synthesi[sz]ed/i.test(item.baseType);
  }
  if (item.rarity !== "unique" && /\bmaps?\b/i.test(item.itemClass)) {
    const ravaged = /^blight-ravaged\s+(.+)$/i.exec(item.baseType);
    const blighted = /^blighted\s+(.+)$/i.exec(item.baseType);
    if (ravaged) {
      item.mapBlighted = "Blight-ravaged";
      item.baseType = ravaged[1].trim();
      if (item.name === ravaged[0]) item.name = item.baseType;
    } else if (blighted) {
      item.mapBlighted = "Blighted";
      item.baseType = blighted[1].trim();
      if (item.name === blighted[0]) item.name = item.baseType;
    }
  }
  item.fractured = /fractured/i.test(item.baseType);
  const tierSuffix = /\s+\(Tier\s+(\d+)\)$/i.exec(item.baseType);
  if (tierSuffix) {
    item.mapTier = Number(tierSuffix[1]);
    item.baseType = item.baseType.slice(0, -tierSuffix[0].length).trim();
  }
  normalizePinnedClipboardIdentity(item);
  return consumed;
}

function parseVaalGemName(section: string[], item: ParsedPoeItem) {
  if (
    item.rarity !== "gem" ||
    section.length !== 1 ||
    !gemIdentityProfile(section[0].trim())
  ) return false;
  item.name = section[0].trim();
  return true;
}

function parseSocketGroups(value: string): ParsedPoeSocketGroup[] {
  const groups: ParsedPoeSocketGroup[] = [];
  for (const token of value.trim().split(/\s+/)) {
    const colors = token
      .split("-")
      .map((color) => color.trim().toUpperCase())
      .filter((color) => /^[RGBWAD]$/.test(color));
    if (colors.length) groups.push({ colors, links: colors.length });
  }
  return groups;
}

function updateDerivedProperty(item: ParsedPoeItem, label: string, value: string): void {
  const key = label.toLowerCase();
  const number = parseNumber(value);

  if (key === "item level") item.itemLevel = number;
  else if (key === "area level") item.areaLevel = number;
  else if (key === "level" && item.rarity === "gem") item.gemLevel = number;
  else if (key === "map tier") item.mapTier = number;
  else if (key === "quality") item.quality = number;
  else if (key === "stack size") {
    const stack = /([\d,]+)\s*\/\s*([\d,]+)/.exec(value);
    if (stack) {
      item.stackSize = Number(stack[1].replace(/,/g, ""));
      item.maxStackSize = Number(stack[2].replace(/,/g, ""));
    } else item.stackSize = number;
  } else if (key === "width") item.width = number;
  else if (key === "height") item.height = number;
  else if (key === "size") {
    const size = /(\d+)\s*[x×]\s*(\d+)/i.exec(value);
    if (size) {
      item.width = Number(size[1]);
      item.height = Number(size[2]);
    }
  } else if (key === "sockets") {
    item.sockets = parseSocketGroups(value);
    item.links = item.sockets.reduce((maximum, group) => Math.max(maximum, group.links), 0);
  } else if (key === "links") item.links = number;
  else if (key === "memory strands") item.memoryStrands = number;
  else if (key === "talisman tier") item.talismanTier = number;
  else if (key === "charge" && /\bsentinels?\b/i.test(item.itemClass)) {
    item.sentinelCharge = number;
  } else if (key === "reward" && /\bmaps?\b/i.test(item.itemClass)) {
    const reward = value.replace(/^Foil\s+/i, "").trim();
    if (reward) item.mapCompletionReward = reward;
  } else if (
    key === "map area" &&
    /\bscrying orb\b/i.test(`${item.name} ${item.baseType}`)
  ) {
    item.scryingMapArea = value.trim();
  } else if (key === "wings revealed" && /\bheist blueprints?\b/i.test(item.itemClass)) {
    item.heistBlueprint = {
      ...item.heistBlueprint,
      ...(number != null ? { wingsRevealed: number } : {}),
    };
  } else if (key === "heist target" && /\bheist blueprints?\b/i.test(item.itemClass)) {
    const targets: Array<[
      NonNullable<ParsedPoeItem["heistBlueprint"]>["target"],
      RegExp,
    ]> = [
      ["Enchants", /^(?:enchants|enchanted armaments)$/i],
      ["Gems", /^(?:gems|unusual gems)$/i],
      ["Replicas", /^(?:replicas|replicas or experimented items)$/i],
      ["Trinkets", /^(?:trinkets|thieves' trinkets or currency)$/i],
    ];
    const target = targets.find(([, pattern]) => pattern.test(value))?.[0];
    if (target) item.heistBlueprint = { ...item.heistBlueprint, target };
  }
  else if (key === "foil variation" && item.rarity === "unique") item.foil = true;
  else if (key === "influence") {
    const influence = value.match(INFLUENCE_VALUE)?.[1];
    if (influence) addInfluence(item, influence);
  }
}

function addInfluence(item: ParsedPoeItem, influence: string): void {
  const canonical = influence
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
  if (!item.influences.includes(canonical)) item.influences.push(canonical);
}

function parseFlagsAndInfluences(section: string[], item: ParsedPoeItem): Set<number> {
  const consumed = new Set<number>();
  section.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const influence = line.match(INFLUENCE_LINE)?.[1];
    if (influence) {
      addInfluence(item, influence);
      consumed.add(index);
      return;
    }

    for (const flag of FLAG_PATTERNS) {
      if (!flag.pattern.test(line)) continue;
      // `Foil Unique` is a unique-only clipboard marker. Do not let an
      // unrelated future/non-unique line silently change Trade rarity.
      if (flag.key === "foil" && item.rarity !== "unique") continue;
      item[flag.key] = flag.value ?? true;
      if (flag.key === "corrupted" && /^unmodifiable$/i.test(line)) {
        item.unmodifiable = true;
      }
      consumed.add(index);
      return;
    }
  });
  return consumed;
}

function modifierKind(value: string): PoeModifierKind {
  const normalized = value.toLowerCase();
  if (normalized.includes("pseudo")) return "pseudo";
  if (/\bveil(?:ed)?\b/.test(normalized)) return "veiled";
  if (normalized.includes("fractured")) return "fractured";
  if (normalized.includes("crafted")) return "crafted";
  if (normalized.includes("enchant")) return "enchant";
  if (normalized.includes("scourge")) return "scourge";
  if (normalized.includes("crucible")) return "crucible";
  if (normalized.includes("rune")) return "rune";
  if (normalized.includes("imbued")) return "imbued";
  if (normalized.includes("implicit")) return "implicit";
  if (
    normalized.includes("prefix") ||
    normalized.includes("suffix") ||
    normalized.includes("explicit") ||
    normalized.includes("foulborn") ||
    normalized.includes("unique modifier")
  ) {
    return "explicit";
  }
  return "unknown";
}

const ATZOATL_OPEN_HEADER = /^open rooms:\s*$/i;
const ATZOATL_OBSTRUCTED_HEADER = /^obstructed rooms:\s*$/i;
const HIGH_VALUE_ATZOATL_ROOMS = new Set([
  "Apex of Atzoatl",
  "Locus of Corruption (Tier 3)",
  "Doryani's Institute (Tier 3)",
  "Apex of Ascension (Tier 3)",
  "Wealth of the Vaal (Tier 3)",
]);

function isChronicleOfAtzoatl(item: ParsedPoeItem) {
  return /^chronicle of atzoatl$/i.test(item.name.trim()) ||
    /^chronicle of atzoatl$/i.test(item.baseType.trim());
}

/** Parses the Chronicle's option-valued room stats without discarding either state. */
function parseAtzoatlRooms(
  lines: string[],
  item: ParsedPoeItem,
  sourceGroupId: string,
): { modifiers: ParsedPoeModifier[]; unknown: string[] } | null {
  if (!isChronicleOfAtzoatl(item)) return null;
  if (!lines.some((line) =>
    ATZOATL_OPEN_HEADER.test(line.trim()) ||
    ATZOATL_OBSTRUCTED_HEADER.test(line.trim())
  )) return null;

  let state: 1 | 2 | null = null;
  const modifiers: ParsedPoeModifier[] = [];
  const unknown: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (ATZOATL_OPEN_HEADER.test(line)) {
      state = 1;
      continue;
    }
    if (ATZOATL_OBSTRUCTED_HEADER.test(line)) {
      state = 2;
      continue;
    }
    if (!state) {
      unknown.push(rawLine);
      continue;
    }
    if (!line) continue;
    const modifier = makeModifier(
      line,
      {
        kind: "pseudo",
        source: state === 1 ? "Open Room" : "Obstructed Room",
        tags: ["atzoatl-room", state === 1 ? "open" : "obstructed"],
      },
      item.modifiers.length + modifiers.length,
      `${sourceGroupId}:plain`,
    );
    modifiers.push({
      ...modifier,
      // Room state is an official Trade option, not a numeric roll. Keep the
      // copied 1/2 value visible while catalog matching sees only text tokens
      // such as the fixed tier number.
      values: [state],
      sourceValues: modifierValues(line),
      roomState: state,
      selectedByDefault: state === 1 && HIGH_VALUE_ATZOATL_ROOMS.has(line),
    });
  }
  return { modifiers, unknown };
}

function parseAdvancedInfo(line: string): AdvancedModifierInfo | null {
  const match = ADVANCED_LINE.exec(line.trim());
  if (!match) return null;
  const body = match[1].trim();
  // PoE's Advanced Description uses an em dash. Keeping this delimiter exact
  // is observable: APT treats a mojibake/corrupted header as an otherwise
  // valid but unknown descriptor, whose safe default is Explicit.
  const [descriptor = "", second, third] = body
    .split("\u2014")
    .map((part) => part.trim());
  const magnitudeText = third !== undefined
    ? third
    : second !== undefined && ADVANCED_MAGNITUDE.test(second)
      ? second
      : undefined;
  const tagText = second !== undefined && second !== magnitudeText ? second : "";
  const descriptorMatch = /^(?<type>[^"\r\n]+?)(?:\s+"(?<name>[^"]*)")?(?:\s+\(Tier:\s*(?<tier>\d+)\))?(?:\s+\(Rank:\s*(?<rank>\d+)\))?$/.exec(
    descriptor,
  );
  const descriptorType = descriptorMatch?.groups?.type?.trim() ?? descriptor;
  const tierMatch = /\b(?:tier|rank)\s*:\s*([^\s,)]+)/i.exec(descriptor);
  const tags = tagText
    .split(/\s*,\s*/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const source = descriptorMatch?.groups?.name || undefined;
  const rollIncrMatch = magnitudeText?.match(ADVANCED_MAGNITUDE);
  const rollIncr = rollIncrMatch ? Number(rollIncrMatch[1]) : undefined;

  let kind: PoeModifierKind = "explicit";
  let generation: ParsedPoeModifier["generation"];
  switch (descriptorType) {
    case "Implicit Modifier":
      kind = "implicit";
      break;
    case "Corruption Implicit Modifier":
      kind = "implicit";
      generation = "corrupted";
      break;
    case "Vestigial Implicit Modifier":
      kind = "implicit";
      generation = "vestigial";
      break;
    case "Fractured Prefix Modifier":
      kind = "fractured";
      generation = "prefix";
      break;
    case "Fractured Suffix Modifier":
      kind = "fractured";
      generation = "suffix";
      break;
    case "Master Crafted Prefix Modifier":
      kind = "crafted";
      generation = "prefix";
      break;
    case "Master Crafted Suffix Modifier":
      kind = "crafted";
      generation = "suffix";
      break;
    case "Prefix Modifier":
      generation = "prefix";
      break;
    case "Suffix Modifier":
      generation = "suffix";
      break;
    case "Foulborn Unique Modifier":
      generation = "foulborn";
      break;
    default:
      if (
        /^Eater of Worlds Implicit Modifier \(.+\)$/.test(descriptorType) ||
        /^Searing Exarch Implicit Modifier \(.+\)$/.test(descriptorType)
      ) {
        kind = "implicit";
        generation = "eldritch";
      }
  }

  return {
    kind,
    source,
    generation,
    tier: tierMatch?.[1],
    tags,
    ...(Number.isFinite(rollIncr) ? { rollIncr } : {}),
  };
}

function stripModifierSuffix(text: string): { text: string; kind: PoeModifierKind | null } {
  let foundKind: PoeModifierKind | null = null;
  const clean = text.replace(MODIFIER_SUFFIX, (_whole, rawKind: string) => {
    foundKind = modifierKind(rawKind);
    return "";
  });
  return { text: clean.trim(), kind: foundKind };
}

function normalizeModifierText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/<<[^>]+>>/g, "")
    .replace(/[−–—]/g, "-")
    .replace(
      /([-+]?\d[\d,]*(?:\.\d+)?)\s*\(\s*[-+]?\d[\d,]*(?:\.\d+)?(?:\s*[\u002d\u2013\u2014\u2212]\s*[-+]?\d[\d,]*(?:\.\d+)?)?\s*\)/g,
      "$1",
    )
    .replace(/[-+]?\d[\d,]*(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function modifierValues(text: string): number[] {
  // Advanced descriptions put the rolled value before its possible range,
  // e.g. +76(70-79). Legacy rolls can use one historic endpoint, e.g.
  // +1170(1000); in both forms keep only the copied roll.
  const withoutRollRanges = text.replace(
    /([-+]?\d[\d,]*(?:\.\d+)?)\s*\(\s*[-+]?\d[\d,]*(?:\.\d+)?(?:\s*[\u002d\u2013\u2014\u2212]\s*[-+]?\d[\d,]*(?:\.\d+)?)?\s*\)/g,
    "$1",
  );
  const values: number[] = [];
  const matches = withoutRollRanges.matchAll(/[-+]?\d[\d,]*(?:\.\d+)?/g);
  for (const match of matches) {
    const value = Number(match[0].replace(/,/g, ""));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function defaultSelection(kind: PoeModifierKind): boolean {
  return !["implicit", "crafted", "unknown"].includes(kind);
}

function makeModifier(
  text: string,
  info: AdvancedModifierInfo,
  occurrence: number,
  sourceGroupId: string,
): ParsedPoeModifier {
  const unscalable = text.endsWith(UNSCALABLE_VALUE);
  const parsedText = unscalable
    ? text.slice(0, -UNSCALABLE_VALUE.length)
    : text;
  const catalogText = info.kind === "veiled"
    ? (/^veiled\s+(?:prefix|suffix)$/i.test(info.source || parsedText)
        ? "Veiled"
        : info.source || parsedText)
    : parsedText;
  const normalizedText = normalizeModifierText(catalogText);
  return {
    id: `mod-${hashText(`${info.kind}|${normalizedText}|${info.source ?? ""}|${info.tier ?? ""}`)}-${occurrence}`,
    kind: info.kind,
    text: parsedText.trim(),
    normalizedText,
    values: modifierValues(parsedText),
    sourceGroupId,
    selectedByDefault: defaultSelection(info.kind),
    source: info.source,
    generation: info.generation,
    tier: info.tier,
    tags: info.tags,
    rollIncr: info.rollIncr,
    ...(unscalable ? { unscalable: true } : {}),
    advanced: Boolean(
      info.source || info.tier || info.tags.length || info.rollIncr != null
    ),
  };
}

function parseAdvancedModifiers(
  lines: string[],
  startOccurrence: number,
  sourceGroupId: string,
): { modifiers: ParsedPoeModifier[]; unknown: string[] } | null {
  const firstInfoIndex = lines.findIndex((line) => ADVANCED_LINE.test(line.trim()));
  if (firstInfoIndex < 0) return null;
  const modifiers: ParsedPoeModifier[] = [];
  const unknown = lines.slice(0, firstInfoIndex);
  let current: {
    info: AdvancedModifierInfo;
    lines: string[];
    sourceGroupId: string;
  } | null = null;
  let groupIndex = 0;

  const flush = () => {
    if (!current?.lines.length) return;
    let kind = current.info.kind;
    if (/^veiled\s+(?:prefix|suffix)$/i.test(current.lines[0].trim())) {
      kind = "veiled";
    }
    const cleaned = current.lines.map((line) => {
      const suffix = stripModifierSuffix(line);
      if (suffix.kind && kind === "unknown") kind = suffix.kind;
      return suffix.text;
    }).filter((line) => Boolean(line));
    if (!cleaned.length) return;
    // One advanced affix can contain multiple independently searchable Trade
    // stats (for example flat Energy Shield plus increased Energy Shield).
    // Keep the affix metadata on every line, but expose each copied stat as its
    // own modifier so the catalog and UI can resolve/select them separately.
    for (const line of cleaned) {
      modifiers.push(
        makeModifier(
          line,
          { ...current.info, kind },
          startOccurrence + modifiers.length,
          current.sourceGroupId,
        ),
      );
    }
  };

  for (const line of lines) {
    const info = parseAdvancedInfo(line);
    if (info) {
      flush();
      current = {
        info,
        lines: [],
        sourceGroupId: `${sourceGroupId}:advanced:${groupIndex}`,
      };
      groupIndex += 1;
    } else if (current) current.lines.push(line.trim());
  }
  flush();
  return { modifiers, unknown };
}

function looksLikeFlavour(line: string): boolean {
  const value = line.trim();
  return /^["“”'‘’]/.test(value) || /["”'’]$/.test(value) || /^—/.test(value);
}

function looksLikeFlavourSection(lines: string[]): boolean {
  if (!lines.length) return false;
  if (lines.every(looksLikeFlavour) || (
    /^["“'‘]/.test(lines[0].trim()) && /["”'’]$/.test(lines[lines.length - 1].trim())
  )) return true;

  // A number of uniques (for example Ralakesh's Impatience) use unquoted,
  // wrapped prose for flavour text. It is a standalone clipboard section,
  // starts like a sentence, continues on a lower-case wrapped line, and ends
  // in punctuation. Treating each line as an explicit modifier creates
  // useless UNMAPPED rows in the editor. Actual multi-line modifier text does
  // not use sentence punctuation and advanced-description headers are
  // explicitly excluded here.
  return lines.length > 1 &&
    /^[A-Z]/.test(lines[0].trim()) &&
    lines.slice(1).some((line) => /^[a-z]/.test(line.trim())) &&
    /[.!?…]["”'’]?$/.test(lines[lines.length - 1].trim()) &&
    !lines.some((line) => MODIFIER_SUFFIX.test(line) || parseAdvancedInfo(line) !== null);
}

function isUniqueFragmentFlavour(
  item: ParsedPoeItem,
  lines: readonly string[],
) {
  return item.rarity === "unique" &&
    /^unique fragments?$/i.test(item.itemClass.trim()) &&
    !lines.some((line) =>
      MODIFIER_SUFFIX.test(line) || parseAdvancedInfo(line) !== null
    );
}

function looksLikeReminder(line: string): boolean {
  const value = line.trim();
  return /^\(.+\)$/.test(value) ||
    /^(?:right-click|right click|left click|shift click|place into|combine this|socket this|can be used|this item|travel to|unmodifiable|limited to|you can only|use on|drag to|a symbol of|corrupted blood cannot)/i.test(value);
}

function looksLikeModifier(line: string): boolean {
  const value = line.trim();
  if (!value) return false;
  if (MODIFIER_SUFFIX.test(value)) return true;
  return /(?:\d|\badds?\b|\bgrants?\b|\ballocat(?:e|es|ed)\b|\bonly affects\b|\bpassives?\b|\bincreased\b|\breduced\b|\bmore\b|\bless\b|\bgain\b|\bis\b|\bhas\b|\bhave\b|\bcannot\b|\bcounts as\b|\bmaximum\b|\bminimum\b|\bresistance\b|\bdamage\b|\blife\b|\bmana\b|\benemies\b|\bnearby\b|\bskills?\b|\battacks?\b|\bspells?\b|\bprefix(?:es)?\b|\bsuffix(?:es)?\b)/i.test(value);
}

function isImbuedGemSupportLine(item: ParsedPoeItem, line: string) {
  return (
    item.rarity === "gem" ||
    /\b(?:skill|support) gems?\b/i.test(item.itemClass)
  ) && /^supported by level 1\s+\S.+$/i.test(line.trim());
}

const TIMELESS_SEED_LINE = /^(?:bathed in the blood of|commanded leadership over|denoted service of|commissioned|carved to glorify|remembrancing|subjugating|binding)\b/i;
const TIMELESS_CONQUEST_LINE = /^passives (?:in radius|affected) are conquered by\b/i;

function parseTimelessModifiers(
  lines: string[],
  item: ParsedPoeItem,
  sourceGroupId: string,
): { modifiers: ParsedPoeModifier[]; unknown: string[] } | null {
  if (
    item.rarity !== "unique"
  ) {
    return null;
  }
  const seedIndex = lines.findIndex((line) => TIMELESS_SEED_LINE.test(line.trim()));
  if (seedIndex < 0) return null;
  const conquestIndex = lines.findIndex(
    (line, index) => index !== seedIndex && TIMELESS_CONQUEST_LINE.test(line.trim()),
  );
  if (conquestIndex < 0) return null;

  const advancedHeaders = lines
    .map((line, index) => ({ index, info: parseAdvancedInfo(line) }))
    .filter((entry): entry is { index: number; info: AdvancedModifierInfo } =>
      entry.info !== null
    )
    .map((entry, groupIndex) => ({ ...entry, groupIndex }));
  const advancedInfo = advancedHeaders[0]?.info;
  const groupForLine = (index: number) => {
    const header = [...advancedHeaders]
      .reverse()
      .find((entry) => entry.index < index);
    return header
      ? `${sourceGroupId}:advanced:${header.groupIndex}`
      : `${sourceGroupId}:plain`;
  };
  const consumed = new Set([
    seedIndex,
    conquestIndex,
    ...advancedHeaders.map((entry) => entry.index),
  ]);
  const seedParts = [lines[seedIndex], lines[conquestIndex]].map(
    (line) => stripModifierSuffix(line).text,
  );
  const modifiers = [
    makeModifier(
      seedParts.join(" "),
      {
        kind: advancedInfo?.kind ?? "explicit",
        ...(advancedInfo?.source ? { source: advancedInfo.source } : {}),
        ...(advancedInfo?.tier ? { tier: advancedInfo.tier } : {}),
        tags: [
          ...new Set([
            ...(advancedInfo?.tags ?? []),
            "timeless-jewel",
            "seed",
          ]),
        ],
      },
      item.modifiers.length,
      groupForLine(seedIndex),
    ),
  ];

  lines.forEach((line, index) => {
    if (consumed.has(index)) return;
    const suffix = stripModifierSuffix(line);
    if (!suffix.text) return;
    // Historic is fixed alternate-tree metadata, never a price-defining Trade
    // filter. Consume only that exact boilerplate; similarly worded real mods
    // remain available to the ordinary parser.
    if (/^historic$/i.test(suffix.text)) {
      consumed.add(index);
      return;
    }
    if (looksLikeModifier(suffix.text)) {
      consumed.add(index);
      modifiers.push(
        makeModifier(
          suffix.text,
          { kind: suffix.kind ?? "explicit", tags: ["timeless-jewel"] },
          item.modifiers.length + modifiers.length,
          groupForLine(index),
        ),
      );
    }
  });

  return {
    modifiers,
    unknown: lines.filter((_line, index) => !consumed.has(index)),
  };
}

function parsePlainModifiers(
  lines: string[],
  item: ParsedPoeItem,
  sourceGroupId: string,
): { modifiers: ParsedPoeModifier[]; unknown: string[] } | null {
  const timeless = parseTimelessModifiers(lines, item, sourceGroupId);
  if (timeless) return timeless;
  const imbuedGemSection = lines.length === 1 &&
    isImbuedGemSupportLine(item, lines[0]);
  // APT's generic modifier parser accepts a plain section only when copied
  // suffix metadata proves it is Scourge or Enchant (in that priority order).
  // Explicit/implicit affixes require Advanced `{...}` headers. Dedicated
  // parsers such as Imbued gems and Timeless jewels remain separate above.
  const plainKind: PoeModifierKind | null = lines.some((line) =>
    /\s+\(scourge\)\s*$/i.test(line)
  )
    ? "scourge"
    : lines.some((line) => /\s+\(enchant\)\s*$/i.test(line))
      ? "enchant"
      : null;
  if (!plainKind && !imbuedGemSection) return null;
  const modifierLines = lines;
  if (!modifierLines.length) return null;
  const modifiers = modifierLines
    .map((line, index) => {
      const suffix = stripModifierSuffix(line);
      const kind = imbuedGemSection ? "imbued" : plainKind!;
      return suffix.text
        ? makeModifier(
            suffix.text,
            { kind, tags: [] },
            item.modifiers.length + index,
            `${sourceGroupId}:plain`,
          )
        : null;
    })
    .filter((modifier): modifier is ParsedPoeModifier => modifier !== null);
  return {
    modifiers,
    unknown: [],
  };
}

function parseMirroredTabletSection(
  lines: string[],
  item: ParsedPoeItem,
  sourceGroupId: string,
) {
  if (
    (item.name || item.baseType).trim() !== "Mirrored Tablet" ||
    lines.length < 8
  ) return false;
  item.modifiers.push(...lines.map((line, index) => makeModifier(
    line,
    { kind: "pseudo", tags: ["mirrored-tablet"] },
    item.modifiers.length + index,
    `${sourceGroupId}:plain`,
  )));
  return true;
}

const LOGBOOK_FACTIONS = new Set([
  "Black Scythe Mercenaries",
  "Druids of the Broken Circle",
  "Knights of the Sun",
  "Order of the Chalice",
]);

const LOGBOOK_BOSSES = new Set([
  "Area contains Medved, Feller of Heroes",
  "Area contains Vorana, Last to Fall",
  "Area contains Uhtred, Covetous Traitor",
  "Area contains Olroth, Origin of the Fall",
]);

/** Mirrors Awakened's per-area Expedition Logbook parser. */
function parseLogbookArea(
  lines: string[],
  item: ParsedPoeItem,
  sourceGroupId: string,
): ParsedPoeModifier[] | null {
  if (
    !/^expedition logbook$/i.test((item.baseType || item.name).trim()) ||
    lines.length < 3 ||
    !/^logbook area\s*:?$/i.test(lines[0].trim())
  ) return null;

  const faction = lines[1].trim();
  if (!LOGBOOK_FACTIONS.has(faction)) return null;
  const occurrence = item.modifiers.length +
    (item.logbookAreas || []).reduce((count, area) => count + area.length, 0);
  const modifiers: ParsedPoeModifier[] = [makeModifier(
    faction,
    { kind: "pseudo", tags: ["logbook-area", "faction"] },
    occurrence,
    `${sourceGroupId}:plain`,
  )];
  let advancedInfo: AdvancedModifierInfo = {
    kind: "implicit",
    tags: ["logbook-area", "boss"],
  };
  let activeSourceGroupId = `${sourceGroupId}:plain`;
  let advancedGroupIndex = 0;
  for (const rawLine of lines.slice(2)) {
    const info = parseAdvancedInfo(rawLine);
    if (info) {
      advancedInfo = {
        ...info,
        tags: [...info.tags, "logbook-area", "boss"],
      };
      activeSourceGroupId = `${sourceGroupId}:advanced:${advancedGroupIndex}`;
      advancedGroupIndex += 1;
      continue;
    }
    const suffix = stripModifierSuffix(rawLine);
    if (!LOGBOOK_BOSSES.has(suffix.text)) continue;
    modifiers.push(makeModifier(
      suffix.text,
      {
        ...advancedInfo,
        kind: suffix.kind ?? advancedInfo.kind,
      },
      occurrence + modifiers.length,
      activeSourceGroupId,
    ));
  }
  return modifiers;
}

function normalizeItemPropertyHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularItemClass(value: string) {
  return value
    .replace(/staves$/i, "staff")
    .replace(/axes$/i, "axe")
    .replace(/ies$/i, "y")
    .replace(/s$/i, "");
}

/**
 * Advanced descriptions may prefix local item properties with the singular
 * item class (`Wand`, `Two Handed Sword`, `Staff`, and so on). It is a section
 * header rather than a Trade modifier, but only consume it when recognised
 * property labels follow so unsupported standalone sections stay lossless.
 */
function isItemPropertySectionHeader(section: string[], item: ParsedPoeItem) {
  const first = section[0]?.trim() ?? "";
  if (!first || parseLabel(first)) return false;

  const itemClass = normalizeItemPropertyHeader(item.itemClass);
  const header = normalizeItemPropertyHeader(first);
  if (header !== itemClass && header !== singularItemClass(itemClass)) return false;

  return section.slice(1).some((line) => {
    const parsed = parseLabel(line);
    if (!parsed) return false;
    const label = parsed.label.toLowerCase();
    return label === "item level" || PROPERTY_KEYS.has(label);
  });
}

function parseProperties(
  section: string[],
  item: ParsedPoeItem,
): { consumed: Set<number>; requirementSection: boolean } {
  const consumed = new Set<number>();
  const requirementSection = /^requirements\s*:?$/i.test(section[0]?.trim() ?? "");
  if (requirementSection) consumed.add(0);
  else if (isItemPropertySectionHeader(section, item)) consumed.add(0);

  section.forEach((line, index) => {
    if (consumed.has(index)) return;
    const parsed = parseLabel(line);
    if (!parsed) return;
    const normalizedLabel = parsed.label.toLowerCase();
    const value = cleanValue(parsed.value);

    if (normalizedLabel === "item level") {
      item.itemLevel = parseNumber(value);
      putRecord(item.properties, "Item Level", value);
      consumed.add(index);
      return;
    }

    if (requirementSection && REQUIREMENT_KEYS.has(normalizedLabel)) {
      putRecord(item.requirements, parsed.label, value);
      if (normalizedLabel === "level") item.requiredLevel = parseNumber(value);
      consumed.add(index);
      return;
    }

    if (PROPERTY_KEYS.has(normalizedLabel)) {
      putRecord(item.properties, parsed.label, value);
      updateDerivedProperty(item, parsed.label, value);
      consumed.add(index);
    }
  });
  return { consumed, requirementSection };
}

function consumesWholeBasePropertySection(
  section: readonly string[],
  item: ParsedPoeItem,
) {
  if (/\bflasks?\b/i.test(item.itemClass.trim())) {
    return section.some((line) =>
      /^currently has\s+\d[\d,]*\s+charges$/i.test(line.trim())
    );
  }
  if (/^tinctures?$/i.test(item.itemClass.trim())) {
    return section.some((line) =>
      /^quality\s*:/i.test(line.trim())
    );
  }
  return false;
}

function isChartItem(item: ParsedPoeItem) {
  return /^charts?$/i.test(item.itemClass.trim());
}

/**
 * Mirrors Awakened's dedicated Chart parser. The area identity is the first
 * line of one section and is valid only when the pinned AREA catalog knows it;
 * Area Level is mandatory. Consume this section before generic properties or
 * modifier parsing so its area name and Dead Man's Sulphur value cannot leak
 * into unsupported modifier rows.
 */
function parseChartSection(section: string[], item: ParsedPoeItem) {
  if (!isChartItem(item) || section.length < 2) return false;
  const areaName = section[0].trim();
  const values = new Map<string, { label: string; value: string; number: number }>();
  for (const rawLine of section.slice(1)) {
    const parsed = parseLabel(rawLine);
    if (!parsed) continue;
    const key = parsed.label.trim().toLowerCase();
    if (![
      "area level",
      "item quantity",
      "item rarity",
      "monster pack size",
      "dead man's sulphur",
    ].includes(key)) continue;
    const value = cleanValue(parsed.value);
    const number = parseNumber(value);
    if (number == null) continue;
    values.set(key, { label: parsed.label, value, number });
  }

  const areaLevel = values.get("area level");
  if (!areaLevel) return false;
  const areaTradeDiscriminator = mapAreaTradeDiscriminator(areaName);
  if (!areaTradeDiscriminator) {
    item.unknownSections.push([...section]);
    item.errors.push(`Unknown Chart area: ${areaName}.`);
    return true;
  }

  item.chartArea = areaName;
  item.chartAreaTradeDiscriminator = areaTradeDiscriminator;
  item.areaLevel = areaLevel.number;
  const derived: Array<[
    string,
    keyof Pick<
      ParsedPoeItem,
      "areaItemQuantity" | "areaItemRarity" | "areaPackSize" | "chartSulphur"
    >,
  ]> = [
    ["item quantity", "areaItemQuantity"],
    ["item rarity", "areaItemRarity"],
    ["monster pack size", "areaPackSize"],
    ["dead man's sulphur", "chartSulphur"],
  ];
  for (const [key, field] of derived) {
    const entry = values.get(key);
    if (entry) item[field] = entry.number;
  }
  for (const entry of values.values()) {
    putRecord(item.properties, entry.label, entry.value);
  }
  return true;
}

function deriveModifierFlags(item: ParsedPoeItem) {
  for (const modifier of item.modifiers) {
    if (modifier.kind === "fractured") item.fractured = true;
    if (modifier.kind === "veiled") item.veiled = true;
    if (modifier.kind === "scourge") item.scourged = true;
  }
}

function parseHeistContractMetadata(
  item: ParsedPoeItem,
  lines: readonly string[],
) {
  if (!/\bheist contracts?\b/i.test(item.itemClass)) return;
  const supportedJobs = new Set<NonNullable<
    NonNullable<ParsedPoeItem["heistContract"]>["requiredJob"]
  >>([
    "Lockpicking",
    "Brute Force",
    "Perception",
    "Demolition",
    "Counter-Thaumaturgy",
    "Trap Disarmament",
    "Agility",
    "Deception",
    "Engineering",
  ]);
  const metadata: NonNullable<ParsedPoeItem["heistContract"]> = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const job = /^Requires (.+) \(Level (\d+)(?:\s*\(unmet\))?\)$/i.exec(line);
    if (job) {
      const canonical = [...supportedJobs].find(
        (entry) => entry.toLowerCase() === job[1].trim().toLowerCase(),
      );
      const level = Number(job[2]);
      if (canonical && Number.isFinite(level)) {
        metadata.requiredJob = canonical;
        metadata.jobLevel = level;
      }
    }
    if (/^Heist Target: .+ \(Priceless\)$/i.test(line)) {
      metadata.targetValue = "Priceless";
    }
  }
  if (metadata.requiredJob || metadata.targetValue) item.heistContract = metadata;
}

/**
 * APT consumes the complete area-property section for Contracts and
 * Blueprints. Job requirements and target labels are metadata within that
 * section, not ordinary explicit modifiers.
 */
function parseHeistSection(section: string[], item: ParsedPoeItem) {
  if (!/\bheist (?:contracts?|blueprints?)\b/i.test(item.itemClass)) {
    return false;
  }
  if (!section.some((line) => {
    const parsed = parseLabel(line);
    return parsed?.label.trim().toLowerCase() === "area level";
  })) return false;

  parseProperties(section, item);
  parseHeistContractMetadata(item, section);
  return true;
}

/**
 * Parses the English text produced by Path of Exile 1's Copy Item command.
 * The parser is deliberately lossless for unsupported sections and never throws.
 */
export function parsePoeItem(rawText: string): ParsedPoeItem {
  const item = createEmptyItem(typeof rawText === "string" ? rawText : "");
  try {
    if (typeof rawText !== "string" || !rawText.trim()) {
      item.errors.push("The clipboard does not contain an item.");
      return item;
    }
    if (rawText.length > MAX_CLIPBOARD_LENGTH) {
      item.errors.push("The clipboard item is too large to parse safely.");
      return item;
    }

    const sections = normalizeCannotUseItemSections(splitSections(rawText));
    if (!sections.length) {
      item.errors.push("The clipboard does not contain an item.");
      return item;
    }

    parseNameplate(sections[0], item);
    if (item.language !== "en") {
      item.unknownSections = sections;
      item.errors.push("Only English Path of Exile item text is currently supported.");
      return item;
    }

    // Once Advanced metadata is present, a later unmarked section on an
    // identified unique is lore rather than another modifier block.
    const hasAdvancedModifierDescriptions = sections.some((section) =>
      section.some((line) => parseAdvancedInfo(line) !== null)
    );

    for (const [sectionOffset, section] of sections.slice(1).entries()) {
      const sourceGroupId = `section:${sectionOffset + 1}`;
      if (parseVaalGemName(section, item)) continue;
      if (parseChartSection(section, item)) continue;
      if (parseHeistSection(section, item)) continue;
      const consumed = parseFlagsAndInfluences(section, item);
      const properties = parseProperties(section, item);
      for (const index of properties.consumed) consumed.add(index);
      // APT deliberately consumes the whole Flask/Tincture base-property
      // section. Duration, charge-use/current-charge and base-effect lines are
      // item properties, never searchable modifiers.
      if (consumesWholeBasePropertySection(section, item)) continue;
      const remaining = section.filter((_line, index) => !consumed.has(index));
      if (!remaining.length) continue;
      if (parseMirroredTabletSection(remaining, item, sourceGroupId)) continue;

      // Timeless jewels print this fixed alternate-tree marker in its own
      // clipboard section. It is metadata, not an explicit Trade stat. Limit
      // the exception to an item where the recognised seed stat was already
      // parsed so an unrelated literal `Historic` line remains lossless.
      if (
        remaining.length === 1 &&
        /^historic$/i.test(remaining[0].trim()) &&
        item.modifiers.some((modifier) =>
          modifier.tags.includes("timeless-jewel") && modifier.tags.includes("seed")
        )
      ) {
        item.reminderText.push(remaining[0]);
        continue;
      }

      if (isUniqueFragmentFlavour(item, remaining) || looksLikeFlavourSection(remaining) || (
        hasAdvancedModifierDescriptions &&
        item.rarity === "unique" &&
        item.identified &&
        item.modifiers.length > 0 &&
        !remaining.some((line) => MODIFIER_SUFFIX.test(line) || parseAdvancedInfo(line) !== null)
      )) {
        item.flavourText.push(...remaining);
        continue;
      }
      const reminders = remaining.filter(looksLikeReminder);
      const searchable = remaining.filter((line) => !looksLikeReminder(line));
      if (reminders.length) item.reminderText.push(...reminders);
      if (!searchable.length) {
        continue;
      }

      const logbookArea = parseLogbookArea(searchable, item, sourceGroupId);
      if (logbookArea) {
        item.logbookAreas ||= [];
        item.logbookAreas.push(logbookArea);
        continue;
      }

      const atzoatl = parseAtzoatlRooms(searchable, item, sourceGroupId);
      if (atzoatl?.modifiers.length) {
        item.modifiers.push(...atzoatl.modifiers);
        if (atzoatl.unknown.length) item.unknownSections.push(atzoatl.unknown);
        continue;
      }
      // Timeless and alternate-tree Abyss jewels are one official Trade stat
      // spread over two clipboard lines. Parse this before generic advanced
      // descriptions, which intentionally split ordinary multi-stat affixes
      // into independent rows and would otherwise strand the seed as UNMAPPED.
      const timeless = parseTimelessModifiers(searchable, item, sourceGroupId);
      if (timeless?.modifiers.length) {
        item.modifiers.push(...timeless.modifiers);
        if (timeless.unknown.length) item.unknownSections.push(timeless.unknown);
        continue;
      }
      const advanced = parseAdvancedModifiers(
        searchable,
        item.modifiers.length,
        sourceGroupId,
      );
      if (advanced?.modifiers.length) {
        item.modifiers.push(...advanced.modifiers);
        if (advanced.unknown.length) item.unknownSections.push(advanced.unknown);
        continue;
      }
      const plain = parsePlainModifiers(searchable, item, sourceGroupId);
      if (plain?.modifiers.length) {
        item.modifiers.push(...plain.modifiers);
        if (plain.unknown.length) item.unknownSections.push(plain.unknown);
        continue;
      }

      item.unknownSections.push(searchable);
    }

    deriveModifierFlags(item);
    if (
      /^superior\s+/i.test(item.name) &&
      (item.rarity === "normal" ||
        (!item.identified && ["magic", "rare", "unique"].includes(item.rarity)))
    ) {
      item.name = item.name.replace(/^superior\s+/i, "").trim();
      if (/^superior\s+/i.test(item.baseType)) {
        item.baseType = item.baseType.replace(/^superior\s+/i, "").trim();
      }
    }
    if (!item.itemClass) item.errors.push("Missing Item Class header.");
    if (item.rarity === "unknown") item.errors.push("Missing or unsupported Rarity header.");
    if (!item.name) item.errors.push("Missing item name.");
    if (item.unknownSections.length) {
      item.warnings.push(`${item.unknownSections.length} unrecognised section${item.unknownSections.length === 1 ? " was" : "s were"} preserved.`);
    }
    item.valid = item.errors.length === 0;
    return item;
  } catch (error) {
    item.valid = false;
    item.errors.push("The item could not be parsed safely.");
    if (error instanceof Error && error.message) item.warnings.push(error.message);
    return item;
  }
}

export const parsePoeClipboard = parsePoeItem;
export const parseCopiedItem = parsePoeItem;

export function isPoeItemText(text: string): boolean {
  if (typeof text !== "string" || text.length > MAX_CLIPBOARD_LENGTH) return false;
  return /^Item Class:\s*.+$/m.test(text) && /^Rarity:\s*.+$/m.test(text);
}
