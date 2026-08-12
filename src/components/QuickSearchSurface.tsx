import clsx from "clsx";
import {
  ArrowRight,
  Command,
  Search,
  Star,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../lib/bridge";
import { formatCompact, formatPrice } from "../lib/format";
import { rankQuickRows } from "../lib/quick-search";
import type { QuickCommand, QuickSearchRow, SurfaceState } from "../types";
import { CurrencyMark } from "./CurrencyMark";

function adaptivePrice(row: QuickSearchRow) {
  return row.divineValue != null && row.divineValue >= 1
    ? { value: row.divineValue, unit: "divine" }
    : { value: row.chaosValue, unit: "chaos" };
}

function openRow(row: QuickSearchRow) {
  return bridge.surfaceAction({
    type: "open-row",
    league: row.league,
    categoryId: row.categoryId,
    source: row.source,
    rowKey: row.key,
  });
}

function openCommand(command: QuickCommand) {
  return bridge.surfaceAction({
    type: "open-mode",
    mode: command.mode,
    categoryId: command.categoryId,
    section: command.section,
    query: command.query,
    resourceId: command.resourceId,
  });
}

function rankedCommands(commands: QuickCommand[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return commands
    .flatMap((command) => {
      const title = command.title.toLocaleLowerCase();
      const haystack = `${command.title} ${command.subtitle} ${command.keywords}`.toLocaleLowerCase();
      if (terms.some((term) => !haystack.includes(term))) return [];
      const score = terms.reduce(
        (total, term) => total + (title === term ? 20 : title.startsWith(term) ? 12 : title.includes(term) ? 7 : 2),
        0,
      );
      return [{ command, score }];
    })
    .sort((left, right) => right.score - left.score || left.command.title.localeCompare(right.command.title))
    .slice(0, query.trim() ? 24 : 12)
    .map((entry) => entry.command);
}

type QuickResult =
  | { kind: "command"; command: QuickCommand }
  | { kind: "market"; row: QuickSearchRow };

export function QuickSearchSurface() {
  const [state, setState] = useState<SurfaceState | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    bridge.getSurfaceState().then((next) => active && setState(next));
    const unsubscribe = bridge.onSurfaceState(setState);
    const focus = () => {
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
    };
    window.addEventListener("focus", focus);
    focus();
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, []);

  const results = useMemo<QuickResult[]>(() => {
    const commands = rankedCommands(state?.commands || [], query)
      .map((command): QuickResult => ({ kind: "command", command }));
    const rows = rankQuickRows(state?.searchRows || [], query, 50 - commands.length)
      .map((row): QuickResult => ({ kind: "market", row }));
    return [...commands, ...rows];
  }, [query, state?.commands, state?.searchRows]);
  const marketCount = useMemo(
    () => new Set((state?.searchRows || []).map((row) => row.categoryId)).size,
    [state?.searchRows],
  );

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    if (selected >= results.length) setSelected(Math.max(0, results.length - 1));
  }, [results.length, selected]);

  const choose = (result: QuickResult | undefined) => {
    if (result?.kind === "command") void openCommand(result.command);
    if (result?.kind === "market") void openRow(result.row);
  };

  return (
    <div
      className="quick-surface"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          void bridge.surfaceAction({ type: "hide-surface" });
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelected((current) =>
            results.length ? (current + 1) % results.length : 0,
          );
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelected((current) =>
            results.length
              ? (current - 1 + results.length) % results.length
              : 0,
          );
        }
        if (event.key === "Enter") {
          event.preventDefault();
          choose(results[selected]);
        }
      }}
    >
      <header className="quick-surface-header">
        <div className="surface-brand">
          <span>P</span>
          <div>
            <strong>GLOAMCORE COMMAND SEARCH</strong>
            <small>{state?.league || "Current league"}</small>
          </div>
        </div>
        <button
          type="button"
          title="Close quick search"
          onClick={() => bridge.surfaceAction({ type: "hide-surface" })}
        >
          <X size={17} />
        </button>
      </header>

      <label className="quick-search-input">
        <Search size={21} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tools, PoE data, saved builds and markets…"
          aria-label="Search GloamCore commands and market items"
          aria-activedescendant={
            results[selected] ? `quick-result-${selected}` : undefined
          }
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} title="Clear search">
            <X size={15} />
          </button>
        ) : (
          <kbd>ESC</kbd>
        )}
      </label>

      <div className="quick-search-meta">
        <span>
          {state?.commands.length.toLocaleString() || "0"} commands
          <i>•</i>
          {state?.searchRows.length.toLocaleString() || "0"} items across {marketCount} market{marketCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => bridge.surfaceAction({ type: "open-dashboard" })}
        >
          Open dashboard
          <ArrowRight size={13} />
        </button>
      </div>

      <div className="quick-results" role="listbox">
        {results.length ? (
          results.map((result, index) => {
            if (result.kind === "command") {
              const command = result.command;
              return (
                <button
                  id={`quick-result-${index}`}
                  role="option"
                  aria-selected={selected === index}
                  type="button"
                  className={clsx(
                    "quick-result quick-result--command",
                    selected === index && "is-selected",
                  )}
                  key={command.id}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => choose(result)}
                >
                  <span className="quick-result-icon"><Command size={17} /></span>
                  <span className="quick-result-copy">
                    <strong>{command.title}</strong>
                    <small>{command.subtitle}</small>
                  </span>
                  <span className="quick-command-open">OPEN <ArrowRight size={13} /></span>
                </button>
              );
            }
            const row = result.row;
            const price = adaptivePrice(row);
            const liquidity = row.volume ?? row.listingCount;
            return (
              <button
                id={`quick-result-${index}`}
                role="option"
                aria-selected={selected === index}
                type="button"
                className={clsx(
                  "quick-result",
                  selected === index && "is-selected",
                )}
                key={`${row.league}:${row.categoryId}:${row.source}:${row.key}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(result)}
              >
                <span className="quick-result-icon">
                  {row.icon ? <img src={row.icon} alt="" /> : row.name[0]}
                </span>
                <span className="quick-result-copy">
                  <strong>{row.name}</strong>
                  <small>
                    {row.categoryLabel}
                    {(row.variant || row.baseType) && (
                      <>
                        <i>•</i>
                        {row.variant || row.baseType}
                      </>
                    )}
                  </small>
                </span>
                <span className="quick-result-market">
                  <span>
                    <strong>{formatPrice(price.value)}</strong>
                    <CurrencyMark unit={price.unit} />
                  </span>
                  <small>{formatCompact(liquidity)} liquid</small>
                </span>
                <span
                  className={clsx(
                    "quick-result-trend",
                    row.change == null
                      ? "is-neutral"
                      : row.change >= 0
                        ? "is-positive"
                        : "is-negative",
                  )}
                >
                  {row.change == null ? (
                    "—"
                  ) : row.change >= 0 ? (
                    <TrendingUp size={13} />
                  ) : (
                    <TrendingDown size={13} />
                  )}
                  {row.change == null
                    ? ""
                    : `${row.change > 0 ? "+" : ""}${Math.round(row.change)}%`}
                </span>
              </button>
            );
          })
        ) : (
          <div className="quick-empty">
            <Search size={25} />
          <strong>No command or indexed item matches “{query}”</strong>
            <p>
              Market categories become searchable after they load. App tools,
              validated gems and Atlas nodes are indexed automatically.
            </p>
          </div>
        )}
      </div>

      <footer className="quick-surface-footer">
        <span>
          <kbd>↑</kbd><kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>Enter</kbd> Open
        </span>
        <span className="quick-global-hint">
          <Command size={12} />
          Ctrl P in app · Ctrl Shift Space anywhere
        </span>
        {state?.alertCount ? (
          <button
            type="button"
            onClick={() => bridge.surfaceAction({ type: "open-watchlist" })}
          >
            <Star size={12} fill="currentColor" />
            {state.alertCount} target{state.alertCount === 1 ? "" : "s"} hit
          </button>
        ) : null}
      </footer>
    </div>
  );
}
