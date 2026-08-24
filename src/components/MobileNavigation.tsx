import {
  BellRing,
  ChevronDown,
  Compass,
  Database,
  Menu,
  Network,
  RefreshCw,
  Search,
  ScanSearch,
  Scissors,
  Settings,
  Star,
  Store,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import gloamCoreLogoUrl from "../assets/gloamcore-logo.png";
import type { AppMode, CategoryDefinition } from "../types";
import { categories } from "../config/categories";
import { tactileTap } from "../lib/platform";
import { useDialogFocus } from "../lib/dialog-focus";
import { CategoryIcon } from "./CategoryIcon";

const mobileModeLabels: Partial<
  Record<AppMode, { kicker: string; title: string; meta: string }>
> = {
  "price-check": {
    kicker: "ITEM PRICE CHECK",
    title: "Price Check",
    meta: "Paste item text",
  },
  knowledge: {
    kicker: "POE KNOWLEDGE",
    title: "Item Intel",
    meta: "PoE Wiki Cargo",
  },
  watchlist: {
    kicker: "PRICE TRACKING",
    title: "Watchlist",
    meta: "Saved market targets",
  },
  command: {
    kicker: "POE 1 CAMPAIGN",
    title: "League Command Center",
    meta: "Verified league data",
  },
  planner: {
    kicker: "BUILD SNAPSHOTS",
    title: "Build Upgrade",
    meta: "Snapshot comparison",
  },
  toolkit: {
    kicker: "POE UTILITIES",
    title: "Player Toolkit",
    meta: "Portable tools",
  },
  craft: {
    kicker: "CRAFTING",
    title: "Craft of Exile",
    meta: "Crafting reference",
  },
  stash: {
    kicker: "STASH VALUE",
    title: "Stash Wealth",
    meta: "Wealth overview",
  },
};

export function MobileTopbar({
  category,
  league,
  loading,
  mode,
  categoryOpen,
  categoryButtonRef,
  onCategories,
  onRefresh,
}: {
  category: CategoryDefinition;
  league: string;
  loading: boolean;
  mode: AppMode;
  categoryOpen: boolean;
  categoryButtonRef?: RefObject<HTMLButtonElement>;
  onCategories: () => void;
  onRefresh: () => void;
}) {
  const modeLabel = mobileModeLabels[mode];
  const kicker = mode === "market" ? "GLOAMCORE" : modeLabel?.kicker || "GLOAMCORE";
  const title = mode === "market" ? category.label : modeLabel?.title || category.label;
  const meta =
    mode === "market"
      ? league || "Current league"
      : modeLabel?.meta || league || "Current league";
  const brandContent = (
    <>
      <span className="mobile-brand-mark" aria-hidden>
        <img src={gloamCoreLogoUrl} alt="" />
      </span>
      <span>
        <small>{kicker}</small>
        <strong>{title}</strong>
      </span>
      {mode === "market" && <ChevronDown size={15} />}
    </>
  );

  return (
    <header className="mobile-topbar">
      {mode === "market" ? (
        <button
          ref={categoryButtonRef}
          className="mobile-brand"
          type="button"
          onClick={() => {
            void tactileTap();
            onCategories();
          }}
          aria-label="Choose economy category"
          aria-haspopup="dialog"
          aria-expanded={categoryOpen}
          aria-controls="mobile-category-dialog"
        >
          {brandContent}
        </button>
      ) : (
        <div className="mobile-brand mobile-brand--static">{brandContent}</div>
      )}
      <div className="mobile-topbar-meta">
        <span>{meta}</span>
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
  moreOpen,
  settingsOpen,
  moreButtonRef,
  onMarket,
  onPriceCheck,
  onKnowledge,
  onCommand,
  onWatchlist,
  onMore,
}: {
  mode: AppMode;
  watchCount: number;
  alertCount: number;
  moreOpen: boolean;
  settingsOpen: boolean;
  moreButtonRef?: RefObject<HTMLButtonElement>;
  onMarket: () => void;
  onPriceCheck: () => void;
  onKnowledge: () => void;
  onCommand: () => void;
  onWatchlist: () => void;
  onMore: () => void;
}) {
  const invoke = (action: () => void) => {
    void tactileTap();
    action();
  };
  return (
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      <button
        type="button"
        className={mode === "command" && !settingsOpen && !moreOpen ? "is-active" : undefined}
        onClick={() => invoke(onCommand)}
        aria-current={mode === "command" ? "page" : undefined}
      >
        <Compass size={21} />
        <span>Guide</span>
      </button>
      <button
        type="button"
        className={mode === "price-check" && !settingsOpen && !moreOpen ? "is-active" : undefined}
        onClick={() => invoke(onPriceCheck)}
        aria-current={mode === "price-check" ? "page" : undefined}
      >
        <ScanSearch size={21} />
        <span>Check</span>
      </button>
      <button
        type="button"
        className={mode === "market" && !settingsOpen && !moreOpen ? "is-active" : undefined}
        onClick={() => invoke(onMarket)}
        aria-current={mode === "market" ? "page" : undefined}
      >
        <Store size={21} />
        <span>Market</span>
      </button>
      <button
        type="button"
        className={mode === "knowledge" && !settingsOpen && !moreOpen ? "is-active" : undefined}
        onClick={() => invoke(onKnowledge)}
        aria-current={mode === "knowledge" ? "page" : undefined}
      >
        <Database size={21} />
        <span>Intel</span>
      </button>
      <button
        type="button"
        className={mode === "watchlist" && !settingsOpen && !moreOpen ? "is-active" : undefined}
        onClick={() => invoke(onWatchlist)}
        aria-current={mode === "watchlist" ? "page" : undefined}
      >
        {alertCount ? <BellRing size={21} /> : <Star size={21} />}
        <span>Watch</span>
        {watchCount > 0 && <em>{alertCount || watchCount}</em>}
      </button>
      <button
        ref={moreButtonRef}
        type="button"
        className={
          moreOpen || settingsOpen || mode === "planner" || mode === "toolkit"
            ? "is-active"
            : undefined
        }
        onClick={() => invoke(onMore)}
        aria-current={
          mode === "planner" || mode === "toolkit" ? "page" : undefined
        }
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-controls="mobile-more-dialog"
      >
        <Menu size={21} />
        <span>More</span>
      </button>
    </nav>
  );
}

export function MobileCategorySheet({
  open,
  selectedId,
  recentIds,
  restoreFocusRef,
  onClose,
  onSelect,
}: {
  open: boolean;
  selectedId: string;
  recentIds: string[];
  restoreFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  onSelect: (category: CategoryDefinition) => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    active: open,
    modal: true,
    onDismiss: onClose,
    initialFocusRef: searchRef,
    restoreFocusRef,
  });
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
      <section
        ref={dialogRef}
        id="mobile-category-dialog"
        className="mobile-category-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-category-dialog-title"
        tabIndex={-1}
      >
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-heading">
          <div>
            <small>POE 1 ECONOMY</small>
            <h2 id="mobile-category-dialog-title">Choose a market</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <label className="mobile-category-search">
          <Search size={17} />
          <input
            ref={searchRef}
            autoFocus
            aria-label="Search economy categories"
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
                    aria-current={category.id === selectedId ? "true" : undefined}
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

export function MobileMoreSheet({
  open,
  mode,
  restoreFocusRef,
  onClose,
  onMode,
  onSettings,
}: {
  open: boolean;
  mode: AppMode;
  restoreFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  onMode: (mode: "planner" | "toolkit") => void;
  onSettings: () => void;
}) {
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    active: open,
    modal: true,
    onDismiss: onClose,
    initialFocusRef: firstActionRef,
    restoreFocusRef,
  });
  if (!open) return null;

  const openMode = (nextMode: "planner" | "toolkit") => {
    void tactileTap();
    onClose();
    onMode(nextMode);
  };

  return (
    <div className="mobile-sheet-layer" role="presentation">
      <button
        className="mobile-sheet-scrim"
        type="button"
        onClick={onClose}
        aria-label="Close more menu"
      />
      <section
        ref={dialogRef}
        id="mobile-more-dialog"
        className="mobile-category-sheet mobile-more-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-more-dialog-title"
        tabIndex={-1}
      >
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-heading">
          <div>
            <small>GLOAMCORE WORKSPACES</small>
            <h2 id="mobile-more-dialog-title">More</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <div className="mobile-more-actions">
          <button
            ref={firstActionRef}
            type="button"
            className={mode === "planner" ? "is-active" : undefined}
            aria-current={mode === "planner" ? "page" : undefined}
            onClick={() => openMode("planner")}
          >
            <span><Network size={20} /></span>
            <div>
              <strong>Build Upgrade</strong>
              <small>Compare imported GloamCore build snapshots.</small>
            </div>
          </button>
          <button
            type="button"
            className={mode === "toolkit" ? "is-active" : undefined}
            aria-current={mode === "toolkit" ? "page" : undefined}
            onClick={() => openMode("toolkit")}
          >
            <span><Scissors size={20} /></span>
            <div>
              <strong>Player Toolkit</strong>
              <small>Portable tools with clear desktop boundaries.</small>
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              void tactileTap();
              onClose();
              onSettings();
            }}
          >
            <span><Settings size={20} /></span>
            <div>
              <strong>Settings</strong>
              <small>Appearance, accessibility, backup and support.</small>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
}
