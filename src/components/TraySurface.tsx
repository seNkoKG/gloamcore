import clsx from "clsx";
import {
  ArrowUpRight,
  BellRing,
  Download,
  LayoutDashboard,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../lib/bridge";
import { formatPrice, formatRelativeTime } from "../lib/format";
import type { QuickSearchRow, SurfaceState } from "../types";
import { CurrencyMark } from "./CurrencyMark";

function openRow(row: Pick<QuickSearchRow, "league" | "categoryId" | "source" | "key">) {
  return bridge.surfaceAction({
    type: "open-row",
    league: row.league,
    categoryId: row.categoryId,
    source: row.source,
    rowKey: row.key,
  });
}

export function TraySurface() {
  const [state, setState] = useState<SurfaceState | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let active = true;
    bridge.getSurfaceState().then((next) => active && setState(next));
    const unsubscribe = bridge.onSurfaceState(setState);
    const timer = window.setInterval(() => tick((value) => value + 1), 30_000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  const update = state?.update;
  const updateAction =
    update?.status === "downloaded" ? "install-update" : "check-update";

  return (
    <div
      className="tray-surface"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          void bridge.surfaceAction({ type: "hide-surface" });
        }
      }}
    >
      <header className="tray-surface-header">
        <div className="surface-brand">
          <span>P</span>
          <div>
            <strong>POE ECONOMY</strong>
            <small>{state?.league || "Connecting…"}</small>
          </div>
        </div>
        <div>
          <button
            type="button"
            title="Quit widget"
            onClick={() => bridge.surfaceAction({ type: "quit" })}
          >
            <Power size={14} />
          </button>
          <button
            type="button"
            title="Close panel"
            onClick={() => bridge.surfaceAction({ type: "hide-surface" })}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <section className="tray-rate-card">
        <div>
          <span>DIVINE ORB</span>
          <small>Current league reference</small>
        </div>
        <strong>
          {state?.divineChaos ? formatPrice(state.divineChaos) : "—"}
          <CurrencyMark unit="chaos" />
        </strong>
        <span
          className={clsx(
            "tray-live-state",
            state?.stale && "is-stale",
            state?.loading && "is-loading",
          )}
        >
          {state?.stale ? <WifiOff size={12} /> : <Wifi size={12} />}
          {state?.loading
            ? "Updating"
            : state?.stale
              ? "Offline cache"
              : state?.fetchedAt
                ? formatRelativeTime(state.fetchedAt)
                : "Waiting for data"}
        </span>
      </section>

      <div className="tray-primary-actions">
        <button
          className="is-primary"
          type="button"
          onClick={() => bridge.surfaceAction({ type: "open-quick-search" })}
        >
          <Search size={16} />
          Quick search
          <kbd>⌃⇧Space</kbd>
        </button>
        <button
          type="button"
          title="Refresh the active market"
          onClick={() => bridge.surfaceAction({ type: "refresh-market" })}
        >
          <RefreshCw size={16} className={state?.loading ? "is-spinning" : ""} />
        </button>
        <button
          type="button"
          title="Open full dashboard"
          onClick={() => bridge.surfaceAction({ type: "open-dashboard" })}
        >
          <LayoutDashboard size={16} />
        </button>
      </div>

      <section className="tray-section">
        <div className="tray-section-heading">
          <span>
            <BellRing size={13} />
            Target alerts
          </span>
          <button
            type="button"
            onClick={() => bridge.surfaceAction({ type: "open-watchlist" })}
          >
            {state?.alertCount || 0} active
            <ArrowUpRight size={12} />
          </button>
        </div>
        {state?.alerts.length ? (
          <div className="tray-alert-list">
            {state.alerts.slice(0, 2).map((alert) => (
              <button
                type="button"
                key={`${alert.league}:${alert.categoryId}:${alert.key}`}
                onClick={() => openRow(alert)}
              >
                <span className="tray-mini-icon">
                  {alert.icon ? <img src={alert.icon} alt="" /> : <Star size={13} />}
                </span>
                <span>
                  <strong>{alert.name}</strong>
                  <small>Target {formatPrice(alert.target)}</small>
                </span>
                <em>
                  {formatPrice(alert.current)}
                  <CurrencyMark unit={alert.unit} />
                </em>
              </button>
            ))}
          </div>
        ) : (
          <div className="tray-section-empty">
            <ShieldCheck size={14} />
            No watched targets are currently triggered.
          </div>
        )}
      </section>

      <section className="tray-section tray-movers">
        <div className="tray-section-heading">
          <span>
            <TrendingUp size={13} />
            Top movers
          </span>
          <small>{state?.categoryLabel}</small>
        </div>
        <div>
          {state?.topMovers.slice(0, 3).map((row) => (
            <button
              type="button"
              key={`${row.categoryId}:${row.source}:${row.key}`}
              onClick={() => openRow(row)}
            >
              <span className="tray-mini-icon">
                {row.icon ? <img src={row.icon} alt="" /> : row.name[0]}
              </span>
              <strong>{row.name}</strong>
              <em className={(row.change || 0) >= 0 ? "is-up" : "is-down"}>
                {(row.change || 0) >= 0 ? (
                  <TrendingUp size={11} />
                ) : (
                  <TrendingDown size={11} />
                )}
                {row.change == null
                  ? "—"
                  : `${row.change > 0 ? "+" : ""}${Math.round(row.change)}%`}
              </em>
            </button>
          ))}
          {!state?.topMovers.length && (
            <div className="tray-section-empty">Market movement is loading.</div>
          )}
        </div>
      </section>

      {update?.feedConfigured ? <footer className="tray-surface-footer">
        <button
          type="button"
          disabled={!update?.feedConfigured}
          onClick={() => bridge.surfaceAction({ type: updateAction })}
          title={update?.message}
        >
          <Download size={13} />
          <span>
            <strong>
              {update?.status === "downloaded"
                ? `Install ${update.version}`
                : `Version ${update?.currentVersion || "…"}`}
            </strong>
            <small>{update?.message || "Update status loading"}</small>
          </span>
        </button>
      </footer> : null}
    </div>
  );
}
