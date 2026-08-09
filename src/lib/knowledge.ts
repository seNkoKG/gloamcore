import type {
  EconomyRow,
  KnowledgeEntry,
  KnowledgeSearchRequest,
  RawKnowledgeSearchResponse,
  RawWikiCargoResponse,
  RawWikiImageInfoResponse,
} from "../types";
import { plainWikiText } from "./item-tooltip-data";

export const KNOWLEDGE_ITEM_FIELDS = [
  "name",
  "base_item",
  "rarity",
  "class",
  "description",
  "drop_level",
  "required_level",
  "frame_type",
  "inventory_icon",
  "metadata_id",
  "drop_text",
  "drop_areas",
  "drop_monsters",
  "acquisition_tags",
  "release_version",
  "drop_enabled",
  "is_in_game",
  "removal_version",
].join(",");

export const KNOWLEDGE_MODIFIER_FIELDS = [
  "id",
  "name",
  "domain",
  "game_mode",
  "generation_type",
  "mod_groups",
  "mod_type",
  "required_level",
  "stat_text_raw",
  "tags",
  "tier_text",
].join(",");

function clampLimit(value: number | undefined) {
  return Math.max(8, Math.min(40, Math.round(Number(value) || 24)));
}

export function sanitizeKnowledgeQuery(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f"\\%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function cargoParameters(
  tables: string,
  fields: string,
  where: string,
  limit: number,
) {
  return new URLSearchParams({
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    limit: String(limit),
    tables,
    fields,
    where,
  });
}

export function knowledgeSearchQueries(request: KnowledgeSearchRequest) {
  const query = sanitizeKnowledgeQuery(request.query);
  if (query.length < 2) {
    throw new Error("Enter at least two letters to search PoE knowledge.");
  }
  const limit = clampLimit(request.limit);
  const pattern = `%${query}%`;
  return {
    query,
    limit,
    items: cargoParameters(
      "items",
      KNOWLEDGE_ITEM_FIELDS,
      `(name LIKE "${pattern}" OR base_item LIKE "${pattern}" OR class LIKE "${pattern}") AND is_in_game=1 AND removal_version IS NULL AND class!="Cosmetic Item" AND class!="Hideout Decoration"`,
      limit,
    ),
    modifiers: cargoParameters(
      "mods",
      KNOWLEDGE_MODIFIER_FIELDS,
      `(stat_text_raw LIKE "${pattern}" OR name LIKE "${pattern}") AND game_mode=0`,
      limit,
    ),
  };
}

function recordValue(record: Record<string, unknown>, key: string) {
  return record[key] ?? record[key.replace(/_/g, " ")];
}

function normalizedWikiFileTitle(value: unknown) {
  const candidate = plainWikiText(value)?.replace(/_/g, " ").trim();
  if (!candidate || !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(candidate)) {
    return undefined;
  }
  return /^File:/i.test(candidate) ? candidate : `File:${candidate}`;
}

function wikiFileKey(value: unknown) {
  return normalizedWikiFileTitle(value)?.toLocaleLowerCase();
}

export function knowledgeImageTitles(payload: RawWikiCargoResponse) {
  return [
    ...new Set(
      (payload.cargoquery || [])
        .map((entry) =>
          normalizedWikiFileTitle(
            recordValue(entry.title || {}, "inventory_icon"),
          ),
        )
        .filter((title): title is string => Boolean(title)),
    ),
  ];
}

export function knowledgeImageQuery(titles: string[], width = 128) {
  return new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|mime|size",
    iiurlwidth: String(Math.max(48, Math.min(256, Math.round(width)))),
    titles: titles.slice(0, 40).join("|"),
  });
}

function trustedKnowledgeIconUrl(value: unknown) {
  const candidate = plainWikiText(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.hostname === "web.poecdn.com"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function trustedKnowledgeDataUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  return /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(
    value,
  )
    ? value.replace(/\s+/g, "")
    : undefined;
}

export function normalizeKnowledgeImages(
  payload?: RawWikiImageInfoResponse,
) {
  const images = new Map<string, string>();
  for (const page of payload?.query?.pages || []) {
    if (page.missing) continue;
    const key = wikiFileKey(page.title);
    const info = page.imageinfo?.[0];
    const url =
      trustedKnowledgeDataUrl(info?.dataUrl) ||
      trustedKnowledgeIconUrl(info?.thumburl || info?.url);
    if (key && url && /^image\//i.test(info?.mime || "image/unknown")) {
      images.set(key, url);
    }
  }
  return images;
}

function numericValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown) {
  if (value == null || value === "") return undefined;
  return String(value) !== "0" && String(value).toLowerCase() !== "false";
}

