import {
  BellRing,
  ChevronDown,
  Database,
  RefreshCw,
  Search,
  ScanSearch,
  Settings,
  Star,
  Store,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import gloamCoreLogoUrl from "../assets/gloamcore-logo.png";
import type { AppMode, CategoryDefinition } from "../types";
import { categories } from "../config/categories";
import { tactileTap } from "../lib/platform";
import { CategoryIcon } from "./CategoryIcon";

export function MobileTopbar({
  category,
  league,
  loading,
  mode,
  onCategories,
  onRefresh,
}: {
  category: CategoryDefinition;
  league: string;
  loading: boolean;
  mode: AppMode;
  onCategories: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="mobile-topbar">
      <button
        className={`mobile-brand ${mode !== "market" ? "mobile-brand--static" : ""}`}
        type="button"
        onClick={() => {
          if (mode !== "market") return;
          void tactileTap();
          onCategories();
        }}
        aria-label={mode === "market" ? "Choose economy category" : undefined}
      >
        <span className="mobile-brand-mark" aria-hidden>
          <img src={gloamCoreLogoUrl} alt="" />
        </span>
        <span>
          <small>{mode === "price-check" ? "ITEM PRICE CHECK" : mode === "knowledge" ? "POE KNOWLEDGE" : mode === "watchlist" ? "PRICE TRACKING" : mode === "command" ? "POE 1 CAMPAIGN" : "GLOAMCORE"}</small>
          <strong>{mode === "price-check" ? "Price Check" : mode === "knowledge" ? "Item Intel" : mode === "watchlist" ? "Watchlist" : mode === "command" ? "League Command Center" : category.label}</strong>
        </span>
        {mode === "market" && <ChevronDown size={15} />}
      </button>
      <div className="mobile-topbar-meta">
        <span>{mode === "knowledge" ? "PoE Wiki Cargo" : mode === "price-check" ? "Paste item text" : mode === "command" ? "Verified league data" : league || "Current league"}</span>
        {mode === "market" && (
          <button
            type="button"
            onClick={() => {
              void tactileTap();
              onRefresh();
            }}
            disabled={loading}
            aria-label="Refresh prices"
          >
            <RefreshCw size={18} className={loading ? "is-spinning" : undefined} />
          </button>
        )}
      </div>
    </header>
  );
}

export function MobileBottomNav({
  mode,
  watchCount,
  alertCount,
  settingsOpen,
  onMarket,
  onPriceCheck,
  onKnowledge,
  onCommand,
  onWatchlist,
  onSettings,
}: {
  mode: AppMode;
  watchCount: number;
  alertCount: number;
  settingsOpen: boolean;
  onMarket: () => void;
  onPriceCheck: () => void;
  onKnowledge: () => void;
  onCommand: () => void;
  onWatchlist: () => void;
  onSettings: () => void;
}) {
  const invoke = (action: () => void) => {
    void tactileTap();
    action();
  };
  return (
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      <button
        type="button"
        className={mode === "command" && !settingsOpen ? "is-active" : undefined}
        onClick={() => invoke(onCommand)}
      >
        <img className="mobile-poe-nav-icon" src="https://www.poewiki.net/images/9/9a/Deal_with_the_Bandits_quest_icon.png" alt="" />
        <span>Guide</span>
      </button>
      <button
        type="button"
        className={mode === "price-check" && !settingsOpen ? "is-active" : undefined}
        onClick={() => invoke(onPriceCheck)}
      >
        <ScanSearch size={21} />
        <span>Check</span>
      </button>
      <button
        type="button"
        className={mode === "market" && !settingsOpen ? "is-active" : undefined}
        onClick={() => invoke(onMarket)}
      >
        <Store size={21} />
        <span>Market</span>
      </button>
      <button
        type="button"
        className={mode === "knowledge" && !settingsOpen ? "is-active" : undefined}
        onClick={() => invoke(onKnowledge)}
      >
        <Database size={21} />
        <span>Intel</span>
      </button>
      <button
        type="button"
        className={mode === "watchlist" && !settingsOpen ? "is-active" : undefined}
        onClick={() => invoke(onWatchlist)}
      >
        {alertCount ? <BellRing size={21} /> : <Star size={21} />}
        <span>Watch</span>
        {watchCount > 0 && <em>{alertCount || watchCount}</em>}
      </button>
      <button
        type="button"
        className={settingsOpen ? "is-active" : undefined}
        onClick={() => invoke(onSettings)}
      >
        <Settings size={21} />
        <span>Settings</span>
      </button>
    </nav>
  );
}

export function MobileCategorySheet({
  open,
  selectedId,
  recentIds,
  onClose,
  onSelect,
}: {
  open: boolean;
  selectedId: string;
  recentIds: string[];
  onClose: () => void;
  onSelect: (category: CategoryDefinition) => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? categories.filter((category) =>
          `${category.label} ${category.group} ${category.description}`
            .toLowerCase()
            .includes(needle),
        )
      : categories;
  }, [query]);
  const grouped = useMemo(
    () =>
      (["General", "Equipment & gems", "Atlas", "Crafting"] as const)
        .map((group) => ({
          group,
          categories: filtered.filter((category) => category.group === group),
        }))
        .filter((entry) => entry.categories.length),
    [filtered],
  );
  const recent = recentIds
    .map((id) => categories.find((category) => category.id === id))
    .filter((category): category is CategoryDefinition => Boolean(category))
    .slice(0, 6);

  if (!open) return null;
  return (
    <div className="mobile-sheet-layer" role="presentation">
      <button
        className="mobile-sheet-scrim"
        type="button"
        onClick={onClose}
        aria-label="Close categories"
      />
      <section className="mobile-category-sheet" aria-label="Economy categories">
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-heading">
          <div>
            <small>POE 1 ECONOMY</small>
            <h2>Choose a market</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <label className="mobile-category-search">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every category"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear category search"
            >
              <X size={15} />
            </button>
          )}
        </label>
        {!query && recent.length > 0 && (
          <div className="mobile-recent-categories">
            <span>RECENT</span>
            <div>
              {recent.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  onClick={() => onSelect(category)}
                >
                  <CategoryIcon name={category.icon} size={15} />
                  {category.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mobile-category-groups">
          {grouped.map((entry) => (
            <section key={entry.group}>
              <h3>{entry.group}</h3>
              <div>
                {entry.categories.map((category) => (
                  <button
                    className={category.id === selectedId ? "is-active" : undefined}
                    type="button"
                    key={category.id}
                    onClick={() => onSelect(category)}
                  >
                    <span>
                      <CategoryIcon name={category.icon} size={19} />
                    </span>
                    <div>
                      <strong>{category.label}</strong>
                      <small>{category.description}</small>
                    </div>
                    {category.id === selectedId && <i>ACTIVE</i>}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {grouped.length === 0 && (
            <div className="mobile-category-empty">
              No economy category matches “{query}”.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
