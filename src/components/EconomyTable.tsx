import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  ShieldQuestion,
  Star,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  DataSource,
  Density,
  EconomyRow,
  ItemTooltipData,
  RawExchangeItem,
  SortKey,
  SortState,
  ValueDisplay,
} from "../types";
import { displayPrice, formatCompact, formatPrice } from "../lib/format";
import { loadItemTooltip } from "../lib/item-tooltip";
import { CurrencyMark } from "./CurrencyMark";
import { ItemMarketTooltip } from "./ItemMarketTooltip";
import { Sparkline } from "./Sparkline";

function SortHeader({
  label,
  sortKey,
  activeSort,
  align = "left",
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortState;
  align?: "left" | "right";
  onSort: (key: SortKey) => void;
}) {
  const active = activeSort.key === sortKey;
  return (
    <button
      className={clsx("sort-header", `sort-header--${align}`, active && "is-active")}
      type="button"
      aria-label={`Sort by ${label}${active ? `, currently ${activeSort.direction === "desc" ? "high to low" : "low to high"}` : ""}`}
      title={`Sort by ${label}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active ? (
        activeSort.direction === "desc" ? (
          <ArrowDown size={13} />
        ) : (
          <ArrowUp size={13} />
        )
      ) : (
        <ArrowUpDown size={12} />
      )}
    </button>
  );
}

function MostPopular({
  row,
  items,
}: {
  row: EconomyRow;
  items: Record<string, RawExchangeItem>;
}) {
  if (!row.maxVolumeCurrency || !row.maxVolumeRate) return <span className="muted">—</span>;
  const paired = items[row.maxVolumeCurrency];
  const rate = row.maxVolumeRate > 0 ? 1 / row.maxVolumeRate : 0;
  const image = paired?.image || paired?.icon;
  const icon = image
    ? image.startsWith("http")
      ? image
      : `https://web.poecdn.com${image.startsWith("/") ? "" : "/"}${image}`
    : undefined;
  return (
    <div className="popular-pair" title={`1 ${row.name} ≈ ${formatPrice(rate)} ${paired?.name || row.maxVolumeCurrency}`}>
      <strong>{formatPrice(rate)}</strong>
      {icon ? <img src={icon} alt="" /> : <CurrencyMark unit={row.maxVolumeCurrency} />}
      <span>⇄</span>
      <em>1.0</em>
      {row.icon ? <img src={row.icon} alt="" /> : null}
    </div>
  );
}

function FaustusRange({
  row,
  onTrade,
}: {
  row: EconomyRow;
  onTrade: (row: EconomyRow) => void;
}) {
  const minimum = row.faustus?.minimumChaos;
  const maximum = row.faustus?.maximumChaos;
  if (minimum == null || maximum == null) {
    return <span className="muted">—</span>;
  }

  return (
    <div
      className="faustus-range"
      title={`Official Faustus hourly range: ${formatPrice(minimum)}–${formatPrice(maximum)} Chaos Orbs`}
    >
      <div>
        <strong>
          {formatPrice(minimum)}
          <span>–</span>
          {formatPrice(maximum)}
        </strong>
        <small>chaos</small>
      </div>
      <button
        className="trade-button trade-button--icon"
        type="button"
        title="Open the official Currency Exchange"
        aria-label={`Trade ${row.name} on the official Currency Exchange`}
        onClick={(event) => {
          event.stopPropagation();
          onTrade(row);
        }}
      >
        <ExternalLink size={12} />
      </button>
    </div>
  );
}

export function EconomyTable({
  source,
  rows,
  visibleRows,
  display,
  density,
  sort,
  items,
  selectedKey,
  watchKeys,
  onSort,
  onSelect,
  onWatch,
  onTrade,
  onShowMore,
}: {
  source: DataSource;
  rows: EconomyRow[];
  visibleRows: EconomyRow[];
  display: ValueDisplay;
  density: Density;
  sort: SortState;
  items: Record<string, RawExchangeItem>;
  selectedKey?: string;
  watchKeys: Set<string>;
  onSort: (key: SortKey) => void;
  onSelect: (row: EconomyRow) => void;
  onWatch: (row: EconomyRow) => void;
  onTrade: (row: EconomyRow) => void;
  onShowMore: () => void;
}) {
  const [tooltip, setTooltip] = useState<{
    row: EconomyRow;
    anchor: DOMRect;
    itemInfo: ItemTooltipData | null;
    loading: boolean;
  } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const requestId = useRef(0);
  const isExchange = source === "exchange";
  const isFaustus = source === "faustus";
  const isCurrencyMarket = isExchange || isFaustus;
  const hasLevel = rows.some(
    (row) => row.levelRequired != null || row.gemLevel != null || row.mapTier != null,
  );
  const hasQuality = rows.some((row) => row.gemQuality != null);
  const levelLabel = rows.some((row) => row.mapTier != null)
    ? "Tier"
    : rows.some((row) => row.gemLevel != null)
      ? "Gem level"
      : rows[0]?.categoryId === "base-types"
        ? "Item level"
        : "Required level";

  const cancelClose = () => clearTimeout(closeTimer.current);
  const closeTooltip = (delay = 100) => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      requestId.current += 1;
      setTooltip(null);
    }, delay);
  };
  const openTooltip = (
    row: EconomyRow,
    element: HTMLElement,
    delay = 220,
  ) => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    const anchor = element.getBoundingClientRect();
    openTimer.current = setTimeout(() => {
      const nextRequest = requestId.current + 1;
      requestId.current = nextRequest;
      setTooltip({ row, anchor, itemInfo: null, loading: true });
      void loadItemTooltip(row).then((itemInfo) => {
        if (requestId.current !== nextRequest) return;
        setTooltip({ row, anchor, itemInfo, loading: false });
      });
    }, delay);
  };

  useEffect(() => {
    const dismiss = () => {
      requestId.current += 1;
      setTooltip(null);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const dismissOnOutsideScroll = (event: Event) => {
      const target = event.target;
      const card = document.getElementById("item-market-tooltip");
      if (target instanceof Node && card?.contains(target)) return;
      dismiss();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismissOnOutsideScroll, true);
    window.addEventListener("keydown", dismissWithEscape);
    return () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismissOnOutsideScroll, true);
      window.removeEventListener("keydown", dismissWithEscape);
    };
  }, []);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <ShieldQuestion size={30} />
        </div>
        <h3>No matching prices</h3>
        <p>
          {isFaustus
            ? "No completed-hour Faustus market was found for these filters. Try resetting filters or switch to Ninja."
            : "Try a wider price range, reset filters, or include low-confidence rows."}
        </p>
      </div>
    );
  }

  return (
    <div className={clsx("economy-table-wrap", `density-${density}`)}>
      <table className="economy-table">
        <thead>
          <tr>
            <th className="watch-column" aria-label="Watchlist" />
            <th>
              <SortHeader
                label="Name"
                sortKey="name"
                activeSort={sort}
                onSort={onSort}
              />
            </th>
            {hasLevel && (
              <th className="optional-column">
                <SortHeader
                  label={levelLabel}
                  sortKey="level"
                  activeSort={sort}
                  align="right"
                  onSort={onSort}
                />
              </th>
            )}
            {hasQuality && (
              <th className="optional-column">
                <SortHeader
                  label="Quality"
                  sortKey="quality"
                  activeSort={sort}
                  align="right"
                  onSort={onSort}
                />
              </th>
            )}
            <th>
              <SortHeader
                label="Value"
                sortKey="value"
                activeSort={sort}
                align="right"
                onSort={onSort}
              />
            </th>
            <th>
              <SortHeader
                label={isFaustus ? "Last 7 hours" : "Last 7 days"}
                sortKey="change"
                activeSort={sort}
                align="right"
                onSort={onSort}
              />
            </th>
            <th className="liquidity-column">
              <SortHeader
                label={
                  isFaustus
                    ? "Traded / hour"
                    : isExchange
                      ? "Volume / hour"
                      : "# Listed"
                }
                sortKey={isCurrencyMarket ? "volume" : "listed"}
                activeSort={sort}
                align="right"
                onSort={onSort}
              />
            </th>
            <th className="popular-column">
              {isFaustus
                ? "Hourly range"
                : isExchange
                  ? "Most traded pair"
                  : "Market"}
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const price = displayPrice(row, display);
            const isWatched = watchKeys.has(row.key);
            const level = row.gemLevel ?? row.levelRequired ?? row.mapTier;
            return (
              <tr
                key={row.key}
                className={clsx(
                  selectedKey === row.key && "is-selected",
                  row.lowConfidence && "is-low-confidence",
                )}
                onClick={() => onSelect(row)}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) {
                    openTooltip(row, event.currentTarget, 80);
                  }
                }}
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  const card = document.getElementById("item-market-tooltip");
                  if (nextTarget instanceof Node && card?.contains(nextTarget)) {
                    cancelClose();
                    return;
                  }
                  closeTooltip();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(row);
                }}
                tabIndex={0}
              >
                <td className="watch-cell">
                  <button
                    className={clsx("watch-button", isWatched && "is-active")}
                    type="button"
                    title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onWatch(row);
                    }}
                  >
                    <Star size={15} fill={isWatched ? "currentColor" : "none"} />
                  </button>
                </td>
                <td>
                  <div
                    className="item-identity item-tooltip-trigger"
                    aria-describedby={
                      tooltip?.row.key === row.key
                        ? "item-market-tooltip"
                        : undefined
                    }
                    onMouseEnter={(event) =>
                      openTooltip(row, event.currentTarget)
                    }
                    onMouseLeave={() => closeTooltip()}
                  >
                    <div className="item-icon">
                      {row.icon ? (
                        <img src={row.icon} alt="" loading="lazy" />
                      ) : (
                        <span>{row.name.slice(0, 1)}</span>
                      )}
                    </div>
                    <div>
                      <strong>{row.name}</strong>
                      {(row.variant || row.baseType) && (
                        <span>
                          {row.variant}
                          {row.variant && row.baseType ? " · " : ""}
                          {row.baseType}
                        </span>
                      )}
                      {row.lowConfidence && (
                        <em title={`${row.confidenceReason || "Very little market data"}; verify the current market before buying`}>
                          {isFaustus
                            ? "GUARDED OFFICIAL MARKET"
                            : "UNRELIABLE ESTIMATE"}
                        </em>
                      )}
                    </div>
                  </div>
                </td>
                {hasLevel && (
                  <td className="numeric optional-column">
                    {level ?? <span className="muted">—</span>}
                  </td>
                )}
                {hasQuality && (
                  <td className="numeric optional-column">
                    {row.gemQuality != null ? `${row.gemQuality}%` : <span className="muted">—</span>}
                  </td>
                )}
                <td className="value-cell">
                  <div className="value-primary">
                    <strong>{row.lowConfidence ? "~" : ""}{formatPrice(price.value)}</strong>
                    <CurrencyMark unit={price.unit} />
                  </div>
                  {row.lowConfidence ? (
                    <span className="value-secondary value-secondary--warning">
                      {row.confidenceReason || "Thin market"} · verify on Trade
                    </span>
                  ) : row.source !== "exchange" && (
                    <span className="value-secondary">
                      ≈ {formatPrice(price.unit === "chaos" ? row.divineValue : row.chaosValue)}{" "}
                      {price.unit === "chaos" ? "Divine" : "Chaos"}
                    </span>
                  )}
                </td>
                <td className="trend-cell">
                  <div className="trend-content">
                    <Sparkline
                      data={row.sparkline}
                      change={row.change}
                      period={isFaustus ? "seven-hour" : "seven-day"}
                    />
                    <strong
                      className={clsx(
                        row.change == null
                          ? "trend-neutral"
                          : row.change >= 0
                            ? "trend-positive"
                            : "trend-negative",
                      )}
                    >
                      {row.change == null
                        ? "—"
                        : `${row.change > 0 ? "+" : ""}${Math.round(row.change)}%`}
                    </strong>
                  </div>
                </td>
                <td className="numeric liquidity-column">
                  {formatCompact(
                    isCurrencyMarket ? row.volume : row.listingCount,
                  )}
                  {!isCurrencyMarket && row.observationCount != null && (
                    <span className="observation-count">
                      {formatCompact(row.observationCount)} seen
                    </span>
                  )}
                </td>
                <td className="popular-column">
                  {isFaustus ? (
                    <FaustusRange row={row} onTrade={onTrade} />
                  ) : isExchange ? (
                    <MostPopular row={row} items={items} />
                  ) : (
                    <button
                      className="trade-button"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onTrade(row);
                      }}
                    >
                      Trade
                      <ExternalLink size={12} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {visibleRows.length < rows.length && (
        <div className="show-more-wrap">
          <button className="show-more" type="button" onClick={onShowMore}>
            Show 80 more
            <span>
              {visibleRows.length.toLocaleString()} / {rows.length.toLocaleString()}
            </span>
          </button>
        </div>
      )}

      {tooltip && (
        <ItemMarketTooltip
          row={tooltip.row}
          anchor={tooltip.anchor}
          itemInfo={tooltip.itemInfo}
          loading={tooltip.loading}
          watched={watchKeys.has(tooltip.row.key)}
          onInspect={() => {
            onSelect(tooltip.row);
            closeTooltip(0);
          }}
          onWatch={() => onWatch(tooltip.row)}
          onTrade={() => onTrade(tooltip.row)}
          onMouseEnter={cancelClose}
          onMouseLeave={() => closeTooltip()}
        />
      )}
    </div>
  );
}
