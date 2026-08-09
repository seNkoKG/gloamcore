import type { RegexEntry } from "./poe-regex";
import { minimumNumberRegex } from "./regex-numeric";

export type RegexStateMode = "ignore" | "include" | "exclude";

export interface MapRegexQualitySettings {
  regular: number;
  packSize: number;
  rarity: number;
  currency: number;
  divination: number;
  scarab: number;
  match: "any" | "all";
}

export interface MapRegexPropertySettings {
  quantity: number;
  packSize: number;
  moreMaps: number;
  itemRarity: number;
  corrupted: RegexStateMode;
  unidentified: RegexStateMode;
  mapRarity: {
    normal: boolean;
    magic: boolean;
    rare: boolean;
    mode: "include" | "exclude";
  };
  quality: MapRegexQualitySettings;
}

export const DEFAULT_MAP_REGEX_PROPERTIES: MapRegexPropertySettings = {
  quantity: 0,
  packSize: 0,
  moreMaps: 0,
  itemRarity: 0,
  corrupted: "ignore",
  unidentified: "ignore",
  mapRarity: {
    normal: false,
    magic: false,
    rare: false,
    mode: "include",
  },
  quality: {
    regular: 0,
    packSize: 0,
    rarity: 0,
    currency: 0,
    divination: 0,
    scarab: 0,
    match: "any",
  },
};

const STATIC = {
  quantity: "m q.*",
  packSize: "iz.*",
  moreMaps: "re maps.*",
  itemRarity: "m rar.*",
  qualityRegular: "ty \\(Quantity\\):.*",
  qualityCurrency: "urr.*",
  qualityDivination: "div.*",
  qualityRarity: "ty\\).*",
  qualityPackSize: "ze\\).*",
  qualityScarab: "sca.*",
  rarity: "y: ",
  corrupted: "pte",
  unidentified: "tified",
} as const;

function safeMinimum(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function minimumPercent(prefix: string, minimum: number) {
  const value = safeMinimum(minimum);
  return value ? `${prefix}${minimumNumberRegex(value)}%` : "";
}

function selectedRarities(settings: MapRegexPropertySettings["mapRarity"]) {
  return [
    settings.normal ? "n" : "",
    settings.magic ? "m" : "",
    settings.rare ? "r" : "",
  ].filter(Boolean);
}

function qualityPatterns(settings: MapRegexQualitySettings) {
  return [
    minimumPercent(STATIC.qualityRegular, settings.regular),
    minimumPercent(STATIC.qualityPackSize, settings.packSize),
    minimumPercent(STATIC.qualityRarity, settings.rarity),
    minimumPercent(STATIC.qualityCurrency, settings.currency),
    minimumPercent(STATIC.qualityDivination, settings.divination),
    minimumPercent(STATIC.qualityScarab, settings.scarab),
  ].filter(Boolean);
}

function avoidEntry(id: string, label: string, pattern: string): RegexEntry {
  return {
    id: `map-property:${id}`,
    label,
    text: label,
    exactToken: pattern,
    optimizedToken: pattern,
    selected: true,
    mode: "avoid",
  };
}

/**
 * Build the non-modifier clauses used by the in-game map search. Wanted map
 * mods may use Any/All; these property clauses stay independently ANDed.
 */
export function buildMapRegexPropertyClauses(settings: MapRegexPropertySettings) {
  const requiredPatterns = [
    minimumPercent(STATIC.quantity, settings.quantity),
    minimumPercent(STATIC.packSize, settings.packSize),
    minimumPercent(STATIC.moreMaps, settings.moreMaps),
    minimumPercent(STATIC.itemRarity, settings.itemRarity),
  ].filter(Boolean);
  const avoidEntries: RegexEntry[] = [];

  for (const [id, label, mode, pattern] of [
    ["corrupted", "Corrupted", settings.corrupted, STATIC.corrupted],
    ["unidentified", "Unidentified", settings.unidentified, STATIC.unidentified],
  ] as const) {
    if (mode === "include") requiredPatterns.push(pattern);
    if (mode === "exclude") avoidEntries.push(avoidEntry(id, label, pattern));
  }

  const rarities = selectedRarities(settings.mapRarity);
  if (rarities.length && !(settings.mapRarity.mode === "include" && rarities.length === 3)) {
    const pattern = `${STATIC.rarity}${rarities.length === 1 ? rarities[0] : `(${rarities.join("|")})`}`;
    if (settings.mapRarity.mode === "include") requiredPatterns.push(pattern);
    else avoidEntries.push(avoidEntry("rarity", "Map rarity", pattern));
  }

  const quality = qualityPatterns(settings.quality);
  if (quality.length) {
    if (settings.quality.match === "any") requiredPatterns.push(quality.join("|"));
    else requiredPatterns.push(...quality);
  }

  return { requiredPatterns, avoidEntries };
}
