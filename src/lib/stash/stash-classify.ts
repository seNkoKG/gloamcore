import type { GGGStashItem } from "../../types";
import type { StashFamily } from "./stash-types";

/**
 * poe.ninja economy category ids (CategoryDefinition.id) that can price each
 * family. Order matters: the first category that yields a name match wins.
 */
export const STASH_FAMILY_CATEGORIES: Record<StashFamily, string[]> = {
  currency: ["currency"],
  fragment: ["fragments"],
  "divination-card": ["divination-cards"],
  fossil: ["fossils"],
  resonator: ["resonators"],
  scarab: ["scarabs"],
  essence: ["essences"],
  oil: ["oils"],
  catalyst: ["currency"],
  incubator: ["incubators"],
  "delirium-orb": ["delirium-orbs"],
  invitation: ["invitations"],
  tattoo: ["tattoos"],
  omen: ["omens"],
  "djinn-coin": ["djinn-coins"],
  ducat: ["ducats"],
  "enshrouding-crystal": ["enshrouding-crystals"],
  astrolabe: ["astrolabes"],
  "allflame-ember": ["allflame-embers"],
  wombgift: ["wombgifts"],
  runegraft: ["runegrafts"],
  artifact: ["artifacts"],
  vial: ["vials"],
  beast: ["beasts"],
  map: ["maps"],
  "blighted-map": ["blighted-maps"],
  "blight-ravaged-map": ["blight-ravaged-maps"],
  "unique-map": ["unique-maps"],
  "skill-gem": ["skill-gems"],
  "imbued-gem": ["imbued-gems"],
  "cluster-jewel": ["cluster-jewels"],
  "unique-weapon": ["unique-weapons"],
  "unique-armour": ["unique-armours"],
  "unique-accessory": ["unique-accessories"],
  "unique-flask": ["unique-flasks"],
  "unique-jewel": ["unique-jewels"],
  "unique-relic": ["unique-relics"],
  "shrine-belt": ["shrine-belts"],
  "unique-tincture": ["unique-tinctures"],
  "forbidden-jewel": ["forbidden-jewels"],
  memory: ["memories"],
  temple: ["temples"],
  "base-type": ["base-types"],
  other: [],
};

/**
 * Unique families tried as a fallback for any frameType 3 item, because a
 * unique's stash category key is not always enough to pin its poe.ninja row.
 */
export const UNIQUE_FAMILIES: StashFamily[] = [
  "unique-weapon",
  "unique-armour",
  "unique-accessory",
  "unique-flask",
  "unique-jewel",
  "unique-relic",
  "shrine-belt",
  "unique-tincture",
  "forbidden-jewel",
  "unique-map",
];

export const STASH_FAMILY_LABELS: Record<StashFamily, string> = {
  currency: "Currency",
  fragment: "Fragments",
  "divination-card": "Divination cards",
  fossil: "Fossils",
  resonator: "Resonators",
  scarab: "Scarabs",
  essence: "Essences",
  oil: "Oils",
  catalyst: "Catalysts",
  incubator: "Incubators",
  "delirium-orb": "Delirium orbs",
  invitation: "Invitations",
  tattoo: "Tattoos",
  omen: "Omens",
  "djinn-coin": "Djinn coins",
  ducat: "Ducats",
  "enshrouding-crystal": "Enshrouding crystals",
  astrolabe: "Astrolabes",
  "allflame-ember": "Allflame embers",
  wombgift: "Wombgifts",
  runegraft: "Runegrafts",
  artifact: "Artifacts",
  vial: "Vials",
  beast: "Beasts",
  map: "Maps",
  "blighted-map": "Blighted maps",
  "blight-ravaged-map": "Blight-ravaged maps",
  "unique-map": "Unique maps",
  "skill-gem": "Skill gems",
  "imbued-gem": "Imbued gems",
  "cluster-jewel": "Cluster jewels",
  "unique-weapon": "Unique weapons",
  "unique-armour": "Unique armour",
  "unique-accessory": "Unique accessories",
  "unique-flask": "Unique flasks",
  "unique-jewel": "Unique jewels",
  "unique-relic": "Unique relics",
  "shrine-belt": "Shrine belts",
  "unique-tincture": "Unique tinctures",
  "forbidden-jewel": "Forbidden jewels",
  memory: "Memories",
  temple: "Temples",
  "base-type": "Base types",
  other: "Other",
};

export const STASH_FAMILY_ORDER: StashFamily[] = [
  "currency",
  "fragment",
  "divination-card",
  "fossil",
  "resonator",
  "scarab",
  "essence",
  "oil",
  "catalyst",
  "incubator",
  "delirium-orb",
  "invitation",
  "tattoo",
  "omen",
  "djinn-coin",
  "ducat",
  "enshrouding-crystal",
  "astrolabe",
  "allflame-ember",
  "wombgift",
  "runegraft",
  "artifact",
  "vial",
  "beast",
  "map",
  "blighted-map",
  "blight-ravaged-map",
  "unique-map",
  "skill-gem",
  "imbued-gem",
  "cluster-jewel",
  "unique-weapon",
  "unique-armour",
  "unique-accessory",
  "unique-flask",
  "unique-jewel",
  "unique-relic",
  "shrine-belt",
  "unique-tincture",
  "forbidden-jewel",
  "memory",
  "temple",
  "base-type",
  "other",
];

