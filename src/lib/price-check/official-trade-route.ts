import { isExchangeableItem, resolveTradeTag } from "./magic-base-type";
import type {
  ParsedPoeItem,
  PriceCheckModifierFilter,
  PriceCheckQueryPlan,
} from "./types";

export type OfficialTradeApi = "trade" | "exchange";

const SAFE_SEARCH_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Builds the same browser handoff used by Awakened PoE Trade.
 *
 * Ordinary searches prefer the server-issued search id. The Exchange page
 * does not consume the API POST body directly: its browser state is wrapped
 * as `{ exchange: query }`.
 */
export function buildOfficialTradeBrowserUrl({
  league,
  tradeQuery,
  api = "trade",
  searchId,
  selectedExchangeHave,
}: {
  league: string;
  tradeQuery: Record<string, unknown>;
  api?: OfficialTradeApi;
  searchId?: string;
  selectedExchangeHave?: string;
}) {
  const endpoint = api === "exchange" ? "exchange" : "search";
  const base = `https://www.pathofexile.com/trade/${endpoint}/${encodeURIComponent(league)}`;
  if (api === "trade" && searchId && SAFE_SEARCH_ID.test(searchId)) {
    return `${base}/${encodeURIComponent(searchId)}`;
  }

  const exchangeQuery = tradeQuery.query &&
    typeof tradeQuery.query === "object" &&
    !Array.isArray(tradeQuery.query)
    ? tradeQuery.query as Record<string, unknown>
    : undefined;
  const availableHave = Array.isArray(exchangeQuery?.have)
    ? exchangeQuery.have
    : [];
  const selectedExchangeQuery = selectedExchangeHave &&
    availableHave.includes(selectedExchangeHave)
    ? { ...exchangeQuery, have: [selectedExchangeHave] }
    : exchangeQuery;
  const browserQuery = api === "exchange"
    ? { exchange: selectedExchangeQuery }
    : tradeQuery;
  return `${base}?q=${encodeURIComponent(JSON.stringify(browserQuery))}`;
}

/** Exact port of Awakened's apiToSatisfySearch decision. */
export function officialTradeApiToSatisfySearch(
  item: Pick<ParsedPoeItem, "name" | "baseType">,
  stats: ReadonlyArray<Pick<PriceCheckModifierFilter, "enabled">>,
): OfficialTradeApi {
  if (stats.some((stat) => stat.enabled)) return "trade";
  return resolveTradeTag(item.name, item.baseType) ? "exchange" : "trade";
}

/**
 * Awakened's merchantOnly default is false only for Currency-Exchange items
 * that have not also been added to the legacy bulk endpoint.
 */
export function defaultOfficialTradeStatusFromPinnedItem(
  item: Pick<ParsedPoeItem, "name" | "baseType">,
  onlineOnly = true,
): "securable" | "available" | "any" {
  if (!onlineOnly) return "any";
  const tag = resolveTradeTag(item.name, item.baseType);
  return isExchangeableItem(item.name, item.baseType) && !tag
    ? "available"
    : "securable";
}

function exchangeStatus(
  status: PriceCheckQueryPlan["status"],
): "online" | "onlineleague" | "any" {
  if (status === "any") return "any";
  if (status === "onlineleague") return "onlineleague";
  return "online";
}

export function buildOfficialTradeExchangeQuery(
  item: Pick<ParsedPoeItem, "name" | "baseType" | "stackSize">,
  status: PriceCheckQueryPlan["status"],
  minimum?: number,
) {
  const want = resolveTradeTag(item.name, item.baseType);
  if (!want) return undefined;
  const have = want === "chaos"
    ? ["divine"]
    : want === "divine"
      ? ["chaos"]
      : ["divine", "chaos"];
  const safeMinimum = Number.isSafeInteger(minimum) && Number(minimum) > 0
    ? Number(minimum)
    : undefined;
  return {
    engine: "new" as const,
    query: {
      status: { option: exchangeStatus(status) },
      have,
      want: [want],
      ...(safeMinimum ? { minimum: safeMinimum } : {}),
    },
    sort: { have: "asc" as const },
  };
}
