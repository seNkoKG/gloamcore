import clsx from "clsx";
import {
  BarChart3,
  BookOpen,
  ExternalLink,
  Eye,
  Info,
  Layers3,
  Star,
  TriangleAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { bridge } from "../lib/bridge";
import { summarizeItemTooltip } from "../lib/item-tooltip-data";
import {
  formatCompact,
  formatPrice,
  poeWikiUrl,
} from "../lib/format";
import type { EconomyRow, ItemTooltipData } from "../types";
import { CurrencyMark } from "./CurrencyMark";

const EDGE_GAP = 10;
const CARD_WIDTH = 430;

function tooltipPosition(
  anchor: DOMRect,
  width: number,
  height: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const availableWidth = Math.min(
    width || CARD_WIDTH,
    CARD_WIDTH,
    viewportWidth - EDGE_GAP * 2,
  );
  let left = anchor.right + 12;
  if (left + availableWidth > viewportWidth - EDGE_GAP) {
    left = anchor.left - availableWidth - 12;
  }
  if (left < EDGE_GAP) {
    left = Math.max(
      EDGE_GAP,
      Math.min(
        anchor.left + anchor.width / 2 - availableWidth / 2,
        viewportWidth - availableWidth - EDGE_GAP,
      ),
    );
  }

  let top = anchor.top + anchor.height / 2 - height / 2;
  top = Math.max(
    EDGE_GAP,
    Math.min(top, viewportHeight - height - EDGE_GAP),
  );

  return {
    left,
    top,
    width: availableWidth,
  };
}

function stopEvent(event: MouseEvent) {
  event.stopPropagation();
}

function MarketStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "warning";
}) {
  return (
    <div className={clsx("intel-stat", tone && `intel-stat--${tone}`)}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function ModGroup({
  label,
  lines,
  tone,
}: {
  label: string;
  lines: string[];
  tone: "implicit" | "explicit" | "enchanted" | "mutated";
}) {
  if (!lines.length) return null;
  return (
    <div className={clsx("intel-mod-group", `intel-mod-group--${tone}`)}>
      <span>{label}</span>
      <div>
        {lines.slice(0, 8).map((line, index) => (
          <p key={`${tone}-${index}`}>{line}</p>
        ))}
      </div>
    </div>
  );
}

export function ItemMarketTooltip({
  row,
  anchor,
  itemInfo,
  loading,
  watched,
  onInspect,
  onWatch,
  onTrade,
  onMouseEnter,
  onMouseLeave,
}: {
  row: EconomyRow;
  anchor: DOMRect;
  itemInfo: ItemTooltipData | null;
  loading: boolean;
  watched: boolean;
  onInspect: () => void;
  onWatch: () => void;
  onTrade: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>(() =>
    tooltipPosition(anchor, CARD_WIDTH, 390),
  );

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    setPosition(tooltipPosition(anchor, rect.width, rect.height));
  }, [anchor, itemInfo, loading]);

  const implicit = row.implicitModifiers.length
    ? row.implicitModifiers.map((modifier) => modifier.text || "Implicit modifier")
    : itemInfo?.implicitMods || [];
  const explicit = row.explicitModifiers.length
    ? row.explicitModifiers.map((modifier) => modifier.text || "Explicit modifier")
    : itemInfo?.explicitMods || [];
  const mutated = row.mutatedModifiers.map(
    (modifier) => modifier.text || "Mutated modifier",
  );
  const enchanted = itemInfo?.enchantMods || [];
  const level =
    row.mapTier ??
    row.gemLevel ??
    row.levelRequired ??
    (itemInfo?.requiredLevel != null && itemInfo.requiredLevel > 1
      ? itemInfo.requiredLevel
      : undefined);
  const liquidity = row.volume ?? row.listingCount;
  const flavour = row.flavourText || itemInfo?.flavourText;
  const itemSummary = summarizeItemTooltip(
    itemInfo,
    row.baseType || row.itemType || row.categoryLabel,
  );
  const itemBadge =
    itemInfo?.frameType && itemInfo.frameType !== "normal"
      ? itemInfo.frameType.replace(/-/g, " ")
      : itemInfo?.rarity?.toLowerCase() !== "normal"
        ? itemInfo?.rarity
        : row.itemType || itemInfo?.itemClass || row.categoryLabel;
  const isFaustus = row.source === "faustus";

  return createPortal(
    <div
      ref={cardRef}
      id="item-market-tooltip"
      className={clsx(
        "item-market-tooltip",
        itemInfo?.frameType && `item-market-tooltip--${itemInfo.frameType}`,
      )}
      role="dialog"
      aria-label={`${row.name} market and item information`}
      style={position}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={stopEvent}
    >
      <div className="intel-accent" />
      <header className="intel-header">
        <div className="intel-art">
          {row.icon ? <img src={row.icon} alt="" /> : <span>{row.name[0]}</span>}
        </div>
        <div className="intel-title">
          <span>
            ITEM INTEL
            <i>{isFaustus ? "OFFICIAL HOURLY" : "LIVE MARKET"}</i>
          </span>
          <h3>{row.name}</h3>
          <p>
            {row.variant ||
              row.baseType ||
              itemInfo?.baseType ||
              itemInfo?.itemClass ||
              row.categoryLabel}
          </p>
        </div>
        <div className="intel-rarity">
          {itemBadge}
        </div>
      </header>

      {row.lowConfidence && (
        <div className="intel-price-warning">
          <TriangleAlert size={13} />
          <span>
            {isFaustus
              ? `Guarded official observation: ${row.confidenceReason?.toLowerCase() || "very little market data"}. Verify the current exchange.`
              : `Unreliable estimate from ${row.confidenceReason?.toLowerCase() || "very little market data"}. Verify the current asks on Trade.`}
          </span>
        </div>
      )}

      <div className="intel-prices">
        <div>
          <small>
            {row.lowConfidence
              ? isFaustus
                ? "OBSERVED CHAOS"
                : "ESTIMATED CHAOS"
              : "CHAOS VALUE"}
          </small>
          <span>
            <strong>{row.lowConfidence ? "~" : ""}{formatPrice(row.chaosValue)}</strong>
            <CurrencyMark unit="chaos" />
          </span>
        </div>
        <div>
          <small>
            {row.lowConfidence
              ? isFaustus
                ? "OBSERVED DIVINE"
                : "ESTIMATED DIVINE"
              : "DIVINE VALUE"}
          </small>
          <span>
            <strong>{row.lowConfidence ? "~" : ""}{formatPrice(row.divineValue)}</strong>
            <CurrencyMark unit="divine" />
          </span>
        </div>
      </div>

      <div className="intel-market-grid">
        <MarketStat
          label={isFaustus ? "7-HOUR MOVE" : "7-DAY MOVE"}
          value={
            row.change == null
              ? "No trend"
              : `${row.change > 0 ? "+" : ""}${row.change.toFixed(1)}%`
          }
          tone={
            row.change == null
              ? undefined
              : row.change >= 0
                ? "positive"
                : "negative"
          }
        />
        <MarketStat
          label={
            row.volume != null
              ? isFaustus
                ? "TRADED / HOUR"
                : "VOLUME / HOUR"
              : "LISTED"
          }
          value={formatCompact(liquidity)}
        />
        <MarketStat
          label={
            isFaustus && row.faustus
              ? "HOURLY RANGE"
              : level != null
                ? "LEVEL / TIER"
                : "CONFIDENCE"
          }
          value={
            isFaustus && row.faustus
              ? `${formatPrice(row.faustus.minimumChaos)}–${formatPrice(
                  row.faustus.maximumChaos,
                )}c`
              : level != null
              ? String(level)
              : row.lowConfidence
                ? "Low"
                : "Normal"
          }
          tone={row.lowConfidence ? "warning" : undefined}
        />
      </div>

      <section className="intel-copy">
        <div className="intel-section-label">
          <Info size={12} />
          <span>WHAT IT IS</span>
          <small>PoE Wiki</small>
        </div>
        {loading ? (
          <div className="intel-loading" aria-label="Loading item information">
            <span />
            <span />
            <span />
          </div>
        ) : itemInfo?.description || itemInfo?.helpText || itemSummary ? (
          <>
            {(itemInfo?.description || itemSummary) && (
              <strong className="intel-description">
                {itemInfo?.description || itemSummary}
              </strong>
            )}
            {itemInfo?.helpText && <p>{itemInfo.helpText}</p>}
          </>
        ) : (
          <p>
            Detailed game text is unavailable for this market entry. Price,
            movement and liquidity are still available.
          </p>
        )}
      </section>

      {(implicit.length > 0 ||
        explicit.length > 0 ||
        enchanted.length > 0 ||
        mutated.length > 0) && (
        <section className="intel-mods">
          <div className="intel-section-label">
            <Layers3 size={12} />
            <span>ITEM MODIFIERS</span>
          </div>
          <ModGroup label="Implicit" lines={implicit} tone="implicit" />
          <ModGroup label="Explicit" lines={explicit} tone="explicit" />
          <ModGroup label="Enchanted" lines={enchanted} tone="enchanted" />
          <ModGroup label="Mutated" lines={mutated} tone="mutated" />
        </section>
      )}

      {flavour && <blockquote className="intel-flavour">{flavour}</blockquote>}

      <footer className="intel-actions">
        <button type="button" onClick={onInspect}>
          <Eye size={13} />
          Inspect
        </button>
        <button
          type="button"
          className={watched ? "is-active" : undefined}
          onClick={onWatch}
        >
          <Star size={13} fill={watched ? "currentColor" : "none"} />
          {watched ? "Watching" : "Watch"}
        </button>
        <button type="button" onClick={onTrade}>
          <ExternalLink size={13} />
          Trade
        </button>
        <button
          type="button"
          onClick={() => void bridge.openExternal(poeWikiUrl(row))}
        >
          <BookOpen size={13} />
          Wiki
        </button>
      </footer>

      <div className="intel-source">
        <BarChart3 size={11} />
        {isFaustus
          ? "Official Faustus completed-hour history · game text from PoE Wiki"
          : "Live market data from poe.ninja · game text from PoE Wiki"}
        {row.change != null &&
          (row.change >= 0 ? (
            <TrendingUp size={11} />
          ) : (
            <TrendingDown size={11} />
          ))}
      </div>
    </div>,
    document.body,
  );
}
