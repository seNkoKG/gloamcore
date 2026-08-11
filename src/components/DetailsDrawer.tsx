import clsx from "clsx";
import {
  BarChart3,
  Bell,
  BellRing,
  BookOpen,
  Box,
  ExternalLink,
  Eye,
  FlaskConical,
  Gauge,
  Info,
  Layers3,
  ListChecks,
  MapPin,
  Star,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { EconomyRow, ItemTooltipData, WatchEntry } from "../types";
import {
  formatCompact,
  formatPrice,
  poeNinjaUrl,
  poeWikiUrl,
  tradeUrl,
} from "../lib/format";
import { bridge } from "../lib/bridge";
import { loadItemTooltip } from "../lib/item-tooltip";
import { summarizeItemTooltip } from "../lib/item-tooltip-data";
import { normalizeTargetPrice } from "../lib/watchlist";
import { craftOfExileUrl, isCraftableMarketRow } from "../lib/knowledge";
import { CurrencyMark } from "./CurrencyMark";
import { Sparkline } from "./Sparkline";

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="detail-stat">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export function DetailsDrawer({
  row,
  league,
  watch,
  onClose,
  onToggleWatch,
  onSaveWatch,
}: {
  row: EconomyRow;
  league: string;
  watch?: WatchEntry;
  onClose: () => void;
  onToggleWatch: (row: EconomyRow) => void;
  onSaveWatch: (watch: WatchEntry) => void;
}) {
  const [targetPrice, setTargetPrice] = useState(
    watch?.targetPrice == null ? "" : String(watch.targetPrice),
  );
  const [targetUnit, setTargetUnit] = useState<"chaos" | "divine">(
    watch?.targetUnit || "divine",
  );
  const [note, setNote] = useState(watch?.note || "");
  const [itemInfo, setItemInfo] = useState<ItemTooltipData | null>(null);
  const [itemInfoLoading, setItemInfoLoading] = useState(true);
  const itemSummary = summarizeItemTooltip(
    itemInfo,
    row.baseType || row.itemType || row.categoryLabel,
  );
  const localModifierCount =
    row.implicitModifiers.length +
    row.explicitModifiers.length +
    row.mutatedModifiers.length;
  const modifiers = [
    ...(row.implicitModifiers.length
      ? row.implicitModifiers
      : (itemInfo?.implicitMods || []).map((text) => ({ text }))
    ).map((modifier) => ({ ...modifier, type: "Implicit" })),
    ...(row.explicitModifiers.length
      ? row.explicitModifiers
      : (itemInfo?.explicitMods || []).map((text) => ({ text }))
    ).map((modifier) => ({ ...modifier, type: "Explicit" })),
    ...(localModifierCount
      ? []
      : (itemInfo?.enchantMods || []).map((text) => ({ text }))
    ).map((modifier) => ({ ...modifier, type: "Enchanted" })),
    ...row.mutatedModifiers.map((modifier) => ({ ...modifier, type: "Mutated" })),
  ];
  const isFaustus = row.source === "faustus";
  const acquisition = [
    itemInfo?.dropText,
    itemInfo?.dropAreas.length
      ? `Restricted areas: ${itemInfo.dropAreas.join(", ")}`
      : undefined,
    itemInfo?.dropMonsters.length
      ? `Specific monsters: ${itemInfo.dropMonsters.join(", ")}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  const craftable = isCraftableMarketRow(row, itemInfo?.itemClass);
  const sourceLabel =
    row.source === "faustus"
      ? "Faustus hourly"
      : row.source === "exchange"
        ? "Ninja exchange"
        : "Ninja stash estimate";

  useEffect(() => {
    setTargetPrice(watch?.targetPrice == null ? "" : String(watch.targetPrice));
    setTargetUnit(watch?.targetUnit || "divine");
    setNote(watch?.note || "");
  }, [watch, row.key]);

  useEffect(() => {
    let active = true;
    setItemInfo(null);
    setItemInfoLoading(true);
    void loadItemTooltip(row).then((next) => {
      if (!active) return;
      setItemInfo(next);
      setItemInfoLoading(false);
    });
    return () => {
      active = false;
    };
  }, [row]);

  const saveTracking = () => {
    const base =
      watch ||
      ({
        key: row.key,
        row,
        league,
        addedAt: Date.now(),
      } satisfies WatchEntry);
    onSaveWatch({
      ...base,
      row,
      league,
      targetPrice: normalizeTargetPrice(targetPrice),
      targetUnit,
      note: note.trim() || undefined,
    });
  };

  return (
    <aside className="details-drawer" aria-label={`${row.name} details`}>
      <div className="details-topline">
        <div>
          <span>{row.categoryLabel}</span>
          <i>•</i>
          <span>{sourceLabel}</span>
        </div>
        <button type="button" onClick={onClose} title="Close details">
          <X size={17} />
        </button>
      </div>

      <div className="details-identity">
        <div className="details-icon">
          {row.icon ? <img src={row.icon} alt="" /> : <span>{row.name[0]}</span>}
        </div>
        <div>
          <h2>{row.name}</h2>
          {row.variant && <strong>{row.variant}</strong>}
          {row.baseType && <p>{row.baseType}</p>}
        </div>
      </div>

      <section className="details-section item-intel-details">
        <div className="details-section-heading">
          <div>
            <Info size={15} />
            <span>Item information</span>
          </div>
          <strong>PoE Wiki</strong>
        </div>
        {itemInfoLoading ? (
          <div className="intel-loading">
            <span />
            <span />
            <span />
          </div>
        ) : itemInfo?.description || itemInfo?.helpText || itemSummary ? (
          <>
            {(itemInfo?.description || itemSummary) && (
              <strong>{itemInfo?.description || itemSummary}</strong>
            )}
            {itemInfo?.helpText && <p>{itemInfo.helpText}</p>}
          </>
        ) : (
          <p>
            No additional game description is available for this market entry.
          </p>
        )}
        {itemInfo && (
          <div className="item-intel-tags">
            {itemInfo.itemClass && <span>{itemInfo.itemClass}</span>}
            {itemInfo.rarity && <span>{itemInfo.rarity}</span>}
            {itemInfo.requiredLevel != null && itemInfo.requiredLevel > 1 && (
              <span>Requires {itemInfo.requiredLevel}</span>
            )}
            {itemInfo.dropLevel != null && (
              <span>Drops at {itemInfo.dropLevel}+</span>
            )}
          </div>
        )}
      </section>

      {itemInfo &&
        (acquisition.length > 0 ||
          itemInfo.releaseVersion ||
          itemInfo.acquisitionTags.length > 0) && (
          <section className="details-section knowledge-acquisition">
            <div className="details-section-heading">
              <div>
                <MapPin size={15} />
                <span>Acquisition & provenance</span>
              </div>
              {itemInfo.releaseVersion && (
                <strong>Patch {itemInfo.releaseVersion}</strong>
              )}
            </div>
            {acquisition.length > 0 ? (
              acquisition.map((line) => <p key={line}>{line}</p>)
            ) : (
              <p>
                {itemInfo.dropEnabled === false
                  ? "This item is not enabled as a natural drop."
                  : "No special drop restriction is recorded."}
              </p>
            )}
            {itemInfo.acquisitionTags.length > 0 && (
              <div className="knowledge-tag-cloud">
                {itemInfo.acquisitionTags.map((tag) => (
                  <span key={tag}>{tag.replace(/_/g, " ")}</span>
                ))}
              </div>
            )}
          </section>
        )}

      {row.lowConfidence && (
        <div className="price-integrity-warning">
          <TriangleAlert size={15} />
          <div>
            <strong>
              {isFaustus
                ? "Guarded official market observation"
                : "Unreliable market estimate"}
            </strong>
            <span>
              {isFaustus
                ? `Official completed-hour data: ${row.confidenceReason?.toLowerCase() || "very little market data"}. Verify the current exchange before acting.`
                : `Based on ${row.confidenceReason?.toLowerCase() || "very little market data"}. This is not a verified sale; check Trade before acting.`}
            </span>
          </div>
        </div>
      )}

      <div className="details-price-grid">
        <div className="details-price details-price--primary">
          <span>
            {row.lowConfidence
              ? isFaustus
                ? "OBSERVED CHAOS"
                : "ESTIMATED CHAOS"
              : "CHAOS VALUE"}
          </span>
          <strong>{row.lowConfidence ? "~" : ""}{formatPrice(row.chaosValue)}</strong>
          <CurrencyMark unit="chaos" size="medium" />
        </div>
        <div className="details-price">
          <span>
            {row.lowConfidence
              ? isFaustus
                ? "OBSERVED DIVINE"
                : "ESTIMATED DIVINE"
              : "DIVINE VALUE"}
          </span>
          <strong>{row.lowConfidence ? "~" : ""}{formatPrice(row.divineValue)}</strong>
          <CurrencyMark unit="divine" size="medium" />
        </div>
        {row.exaltedValue != null && (
          <div className="details-price">
            <span>EXALTED VALUE</span>
            <strong>{formatPrice(row.exaltedValue)}</strong>
            <CurrencyMark unit="exalted" size="medium" />
          </div>
        )}
        {row.faustus && (
          <div className="details-price">
            <span>HOURLY RANGE</span>
            <strong>
              {formatPrice(row.faustus.minimumChaos)}–
              {formatPrice(row.faustus.maximumChaos)}
            </strong>
            <CurrencyMark unit="chaos" size="medium" />
          </div>
        )}
      </div>

      <section className="details-section price-history">
        <div className="details-section-heading">
          <div>
            <BarChart3 size={15} />
            <span>{isFaustus ? "7-hour price movement" : "7-day price movement"}</span>
          </div>
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
              ? "Not enough data"
              : `${row.change > 0 ? "+" : ""}${row.change.toFixed(1)}%`}
          </strong>
        </div>
        <Sparkline
          data={row.sparkline}
          change={row.change}
          width={340}
          height={110}
          detailed
          period={isFaustus ? "seven-hour" : "seven-day"}
        />
        <div className="history-labels">
          <span>{isFaustus ? "7 hours ago" : "7 days ago"}</span>
          <span>{isFaustus ? "Last completed hour" : "Today"}</span>
        </div>
      </section>

      <div className="detail-stats">
        {row.volume != null && (
          <Stat
            icon={<Gauge size={16} />}
            label={isFaustus ? "Traded / hour" : "Volume / hour"}
            value={formatCompact(row.volume)}
          />
        )}
        {row.faustus?.maximumStock != null && (
          <Stat
            icon={<ListChecks size={16} />}
            label="Hourly stock range"
            value={`${formatCompact(row.faustus.minimumStock)}–${formatCompact(
              row.faustus.maximumStock,
            )}`}
          />
        )}
        {row.listingCount != null && (
          <Stat
            icon={<ListChecks size={16} />}
            label="Current listings"
            value={formatCompact(row.listingCount)}
          />
        )}
        {row.observationCount != null && (
          <Stat
            icon={<Eye size={16} />}
            label="Observations"
            value={formatCompact(row.observationCount)}
          />
        )}
        {(row.levelRequired != null || row.gemLevel != null || row.mapTier != null) && (
          <Stat
            icon={<Layers3 size={16} />}
            label={row.mapTier != null ? "Map tier" : row.gemLevel != null ? "Gem level" : "Required level"}
            value={row.mapTier ?? row.gemLevel ?? row.levelRequired}
          />
        )}
        <Stat
          icon={<Box size={16} />}
          label="Confidence"
          value={row.lowConfidence ? "Low" : "Normal"}
        />
      </div>

      {modifiers.length > 0 && (
        <section className="details-section modifier-section">
          <div className="details-section-heading">
            <div>
              <Layers3 size={15} />
              <span>Priced modifiers</span>
            </div>
            <strong>{modifiers.length}</strong>
          </div>
          <div className="modifier-list">
            {modifiers.slice(0, 12).map((modifier, index) => (
              <div
                className={clsx(
                  "modifier-line",
                  modifier.type === "Mutated" && "modifier-line--mutated",
                )}
                key={`${modifier.type}-${index}`}
              >
                <span>{modifier.type}</span>
                <p>{modifier.text || "Special modifier"}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="tracking-card">
        <div className="tracking-heading">
          <div className={watch ? "tracking-icon is-active" : "tracking-icon"}>
            {watch?.targetPrice != null ? <BellRing size={17} /> : <Bell size={17} />}
          </div>
          <div>
            <strong>Price tracker</strong>
            <span>Alert when this item reaches your target</span>
          </div>
        </div>
        <div className="target-price-row">
          <input
            inputMode="decimal"
            min="0"
            step="any"
            value={targetPrice}
            placeholder="Target price"
            onChange={(event) => setTargetPrice(event.target.value)}
          />
          <select
            value={targetUnit}
            onChange={(event) =>
              setTargetUnit(event.target.value as "chaos" | "divine")
            }
          >
            <option value="divine">Divine</option>
            <option value="chaos">Chaos</option>
          </select>
        </div>
        <input
          className="tracking-note"
          value={note}
          placeholder="Optional note (craft, buy for build…)"
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="tracking-actions">
          <button
            className={clsx("watch-primary", watch && "is-watched")}
            type="button"
            onClick={() => onToggleWatch(row)}
          >
            <Star size={15} fill={watch ? "currentColor" : "none"} />
            {watch ? "Watching" : "Add to watchlist"}
          </button>
          <button type="button" onClick={saveTracking}>
            Save target
          </button>
        </div>
      </section>

      <div className="details-links">
        <button type="button" onClick={() => bridge.openExternal(tradeUrl(row, league))}>
          <ExternalLink size={14} />
          Open Trade
        </button>
        <button type="button" onClick={() => bridge.openExternal(poeWikiUrl(row))}>
          <BookOpen size={14} />
          Wiki
        </button>
        <button
          type="button"
          onClick={() =>
            bridge.openExternal(poeNinjaUrl(league, row.categoryId, row.detailsId))
          }
        >
          <BarChart3 size={14} />
          {isFaustus ? "Ninja comparison" : "Source"}
        </button>
        {craftable && (
          <button
            className="craft-link"
            type="button"
            onClick={() => bridge.openExternal(craftOfExileUrl())}
          >
            <FlaskConical size={14} />
            Craft Lab
          </button>
        )}
      </div>

      {(row.flavourText || itemInfo?.flavourText) && (
        <p className="flavour-text">
          {row.flavourText || itemInfo?.flavourText}
        </p>
      )}
    </aside>
  );
}
