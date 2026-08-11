import type { PassiveTreeSpriteRect } from "../../types";
import type { ImportedPobItem } from "./pob-build";

export type TimelessJewelFamily =
  | "karui"
  | "maraketh"
  | "eternal"
  | "vaal"
  | "templar"
  | "kalguur";

export interface TimelessJewelVisual {
  family: TimelessJewelFamily;
  radius: number;
  spriteNames: readonly [string, string];
}

const RADIUS_BY_LABEL: Record<string, number> = {
  small: 960,
  medium: 1440,
  large: 1800,
  "very large": 2400,
  massive: 2880,
};

const TIMELESS: Array<{
  pattern: RegExp;
  family: TimelessJewelFamily;
  spriteNames: readonly [string, string];
}> = [
  { pattern: /^Lethal Pride$/i, family: "karui", spriteNames: ["KaruiJewelCircle1", "KaruiJewelCircle2"] },
  { pattern: /^Brutal Restraint$/i, family: "maraketh", spriteNames: ["MarakethJewelCircle1", "MarakethJewelCircle2"] },
  { pattern: /^Elegant Hubris$/i, family: "eternal", spriteNames: ["EternalEmpireJewelCircle1", "EternalEmpireJewelCircle2"] },
  { pattern: /^Glorious Vanity$/i, family: "vaal", spriteNames: ["VaalJewelCircle1", "VaalJewelCircle2"] },
  { pattern: /^Militant Faith$/i, family: "templar", spriteNames: ["TemplarJewelCircle1", "TemplarJewelCircle2"] },
  { pattern: /^Heroic Tragedy$/i, family: "kalguur", spriteNames: ["KalguurJewelCircle1", "KalguurJewelCircle2"] },
];

function itemIdentity(item: Pick<ImportedPobItem, "name" | "baseType">) {
  return `${item.name}\n${item.baseType}`.trim();
}

export function jewelSocketOverlayName(
  item: Pick<ImportedPobItem, "name" | "baseType" | "text">,
  expansion: boolean,
) {
  const base = item.baseType.trim();
  const suffix = expansion ? "Alt" : "";
  if (/^Crimson Jewel$/i.test(base)) return `JewelSocketActiveRed${suffix}`;
  if (/^Viridian Jewel$/i.test(base)) return `JewelSocketActiveGreen${suffix}`;
  if (/^Cobalt Jewel$/i.test(base)) return `JewelSocketActiveBlue${suffix}`;
  if (/^Prismatic Jewel$/i.test(base)) return `JewelSocketActivePrismatic${suffix}`;
  if (/^Timeless Jewel$/i.test(base) || TIMELESS.some(({ pattern }) => pattern.test(item.name))) {
    return `JewelSocketActiveLegion${suffix}`;
  }
  if (/^Large Cluster Jewel$/i.test(base)) return "JewelSocketActiveAltPurple";
  if (/^Medium Cluster Jewel$/i.test(base)) return "JewelSocketActiveAltBlue";
  if (/^Small Cluster Jewel$/i.test(base)) return "JewelSocketActiveAltRed";
  if (/(?:Eye|Abyss) Jewel$/i.test(base) || /Abyss Jewel/i.test(item.text)) return `JewelSocketActiveAbyss${suffix}`;
  return null;
}

export function timelessJewelVisual(
  item: Pick<ImportedPobItem, "name" | "baseType" | "text">,
): TimelessJewelVisual | null {
  const identity = itemIdentity(item);
  const definition = TIMELESS.find(({ pattern }) => pattern.test(item.name.trim()) || pattern.test(identity));
  if (!definition) return null;
  const radiusLabel = /^Radius:\s*(.+)$/im.exec(item.text)?.[1]?.trim().toLocaleLowerCase();
  return {
    family: definition.family,
    radius: RADIUS_BY_LABEL[radiusLabel || ""] || RADIUS_BY_LABEL.large,
    spriteNames: definition.spriteNames,
  };
}

export function timelessJewelSprites(
  assets: Readonly<Record<string, PassiveTreeSpriteRect>> | undefined,
  visual: TimelessJewelVisual,
) {
  return visual.spriteNames.map((name) => assets?.[name]).filter((entry): entry is PassiveTreeSpriteRect => Boolean(entry));
}
