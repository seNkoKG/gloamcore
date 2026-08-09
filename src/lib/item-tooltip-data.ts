import type {
  ItemTooltipData,
  ItemTooltipRequest,
  RawWikiCargoResponse,
} from "../types";

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, token: string) => {
      const normalized = token.toLowerCase();
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : normalized.startsWith("#")
          ? Number.parseInt(normalized.slice(1), 10)
          : undefined;
      if (codePoint != null && Number.isFinite(codePoint)) {
        return String.fromCodePoint(codePoint);
      }
      return named[normalized] ?? entity;
    },
  );
}

export function plainWikiText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const decoded = decodeEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match, target: string, label?: string) => label || target,
    )
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/'''?/g, "")
    .replace(/\r/g, "");
  const normalized = decoded
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return normalized || undefined;
}

function textLines(value: unknown) {
  return (plainWikiText(value) || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function listValue(value: unknown) {
  return (plainWikiText(value) || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function booleanValue(value: unknown) {
  if (value == null || value === "") return undefined;
  return String(value) !== "0" && String(value).toLowerCase() !== "false";
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function frameTypeValue(value: unknown) {
  const normalized = plainWikiText(value)?.toLowerCase();
  if (!normalized) return undefined;
  const frameTypes: Record<string, string> = {
    "0": "normal",
    "1": "magic",
    "2": "rare",
    "3": "unique",
    "4": "gem",
    "5": "currency",
    "6": "divination",
    "7": "quest",
    "8": "prophecy",
    "9": "foil",
    "10": "supporter-foil",
    "11": "necropolis",
    "12": "gold",
    "13": "breach-skill",
  };
  return frameTypes[normalized] || normalized.replace(/\s+/g, "-");
}

function recordValue(record: Record<string, unknown>, key: string) {
  return record[key] ?? record[key.replace(/_/g, " ")];
}

function chooseRecord(
  payload: RawWikiCargoResponse,
  request: ItemTooltipRequest,
) {
  const records = (payload.cargoquery || [])
    .map((entry) => entry.title)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  if (!records.length) return undefined;
  const active = records.filter(
    (record) =>
      String(recordValue(record, "is_in_game") ?? "1") !== "0" &&
      !recordValue(record, "removal_version"),
  );
  const candidates = active.length ? active : records;
  if (request.baseType) {
    const base = request.baseType.toLowerCase();
    const match = candidates.find(
      (record) =>
        String(recordValue(record, "base_item") || "").toLowerCase() === base,
    );
    if (match) return match;
  }
  return candidates[0];
}

export function normalizeItemTooltip(
  payload: RawWikiCargoResponse,
  request: ItemTooltipRequest,
): ItemTooltipData | null {
  const record = chooseRecord(payload, request);
  if (!record) return null;
  return {
    name: plainWikiText(recordValue(record, "name")) || request.name,
    baseType:
      plainWikiText(recordValue(record, "base_item")) || request.baseType,
    itemClass: plainWikiText(recordValue(record, "class")),
    rarity: plainWikiText(recordValue(record, "rarity")),
    frameType: frameTypeValue(recordValue(record, "frame_type")),
    description: plainWikiText(recordValue(record, "description")),
    helpText: plainWikiText(recordValue(record, "help_text")),
    flavourText: plainWikiText(recordValue(record, "flavour_text")),
    implicitMods: textLines(recordValue(record, "implicit_stat_text")),
    explicitMods: textLines(recordValue(record, "explicit_stat_text")),
    enchantMods: textLines(recordValue(record, "enchantment_stat_text")),
    requiredLevel: numberValue(recordValue(record, "required_level")),
    dropLevel: numberValue(recordValue(record, "drop_level")),
    metadataId: plainWikiText(recordValue(record, "metadata_id")),
    inventoryIcon: plainWikiText(recordValue(record, "inventory_icon")),
    dropText: plainWikiText(recordValue(record, "drop_text")),
    dropAreas: listValue(recordValue(record, "drop_areas")),
    dropMonsters: listValue(recordValue(record, "drop_monsters")),
    acquisitionTags: listValue(recordValue(record, "acquisition_tags")),
    releaseVersion: plainWikiText(recordValue(record, "release_version")),
    dropEnabled: booleanValue(recordValue(record, "drop_enabled")),
    source: "poewiki",
  };
}

export function summarizeItemTooltip(
  itemInfo: ItemTooltipData | null | undefined,
  fallback?: string,
) {
  if (!itemInfo) return fallback;
  const rarity =
    itemInfo.rarity?.toLowerCase() === "normal"
      ? undefined
      : itemInfo.rarity;
  const frame =
    itemInfo.frameType && itemInfo.frameType !== "normal"
      ? itemInfo.frameType
          .split("-")
          .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
          .join(" ")
      : undefined;
  const kind =
    itemInfo.baseType || itemInfo.itemClass || frame || fallback;
  if (!rarity) return kind;
  if (!kind || kind.toLowerCase().startsWith(rarity.toLowerCase())) {
    return kind || rarity;
  }
  return `${rarity} ${kind}`;
}