function typeName(item: GGGStashItem) {
  return `${item?.typeLine || ""} ${item?.baseType || ""} ${item?.name || ""}`;
}

function hasCategory(item: GGGStashItem, key: string) {
  return Boolean(item?.category && Array.isArray(item.category[key]) && item.category[key].length > 0);
}

/**
 * Maps a GGG stash item to the wealth family that prices it. Rares, magic and
 * normal gear have no aggregate market identity and land in "other".
 */
export function classifyStashItem(item: GGGStashItem): StashFamily {
  if (!item || typeof item !== "object") return "other";
  const frameType = Number(item.frameType);
  const text = typeName(item);
  const typeLine = String(item.typeLine || "");

  if (frameType === 6 || hasCategory(item, "cards")) return "divination-card";

  // Fragments, beasts and vials sit in currency-like GGG frames but have their
  // own poe.ninja categories, so they must win before currency name rules.
  if (hasCategory(item, "fragments") || /^Fragment of /.test(typeLine)) return "fragment";
  if (hasCategory(item, "beasts") || hasCategory(item, "monsters")) return "beast";
  if (/^Vial of /.test(typeLine)) return "vial";

  const currencyLike =
    frameType === 5 || hasCategory(item, "currency") || hasCategory(item, "catalysts");

  if (currencyLike) {
    if (hasCategory(item, "fossils") || /Fossil$/.test(typeLine)) return "fossil";
    if (hasCategory(item, "resonators") || /Resonator$/.test(typeLine)) return "resonator";
    if (hasCategory(item, "scarabs") || /Scarab/.test(typeLine)) return "scarab";
    if (hasCategory(item, "essences") || /^Essence of /.test(typeLine)) return "essence";
    if (hasCategory(item, "oils") || / Oil$/.test(typeLine)) return "oil";
    if (/ Catalyst$/.test(typeLine)) return "catalyst";
    if (/Incubator/.test(typeLine)) return "incubator";
    if (/Delirium Orb/.test(typeLine)) return "delirium-orb";
    if (/Invitation/.test(typeLine)) return "invitation";
    if (/^Tattoo of /.test(typeLine)) return "tattoo";
    if (/^Omen of /.test(typeLine)) return "omen";
    if (/Djinn Coin/.test(typeLine)) return "djinn-coin";
    if (/Ducat/.test(typeLine)) return "ducat";
    if (/Enshrouding Crystal/.test(typeLine)) return "enshrouding-crystal";
    if (/Astrolabe/.test(typeLine)) return "astrolabe";
    if (/Allflame/.test(typeLine)) return "allflame-ember";
    if (/Wombgift/.test(typeLine)) return "wombgift";
    if (/Runegraft/.test(typeLine)) return "runegraft";
    if (hasCategory(item, "artifacts") || /Artifact$/.test(typeLine)) return "artifact";
    return "currency";
  }

  if (hasCategory(item, "fragments") || /^Fragment of /.test(typeLine)) return "fragment";
  if (hasCategory(item, "beasts") || hasCategory(item, "monsters")) return "beast";
  if (/^Vial of /.test(typeLine)) return "vial";
  if (/Chronicle of Atzoatl/.test(text)) return "temple";
  if (/Memory of /.test(typeLine) || hasCategory(item, "memories")) return "memory";

  if (hasCategory(item, "maps") || / Map$/.test(typeLine) || / Map$/.test(String(item.baseType || ""))) {
    if (/Blight-ravaged/.test(text)) return "blight-ravaged-map";
    if (/Blighted/.test(text)) return "blighted-map";
    if (frameType === 3) return "unique-map";
    return "map";
  }

  if (frameType === 4 || hasCategory(item, "gems")) {
    if (/Imbued/.test(text)) return "imbued-gem";
    return "skill-gem";
  }

  if (frameType === 3) {
    if (hasCategory(item, "jewels")) return "unique-jewel";
    if (hasCategory(item, "flasks")) return "unique-flask";
    if (hasCategory(item, "weapons")) return "unique-weapon";
    if (hasCategory(item, "armour")) return "unique-armour";
    if (hasCategory(item, "accessories")) return "unique-accessory";
    if (/Shrine/.test(typeLine)) return "shrine-belt";
    if (/Tincture/.test(typeLine)) return "unique-tincture";
    if (/Relic/.test(typeLine)) return "unique-relic";
    if (/Forbidden/.test(typeLine)) return "forbidden-jewel";
    return "unique-weapon";
  }

  if (hasCategory(item, "jewels") && /Cluster Jewel/.test(String(item.baseType || typeLine))) {
    return "cluster-jewel";
  }

  // Rares, magic and normal gear have no aggregate market identity.
  return "other";
}

/** categoryIds (CategoryDefinition.id) needed to price every given family. */
export function categoryIdsForFamilies(families: Iterable<StashFamily>) {
  const seen = new Set<string>();
  for (const family of families) {
    for (const categoryId of STASH_FAMILY_CATEGORIES[family] || []) {
      seen.add(categoryId);
    }
  }
  return [...seen];
}

export function isStackableItem(item: GGGStashItem) {
  const stack = Number(item?.stackSize);
  return Number.isFinite(stack) && stack > 1;
}