import clsx from "clsx";
import { ArrowLeft, Clock3, Search, Trash2 } from "lucide-react";
import { formatPrice, formatRelativeTime } from "../lib/format";
import type { PriceCheckHistoryEntry } from "../lib/price-check/types";
import { CurrencyMark } from "./CurrencyMark";

export interface PriceCheckHistoryProps {
  entries: PriceCheckHistoryEntry[];
  selectedId?: string;
  onSelect: (entry: PriceCheckHistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onBack: () => void;
}

function displayName(entry: PriceCheckHistoryEntry) {
  return entry.item.name || entry.item.baseType || "Unnamed item";
}

function adaptivePrice(entry: PriceCheckHistoryEntry) {
  if (
    entry.estimate.divineValue != null &&
    (entry.estimate.divineValue >= 1 || entry.estimate.chaosValue == null)
  ) {
    return { value: entry.estimate.divineValue, unit: "divine" };
  }
  return { value: entry.estimate.chaosValue, unit: "chaos" };
}

export function PriceCheckHistory({
  entries,
  selectedId,
  onSelect,
  onRemove,
  onClear,
  onBack,
}: PriceCheckHistoryProps) {
  const ordered = [...entries].sort((a, b) => b.checkedAt - a.checkedAt);

  return (
    <section className="pc-history">
      <header className="pc-section-heading">
        <button className="pc-back-button" type="button" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden />
          Back
        </button>
        <div>
          <h1>History</h1>
        </div>
        {ordered.length ? (
          <button className="pc-button pc-button--danger" type="button" onClick={onClear}>
            <Trash2 size={14} aria-hidden />
            Clear
          </button>
        ) : null}
      </header>

      {ordered.length ? (
        <div className="pc-history-list" aria-label="Recent item price checks">
          {ordered.map((entry) => {
            const price = adaptivePrice(entry);
            return (
              <article
                className={clsx(
                  "pc-history-row",
                  selectedId === entry.id && "is-selected",
                )}
                key={entry.id}
              >
                <button
                  className="pc-history-open"
                  type="button"
                  onClick={() => onSelect(entry)}
                  aria-label={`Open saved price check for ${displayName(entry)}`}
                >
                  <span className={clsx("pc-history-icon", `is-${entry.item.rarity}`)}>
                    {entry.item.iconHint ? (
                      <img src={entry.item.iconHint} alt="" />
                    ) : (
                      <Search size={18} aria-hidden />
                    )}
                  </span>
                  <span className="pc-history-copy">
                    <strong title={displayName(entry)}>{displayName(entry)}</strong>
                    <small>
                      {entry.item.baseType && entry.item.baseType !== entry.item.name
                        ? `${entry.item.baseType} - `
                        : ""}
                      {entry.league}
                    </small>
                  </span>
                  <span
                    className={clsx(
                      "pc-confidence",
                      `is-${entry.estimate.confidence}`,
                    )}
                  >
                    {entry.estimate.confidence}
                  </span>
                  <span className="pc-history-price">
                    <span>
                      <strong>
                        {price.value == null ? "No price" : formatPrice(price.value)}
                      </strong>
                      {price.value != null ? <CurrencyMark unit={price.unit} /> : null}
                    </span>
                    <small>
                      <Clock3 size={11} aria-hidden />
                      {formatRelativeTime(entry.checkedAt)}
                    </small>
                  </span>
                </button>
                <button
                  className="pc-history-remove"
                  type="button"
                  onClick={() => onRemove(entry.id)}
                  aria-label={`Remove ${displayName(entry)} from price check history`}
                  title="Remove from history"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="pc-history-empty">
          <Clock3 size={27} aria-hidden />
          <strong>No saved checks yet</strong>
          <button className="pc-button pc-button--primary" type="button" onClick={onBack}>
            Check item
          </button>
        </section>
      )}
    </section>
  );
}
