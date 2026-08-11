import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Gauge,
  ListChecks,
  Star,
} from "lucide-react";
import type {
  DataSource,
  Density,
  EconomyRow,
  SortKey,
  SortState,
  ValueDisplay,
} from "../types";
import { displayPrice, formatCompact, formatPrice } from "../lib/format";
import { tactileTap } from "../lib/platform";
import { CurrencyMark } from "./CurrencyMark";
import { Sparkline } from "./Sparkline";

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "value", label: "Price" },
  { key: "change", label: "Trend" },
  { key: "volume", label: "Liquidity" },
  { key: "name", label: "Name" },
];

function liquidity(row: EconomyRow, source: DataSource) {
  if (source === "exchange" || source === "faustus") {
    return {
      icon: <Gauge size={13} />,
      label: source === "faustus" ? "traded / hour" : "volume / hour",
      value: formatCompact(row.volume),
    };
  }
  return {
    icon: <ListChecks size={13} />,
    label: "listings",
    value: formatCompact(row.listingCount),
  };
}

export function MobileEconomyList({
  source,
  rows,
  visibleRows,
  display,
  density,
  sort,
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
  watchKeys: Set<string>;
  onSort: (key: SortKey) => void;
  onSelect: (row: EconomyRow) => void;
  onWatch: (row: EconomyRow) => void;
  onTrade: (row: EconomyRow) => void;
  onShowMore: () => void;
}) {
  return (
    <section
      className={`mobile-market-list mobile-market-list--${density}`}
      aria-label="Economy prices"
    >
      <div className="mobile-sort-strip">
        <span>SORT</span>
        <div>
          {sortOptions.map((option) => (
            <button
              type="button"
              key={option.key}
              className={sort.key === option.key ? "is-active" : undefined}
              onClick={() => {
                void tactileTap();
                onSort(option.key);
              }}
            >
              {option.label}
              {sort.key === option.key &&
                (sort.direction === "desc" ? (
                  <ArrowDown size={12} />
                ) : (
                  <ArrowUp size={12} />
                ))}
            </button>
          ))}
        </div>
        <em>{rows.length.toLocaleString()}</em>
      </div>

      <div className="mobile-price-cards">
        {visibleRows.map((row, index) => {
          const price = displayPrice(row, display);
          const marketLiquidity = liquidity(row, source);
          const watched = watchKeys.has(row.key);
          return (
            <article
              className={clsx(
                "mobile-price-card",
                row.lowConfidence && "is-low-confidence",
              )}
              key={row.key}
              tabIndex={0}
              onClick={() => onSelect(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row);
                }
              }}
            >
              <span className="mobile-row-rank">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="mobile-row-icon">
                {row.icon ? (
                  <img src={row.icon} alt="" loading="lazy" />
                ) : (
                  <span>{row.name.slice(0, 1)}</span>
                )}
              </div>
              <div className="mobile-row-copy">
                <strong>{row.name}</strong>
                {(row.variant || row.baseType) && (
                  <span>
                    {[row.variant, row.baseType].filter(Boolean).join(" · ")}
                  </span>
                )}
                <div className="mobile-row-liquidity">
                  {marketLiquidity.icon}
                  <b>{marketLiquidity.value}</b>
                  <span>{marketLiquidity.label}</span>
                  {row.lowConfidence && (
                    <i>
                      {row.source === "faustus"
                        ? "GUARDED OFFICIAL MARKET"
                        : "UNRELIABLE ESTIMATE"}
                    </i>
                  )}
                </div>
              </div>
              <div className="mobile-row-market">
                <div className="mobile-row-price">
                  <strong>{row.lowConfidence ? "~" : ""}{formatPrice(price.value)}</strong>
                  <CurrencyMark unit={price.unit} />
                </div>
                {row.lowConfidence && (
                  <small className="mobile-price-warning">
                    {row.confidenceReason || "Thin market"} · verify on Trade
                  </small>
                )}
                <div
                  className={clsx(
                    "mobile-row-trend",
                    row.change == null
                      ? "is-neutral"
                      : row.change >= 0
                        ? "is-positive"
                        : "is-negative",
                  )}
                >
                  <Sparkline
                    data={row.sparkline}
                    change={row.change}
                    width={58}
                    height={25}
                    period={row.source === "faustus" ? "seven-hour" : "seven-day"}
                  />
                  <strong>
                    {row.change == null
                      ? "—"
                      : `${row.change > 0 ? "+" : ""}${Math.round(row.change)}%`}
                  </strong>
                </div>
                {row.faustus && (
                  <small>
                    {formatPrice(row.faustus.minimumChaos)}–
                    {formatPrice(row.faustus.maximumChaos)} chaos
                  </small>
                )}
              </div>
              <div className="mobile-row-actions">
                <button
                  type="button"
                  className={watched ? "is-watched" : undefined}
                  aria-label={watched ? `Stop watching ${row.name}` : `Watch ${row.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void tactileTap();
                    onWatch(row);
                  }}
                >
                  <Star size={16} fill={watched ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  aria-label={`Open ${row.name} trade`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void tactileTap();
                    onTrade(row);
                  }}
                >
                  <ExternalLink size={15} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {visibleRows.length < rows.length && (
        <button className="mobile-show-more" type="button" onClick={onShowMore}>
          Load 80 more
          <span>
            {visibleRows.length.toLocaleString()} / {rows.length.toLocaleString()}
          </span>
        </button>
      )}
    </section>
  );
}
