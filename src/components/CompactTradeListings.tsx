import clsx from "clsx";
import { ExternalLink, RefreshCw } from "lucide-react";
import "../compact-trade-listings.css";

export interface CompactTradeListingRow {
  id: string;
  amount: number | string;
  currency: string;
  indexedAt?: number | string | Date | null;
  seller?: string | null;
  character?: string | null;
  itemName?: string | null;
  baseType?: string | null;
  icon?: string | null;
  whisper?: string | null;
  groupedCount?: number;
  stock?: number;
  exchange?: {
    haveAmount: number;
    itemAmount: number;
    stock: number;
  } | null;
}

export interface CompactTradeListingsProps {
  rows: readonly CompactTradeListingRow[];
  total: number;
  loading?: boolean;
  stale?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenTrade?: () => void;
  className?: string;
  now?: number;
  /** Optional explicit render budget. Official Trade can return up to 100 fetched rows. */
  limit?: number;
}

const MAX_RENDERED_ROWS = 100;

function compactNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1))}m`;
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(value < 10_000 ? 2 : 1))}k`;
  }
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatTradeListingAmount(value: number | string) {
  if (typeof value === "number") return compactNumber(value);
  const trimmed = value.trim();
  if (!trimmed) return "—";
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? compactNumber(parsed) : trimmed;
}

function indexedTimestamp(value: CompactTradeListingRow["indexedAt"]) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  return Date.parse(value);
}

export function formatTradeListingAge(
  indexedAt: CompactTradeListingRow["indexedAt"],
  now = Date.now(),
) {
  const indexed = indexedTimestamp(indexedAt);
  if (!Number.isFinite(indexed)) return "—";

  const minutes = Math.max(0, Math.floor((now - indexed) / 60_000));
  if (minutes < 1) return "NOW";
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H`;
  return `${Math.floor(hours / 24)}D`;
}

function sellerText(row: CompactTradeListingRow) {
  return row.character?.trim() || row.seller?.trim() || "—";
}

function sellerTitle(row: CompactTradeListingRow) {
  const character = row.character?.trim();
  const seller = row.seller?.trim();
  if (character && seller && character !== seller) return `${character} (${seller})`;
  return character || seller || "Seller unavailable";
}

function rowTitle(row: CompactTradeListingRow) {
  const item = [row.itemName, row.baseType]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" — ");
  const exchange = row.exchange
    ? `${formatTradeListingAmount(row.exchange.haveAmount)} / ${formatTradeListingAmount(row.exchange.itemAmount)}; stock ${row.exchange.stock}`
    : "";
  return [item, exchange].filter(Boolean).join(" — ");
}

function listingState({
  loading,
  stale,
  error,
}: Pick<CompactTradeListingsProps, "loading" | "stale" | "error">) {
  if (loading) return "LOADING";
  if (stale) return "STALE";
  if (error) return "ERROR";
  return "LIVE";
}

export function CompactTradeListings({
  rows,
  total,
  loading = false,
  stale = false,
  error,
  onRetry,
  onOpenTrade,
  className,
  now = Date.now(),
  limit,
}: CompactTradeListingsProps) {
  const hasExplicitLimit = Number.isFinite(limit);
  const rowLimit = hasExplicitLimit
    ? Math.max(1, Math.min(MAX_RENDERED_ROWS, Math.floor(limit!)))
    : MAX_RENDERED_ROWS;
  const visibleRows = rows.slice(0, rowLimit);
  const placeholderCount = hasExplicitLimit
    ? Math.max(0, rowLimit - visibleRows.length)
    : 0;
  const safeTotal = Number.isFinite(total)
    ? Math.max(visibleRows.length, Math.floor(Math.max(0, total)))
    : visibleRows.length;
  const state = listingState({ loading, stale, error });
  const emptyLabel = !visibleRows.length && !loading
    ? error ? "UNAVAILABLE" : "NO RESULTS"
    : null;
  const summary = safeTotal > visibleRows.length
    ? `${visibleRows.length}/${safeTotal}`
    : String(safeTotal);

  return (
    <section
      className={clsx("ctl", className)}
      aria-label="Live seller listings"
      aria-busy={loading}
      data-state={state.toLowerCase()}
    >
      <header className="ctl-bar">
        <strong>LISTINGS</strong>
        <span
          className={clsx("ctl-state", state !== "LIVE" && `is-${state.toLowerCase()}`)}
          role="status"
          aria-live="polite"
          title={error || `${state.toLowerCase()} seller listings`}
        >
          {state}
        </span>
        <output aria-label={`${safeTotal} seller listings`} title={`${safeTotal} results`}>
          {summary}
        </output>
        <nav aria-label="Seller listing actions">
          {onRetry ? (
            <button
              type="button"
              aria-label="Retry seller listings"
              title="Retry seller listings"
              onClick={onRetry}
              disabled={loading}
            >
              <RefreshCw size={11} aria-hidden />
            </button>
          ) : null}
          {onOpenTrade ? (
            <button
              type="button"
              aria-label="Open official Trade results"
              title="Open official Trade results"
              onClick={onOpenTrade}
            >
              <ExternalLink size={11} aria-hidden />
            </button>
          ) : null}
        </nav>
      </header>

      <div className="ctl-scroll">
      <table className="ctl-table">
        <caption className="ctl-sr-only">Current Path of Exile seller listings</caption>
        <colgroup>
          <col className="ctl-price-col" />
          <col />
          <col className="ctl-age-col" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">PRICE</th>
            <th scope="col">SELLER</th>
            <th scope="col">AGE</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const amount = formatTradeListingAmount(row.amount);
            const currency = row.currency.trim() || "?";
            const age = formatTradeListingAge(row.indexedAt, now);
            const item = rowTitle(row);
            return (
              <tr key={row.id} title={item || undefined}>
                <td className="ctl-price" title={`${amount} ${currency}`}>
                  <b>{amount}</b>
                  <span>{currency}</span>
                  {row.exchange ? (
                    <small
                      className="ctl-ratio"
                      title={`${formatTradeListingAmount(row.exchange.haveAmount)} ${currency} for ${formatTradeListingAmount(row.exchange.itemAmount)} items; stock ${row.exchange.stock}`}
                    >
                      {formatTradeListingAmount(row.exchange.haveAmount)}/{formatTradeListingAmount(row.exchange.itemAmount)}
                    </small>
                  ) : Number(row.groupedCount) > 1 ? (
                    <small
                      className="ctl-grouped"
                      title={`${row.groupedCount} same-seller listings${row.stock ? `; ${row.stock} total stock` : ""}`}
                    >
                      ×{row.groupedCount}
                    </small>
                  ) : null}
                </td>
                <td className="ctl-seller" title={sellerTitle(row)}>
                  {sellerText(row)}
                </td>
                <td
                  className="ctl-age"
                  title={age === "—" ? "Listing age unavailable" : `Listed ${age.toLowerCase()} ago`}
                >
                  {age}
                </td>
              </tr>
            );
          })}
          {Array.from({ length: placeholderCount }, (_value, index) => {
            const statusRow = index === 0 && emptyLabel;
            return (
              <tr
                className={clsx("ctl-placeholder", statusRow && "is-status")}
                aria-hidden={statusRow ? undefined : true}
                key={`placeholder-${index}`}
              >
                <td colSpan={3}>
                  {statusRow ? <span role="status">{emptyLabel}</span> : "***"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {!visibleRows.length && !placeholderCount ? (
        <div className="ctl-empty" role="status">
          {loading ? "LOADING" : error ? "UNAVAILABLE" : "NO RESULTS"}
        </div>
      ) : null}
    </section>
  );
}
