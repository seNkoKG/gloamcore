import { categoryById } from "../../config/categories";
import type { CategoryDefinition, DataSource } from "../../types";
import type { ParsedPoeItem } from "./types";

export interface PriceCheckCategoryCandidate {
  category: CategoryDefinition;
  source: Exclude<DataSource, "faustus">;
  reason: string;
}

const exchangeClassCategories: Array<[RegExp, string, string]> = [
  [/divination card/i, "divination-cards", "divination card"],
  [/scarab/i, "scarabs", "scarab"],
  [/delirium orb/i, "delirium-orbs", "delirium orb"],
  [/essence/i, "essences", "essence"],
  [/fossil/i, "fossils", "fossil"],
  [/resonator/i, "resonators", "resonator"],
  [/oil/i, "oils", "oil"],
  [/tattoo/i, "tattoos", "tattoo"],
  [/omen/i, "omens", "omen"],
  [/runegraft/i, "runegrafts", "runegraft"],
  [/allflame/i, "allflame-embers", "allflame ember"],
  [/djinn coin/i, "djinn-coins", "djinn coin"],
  [/ducat/i, "ducats", "ducat"],
  [/enshrouding crystal/i, "enshrouding-crystals", "enshrouding crystal"],
  [/astrolabe/i, "astrolabes", "astrolabe"],
  [/artifact/i, "artifacts", "expedition artifact"],
  [
    /valdo(?:['’]s)? puzzle box|\bpuzzle box\b/i,
    "fragments",
    "Valdo's Puzzle Box fragment",
  ],
  [/map fragment|breachstone|splinter/i, "fragments", "fragment"],
];

const uniqueClassCategories: Array<[RegExp, string]> = [
  [/flask/i, "unique-flasks"],
  [/jewel/i, "unique-jewels"],
  [/ring|amulet|belt|talisman/i, "unique-accessories"],
  [/body armour|helmet|glove|boot|shield|quiver/i, "unique-armours"],
  [/weapon|sword|axe|mace|bow|wand|staff|staves|dagger|claw|sceptre|rod/i, "unique-weapons"],
  [/map/i, "unique-maps"],
  [/tincture/i, "unique-tinctures"],
  [/relic/i, "unique-relics"],
];

function sourceFor(category: CategoryDefinition): Exclude<DataSource, "faustus"> {
  if (category.source === "item") return "stash-item";
  return "exchange";
}

function candidate(id: string, reason: string): PriceCheckCategoryCandidate | null {
  const category = categoryById[id];
  return category ? { category, source: sourceFor(category), reason } : null;
}

function pushUnique(
  output: PriceCheckCategoryCandidate[],
  value: PriceCheckCategoryCandidate | null,
) {
  if (value && !output.some((entry) => entry.category.id === value.category.id)) {
    output.push(value);
  }
}

/**
 * Selects the smallest useful set of poe.ninja markets for a copied item.
 * The list is deliberately capped: a price check must not download the whole
 * economy or compete with the game for CPU/network time.
 */
export function priceCheckCategoryCandidates(
  item: ParsedPoeItem,
): PriceCheckCategoryCandidate[] {
  // Aggregate base-type values are not comparable prices for rolled rares or
  // magic items. Their compact checker uses local stat filters and an official
  // Trade handoff, so do not spend network/CPU on a misleading poe.ninja row.
  if (item.rarity === "rare" || item.rarity === "magic") return [];

  const output: PriceCheckCategoryCandidate[] = [];
  const searchable = `${item.itemClass} ${item.name} ${item.baseType}`.trim();

  // A unique's item class wins over words in its name (for example Memory
  // Vault is a helmet, not an Atlas Memory). Keep true specialized unique
  // markets ahead of the generic class buckets.
  if (item.rarity === "unique") {
    if (/forbidden (?:flame|flesh)/i.test(searchable)) {
      pushUnique(output, candidate("forbidden-jewels", "forbidden jewel"));
    } else if (/shrine belt/i.test(searchable)) {
      pushUnique(output, candidate("shrine-belts", "shrine belt"));
    } else {
      for (const [pattern, id] of uniqueClassCategories) {
        if (pattern.test(item.itemClass)) {
          pushUnique(output, candidate(id, "unique item class"));
          break;
        }
      }
    }
    if (output.length) return output;
  }

  for (const [pattern, id, label] of exchangeClassCategories) {
    if (pattern.test(searchable)) pushUnique(output, candidate(id, label));
  }

  if (/gem/i.test(item.itemClass) || item.rarity === "gem") {
    pushUnique(output, candidate("skill-gems", "skill or support gem"));
    if (/imbued/i.test(searchable)) {
      pushUnique(output, candidate("imbued-gems", "imbued gem"));
    }
  }

  if (/wombgift/i.test(searchable)) {
    pushUnique(output, candidate("wombgifts", "wombgift"));
  }
  if (/forbidden (?:flame|flesh)/i.test(searchable)) {
    pushUnique(output, candidate("forbidden-jewels", "forbidden jewel"));
  } else if (/cluster jewel/i.test(searchable)) {
    pushUnique(output, candidate("cluster-jewels", "cluster jewel"));
  }
  if (/chronicle of atzoatl|incursion temple/i.test(searchable)) {
    pushUnique(output, candidate("temples", "incursion temple"));
  }
  if (/\bvaldo(?:['’]s)? map\b/i.test(searchable)) {
    pushUnique(output, candidate("valdo-maps", "Valdo map"));
  }
  if (/\bvial\b/i.test(searchable)) {
    pushUnique(output, candidate("vials", "incursion vial"));
  }
  if (/shrine belt/i.test(searchable)) {
    pushUnique(output, candidate("shrine-belts", "shrine belt"));
  }

  if (/blight-ravaged/i.test(searchable)) {
    pushUnique(output, candidate("blight-ravaged-maps", "blight-ravaged map"));
  } else if (/blighted/i.test(searchable)) {
    pushUnique(output, candidate("blighted-maps", "blighted map"));
  } else if (/map/i.test(item.itemClass)) {
    pushUnique(
      output,
      candidate(item.rarity === "unique" ? "unique-maps" : "maps", "map"),
    );
  }

  if (/invitation/i.test(searchable)) {
    pushUnique(output, candidate("invitations", "atlas invitation"));
  }
  if (/memory/i.test(searchable)) {
    pushUnique(output, candidate("memories", "atlas memory"));
  }
  if (/incubator/i.test(searchable)) {
    pushUnique(output, candidate("incubators", "incubator"));
  }
  if (/beast/i.test(item.itemClass)) {
    pushUnique(output, candidate("beasts", "bestiary beast"));
  }

  if (
    output.length === 0 &&
    (item.rarity === "currency" || /currency/i.test(item.itemClass))
  ) {
    pushUnique(output, candidate("currency", "stackable currency"));
    pushUnique(output, candidate("fragments", "currency fallback"));
  }

  if (output.length === 0) {
    pushUnique(output, candidate("base-types", "crafting base value"));
  }

  return output.slice(0, 3);
}
