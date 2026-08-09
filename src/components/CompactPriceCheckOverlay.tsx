import clsx from "clsx";
import {
  Pin,
  PinOff,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent, PointerEventHandler } from "react";
import type {
  PriceCheckDashboardMode,
  PriceCheckModifierFilter,
  PriceCheckSession,
} from "../lib/price-check/types";
import {
  nextPriceCheckAvailability,
  priceCheckAvailabilityDescription,
  priceCheckAvailabilityLabel,
  type PriceCheckAvailability,
} from "../lib/price-check/availability";
import { isOfficialPriceCheckFilter } from "../lib/price-check/equipment-properties";
import {
  defaultPriceCheckModeForItem,
  officialTradeNeedsExplicitSearch,
  priceCheckItemForMode,
  priceCheckModesForItem,
} from "../lib/price-check/official-trade-workflow";
import { supportsCompactModifierEditor } from "../lib/price-check/query-plan";
import {
  COMPACT_ITEM_STATE_ONE_ROW_HEIGHT,
  CompactRareModifierEditor,
  compactPriceCheckItemStateStripHeight,
  compactPriceCheckModifierRowsHeight,
} from "./CompactRareModifierEditor";
import { CompactTradeListings } from "./CompactTradeListings";
import {
  unidentifiedUniqueCandidates,
  UnidentifiedUniqueResolver,
} from "./UnidentifiedUniqueResolver";
import "../compact-price-check.css";

interface CompactPriceCheckOverlayProps {
  session: PriceCheckSession;
  mode?: PriceCheckDashboardMode;
  pinned: boolean;
  hotkey: string;
  /** Actual native card height after work-area clamping. */
  panelHeight?: number;
  onClose: () => void;
  onMovePointerDown?: PointerEventHandler<HTMLElement>;
  onMovePointerMove?: PointerEventHandler<HTMLElement>;
  onMovePointerUp?: PointerEventHandler<HTMLElement>;
  onMovePointerCancel?: PointerEventHandler<HTMLElement>;
  onPinChange: (value: boolean) => void;
  onRetry: () => void;
  onModeChange?: (mode: PriceCheckDashboardMode) => void;
  onIdentifyUnique?: (name: string) => void;
  onOpenDashboard?: () => void;
  availability: PriceCheckAvailability;
  onModifierChange: (
    modifierId: string,
    patch: Partial<PriceCheckModifierFilter>,
  ) => void;
  onItemFilterChange: (
    key: string,
    value: string | number | boolean | undefined,
  ) => void;
  onAvailabilityChange: (value: PriceCheckAvailability) => void;
  onOpenTrade: () => void;
}

function trimmedDecimal(value: number, maximumFractionDigits: number) {
  return value
    .toFixed(maximumFractionDigits)
    .replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")
    .replace(/\.$/, "");
}

