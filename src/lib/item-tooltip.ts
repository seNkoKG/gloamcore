import { bridge } from "./bridge";
import { normalizeItemTooltip } from "./item-tooltip-data";
import type { EconomyRow, ItemTooltipData, ItemTooltipRequest } from "../types";

const tooltipCache = new Map<string, Promise<ItemTooltipData | null>>();

function requestForRow(
  row: Pick<
    EconomyRow,
    "name" | "baseType" | "categoryId" | "detailsId"
  >,
): ItemTooltipRequest {
  return {
    name: row.name,
    baseType: row.baseType,
    categoryId: row.categoryId,
    detailsId: row.detailsId,
  };
}

async function requestTooltip(request: ItemTooltipRequest) {
  try {
    const envelope = await bridge.getItemTooltip(request);
    return normalizeItemTooltip(envelope.data, request);
  } catch {
    return null;
  }
}

export function loadItemTooltip(
  row: Pick<
    EconomyRow,
    "name" | "baseType" | "categoryId" | "detailsId"
  >,
) {
  const request = requestForRow(row);
  const key = `${request.name}:${request.baseType || ""}`.toLowerCase();
  const existing = tooltipCache.get(key);
  if (existing) return existing;
  const pending = requestTooltip(request).then(async (result) => {
    if (result || !request.name.startsWith("Foulborn ")) return result;
    const fallback = {
      ...request,
      name: request.name.slice("Foulborn ".length),
      detailsId: undefined,
    };
    return requestTooltip(fallback);
  });
  tooltipCache.set(key, pending);
  return pending;
}

export function clearItemTooltipCache() {
  tooltipCache.clear();
}

export { normalizeItemTooltip } from "./item-tooltip-data";
