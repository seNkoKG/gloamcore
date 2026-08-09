import type { ParsedPoeItem } from "./types";

// Awakened only starts a Trade request automatically for item kinds where the
// copied identity is already useful. Ordinary equipment is left at the filter
// editor until the user explicitly searches, which avoids spending a request
// for every rare base they inspect.
const STANDARD_TRADE_ITEM_CLASSES = new Set([
  "abyss jewels",
  "amulets",
  "belts",
  "body armours",
  "boots",
  "bows",
  "charms",
  "claws",
  "daggers",
  "fishing rods",
  "flasks",
  "gloves",
  "grafts",
  "heist blueprints",
  "heist brooches",
  "heist cloaks",
  "heist contracts",
  "heist gear",
  "heist tools",
  "helmets",
  "idols",
  "jewels",
  "maps",
  "one hand axes",
  "one hand maces",
  "one hand swords",
  "quivers",
  "rings",
  "rune daggers",
  "sanctum relics",
  "sceptres",
  "shields",
  "staves",
  "tinctures",
  "trinkets",
  "two hand axes",
  "two hand maces",
  "two hand swords",
  "wands",
  "warstaves",
]);

const ALWAYS_AUTO_SEARCH_CLASSES = new Set([
  "charms",
  "heist blueprints",
  "heist contracts",
  "idols",
  "sanctum relics",
]);

function normalizedItemClass(item: ParsedPoeItem) {
  return item.itemClass.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Mirrors Awakened's smart initial-search decision for a newly copied item. */
export function shouldAutoSearchOfficialTrade(item: ParsedPoeItem) {
  if (item.rarity === "unique" || !item.identified || item.veiled) return true;
  const itemClass = normalizedItemClass(item);
  if (itemClass === "maps") {
    // Awakened starts Valdo maps and the bulk preset used by normal/magic
    // maps immediately. An identified rare map starts on the editable
    // property preset instead, so it waits for the explicit Search action.
    return Boolean(item.mapCompletionReward) || item.rarity !== "rare";
  }
  if (/^charts?$/.test(itemClass)) {
    // Identified rare Charts start on APT's editable Pseudo/property preset;
    // every other non-unique Chart starts on Bulk and searches immediately.
    return item.rarity !== "rare";
  }
  if (ALWAYS_AUTO_SEARCH_CLASSES.has(itemClass)) return true;
  return !STANDARD_TRADE_ITEM_CLASSES.has(itemClass);
}

/** Awakened refreshes trade-only listing controls without auto-submitting stat edits. */
export function shouldAutoSearchOfficialTradeItemFilter(key: string) {
  return key === "listed" || key === "tradeCurrency";
}
