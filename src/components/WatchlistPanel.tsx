import clsx from "clsx";
import {
  Bell,
  BellRing,
  ChevronRight,
  RefreshCw,
  Search,
  Star,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ValueDisplay, WatchEntry } from "../types";
import { displayPrice, formatPrice } from "../lib/format";
import { CurrencyMark } from "./CurrencyMark";
import { Sparkline } from "./Sparkline";
import { isWatchPriceActionable, isWatchTargetHit } from "../lib/watchlist";

export function WatchlistPanel({
  entries,
  display,
  refreshing,
  onDisplay,
  onSelect,
  onRemove,
  onRefresh,
}: {
  entries: WatchEntry[];
  display: ValueDisplay;
  refreshing: boolean;
  onDisplay: (display: ValueDisplay) => void;
  onSelect: (entry: WatchEntry) => void;
  onRemove: (entry: WatchEntry) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "targets" | "gainers" | "losers">(
    "all",
  );
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries
      .filter((entry) => {
        if (
          normalizedQuery &&
          !`${entry.row.name} ${entry.row.categoryLabel} ${entry.note || ""}`
            .toLowerCase()
            .includes(normalizedQuery)
        )
          return false;
        if (filter === "targets") return isWatchTargetHit(entry);
        if (filter === "gainers") return (entry.row.change || 0) > 0;
        if (filter === "losers") return (entry.row.change || 0) < 0;
        return true;
      })
      .sort((a, b) => Number(isWatchTargetHit(b)) - Number(isWatchTargetHit(a)));
  }, [entries, filter, query]);
  const targetsHit = entries.filter(isWatchTargetHit).length;
  const gainers = entries.filter((entry) => (entry.row.change || 0) > 0).length;
  const losers = entries.filter((entry) => (entry.row.change || 0) < 0).length;

  return (
    <div className="watchlist-page">
      <div className="watchlist-header">
        <div>
          <span className="eyebrow">PERSONAL MARKET TRACKER</span>
          <h1>Watchlist</h1>
          <p>Live snapshots, movement and buy targets in one compact view.</p>
        </div>
        <div className="watchlist-header-actions">
          <label className="value-display">
            <span>VALUE IN</span>
            <select
              value={display}
              onChange={(event) => onDisplay(event.target.value as ValueDisplay)}
            >
              <option value="adaptive">Adaptive</option>
              <option value="chaos">Chaos Orb</option>
              <option value="divine">Divine Orb</option>
            </select>
          </label>
          <button
            className="refresh-button"
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh watched categories"
          >
            <RefreshCw size={16} className={refreshing ? "is-spinning" : undefined} />
          </button>
        </div>
      </div>

      <div className="watch-stats">
        <button
          className={clsx(filter === "all" && "is-active")}
          type="button"
          onClick={() => setFilter("all")}
        >
          <Star size={18} />
          <div>
            <strong>{entries.length}</strong>
            <span>Watched</span>
          </div>
        </button>
        <button
          className={clsx("watch-stat--target", filter === "targets" && "is-active")}
          type="button"
          onClick={() => setFilter("targets")}
        >
          {targetsHit ? <BellRing size={18} /> : <Target size={18} />}
          <div>
            <strong>{targetsHit}</strong>
            <span>Targets hit</span>
          </div>
        </button>
        <button
          className={clsx("watch-stat--gain", filter === "gainers" && "is-active")}
          type="button"
          onClick={() => setFilter("gainers")}
        >
          <TrendingUp size={18} />
          <div>
            <strong>{gainers}</strong>
            <span>Gaining</span>
          </div>
        </button>
        <button
          className={clsx("watch-stat--loss", filter === "losers" && "is-active")}
          type="button"
          onClick={() => setFilter("losers")}
        >
          <TrendingDown size={18} />
          <div>
            <strong>{losers}</strong>
            <span>Falling</span>
          </div>
        </button>
      </div>

      <label className="watch-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search watched items, categories or notes…"
        />
      </label>

      {visible.length === 0 ? (
        <div className="watch-empty">
          <div>
            <Star size={27} />
          </div>
          <h3>{entries.length ? "No matches" : "Build your market shortlist"}</h3>
          <p>
            {entries.length
              ? "Change the filter or search to see more watched items."
              : "Star items from any economy table. Add optional buy targets and the widget will track them here."}
          </p>
        </div>
      ) : (
        <div className="watch-grid">
          {visible.map((entry) => {
            const row = entry.row;
            const price = displayPrice(row, display);
            const hit = isWatchTargetHit(entry);
            const actionable = isWatchPriceActionable(entry);
            return (
              <article
                className={clsx("watch-card", hit && "watch-card--hit")}
                key={`${entry.league}:${entry.key}`}
                tabIndex={0}
                onClick={() => onSelect(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSelect(entry);
                }}
              >
                <div className="watch-card-top">
                  <div className="item-icon">
                    {row.icon ? (
                      <img src={row.icon} alt="" loading="lazy" />
                    ) : (
                      <span>{row.name[0]}</span>
                    )}
                  </div>
                  <div className="watch-card-name">
                    <span>{row.categoryLabel}</span>
                    <strong>{row.name}</strong>
                    {(row.variant || row.baseType) && (
                      <small>{row.variant || row.baseType}</small>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Remove from watchlist"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(entry);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="watch-card-market">
                  <div className="watch-price">
                    <span>{row.lowConfidence ? "ESTIMATE" : "NOW"}</span>
                    <div>
                      <strong>{row.lowConfidence ? "~" : ""}{formatPrice(price.value)}</strong>
                      <CurrencyMark unit={price.unit} />
                    </div>
                  </div>
                  <Sparkline
                    data={row.sparkline}
                    change={row.change}
                    width={118}
                    height={42}
                    period={row.source === "faustus" ? "seven-hour" : "seven-day"}
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
                {!actionable && (
                  <div className="watch-price-guard">
                    {row.lowConfidence
                      ? "Unreliable estimate · target alerts paused"
                      : entry.marketStale
                        ? "Offline snapshot · target alerts paused"
                        : "Waiting for a fresh market check"}
                  </div>
                )}
                {entry.targetPrice != null && entry.targetUnit && (
                  <div className={clsx("watch-target", hit && "is-hit")}>
                    {hit ? <BellRing size={14} /> : <Bell size={14} />}
                    <span>{hit ? "Target reached" : "Buy target"}</span>
                    <strong>{formatPrice(entry.targetPrice)}</strong>
                    <CurrencyMark unit={entry.targetUnit} />
                  </div>
                )}
                {entry.note && <p className="watch-note">{entry.note}</p>}
                <div className="watch-card-footer">
                  <span>{entry.league}</span>
                  <button type="button">
                    Inspect
                    <ChevronRight size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
