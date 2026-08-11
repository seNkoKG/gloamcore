import {
  BellRing,
  ChevronDown,
  CircleAlert,
  Clock3,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import type {
  CategoryDefinition,
  DataSource,
  EconomyLeague,
} from "../types";
import { formatRelativeTime, formatRemaining } from "../lib/format";
import { CategoryIcon } from "./CategoryIcon";

export function MarketHeader({
  category,
  source,
  league,
  leagues,
  fetchedAt,
  expiresAt,
  stale,
  loading,
  rowCount,
  alertCount,
  onLeague,
  onRefresh,
}: {
  category: CategoryDefinition;
  source: DataSource;
  league: string;
  leagues: EconomyLeague[];
  fetchedAt?: number;
  expiresAt?: number;
  stale: boolean;
  loading: boolean;
  rowCount: number;
  alertCount: number;
  onLeague: (league: string) => void;
  onRefresh: () => void;
}) {
  const sourceLabel =
    source === "faustus"
      ? "Faustus · official"
      : source === "exchange"
        ? "Ninja exchange"
        : "Ninja stash";
  const sourceClock =
    source === "faustus"
      ? "Official completed-hour snapshots · 5m checks · 1m catch-up"
      : "Source-timed auto refresh · CDN age verified";
  const refreshTitle =
    source === "faustus"
      ? "Check for the latest official Faustus completed-hour snapshot"
      : "Revalidate with poe.ninja";

  return (
    <div className="market-heading">
      <div className="market-heading-title">
        <div className="market-heading-icon">
          <CategoryIcon name={category.icon} size={23} />
        </div>
        <div>
          <div className="breadcrumbs">
            <span>Economy</span>
            <i>/</i>
            <span>{category.group}</span>
          </div>
          <h1>{category.label}</h1>
          <p>{category.description}</p>
        </div>
      </div>

      <div className="market-heading-meta">
        {alertCount > 0 && (
          <div className="alert-pill">
            <BellRing size={13} />
            {alertCount} target{alertCount === 1 ? "" : "s"} hit
          </div>
        )}
        <label className="league-picker">
          <span>LEAGUE</span>
          <select value={league} onChange={(event) => onLeague(event.target.value)}>
            {leagues.map((entry) => (
              <option value={entry.id} key={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <ChevronDown size={15} />
        </label>
        <button
          className="refresh-button"
          type="button"
          disabled={loading}
          onClick={onRefresh}
          title={refreshTitle}
        >
          <RefreshCw size={16} className={loading ? "is-spinning" : undefined} />
        </button>
        <div className={`freshness ${stale ? "freshness--stale" : ""}`}>
          {stale ? <WifiOff size={15} /> : <Wifi size={15} />}
          <div>
            <strong>
              {stale ? "Offline cache" : sourceLabel}
            </strong>
            <span>
              {fetchedAt ? formatRelativeTime(fetchedAt) : "Connecting"}
              {source === "faustus" && !stale
                ? " · checks every 5m"
                : expiresAt && !stale
                  ? ` · next ${formatRemaining(expiresAt)}`
                  : ""}
            </span>
          </div>
        </div>
        <div className="row-count" title={`${rowCount} market rows loaded`}>
          {rowCount.toLocaleString()}
          <span>ROWS</span>
        </div>
      </div>
      {stale && (
        <div className="stale-banner">
          <CircleAlert size={14} />
          {source === "faustus"
            ? "The official Faustus history feed could not be reached. Showing the last successfully cached completed hour."
            : "poe.ninja could not be reached. Showing a clearly marked recent snapshot; market cache older than two hours is rejected."}
        </div>
      )}
      {!stale && fetchedAt && (
        <div className="source-clock" title="Source cache timing">
          <Clock3 size={12} />
          {sourceClock}
        </div>
      )}
    </div>
  );
}