function listValue(value: unknown) {
  const text = plainWikiText(value);
  return text
    ? text
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function frameTypeValue(value: unknown) {
  const normalized = plainWikiText(value)?.toLowerCase();
  if (!normalized) return undefined;
  const known: Record<string, string> = {
    "0": "normal",
    "1": "magic",
    "2": "rare",
    "3": "unique",
    "4": "gem",
    "5": "currency",
    "6": "divination",
    "7": "quest",
    "9": "foil",
    "12": "gold",
  };
  return known[normalized] || normalized.replace(/\s+/g, "-");
}

function wikiIconUrl(value: unknown, images: Map<string, string>) {
  const direct = trustedKnowledgeIconUrl(value);
  if (direct) return direct;
  const key = wikiFileKey(value);
  return key ? images.get(key) : undefined;
}

const generationTypes: Record<number, string> = {
  1: "Prefix",
  2: "Suffix",
  3: "Intrinsic",
  4: "Nemesis",
  5: "Corrupted",
  6: "Bloodlines",
  7: "Torment",
  8: "Tempest",
  9: "Talisman",
  10: "Enchantment",
  11: "Essence",
  12: "Unused",
  13: "Bestiary",
  14: "Delve",
  15: "Synthesis",
  16: "Synthesis global",
  17: "Synthesis bonus",
  18: "Blight",
  19: "Blight anointment",
  20: "Delirium",
  21: "Enkindling Orb",
  22: "Instilling Orb",
  23: "Expedition Logbook",
  24: "Scourge benefit",
  25: "Scourge detriment",
  26: "Scourge gimmick",
  27: "Unused",
  28: "Searing Exarch",
  29: "Eater of Worlds",
  30: "Unused",
  31: "Crucible tree",
  32: "Crucible mutation",
  33: "Wildwood Wisps",
  34: "Necropolis downside",
  35: "Necropolis upside",
  36: "Memory Altar",
  37: "Deepwater Voyage Planner",
};

function generationType(value: unknown) {
  const id = numericValue(value);
  if (id == null) return {};
  return {
    generationType: generationTypes[id] || `Generation ${id}`,
    generationTypeId: id,
  };
}

const modifierDomains: Record<number, string> = {
  1: "Item",
  2: "Flask",
  3: "Monster",
  4: "Strongbox",
  5: "Area",
  6: "Unused",
  7: "Relic",
  8: "Unused",
  9: "Crafting bench",
  10: "Jewel",
  11: "Atlas",
  12: "Leaguestone",
  13: "Abyss jewel",
  14: "Map device",
  15: "Unused",
  16: "Delve fossil",
  17: "Delve area",
  18: "Synthesis area",
  19: "Synthesis global",
  20: "Synthesis bonus",
  21: "Cluster jewel",
  22: "Heist area",
  23: "Heist equipment",
  24: "Heist trinket",
  25: "Watchstone",
  26: "Veiled",
  27: "Expedition remnant",
  28: "Unveiled",
  29: "Eldritch altar",
  30: "Sentinel",
  31: "Memory",
  32: "Sanctified relic",
  33: "Crucible area",
  34: "Tincture",
  35: "Charm",
  36: "Necropolis monster",
  37: "Idol",
  38: "Graft",
  39: "Deepwater chart",
  40: "Deepwater border",
  41: "Mercenary",
  42: "Ducat crafted",
};

function modifierDomain(value: unknown) {
  const id = numericValue(value);
  if (id == null) return {};
  return {
    modifierDomain: modifierDomains[id] || `Domain ${id}`,
    modifierDomainId: id,
  };
}

function relevance(entry: KnowledgeEntry, query: string) {
  const needle = query.toLowerCase();
  const name = entry.name.toLowerCase();
  const modifierName = entry.modifierName?.toLowerCase() || "";
  let score = entry.kind === "item" ? 40 : 0;
  if (name === needle) score += 1_000;
  else if (name.startsWith(needle)) score += 600;
  else if (name.includes(needle)) score += 350;
  if (modifierName === needle) score += 500;
  else if (modifierName.includes(needle)) score += 120;
  if (name.includes(needle)) score += Math.max(0, 160 - name.length);
  if (entry.baseType?.toLowerCase() === needle) score += 450;
  if (entry.tags.some((tag) => tag.toLowerCase() === needle)) score += 100;
  return score;
}

export function normalizeKnowledgeSearch(
  payload: RawKnowledgeSearchResponse,
  rawQuery: string,
) {
  const query = sanitizeKnowledgeQuery(rawQuery);
  const images = normalizeKnowledgeImages(payload.images);
  const items: KnowledgeEntry[] = (payload.items.cargoquery || [])
    .map((entry) => entry.title)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .map((record) => {
      const name = plainWikiText(recordValue(record, "name")) || "Unknown item";
      return {
        key: `item:${plainWikiText(recordValue(record, "metadata_id")) || name}`,
        kind: "item" as const,
        name,
        icon: wikiIconUrl(recordValue(record, "inventory_icon"), images),
        baseType: plainWikiText(recordValue(record, "base_item")),
        itemClass: plainWikiText(recordValue(record, "class")),
        rarity: plainWikiText(recordValue(record, "rarity")),
        frameType: frameTypeValue(recordValue(record, "frame_type")),
        description: plainWikiText(recordValue(record, "description")),
        requiredLevel: numericValue(recordValue(record, "required_level")),
        dropLevel: numericValue(recordValue(record, "drop_level")),
        metadataId: plainWikiText(recordValue(record, "metadata_id")),
        dropText: plainWikiText(recordValue(record, "drop_text")),
        dropAreas: listValue(recordValue(record, "drop_areas")),
        dropMonsters: listValue(recordValue(record, "drop_monsters")),
        acquisitionTags: listValue(recordValue(record, "acquisition_tags")),
        releaseVersion: plainWikiText(recordValue(record, "release_version")),
        dropEnabled: booleanValue(recordValue(record, "drop_enabled")),
        modifierGroups: [],
        tags: [],
        source: "poewiki" as const,
      };
    });
  const modifiers: KnowledgeEntry[] = (payload.modifiers.cargoquery || [])
    .map((entry) => entry.title)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .map((record) => {
      const statText =
        plainWikiText(recordValue(record, "stat_text_raw")) ||
        "Undocumented modifier";
      const id = plainWikiText(recordValue(record, "id")) || statText;
      return {
        key: `modifier:${id}`,
        kind: "modifier" as const,
        name: statText,
        modifierId: id,
        modifierName: plainWikiText(recordValue(record, "name")),
        modifierType: plainWikiText(recordValue(record, "mod_type")),
        ...modifierDomain(recordValue(record, "domain")),
        modifierGroups: listValue(recordValue(record, "mod_groups")),
        statText,
        tags: listValue(recordValue(record, "tags")),
        tier: plainWikiText(recordValue(record, "tier_text")),
        requiredLevel: numericValue(recordValue(record, "required_level")),
        ...generationType(recordValue(record, "generation_type")),
        dropAreas: [],
        dropMonsters: [],
        acquisitionTags: [],
        source: "poewiki" as const,
      };
    });

  return [...items, ...modifiers]
    .sort(
      (left, right) =>
        relevance(right, query) - relevance(left, query) ||
        left.name.localeCompare(right.name),
    )
    .filter(
      (entry, index, entries) =>
        entries.findIndex((candidate) => candidate.key === entry.key) === index,
    );
}

export function knowledgeWikiUrl(entry: KnowledgeEntry) {
  if (entry.kind === "item") {
    return `https://www.poewiki.net/wiki/${encodeURIComponent(
      entry.name.replace(/ /g, "_"),
    )}`;
  }
  return `https://www.poewiki.net/index.php?search=${encodeURIComponent(
    entry.statText || entry.name,
  )}`;
}

export function craftOfExileUrl() {
  return "https://www.craftofexile.com/en/";
}

export function poeDbUrl(entry: KnowledgeEntry) {
  if (entry.kind !== "item") return "https://poedb.tw/us/";
  return `https://poedb.tw/us/${encodeURIComponent(
    entry.name.replace(/ /g, "_"),
  )}`;
}

const craftableClasses = /armour|boots|gloves|helmet|shield|weapon|axe|bow|claw|dagger|mace|staff|sword|wand|sceptre|quiver|ring|amulet|belt|jewel|flask/i;

export function isCraftableKnowledgeEntry(entry: KnowledgeEntry) {
  return (
    entry.kind === "modifier" ||
    Boolean(entry.itemClass && craftableClasses.test(entry.itemClass))
  );
}

export function isCraftableMarketRow(
  row: EconomyRow,
  itemClass?: string,
) {
  return (
    row.categoryId === "base-types" ||
    Boolean(itemClass && craftableClasses.test(itemClass))
  );
}
