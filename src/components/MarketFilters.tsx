import clsx from "clsx";
import {
  ChevronDown,
  Filter,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import type {
  CategoryDefinition,
  DataSource,
  FilterState,
  ValueDisplay,
} from "../types";
import { supportsFaustus } from "../config/categories";
import { deriveFilterOptions, emptyFilters } from "../lib/economy";
import type { EconomyRow } from "../types";

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }> | string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-select">
      <span>{label}</span>
      <div>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="all">All</option>
          {options.map((option) => {
            const value = typeof option === "string" ? option : option.value;
            const text = typeof option === "string" ? option : option.label;
            return (
              <option value={value} key={value}>
                {text}
              </option>
            );
          })}
        </select>
        <ChevronDown size={14} />
      </div>
    </label>
  );
}

export const MarketFilters = forwardRef<
  HTMLInputElement,
  {
    category: CategoryDefinition;
    source: DataSource;
    rows: EconomyRow[];
    filters: FilterState;
    display: ValueDisplay;
    resultCount: number;
    onSource: (source: DataSource) => void;
    onFilters: (filters: FilterState) => void;
    onDisplay: (display: ValueDisplay) => void;
  }
>(function MarketFilters(
  {
    category,
    source,
    rows,
    filters,
    display,
    resultCount,
    onSource,
    onFilters,
    onDisplay,
  },
  searchRef,
) {
  const [advanced, setAdvanced] = useState(false);
  const options = useMemo(() => deriveFilterOptions(rows), [rows]);
  const guardedEstimateCount = useMemo(
    () => rows.filter((row) => row.lowConfidence).length,
    [rows],
  );
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => {
    if (key === "query") return Boolean(value);
    if (key === "includeLowConfidence") return value === true;
    if (key === "trend") return value !== "all";
    return value !== "all" && value !== "";
  }).length;
  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onFilters({ ...filters, [key]: value });

  return (
    <div className="filter-panel">
      <div className="filter-toolbar">
        <label className="market-search">
          <Search size={17} />
          <input
            ref={searchRef}
            value={filters.query}
            onChange={(event) => update("query", event.target.value)}
            placeholder={`Search ${category.label.toLowerCase()}…`}
          />
          <kbd>/</kbd>
          {filters.query && (
            <button type="button" onClick={() => update("query", "")} title="Clear search">
              <X size={14} />
            </button>
          )}
        </label>

        {(category.source === "dual" || supportsFaustus(category)) && (
          <div className="source-switch" aria-label="Pricing source">
            <button
              type="button"
              className={source === "exchange" ? "is-active" : undefined}
              title="Current exchange pricing from poe.ninja"
              onClick={() => onSource("exchange")}
            >
              Ninja
            </button>
            {category.source === "dual" && (
              <button
                type="button"
                className={
                  source === "stash-currency" ? "is-active" : undefined
                }
                title="Current public-stash estimates from poe.ninja"
                onClick={() => onSource("stash-currency")}
              >
                Stash
              </button>
            )}
            {supportsFaustus(category) && (
              <button
                type="button"
                className={clsx(
                  "faustus-source-button",
                  source === "faustus" && "is-active",
                )}
                title="Official Faustus Currency Exchange history for the last completed hour"
                onClick={() => onSource("faustus")}
              >
                Faustus
              </button>
            )}
          </div>
        )}

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
          <ChevronDown size={14} />
        </label>

        <div className="trend-switch" aria-label="Trend filter">
          {(
            [
              ["all", "All"],
              ["gainers", "Gainers"],
              ["losers", "Losers"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={filters.trend === value ? "is-active" : undefined}
              onClick={() => update("trend", value)}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={clsx("advanced-toggle", advanced && "is-active")}
          onClick={() => setAdvanced(!advanced)}
        >
          <SlidersHorizontal size={16} />
          <span>Filters</span>
          {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
        </button>
      </div>

      {guardedEstimateCount > 0 && !filters.includeLowConfidence && (
        <div className="confidence-guard" role="status">
          <ShieldCheck size={13} />
          <strong>{guardedEstimateCount.toLocaleString()}</strong>
          unreliable {guardedEstimateCount === 1 ? "estimate" : "estimates"} hidden
          <button
            type="button"
            onClick={() => update("includeLowConfidence", true)}
          >
            Review
          </button>
        </div>
      )}

      {advanced && (
        <div className="advanced-filters">
          {options.itemTypes.length > 1 && (
            <FilterSelect
              label="Type"
              value={filters.itemType}
              options={options.itemTypes}
              onChange={(value) => update("itemType", value)}
            />
          )}
          {options.hasFoulborn && (
            <FilterSelect
              label="Foulborn"
              value={filters.foulborn}
              options={[
                { value: "true", label: "Foulborn" },
                { value: "false", label: "Normal" },
              ]}
              onChange={(value) => update("foulborn", value)}
            />
          )}
          {category.id === "skill-gems" && options.gemTypes.length > 1 && (
            <FilterSelect
              label="Gem type"
              value={filters.gemType}
              options={options.gemTypes.map((value) => ({
                value,
                label: value
                  .split("-")
                  .map((part) => part[0].toUpperCase() + part.slice(1))
                  .join(" "),
              }))}
              onChange={(value) => update("gemType", value)}
            />
          )}
          {options.hasLevel && (
            <FilterSelect
              label={category.id === "base-types" ? "Item level" : "Required level"}
              value={filters.level}
              options={[
                { value: "0-20", label: "0–20" },
                { value: "21-40", label: "21–40" },
                { value: "41-60", label: "41–60" },
                { value: "61-999", label: "61+" },
              ]}
              onChange={(value) => update("level", value)}
            />
          )}
          {options.links.length > 0 && (
            <FilterSelect
              label="Links"
              value={filters.links}
              options={options.links}
              onChange={(value) => update("links", value)}
            />
          )}
          {options.gemLevels.length > 0 && (
            <FilterSelect
              label="Gem level"
              value={filters.gemLevel}
              options={options.gemLevels}
              onChange={(value) => update("gemLevel", value)}
            />
          )}
          {options.gemQualities.length > 0 && (
            <FilterSelect
              label="Quality"
              value={filters.gemQuality}
              options={options.gemQualities}
              onChange={(value) => update("gemQuality", value)}
            />
          )}
          {options.hasCorruption && (
            <FilterSelect
              label="Corrupted"
              value={filters.corruption}
              options={[
                { value: "false", label: "No" },
                { value: "true", label: "Yes" },
              ]}
              onChange={(value) => update("corruption", value)}
            />
          )}
          {options.mapTiers.length > 0 && (
            <FilterSelect
              label="Map tier"
              value={filters.mapTier}
              options={options.mapTiers}
              onChange={(value) => update("mapTier", value)}
            />
          )}
          {options.variants.length > 1 && options.variants.length < 120 && (
            <FilterSelect
              label={category.id === "base-types" ? "Mods" : "Variant"}
              value={filters.variant}
              options={options.variants}
              onChange={(value) => update("variant", value)}
            />
          )}

          <div className="price-range">
            <span>Price range ({display === "divine" ? "div" : display === "chaos" ? "chaos" : "shown"})</span>
            <div>
              <input
                inputMode="decimal"
                value={filters.minPrice}
                placeholder="Min"
                onChange={(event) => update("minPrice", event.target.value)}
              />
              <i>—</i>
              <input
                inputMode="decimal"
                value={filters.maxPrice}
                placeholder="Max"
                onChange={(event) => update("maxPrice", event.target.value)}
              />
            </div>
          </div>

          {options.hasLowConfidence && (
            <label className="confidence-toggle">
              <input
                type="checkbox"
                checked={filters.includeLowConfidence}
                onChange={(event) =>
                  update("includeLowConfidence", event.target.checked)
                }
              />
              <span />
              Show unreliable estimates (&lt;5 observations)
            </label>
          )}

          <div className="filter-result-count">
            <Filter size={14} />
            <strong>{resultCount.toLocaleString()}</strong> matching rows
          </div>

          {activeFilterCount > 0 && (
            <button
              className="reset-filters"
              type="button"
              onClick={() => onFilters({ ...emptyFilters })}
            >
              <RotateCcw size={14} />
              Reset all
            </button>
          )}
        </div>
      )}
    </div>
  );
});
