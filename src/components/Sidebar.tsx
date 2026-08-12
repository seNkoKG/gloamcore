import clsx from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Database,
  LayoutDashboard,
  Network,
  Search,
  ScanSearch,
  Scissors,
  Star,
  Gem,
  Hammer,
} from "lucide-react";
import {
  categories,
  categoryGroups,
} from "../config/categories";
import type { AppMode, CategoryDefinition } from "../types";
import { CategoryIcon } from "./CategoryIcon";

export function Sidebar({
  selectedCategory,
  collapsed,
  watchCount,
  mode,
  onMode,
  onCategory,
  onCollapsed,
}: {
  selectedCategory: string;
  collapsed: boolean;
  watchCount: number;
  mode: AppMode;
  onMode: (mode: AppMode) => void;
  onCategory: (category: CategoryDefinition) => void;
  onCollapsed: (collapsed: boolean) => void;
}) {
  return (
    <aside className={clsx("sidebar", collapsed && "sidebar--collapsed")}>
      <div className="sidebar-primary">
        <button
          type="button"
          className={clsx(
            "sidebar-primary-item",
            mode === "command" && "is-active",
          )}
          onClick={() => onMode("command")}
          title="League Command Center"
        >
          <Compass size={18} />
          {!collapsed && <span>League Center</span>}
          {!collapsed && <small>POE 1</small>}
        </button>
        <button
          type="button"
          className={clsx(
            "sidebar-primary-item",
            mode === "price-check" && "is-active",
          )}
          onClick={() => onMode("price-check")}
          title="Price checker"
        >
          <ScanSearch size={18} />
          {!collapsed && <span>Price checker</span>}
          {!collapsed && <small>OVERLAY</small>}
        </button>
        <button
          type="button"
          className={clsx("sidebar-primary-item", mode === "market" && "is-active")}
          onClick={() => onMode("market")}
          title="Market explorer"
        >
          <LayoutDashboard size={18} />
          {!collapsed && <span>Market explorer</span>}
        </button>
        <button
          type="button"
          className={clsx(
            "sidebar-primary-item",
            mode === "craft" && "is-active",
          )}
          onClick={() => onMode("craft")}
          title="Craft of Exile"
        >
          <Hammer size={18} />
          {!collapsed && <span>Craft of Exile</span>}
          {!collapsed && <small>CRAFT</small>}
        </button>
        <button
          type="button"
          className={clsx(
            "sidebar-primary-item",
            mode === "knowledge" && "is-active",
          )}
          onClick={() => onMode("knowledge")}
          title="Item Intel"
        >
          <Database size={18} />
          {!collapsed && <span>Item Intel</span>}
          {!collapsed && <small>LIVE</small>}
        </button>
        <button
          type="button"
          className={clsx(
            "sidebar-primary-item",
            mode === "watchlist" && "is-active",
          )}
          onClick={() => onMode("watchlist")}
          title="Watchlist"
        >
          <Star size={18} />
          {!collapsed && <span>Watchlist</span>}
          {watchCount > 0 && <strong>{watchCount}</strong>}
        </button>
        <button
          type="button"
          className={clsx(
            "sidebar-primary-item",
            mode === "toolkit" && "is-active",
          )}
          onClick={() => onMode("toolkit")}
          title="Player toolkit"
        >
          <Scissors size={18} />
          {!collapsed && <span>Player toolkit</span>}
          {!collapsed && <small>NEW</small>}
        </button>
        <button
          type="button"
          className={clsx(
            "sidebar-primary-item",
            mode === "planner" && "is-active",
          )}
          onClick={() => onMode("planner")}
          title="Build planner"
        >
          <Network size={18} />
          {!collapsed && <span>Build planner</span>}
          {!collapsed && <small>BUILD</small>}
        </button>
        <button
          type="button"
          className={clsx(
            "sidebar-primary-item",
            mode === "stash" && "is-active",
          )}
          onClick={() => onMode("stash")}
          title="Stash wealth"
        >
          <Gem size={18} />
          {!collapsed && <span>Stash wealth</span>}
          {!collapsed && <small>WEALTH</small>}
        </button>
      </div>

      <nav className="category-nav" aria-label="Economy categories">
        {categoryGroups.map((group) => (
          <section className="category-group" key={group}>
            {!collapsed && <h3>{group}</h3>}
            <div className="category-list">
              {categories
                .filter((category) => category.group === group)
                .map((category) => (
                  <button
                    className={clsx(
                      "category-item",
                      mode === "market" &&
                        selectedCategory === category.id &&
                        "is-active",
                    )}
                    type="button"
                    key={category.id}
                    title={collapsed ? category.label : category.description}
                    onClick={() => onCategory(category)}
                  >
                    <span className="category-icon">
                      <CategoryIcon name={category.icon} />
                    </span>
                    {!collapsed && <span>{category.label}</span>}
                    {!collapsed && category.source === "dual" && (
                      <small>2</small>
                    )}
                  </button>
                ))}
            </div>
          </section>
        ))}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && (
          <div className="sidebar-tip">
            <Search size={14} />
            <span><kbd>Ctrl K</kbd> opens Item Intel</span>
          </div>
        )}
        <button
          className="sidebar-collapse"
          type="button"
          onClick={() => onCollapsed(!collapsed)}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