export function shortNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${trimmedDecimal(scaled, scaled < 10 ? 2 : scaled < 100 ? 1 : 0)}m`;
  }
  if (value >= 1_000) {
    const scaled = value / 1_000;
    return `${trimmedDecimal(scaled, scaled < 10 ? 2 : scaled < 100 ? 1 : 0)}k`;
  }
  return Number.isInteger(value) ? String(value) : trimmedDecimal(value, 2);
}

function marketValue(chaosValue: number, divineValue: number) {
  return divineValue >= 1
    ? `${shortNumber(divineValue)} DIVINE`
    : `${shortNumber(chaosValue)} CHAOS`;
}

function estimateValue(session: PriceCheckSession) {
  const estimate = session.estimate;
  if (session.sourceStale) return "STALE";
  if (!estimate || estimate.confidence === "low" || estimate.confidence === "none") {
    return "NO PRICE";
  }
  if (estimate.divineValue != null && estimate.divineValue >= 1) {
    return `${shortNumber(estimate.divineValue)} DIVINE`;
  }
  return estimate.chaosValue != null ? `${shortNumber(estimate.chaosValue)} CHAOS` : "-";
}

function marketAge(fetchedAt?: number) {
  if (!fetchedAt) return "POE.NINJA";
  const minutes = Math.max(0, Math.round((Date.now() - fetchedAt) / 60_000));
  if (minutes < 1) return "POE.NINJA NOW";
  if (minutes < 60) return `POE.NINJA ${minutes} MIN`;
  return `POE.NINJA ${Math.round(minutes / 60)} HR`;
}

function itemTitle(session: PriceCheckSession) {
  return session.item?.name || session.item?.baseType || "ITEM";
}

function compactHotkey(hotkey: string) {
  return hotkey
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/\+/g, "+")
    .toUpperCase();
}

interface CompactItemFact {
  key: string;
  label: string;
  description: string;
  priority: number;
}

function compactItemFacts(item: NonNullable<PriceCheckSession["item"]>) {
  const facts: CompactItemFact[] = [];
  const add = (
    key: string,
    label: string,
    description: string,
    priority: number,
  ) => facts.push({ key, label, description, priority });

  if (item.gemLevel != null) {
    add("gem-level", `LVL ${item.gemLevel}`, `Gem level ${item.gemLevel}`, 102);
  }
  if (item.quality != null) {
    add(
      "quality",
      `Q ${item.quality}%`,
      `Quality ${item.quality}%`,
      item.rarity === "gem" ? 101 : 70,
    );
  }
  if (item.mapTier != null) {
    add("map-tier", `TIER ${item.mapTier}`, `Map tier ${item.mapTier}`, 103);
  }
  if (item.itemLevel != null && item.rarity !== "gem") {
    add("item-level", `ILVL ${item.itemLevel}`, `Item level ${item.itemLevel}`, 80);
  }
  if (item.links) {
    add("links", `${item.links} LINKS`, `${item.links} linked sockets`, 104);
  }
  if (item.corrupted) {
    add("corrupted", "CORRUPTED", "Corrupted", 110);
  }
  if (item.foulborn) {
    add("foulborn", "FOULBORN", "Foulborn", 120);
  }
  if (item.vestigial) {
    add("vestigial", "VESTIGIAL", "Vestigial", 121);
  }
  if (item.foil) {
    add("foil", "FOIL", "Foil unique", 122);
  }

  const ordered = facts.sort(
    (left, right) => right.priority - left.priority,
  );
  return {
    all: ordered,
    visible: ordered.slice(0, 3),
  };
}

function stateText(session: PriceCheckSession, hotkey: string) {
  if (session.status === "idle") return compactHotkey(hotkey);
  if (session.status === "parsing" || session.status === "resolving") return "CHECKING";
  if (session.status === "invalid") return "NO ITEM";
  return "FAILED";
}

export const COMPACT_PRICE_CHECK_WIDTH = 460;

/**
 * Auto-searched items render their loading/listing viewport on the first ready
 * frame. Keeping this decision pure lets native geometry and React markup use
 * the same height before the request effect has run.
 */
export function compactPriceCheckReservesOfficialListings(
  session: PriceCheckSession,
) {
  return session.status === "ready" &&
    Boolean(session.item && session.query) &&
    !officialTradeNeedsExplicitSearch(session);
}

export function compactPriceCheckPanelHeight(
  session: PriceCheckSession,
  mode?: PriceCheckDashboardMode,
) {
  if (session.status !== "ready" || !session.item || !session.query) return 72;
  const uniqueCandidates = unidentifiedUniqueCandidates(session.item);
  const resolverHeight = uniqueCandidates.length > 1
    ? 25 + Math.ceil(uniqueCandidates.length / 2) * 33
    : 0;
  const tradeOptionsHeight = session.query.tradeApi === "exchange" ? 0 : 31;
  const presetHeight = priceCheckModesForItem(session.item).length > 1 ? 31 : 0;
  const hasOfficialListings = Boolean(
    session.officialTradeLoading ||
    session.officialTrade ||
    compactPriceCheckReservesOfficialListings(session),
  );
  const exactItemFilters =
    (mode ?? defaultPriceCheckModeForItem(session.item)) !== "similar";
  if (supportsCompactModifierEditor(
    session.item,
    session.query.filters,
    exactItemFilters,
  )) {
    const rowHeight = compactPriceCheckModifierRowsHeight(
      session.item,
      session.query.filters,
    );
    // Awakened owns a fixed twenty-row result budget. Request that budget on
    // the first ready frame; the renderer later trims seller rows against the
    // native work-area clamp without ever shrinking the modifier editor.
    const listingsHeight = hasOfficialListings
      ? 45 + AWAKENED_VISIBLE_TRADE_RESULTS * 25
      : 0;
    const stateStripHeight = compactPriceCheckItemStateStripHeight(
      session.item,
      exactItemFilters,
      session.query.itemFilters,
    );
    const hasVisibleStats = session.query.filters.some(
      (filter) => !filter.advancedOnly,
    );
    // 115px covers the title, item identity, actions, and borders. Awakened
    // opens every non-hidden stat, so the native card always reserves every
    // rendered editor row and never creates an inner modifier scrollbar.
    return presetHeight + tradeOptionsHeight + resolverHeight + 115 +
      stateStripHeight + listingsHeight +
      (hasVisibleStats ? 24 + rowHeight : 0);
  }
  if (hasOfficialListings) {
    // 174px is the non-listing shell plus seller chrome; every visible seller
    // row adds 25px. Keeping twenty slots stable avoids a loading/result jump.
    return presetHeight + tradeOptionsHeight + resolverHeight + 174 +
      AWAKENED_VISIBLE_TRADE_RESULTS * 25;
  }
  const rowCount = session.sourceStale
    ? 0
    : session.matches.filter(
        (match) => match.kind !== "fuzzy" && !match.row.lowConfidence,
      ).slice(0, 8).length;
  return Math.min(520, presetHeight + tradeOptionsHeight + resolverHeight + 137 + Math.max(1, rowCount) * 28);
}

/**
 * A short work area cannot hold an eleven-row item plus full slider tracks.
 * Numeric min/max inputs remain available; only the redundant tracks collapse
 * after seller rows have already reached zero.
 */
export function compactPriceCheckUsesConstrainedModifierRows(
  session: PriceCheckSession,
  panelHeight: number,
  mode?: PriceCheckDashboardMode,
) {
  const exactItemFilters = Boolean(
    session.item &&
      (mode ?? defaultPriceCheckModeForItem(session.item)) !== "similar",
  );
  if (
    session.status !== "ready" ||
    !session.item ||
    !session.query ||
    !Number.isFinite(panelHeight) ||
    !supportsCompactModifierEditor(
      session.item,
      session.query.filters,
      exactItemFilters,
    )
  ) return false;

  const uniqueCandidates = unidentifiedUniqueCandidates(session.item);
  const resolverHeight = uniqueCandidates.length > 1
    ? 25 + Math.ceil(uniqueCandidates.length / 2) * 33
    : 0;
  const tradeOptionsHeight = session.query.tradeApi === "exchange" ? 0 : 31;
  const presetHeight = priceCheckModesForItem(session.item).length > 1 ? 31 : 0;
  const stateStripHeight = compactPriceCheckItemStateStripHeight(
    session.item,
    exactItemFilters,
    session.query.itemFilters,
  );
  const hasVisibleStats = session.query.filters.some(
    (filter) => !filter.advancedOnly,
  );
  if (!hasVisibleStats) return false;
  const fullEditorHeight = compactPriceCheckModifierRowsHeight(
    session.item,
    session.query.filters,
  );
  const fullShellHeight = presetHeight + tradeOptionsHeight + resolverHeight +
    115 + stateStripHeight + 24 + fullEditorHeight;
  return fullShellHeight > panelHeight;
}

/**
 * Bounds only seller rows when native work-area clamping makes the requested
 * card too tall. A zero result means the listing section must be omitted so
 * every non-hidden modifier row and the action bar remain fully visible.
 */
export function compactOfficialListingRowLimit(
  session: PriceCheckSession,
  panelHeight: number,
  mode?: PriceCheckDashboardMode,
) {
  if (
    session.status !== "ready" ||
    !session.item ||
    !session.query ||
    !Number.isFinite(panelHeight)
  ) return 0;

  const uniqueCandidates = unidentifiedUniqueCandidates(session.item);
  const resolverHeight = uniqueCandidates.length > 1
    ? 25 + Math.ceil(uniqueCandidates.length / 2) * 33
    : 0;
  const tradeOptionsHeight = session.query.tradeApi === "exchange" ? 0 : 31;
  const presetHeight = priceCheckModesForItem(session.item).length > 1 ? 31 : 0;
  const exactItemFilters =
    (mode ?? defaultPriceCheckModeForItem(session.item)) !== "similar";
  const modifierEditor = supportsCompactModifierEditor(
    session.item,
    session.query.filters,
    exactItemFilters,
  );
  let capacity: number;

  if (modifierEditor) {
    const stateStripHeight = compactPriceCheckItemStateStripHeight(
      session.item,
      exactItemFilters,
      session.query.itemFilters,
    );
    const hasVisibleStats = session.query.filters.some(
      (filter) => !filter.advancedOnly,
    );
    const showSliders = !compactPriceCheckUsesConstrainedModifierRows(
      session,
      panelHeight,
      mode,
    );
    const editorHeight = compactPriceCheckModifierRowsHeight(
      session.item,
      session.query.filters,
      showSliders,
    );
    const shellHeight = presetHeight + tradeOptionsHeight + resolverHeight + 115 +
      stateStripHeight + (hasVisibleStats ? 24 + editorHeight : 0);
    capacity = Math.floor((panelHeight - shellHeight - 45) / 25);
  } else {
    const shellAndListingChrome = presetHeight + tradeOptionsHeight +
      resolverHeight + 174;
    capacity = Math.floor((panelHeight - shellAndListingChrome) / 25);
  }

  return Math.max(
    0,
    Math.min(AWAKENED_VISIBLE_TRADE_RESULTS, capacity),
  );
}

export function CompactPriceCheckOverlay({
  session,
  mode,
  pinned,
  hotkey,
  panelHeight,
  onClose,
  onMovePointerDown,
  onMovePointerMove,
  onMovePointerUp,
  onMovePointerCancel,
  onPinChange,
  onRetry,
  onModeChange,
  onIdentifyUnique,
  onOpenDashboard,
  availability,
  onModifierChange,
  onItemFilterChange,
  onAvailabilityChange,
  onOpenTrade,
}: CompactPriceCheckOverlayProps) {
  const ready = session.status === "ready" && !!session.item && !!session.query;
  const effectiveMode = session.item
    ? mode ?? defaultPriceCheckModeForItem(session.item)
    : "similar";
  const presetModes = session.item ? priceCheckModesForItem(session.item) : [];
  const contextualItem = session.item
    ? priceCheckItemForMode(session.item, effectiveMode)
    : null;
  const retryable = session.status === "ready" || session.status === "error";
  const validMatches = session.matches.filter(
    (match) => match.kind !== "fuzzy" && !match.row.lowConfidence,
  );
  const matches = session.sourceStale
    ? []
    : validMatches.slice(0, 8);
  const itemIcon = validMatches.find((match) => match.row.icon)?.row.icon || session.item?.iconHint;
  const title = itemTitle(session);
  const subtitle = session.item?.baseType && session.item.baseType !== title
    ? session.item.baseType
    : "";
  const facts = session.item ? compactItemFacts(session.item) : null;
  const waitingForManualTradeSearch = officialTradeNeedsExplicitSearch(session);
  const modifierEditor = Boolean(
    ready && contextualItem && session.query &&
    supportsCompactModifierEditor(
      contextualItem,
      session.query.filters,
      effectiveMode !== "similar",
    ),
  );
  const tradeDrivenEditor = modifierEditor;
  const appliedModifierFilters = modifierEditor
    ? session.query!.filters.filter(
        (filter) =>
          filter.enabled &&
          isOfficialPriceCheckFilter(filter),
      ).length
    : 0;
  const officialRows = (session.officialTrade?.listings || [])
    .filter((listing) => listing.price != null)
    .map((listing) => ({
      id: listing.id,
      amount: listing.price!.amount,
      currency: listing.price!.currency,
      indexedAt: listing.indexed,
      seller: listing.seller.account,
      character: listing.seller.character,
      itemName: listing.item.name,
      baseType: listing.item.baseType,
      icon: listing.item.icon,
      whisper: listing.whisper,
      groupedCount: listing.groupedCount,
      stock: listing.stock,
      exchange: listing.exchange ? {
        haveAmount: listing.exchange.haveAmount,
        itemAmount: listing.exchange.itemAmount,
        stock: listing.exchange.stock,
      } : undefined,
    }));
  const showOfficialListings = Boolean(
    session.officialTradeLoading ||
    session.officialTrade ||
    compactPriceCheckReservesOfficialListings(session),
  );
  const optimisticOfficialLoading = Boolean(
    showOfficialListings &&
    !session.officialTrade &&
    !session.officialTradeLoading,
  );
  const officialListingRowLimit = showOfficialListings
    ? compactOfficialListingRowLimit(
        session,
        panelHeight ?? compactPriceCheckPanelHeight(session, effectiveMode),
        effectiveMode,
      )
    : 0;
  const boundedOfficialRows = officialRows.slice(0, officialListingRowLimit);
  const renderOfficialListings = showOfficialListings &&
    officialListingRowLimit > 0;
  const constrainedModifierRows = modifierEditor &&
    compactPriceCheckUsesConstrainedModifierRows(
      session,
      panelHeight ?? compactPriceCheckPanelHeight(session, effectiveMode),
      effectiveMode,
    );
  const estimate = estimateValue(session);
  const matchSummary = validMatches.length > matches.length
    ? `${matches.length} OF ${validMatches.length}`
    : `${matches.length} ${matches.length === 1 ? "MATCH" : "MATCHES"}`;
  const searchOnEditorExit = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const previous = event.relatedTarget;
    if (
      previous instanceof Element &&
      previous.closest(".pco-rare-editor")
    ) onRetry();
  };

  return (
    <section className="pco" aria-label="PoE item price check">
      <header
        className="pco-top"
        data-overlay-drag-handle
        title="Drag to reposition"
        onPointerDown={onMovePointerDown}
        onPointerMove={onMovePointerMove}
        onPointerUp={onMovePointerUp}
        onPointerCancel={onMovePointerCancel}
      >
        <span className="pco-league" title={session.league || "PoE 1"}>
          {session.league || "POE 1"}
        </span>
        {ready ? (
          <span className={clsx("pco-matched", !tradeDrivenEditor && session.sourceStale && "is-stale")}>
            {tradeDrivenEditor
              ? session.officialTradeLoading
                ? "SEARCHING"
                : session.officialTrade?.stale
                  ? "TRADE STALE"
                  : session.officialTrade?.error
                    ? "TRADE ERROR"
                    : session.officialTrade
                      ? "TRADE LIVE"
                      : "TRADE FILTERS"
              : session.sourceStale
                ? "POE.NINJA STALE"
                : marketAge(session.sourceFetchedAt)}
          </span>
        ) : <span />}
        <nav aria-label="Price check controls">
          {retryable ? (
            <button
              type="button"
              title={waitingForManualTradeSearch ? "Search official Trade" : "Refresh price"}
              aria-label={waitingForManualTradeSearch ? "Search official Trade" : "Refresh price"}
              onClick={onRetry}
            >
              {waitingForManualTradeSearch
                ? <Search size={12} aria-hidden />
                : <RefreshCw size={12} aria-hidden />}
            </button>
          ) : null}
          <button
            type="button"
            title={pinned ? "Unpin" : "Pin"}
            aria-label={pinned ? "Unpin overlay" : "Pin overlay"}
            aria-pressed={pinned}
            className={pinned ? "is-active" : undefined}
            onClick={() => onPinChange(!pinned)}
          >
            {pinned ? <PinOff size={12} aria-hidden /> : <Pin size={12} aria-hidden />}
          </button>
          <button type="button" title="Close" aria-label="Close price check" onClick={onClose}>
            <X size={13} aria-hidden />
          </button>
        </nav>
      </header>

      {!ready ? (
        session.status === "resolving" && session.item ? (
          <div className="pco-resolving" role="status" aria-live="polite">
            <span>
              <strong title={title}>{title}</strong>
              {subtitle ? <small title={subtitle}>{subtitle}</small> : null}
            </span>
            <span className="pco-loader" aria-hidden />
          </div>
        ) : (
          <div className={clsx("pco-empty", session.status)} role="status" aria-live="polite">
            <strong>{stateText(session, hotkey)}</strong>
            {session.status === "parsing" ? (
              <span className="pco-loader" aria-hidden />
            ) : null}
          </div>
        )
      ) : (
        <>
          <UnidentifiedUniqueResolver
            item={session.item!}
            compact
            onIdentify={(name) => onIdentifyUnique?.(name)}
          />
          <div className={clsx("pco-item", `is-${session.item!.rarity}`, itemIcon && "has-icon")}>
            {itemIcon ? <img className="pco-item-art" src={itemIcon} alt="" /> : null}
            <div className="pco-item-name">
              <strong title={title}>{title}</strong>
              {subtitle ? <span title={subtitle}>{subtitle}</span> : null}
            </div>
            {facts?.visible.length ? (
              <div
                className="pco-facts"
                aria-label={facts.all.map((fact) => fact.description).join(", ")}
                title={facts.all.map((fact) => fact.description).join("; ")}
                data-total-facts={facts.all.length}
              >
                {facts.visible.map((fact) => (
                  <b title={fact.description} key={fact.key}>{fact.label}</b>
                ))}
              </div>
            ) : null}
            {tradeDrivenEditor ? (
              <output
                className="pco-filter-count"
                title={`${appliedModifierFilters} official Trade filters selected`}
                aria-label={`${appliedModifierFilters} official Trade filters selected`}
              >
                {session.officialTradeLoading
                  ? "..."
                  : session.officialTrade
                    ? `${session.officialTrade.total} LISTED`
                    : `${appliedModifierFilters} STATS`}
              </output>
            ) : (
              <output
                className={clsx(
                  session.sourceStale && "is-stale",
                  !session.sourceStale && (estimate === "NO PRICE" || estimate === "-") && "is-empty",
                )}
                title={`Estimate: ${estimate}`}
                aria-label={`Estimated value ${estimate}`}
              >
                {estimate}
              </output>
            )}
          </div>

          {presetModes.length > 1 ? (
            <div className="pco-presets" role="group" aria-label="Comparison preset">
              {presetModes.map((preset) => (
                <button
                  type="button"
                  aria-pressed={effectiveMode === preset}
                  className={effectiveMode === preset ? "is-active" : undefined}
                  key={preset}
                  onClick={() => onModeChange?.(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          ) : null}

          {modifierEditor ? (
            <CompactRareModifierEditor
              className="pco-rare-editor"
              item={contextualItem!}
              filters={session.query!.filters}
              itemFilters={session.query!.itemFilters}
              exactItemFilters={effectiveMode !== "similar"}
              showSliders={!constrainedModifierRows}
              onModifierChange={onModifierChange}
              onItemFilterChange={onItemFilterChange}
            />
          ) : null}

          <div className="pco-controls">
            {waitingForManualTradeSearch ? (
              <button
                className="pco-search"
                type="button"
                title="Run this edited official Trade search"
                aria-label="Search official Trade with edited filters"
                onMouseEnter={searchOnEditorExit}
                onClick={onRetry}
              >
                <Search size={11} aria-hidden /> SEARCH
              </button>
            ) : (
              <span className="pco-source">
                {modifierEditor
                  ? ""
                  : matches.length
                    ? matchSummary
                    : ""}
              </span>
            )}
            <button
              className="pco-online"
              type="button"
              title={`${priceCheckAvailabilityDescription(availability)}. Click to change.`}
              aria-label={`Availability: ${priceCheckAvailabilityLabel(availability)}. Click to change.`}
              data-availability={availability}
              onClick={() => onAvailabilityChange(nextPriceCheckAvailability(availability))}
            >
              {priceCheckAvailabilityLabel(availability)}
            </button>
            {onOpenDashboard ? (
              <button
                className="pco-details"
                type="button"
                title="Open detailed price check"
                onClick={onOpenDashboard}
              >
                DETAILS
              </button>
            ) : null}
            <button
              className="pco-trade"
              type="button"
              title={modifierEditor
                ? "Open official Path of Exile Trade with these filters"
                : "Open official Path of Exile Trade"}
              onClick={onOpenTrade}
            >
              TRADE
            </button>
          </div>

          {session.query!.tradeApi !== "exchange" ? (
            <div className="pco-trade-options" aria-label="Trade listing filters">
              <select
                aria-label="Listed age"
                value={String(session.query!.itemFilters.listed || "")}
                onChange={(event) => onItemFilterChange(
                  "listed",
                  event.currentTarget.value || undefined,
                )}
              >
                <option value="">ANY TIME</option>
                <option value="1day">1 DAY</option>
                <option value="3days">3 DAYS</option>
                <option value="1week">1 WEEK</option>
                <option value="2weeks">2 WEEKS</option>
                <option value="1month">1 MONTH</option>
                <option value="2months">2 MONTHS</option>
              </select>
              <select
                aria-label="Listing currency"
                value={String(session.query!.itemFilters.tradeCurrency || "")}
                onChange={(event) => onItemFilterChange(
                  "tradeCurrency",
                  event.currentTarget.value || undefined,
                )}
              >
                <option value="">ANY PRICE</option>
                <option value="chaos">CHAOS</option>
                <option value="divine">DIVINE</option>
                <option value="chaos_divine">CHAOS + DIVINE</option>
              </select>
            </div>
          ) : null}

          {renderOfficialListings ? (
            <CompactTradeListings
              className={clsx(
                "pco-live-listings",
                modifierEditor && "is-with-modifiers",
              )}
              rows={boundedOfficialRows}
              limit={officialListingRowLimit}
              total={session.officialTrade?.total || 0}
              loading={session.officialTradeLoading || optimisticOfficialLoading}
              stale={session.officialTrade?.stale}
              error={session.officialTrade?.error || undefined}
              onRetry={onRetry}
              onOpenTrade={onOpenTrade}
            />
          ) : null}

          {!modifierEditor && !renderOfficialListings ? <div className="pco-results">
            <div className="pco-results-head">
              <span>VALUE</span>
              <span>MATCH</span>
              <span>LISTED</span>
            </div>
            {session.sourceStale ? (
              <div className="pco-no-results is-stale">STALE DATA</div>
            ) : matches.length ? (
              matches.map((match) => (
                <div className="pco-row" key={match.row.key}>
                  <b>
                    {marketValue(match.row.chaosValue, match.row.divineValue)}
                  </b>
                  <span title={[match.row.name, match.row.variant, match.row.baseType].filter(Boolean).join(" / ")}>
                    {match.row.name}
                    {match.row.variant ? ` / ${match.row.variant}` : ""}
                  </span>
                  <span
                    className="pco-listed"
                    aria-label={
                      match.row.listingCount == null
                        ? "Listing count unavailable"
                        : `${match.row.listingCount} listings`
                    }
                  >
                    {match.row.listingCount == null ? "-" : shortNumber(match.row.listingCount)}
                  </span>
                </div>
              ))
            ) : (
              <div className="pco-no-results">NO MATCH</div>
            )}
          </div> : null}
        </>
      )}
    </section>
  );
}
// Awakened renders twenty grouped market rows. Fetching may inspect up to one
// hundred raw listings to obtain those useful seller groups.
export const AWAKENED_VISIBLE_TRADE_RESULTS = 20;
