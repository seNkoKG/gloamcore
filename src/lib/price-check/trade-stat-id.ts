import type {
  ParsedPoeModifier,
  PriceCheckModifierFilter,
} from "./types";

/**
 * The official registry is data-driven and adds namespaces/key families over
 * time (for example `crucible.mod_*` and `mercenary.skill_*`). Validate the
 * conservative wire shape instead of maintaining a lossy family allowlist.
 * Pipe-qualified selectors remain opaque parts of the ID.
 */
export const OFFICIAL_TRADE_STAT_ID =
  /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{1,126}(?:\|\d{1,10}){0,2}$/;

export function isOfficialTradeStatId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 160 &&
    OFFICIAL_TRADE_STAT_ID.test(value)
  );
}

/** Valid, de-duplicated IDs carried by a parsed modifier or planned filter. */
export function officialTradeStatIds(value: {
  tradeId?: string;
  tradeIds?: string[];
  modifierId?: string;
  id?: string;
}) {
  const candidates = value.tradeIds?.length
    ? value.tradeIds
    : [value.tradeId || value.modifierId || value.id];
  return [...new Set(candidates.filter(isOfficialTradeStatId))];
}

/** True when the opaque official ID includes one or two choice selectors. */
export function isSelectorTradeStatId(value: unknown): value is string {
  return isOfficialTradeStatId(value) && value.includes("|");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Numeric editability must come from trusted parsed/planned semantics, never
 * from user-editable min/max state. This keeps value-less official stats such
 * as Megalomaniac notables presence-only even if a stale or adversarial state
 * snapshot tries to attach an exact/range value.
 */
export function hasNumericPriceCheckSemantics(
  filter: Pick<
    PriceCheckModifierFilter,
    "bounds" | "copiedValue"
  >,
  modifier?: Pick<ParsedPoeModifier, "values">,
) {
  return finite(filter.copiedValue) ||
    finite(filter.bounds?.min) ||
    finite(filter.bounds?.max) ||
    Boolean(modifier?.values.some(finite));
}

export function isPresenceOnlyPriceCheckFilter(
  filter: Pick<
    PriceCheckModifierFilter,
    "bounds" | "copiedValue" | "tradeOption"
  >,
  modifier?: Pick<ParsedPoeModifier, "values">,
) {
  return filter.tradeOption != null ||
    !hasNumericPriceCheckSemantics(filter, modifier);
}

/** Removes fabricated numeric state while preserving the trusted filter. */
export function sanitizePresenceOnlyPriceCheckFilter(
  filter: PriceCheckModifierFilter,
  modifier?: Pick<ParsedPoeModifier, "values">,
): PriceCheckModifierFilter {
  if (!isPresenceOnlyPriceCheckFilter(filter, modifier)) return filter;
  const { min: _min, max: _max, ...withoutNumericState } = filter;
  return { ...withoutNumericState, mode: "presence" };
}
