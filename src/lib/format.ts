import type { EconomyRow, ValueDisplay } from "../types";
import { forbiddenPassiveTradeOptions } from "../data/forbidden-trade-options";
import {
  buildOfficialTradeBrowserUrl,
  buildOfficialTradeExchangeQuery,
} from "./price-check/official-trade-route";

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const preciseFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function formatCompact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1000) return preciseFormatter.format(value);
  return compactFormatter.format(value);
}

export function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return compactFormatter.format(value);
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2).replace(/0$/, "");
  if (value >= 0.01) return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return value.toPrecision(2);
}

export function displayPrice(row: EconomyRow, display: ValueDisplay) {
  if (display === "chaos") {
    return { value: row.chaosValue, unit: "chaos" as const };
  }
  if (display === "divine") {
    return { value: row.divineValue, unit: "divine" as const };
  }
  if (row.divineValue != null && row.divineValue >= 1) {
    return { value: row.divineValue, unit: "divine" as const };
  }
  return { value: row.chaosValue, unit: "chaos" as const };
}

export function formatRelativeTime(timestamp: number) {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatRemaining(timestamp: number) {
  const delta = timestamp - Date.now();
  if (delta <= 0) return "ready";
  const minutes = Math.ceil(delta / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}

export function cleanWikiName(name: string) {
  return name
    .replace(/^Foulborn\s+/i, "")
    .replace(/,\s.+$/, "")
    .trim();
}

export function poeWikiUrl(item: EconomyRow | string) {
  const name = typeof item === "string" ? item : item.name;
  const wikiName =
    typeof item !== "string" &&
    !/^Foulborn\s/i.test(name) &&
    /\(.+\)/.test(name) &&
    item.baseType
      ? item.baseType
      : cleanWikiName(name);
  return `https://www.poewiki.net/wiki/${encodeURIComponent(wikiName.replace(/ /g, "_"))}`;
}

export function poeNinjaUrl(
  league: string,
  categoryId: string,
  detailsId?: string,
) {
  const knownLeagueSlugs: Record<string, string> = {
    Standard: "standard",
    Hardcore: "hardcore",
    Allflame: "allflame",
    "Hardcore Allflame": "allflamehc",
  };
  const leagueSlug =
    knownLeagueSlugs[league] ?? league.toLowerCase().replace(/\s+/g, "-");
  const base = `https://poe.ninja/poe1/economy/${encodeURIComponent(leagueSlug)}/${categoryId}`;
  return detailsId ? `${base}/${encodeURIComponent(detailsId)}` : base;
}

const uniqueCategories = new Set([
  "unique-weapons",
  "unique-armours",
  "unique-accessories",
  "unique-flasks",
  "unique-jewels",
  "forbidden-jewels",
  "shrine-belts",
  "unique-tinctures",
  "unique-relics",
  "unique-maps",
]);

const mapCategories = new Set([
  "maps",
  "blighted-maps",
  "blight-ravaged-maps",
  "valdo-maps",
]);

function influenceFilters(variant?: string) {
  if (!variant) return {};
  const filters: Record<string, { option: true }> = {};
  const influences = [
    ["Shaper", "shaper_item"],
    ["Elder", "elder_item"],
    ["Crusader", "crusader_item"],
    ["Redeemer", "redeemer_item"],
    ["Hunter", "hunter_item"],
    ["Warlord", "warlord_item"],
  ] as const;
  for (const [label, key] of influences) {
    if (variant.includes(label)) filters[key] = { option: true };
  }
  return filters;
}

export function buildTradeQuery(row: EconomyRow) {
  if (row.tradeFilter?.query) {
    return {
      query: {
        status: { option: "any" },
        ...row.tradeFilter.query,
      },
      sort: { price: "asc" },
    };
  }

  const miscFilters: Record<string, unknown> = {
    ...(row.corrupted != null
      ? { corrupted: { option: row.corrupted } }
      : {}),
    ...(row.gemLevel != null ? { gem_level: { min: row.gemLevel } } : {}),
    ...(row.gemQuality != null ? { quality: { min: row.gemQuality } } : {}),
    ...(row.categoryId === "base-types" && row.levelRequired != null
      ? { ilvl: { min: row.levelRequired } }
      : {}),
    ...(row.categoryId === "base-types"
      ? influenceFilters(row.variant)
      : {}),
    ...(/^Foulborn\s/i.test(row.name)
      ? { mutated: { option: true } }
      : {}),
  };

  const forbiddenVariant =
    row.categoryId === "forbidden-jewels" &&
    (row.variant === "Forbidden Flame" || row.variant === "Forbidden Flesh")
      ? row.variant
      : null;
  const forbiddenPassive =
    typeof row.metadata?.passiveName === "string"
      ? row.metadata.passiveName
      : row.name;
  const forbiddenOption = forbiddenVariant
    ? forbiddenPassiveTradeOptions[forbiddenPassive]
    : undefined;
  if (forbiddenVariant && !forbiddenOption) return null;
  const forbiddenStat = forbiddenVariant && forbiddenOption
    ? forbiddenVariant === "Forbidden Flame"
      ? `explicit.stat_1190333629|${forbiddenOption}`
      : `explicit.stat_2460506030|${forbiddenOption}`
    : null;

  const stats = [
    ...(row.tradeInfo || []),
    ...(forbiddenStat ? [{ mod: forbiddenStat }] : []),
  ]
    .filter((entry) => entry.mod)
    .map((entry) => {
      const hasUsefulRange =
        (entry.min != null && entry.min !== 0) ||
        (entry.max != null && entry.max !== 0);
      return {
        id:
          entry.option && !entry.mod!.includes("|")
            ? `${entry.mod}|${entry.option}`
            : entry.mod!,
        ...(hasUsefulRange
          ? {
              value: {
                ...(entry.min != null ? { min: entry.min } : {}),
                ...(entry.max != null ? { max: entry.max } : {}),
              },
            }
          : {}),
      };
    });

  const identity =
    forbiddenVariant
      ? { name: forbiddenVariant, ...(row.baseType ? { type: row.baseType } : {}) }
      : row.categoryId === "base-types"
      ? { type: row.name }
      : mapCategories.has(row.categoryId)
        ? { term: row.name }
        : uniqueCategories.has(row.categoryId) || /^Foulborn\s/i.test(row.name)
          ? {
              name: cleanWikiName(row.name),
              ...(row.baseType ? { type: row.baseType } : {}),
            }
          : { type: row.baseType || cleanWikiName(row.name) };

  return {
    query: {
      status: { option: "any" },
      ...identity,
      ...(stats.length
        ? { stats: [{ type: "and", filters: stats }] }
        : {}),
      filters: {
        ...(Object.keys(miscFilters).length
          ? { misc_filters: { filters: miscFilters } }
          : {}),
        ...(row.links
          ? {
              socket_filters: {
                filters: { links: { min: row.links, max: row.links } },
              },
            }
          : {}),
      },
    },
    sort: { price: "asc" },
  };
}

export function tradeUrl(row: EconomyRow, league: string) {
  if (
    row.source === "exchange" ||
    row.source === "stash-currency" ||
    row.source === "faustus"
  ) {
    const exchangeQuery = buildOfficialTradeExchangeQuery(
      {
        name: row.name,
        baseType: row.baseType || row.name,
        stackSize: row.stackSize,
      },
      "any",
    );
    if (exchangeQuery) {
      return buildOfficialTradeBrowserUrl({
        league,
        api: "exchange",
        tradeQuery: exchangeQuery,
      });
    }
  }

  const tradeQuery = buildTradeQuery(row);
  if (!tradeQuery) return null;
  return buildOfficialTradeBrowserUrl({
    league,
    tradeQuery,
  });
}
