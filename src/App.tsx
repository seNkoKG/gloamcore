import clsx from "clsx";
import {
  BellRing,
  ChevronDown,
  CircleAlert,
  Database,
  Flame,
  Gauge,
  LoaderCircle,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  categories,
  categoryById,
  defaultSource,
  supportsFaustus,
} from "./config/categories";
import { DetailsDrawer } from "./components/DetailsDrawer";
import { KnowledgeDrawer } from "./components/KnowledgeDrawer";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { EconomyTable } from "./components/EconomyTable";
import { LoadingState } from "./components/LoadingState";
import { MarketFilters } from "./components/MarketFilters";
import { MarketHeader } from "./components/MarketHeader";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import { WatchlistPanel } from "./components/WatchlistPanel";
import { ToolkitPanel } from "./components/ToolkitPanel";
import { BuildPlannerPanel } from "./components/BuildPlannerPanel";
import { CraftOfExilePanel } from "./components/CraftOfExilePanel";
import { StashWealthPanel } from "./components/StashWealthPanel";
import { CommandCenterPanel } from "./components/CommandCenterPanel";
import PriceCheckApp from "./PriceCheckApp";
import { resetPriceCheckSurfaceScroll } from "./components/PriceCheckSurface";
import { MobileEconomyList } from "./components/MobileEconomyList";
import {
  MobileBottomNav,
  MobileCategorySheet,
  MobileTopbar,
} from "./components/MobileNavigation";
import { bridge } from "./lib/bridge";
import {
  defaultFiltersForSource,
  emptyFilters,
  filterRows,
  marketStats,
  normalizeOverview,
  sortRows,
} from "./lib/economy";
import { displayPrice, formatCompact, formatPrice, tradeUrl } from "./lib/format";
import { faustusItemSeeds, normalizeFaustusOverview } from "./lib/faustus";
import {
  faustusRefreshDelayMs,
  marketFailureDisposition,
  marketRefreshDelayMs,
  isMarketSnapshotActionable,
} from "./lib/market-freshness";
import {
  defaultPreferences,
  loadPreferences,
  savePreferences,
} from "./lib/preferences";
import {
  mergeDesktopSettingsPatch,
  reconcileSettingsSnapshot,
} from "./lib/settings-sync";
import {
  defaultDesktopShortcuts,
  shortcutEventMatches,
} from "./lib/shortcuts";
import {
  actionableWatchesForLeague,
  isWatchTargetHit,
  isSameWatch,
  mergeWatchlistMarketRefresh,
  pruneAnnouncedWatchIdentities,
  watchAlertDecision,
  watchEntryIdentity,
  watchIdentity,
  watchMarketGroupIdentity,
  watchMarketGroupScheduleKey,
  watchMarketSelection,
} from "./lib/watchlist";
import {
  currentQuickSearchIndexRows,
  dedupeQuickRows,
  isQuickSearchIndexGroupActionable,
  nextQuickSearchIndexExpiryAt,
  type QuickSearchIndexGroup,
} from "./lib/quick-search";
import {
  isMobileApp,
  isNativeMobile,
  notifyPriceTarget,
  preparePriceAlerts,
  tactileTap,
} from "./lib/platform";
import { App as NativeApp } from "@capacitor/app";
import { Network } from "@capacitor/network";
import type { PluginListenerHandle } from "@capacitor/core";
import type {
  AppPreferences,
  AppMode,
  CacheEnvelope,
  CategoryDefinition,
  DataSource,
  DesktopSettings,
  DesktopSettingsPatch,
  EconomyLeague,
  EconomyRow,
  FilterState,
  KnowledgeEntry,
  NormalizedOverview,
  QuickCommand,
  QuickSearchRow,
  RawExchangeOverview,
  RawFaustusOverview,
  RawItemOverview,
  RawStashCurrencyOverview,
  ShortcutEvent,
  SortKey,
  SortState,
  ValueDisplay,
  WatchEntry,
} from "./types";
import { defaultPriceCheckSettings } from "./lib/price-check/types";
import { loadGameData, type GameDataBundle } from "./lib/game-data";
import {
  parseSavedPlannerBuilds,
  SAVED_PLANNER_BUILDS_KEY,
} from "./lib/planner/planner-workspace";

const defaultDesktopSettings: DesktopSettings = {
  alwaysOnTop: true,
  opacity: 1,
  compact: false,
  clickThrough: false,
  startMinimized: false,
  autoCheckUpdates: true,
  updateChannel: "stable",
  shortcuts: defaultDesktopShortcuts,
  priceCheck: defaultPriceCheckSettings,
};

type OverviewEnvelope = CacheEnvelope<
  | RawExchangeOverview
  | RawFaustusOverview
  | RawItemOverview
  | RawStashCurrencyOverview
>;

const normalizedMarketCache = new Map<string, NormalizedOverview>();

function memoizedMarket(key: string, create: () => NormalizedOverview) {
  const cached = normalizedMarketCache.get(key);
  if (cached) {
    normalizedMarketCache.delete(key);
    normalizedMarketCache.set(key, cached);
    return cached;
  }
  const normalized = create();
  normalizedMarketCache.set(key, normalized);
  while (normalizedMarketCache.size > 12) {
    const oldest = normalizedMarketCache.keys().next().value;
    if (oldest) normalizedMarketCache.delete(oldest);
    else break;
  }
  return normalized;
}

export function normalizedSourceForCategory(
  categoryId: string,
  requested: DataSource | undefined,
): DataSource {
  const category = categoryById[categoryId] || categories[0];
  const supported =
    (requested === "faustus" && supportsFaustus(category)) ||
    (requested === "exchange" &&
      (category.source === "exchange" || category.source === "dual")) ||
    (requested === "stash-currency" && category.source === "dual") ||
    (requested === "stash-item" && category.source === "item");
  return supported ? requested : defaultSource(category);
}

export function sourceByCategoryWith(
  current: AppPreferences["sourceByCategory"],
  categoryId: string,
  requested: DataSource,
) {
  return {
    ...current,
    [categoryId]: normalizedSourceForCategory(categoryId, requested),
  };
}

function sourceForCategory(
  preferences: AppPreferences,
  categoryId: string,
): DataSource {
  return normalizedSourceForCategory(
    categoryId,
    preferences.sourceByCategory[categoryId],
  );
}

async function loadCategoryMarket(
  league: string,
  category: CategoryDefinition,
  source: DataSource,
  force = false,
) {
  if (source === "faustus") {
    const baseSource = defaultSource(category);
    const baseEnvelope = await bridge.getOverview({ league, type: category.apiType, source: baseSource, force });
    const base = normalizeOverview(baseEnvelope.data, baseSource, category);
    const envelope = await bridge.getFaustusOverview({ league, items: faustusItemSeeds(base.rows), force });
    return {
      normalized: normalizeFaustusOverview(base, envelope.data, category),
      envelope,
    };
  }
  const envelope = await bridge.getOverview({
    league,
    type: category.apiType,
    source,
    force,
  });
  return {
    normalized: memoizedMarket(
      `${league}:${category.id}:${source}:${envelope.fetchedAt}`,
      () => normalizeOverview(envelope.data, source, category),
    ),
    envelope,
  };
}

function toQuickRow(row: EconomyRow, league: string): QuickSearchRow {
  return {
    key: row.key,
    name: row.name,
    icon: row.icon,
    categoryId: row.categoryId,
    categoryLabel: row.categoryLabel,
    source: row.source,
    league,
    chaosValue: row.chaosValue,
    divineValue: row.divineValue,
    change: row.change,
    volume: row.volume,
    listingCount: row.listingCount,
    variant: row.variant,
    baseType: row.baseType,
    lowConfidence: row.lowConfidence,
  };
}

function quickCommands(bundle: GameDataBundle | null): QuickCommand[] {
  const commands: QuickCommand[] = [
    { id: "workspace:market", title: "Market explorer", subtitle: "Live PoE 1 economy categories", keywords: "economy prices ninja faustus", mode: "market" },
    { id: "workspace:price-check", title: "Price checker", subtitle: "Open the copied-item workspace", keywords: "ctrl d trade item", mode: "price-check" },
    { id: "workspace:knowledge", title: "Item Intel", subtitle: "Search verified game knowledge", keywords: "wiki item intel search", mode: "knowledge" },
    { id: "workspace:watchlist", title: "Watchlist", subtitle: "Saved market targets", keywords: "alerts targets starred", mode: "watchlist" },
    { id: "workspace:league", title: "League Center", subtitle: "Campaign, gems, Atlas and data health", keywords: "route atlas gems league", mode: "command", section: "route" },
    { id: "workspace:planner", title: "Build planner", subtitle: "Path of Building workspace", keywords: "pob passive tree build", mode: "planner" },
    { id: "workspace:toolkit", title: "Player toolkit", subtitle: "Filters, regex, journal and overlays", keywords: "filter regex mapping tools", mode: "toolkit" },
    { id: "workspace:stash", title: "Stash wealth", subtitle: "Open the Wealthy Exile workspace", keywords: "stash wealth", mode: "stash" },
    { id: "workspace:craft", title: "Craft of Exile", subtitle: "Open the protected PoE 1 crafting browser", keywords: "craft simulator", mode: "craft" },
    { id: "workspace:settings", title: "Settings", subtitle: "Themes, accessibility, updates, backup and support", keywords: "preferences theme accessibility backup restore updates", mode: "settings" },
    { id: "league:gems", title: "Gem acquisition", subtitle: "Exact quest and vendor sources", keywords: "league center gems vendor quest", mode: "command", section: "gems" },
    { id: "league:atlas", title: "Atlas planner", subtitle: "Official-data Atlas strategy presets", keywords: "league center atlas nodes", mode: "command", section: "atlas" },
    { id: "league:data", title: "League data health", subtitle: "Validated pack identity and updates", keywords: "integrity sha source version", mode: "command", section: "data" },
  ];
  commands.push(...categories.map((entry): QuickCommand => ({
    id: `market:${entry.id}`,
    title: entry.label,
    subtitle: "Market category",
    keywords: `${entry.id} economy market`,
    mode: "market",
    categoryId: entry.id,
  })));
  try {
    commands.push(...parseSavedPlannerBuilds(
      localStorage.getItem(SAVED_PLANNER_BUILDS_KEY),
    ).map((build): QuickCommand => ({
      id: `build:${build.id}`,
      title: build.name,
      subtitle: "Saved Build Planner workspace",
      keywords: `saved build pob ${build.tags.join(" ")}`,
      mode: "planner",
      resourceId: build.id,
    })));
  } catch {
    // The Build Planner owns recovery for a corrupt library.
  }
  try {
    const atlas = JSON.parse(
      localStorage.getItem("gloamcore:atlas-command-center:v1") || "null",
    ) as { loadouts?: Array<{ id?: string; name?: string; tags?: string[] }> } | null;
    commands.push(...(Array.isArray(atlas?.loadouts) ? atlas.loadouts : []).flatMap(
      (loadout): QuickCommand[] => typeof loadout?.name === "string" && loadout.name.trim()
        ? [{
            id: `atlas-preset:${String(loadout.id || loadout.name)}`,
            title: loadout.name.trim(),
            subtitle: "Saved Atlas strategy preset",
            keywords: `atlas preset ${(loadout.tags || []).join(" ")}`,
            mode: "command",
            section: "atlas",
            resourceId: String(loadout.id || loadout.name),
          }]
        : [],
    ));
  } catch {
    // Atlas Command Center reports and repairs its own stored workspace.
  }
  if (bundle) {
    commands.push(...bundle.navigator.gems.map((gem): QuickCommand => ({
      id: `gem:${gem.id}`,
      title: gem.name,
      subtitle: `${gem.support ? "Support" : "Active"} gem · level ${gem.requiredLevel}`,
      keywords: `gem ${gem.attribute} quest vendor`,
      mode: "command",
      section: "gems",
      query: gem.name,
    })));
    commands.push(...bundle.atlas.nodes.flatMap((node): QuickCommand[] => node.name
      ? [{
          id: `atlas-node:${node.id}`,
          title: node.name,
          subtitle: node.keystone ? "Atlas keystone" : node.notable ? "Atlas notable" : "Atlas node",
          keywords: `atlas ${node.stats.join(" ")}`,
          mode: "command",
          section: "atlas",
          query: node.name,
        }]
      : []));
  }
  return commands;
}

function MarketPulse({
  rows,
  onSelect,
}: {
  rows: EconomyRow[];
  onSelect: (row: EconomyRow) => void;
}) {
  const stats = marketStats(rows);
  const cards = [
    {
      label: "Top gainer",
      row: stats.gainer,
      icon: <TrendingUp size={15} />,
      tone: "gain",
      value:
        stats.gainer?.change == null
          ? "—"
          : `+${Math.round(stats.gainer.change)}%`,
    },
    {
      label: "Top mover down",
      row: stats.loser,
      icon: <TrendingDown size={15} />,
      tone: "loss",
      value:
        stats.loser?.change == null ? "—" : `${Math.round(stats.loser.change)}%`,
    },
    {
      label: "Most liquid",
      row: stats.liquid,
      icon: <Gauge size={15} />,
      tone: "liquid",
      value: formatCompact(stats.liquid?.volume ?? stats.liquid?.listingCount),
    },
  ];
  return (
    <div className="market-pulse">
      <div className="market-pulse-label">
        <Flame size={14} />
        <span>Market pulse</span>
      </div>
      {cards.map((card) => (
        <button
          type="button"
          className={`pulse-card pulse-card--${card.tone}`}
          key={card.label}
          disabled={!card.row}
          onClick={() => card.row && onSelect(card.row)}
        >
          <span>{card.icon}</span>
          <div>
            <small>{card.label}</small>
            <strong>{card.row?.name || "No trend data"}</strong>
          </div>
          <em>{card.value}</em>
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences);
  const [desktopSettings, setDesktopSettings] =
    useState<DesktopSettings>(defaultDesktopSettings);
  const [leagues, setLeagues] = useState<EconomyLeague[]>([]);
  const [league, setLeague] = useState(preferences.league || "");
  const [mode, setMode] = useState<AppMode>("market");
  const [filters, setFilters] = useState<FilterState>({ ...emptyFilters });
  const [sort, setSort] = useState<SortState>({
    key: "value",
    direction: "desc",
  });
  const [overview, setOverview] = useState<NormalizedOverview | null>(null);
  const [overviewEnvelope, setOverviewEnvelope] =
    useState<OverviewEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState<EconomyRow | null>(null);
  const [selectedKnowledge, setSelectedKnowledge] =
    useState<KnowledgeEntry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(80);
  const [watchRefreshing, setWatchRefreshing] = useState(false);
  const [watchInitialRefreshComplete, setWatchInitialRefreshComplete] =
    useState(false);
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [marketRetryRevision, setMarketRetryRevision] = useState(0);
  const [leagueRetryRevision, setLeagueRetryRevision] = useState(0);
  const [pendingSelectionVersion, setPendingSelectionVersion] = useState(0);
  const [commandData, setCommandData] = useState<GameDataBundle | null>(null);
  const [commandNavigation, setCommandNavigation] = useState<{
    section?: "route" | "gems" | "atlas" | "data";
    query?: string;
    resourceId?: string;
    nonce: number;
  }>({ nonce: 0 });
  const searchRef = useRef<HTMLInputElement>(null);
  const knowledgeSearchRef = useRef<HTMLInputElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const mobileScrollResetFrame = useRef<number | null>(null);
  const announcedTargets = useRef<Set<string>>(new Set());
  const overviewRequestId = useRef(0);
  const overviewEnvelopeRef = useRef<OverviewEnvelope | null>(null);
  const watchRefreshGeneration = useRef(0);
  const watchlistRef = useRef(preferences.watchlist);
  const overviewContext = useRef<{
    league: string;
    categoryId: string;
    source: DataSource;
  } | null>(null);
  const quickSearchIndex = useRef<Map<string, QuickSearchIndexGroup>>(new Map());
  const pendingSelection = useRef<{
    league: string;
    categoryId: string;
    source: DataSource;
    rowKey: string;
  } | null>(null);
  const desktopSettingsRef = useRef(desktopSettings);
  const savedDesktopSettingsRef = useRef(defaultDesktopSettings);
  const desktopSettingsRevisionRef = useRef(-1);

  const resetMobileWorkspaceScroll = useCallback(() => {
    if (!isMobileApp) return;
    if (mobileScrollResetFrame.current != null) {
      window.cancelAnimationFrame(mobileScrollResetFrame.current);
    }
    resetPriceCheckSurfaceScroll(mainContentRef.current);
    mobileScrollResetFrame.current = window.requestAnimationFrame(() => {
      resetPriceCheckSurfaceScroll(mainContentRef.current);
      mobileScrollResetFrame.current = null;
    });
  }, []);

  const category = categoryById[preferences.categoryId] || categories[0];
  const source = sourceForCategory(preferences, category.id);
  watchlistRef.current = preferences.watchlist;
  const watchRefreshScheduleKey = useMemo(
    () => watchMarketGroupScheduleKey(preferences.watchlist),
    [preferences.watchlist],
  );

  useEffect(() => {
    desktopSettingsRef.current = desktopSettings;
  }, [desktopSettings]);

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.textScale = preferences.textScale;
    root.dataset.reducedMotion = preferences.reducedMotion ? "true" : "false";
    root.dataset.colorVision = preferences.colorVision;
  }, [preferences.colorVision, preferences.reducedMotion, preferences.textScale]);

  useEffect(() => {
    let active = true;
    void loadGameData()
      .then((loaded) => {
        if (active) setCommandData(loaded.bundle);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const refreshCommands = () => setSurfaceRevision((value) => value + 1);
    window.addEventListener("gloamcore:commands-changed", refreshCommands);
    return () => window.removeEventListener("gloamcore:commands-changed", refreshCommands);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "p") {
        event.preventDefault();
        void bridge.surfaceAction({ type: "open-quick-search" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const applyDesktopSettingsSnapshot = useCallback((incoming: DesktopSettings) => {
    const remote: DesktopSettings = {
      ...defaultDesktopSettings,
      ...incoming,
      shortcuts: {
        ...defaultDesktopShortcuts,
        ...(incoming.shortcuts || {}),
      },
      priceCheck: {
        ...defaultPriceCheckSettings,
        ...(incoming.priceCheck || {}),
      },
    };
    const reconciliation = reconcileSettingsSnapshot({
      authoritative: savedDesktopSettingsRef.current,
      authoritativeRevision: desktopSettingsRevisionRef.current,
      incoming: remote,
      incomingRevision: incoming.settingsRevision,
      local: desktopSettingsRef.current,
      pendingKeys: [] as Array<keyof DesktopSettings>,
    });
    if (!reconciliation.accepted) return false;
    savedDesktopSettingsRef.current = reconciliation.authoritative;
    desktopSettingsRevisionRef.current = reconciliation.authoritativeRevision;
    desktopSettingsRef.current = reconciliation.visible;
    setDesktopSettings(reconciliation.visible);
    return true;
  }, []);

  const updatePreferences = useCallback(
    (
      patch:
        | Partial<AppPreferences>
        | ((current: AppPreferences) => Partial<AppPreferences>),
    ) => {
      setPreferences((current) => {
        const next = {
          ...current,
          ...(typeof patch === "function" ? patch(current) : patch),
        };
        savePreferences(next);
        return next;
      });
    },
    [],
  );

  const updateWatchlist = useCallback(
    (watchlist: WatchEntry[]) => updatePreferences({ watchlist }),
    [updatePreferences],
  );

  useEffect(() => {
    let active = true;
    const apply = (settings: DesktopSettings) => {
      if (active) applyDesktopSettingsSnapshot(settings);
    };
    const unsubscribeSettings = bridge.onSettingsChanged(apply);
    void bridge.getSettings().then(apply).catch(() => {
      // Defaults stay usable until the next authoritative settings event.
    });
    return () => {
      active = false;
      unsubscribeSettings();
    };
  }, [applyDesktopSettingsSnapshot]);

  useEffect(() => {
    let active = true;
    void bridge.getLeagues()
      .then((leagueEnvelope) => {
        if (!active) return;
        setLeagues(leagueEnvelope.data);
        const savedExists = leagueEnvelope.data.some(
          (entry) => entry.id === preferences.league,
        );
        const currentLeague = savedExists
          ? preferences.league!
          : leagueEnvelope.data[0]?.id || "";
        if (!currentLeague) {
          setError("No active Path of Exile 1 economy league is available.");
          setLoading(false);
          return;
        }
        setLeague(currentLeague);
        if (currentLeague !== preferences.league) {
          updatePreferences({ league: currentLeague });
        }
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leagueRetryRevision, preferences.league, updatePreferences]);

  useEffect(() => {
    const unsubscribe = bridge.onShortcut((event: ShortcutEvent) => {
      if (event.type === "always-on-top") {
        setDesktopSettings((current) => ({
          ...current,
          alwaysOnTop: event.value,
        }));
        void bridge.getSettings().then(applyDesktopSettingsSnapshot).catch(() => undefined);
      }
      if (event.type === "click-through") {
        setDesktopSettings((current) => ({
          ...current,
          clickThrough: event.value,
        }));
        void bridge.getSettings().then(applyDesktopSettingsSnapshot).catch(() => undefined);
      }
      if (event.type === "refresh-market") {
        setRefreshSignal((value) => value + 1);
      }
      if (event.type === "open-watchlist") {
        setMode("watchlist");
        setSelectedRow(null);
        setSelectedKnowledge(null);
        setSettingsOpen(false);
      }
      if (event.type === "open-price-check-dashboard") {
        resetMobileWorkspaceScroll();
        setMode("price-check");
        setSelectedRow(null);
        setSelectedKnowledge(null);
        setSettingsOpen(false);
      }
      if (event.type === "open-mode") {
        setSelectedRow(null);
        setSelectedKnowledge(null);
        if (event.mode === "settings") {
          setSettingsOpen(true);
          return;
        }
        setSettingsOpen(false);
        setCommandNavigation((current) => ({
          section: event.section,
          query: event.query,
          resourceId: event.resourceId,
          nonce: current.nonce + 1,
        }));
        if (event.mode === "market" && event.categoryId && categoryById[event.categoryId]) {
          setPreferences((current) => {
            const next = { ...current, categoryId: event.categoryId! };
            savePreferences(next);
            return next;
          });
        }
        setMode(event.mode);
      }
      if (event.type === "open-row" && categoryById[event.categoryId]) {
        const selection = {
          ...event,
          source: normalizedSourceForCategory(event.categoryId, event.source),
        };
        pendingSelection.current = selection;
        setPendingSelectionVersion((value) => value + 1);
        setLeague(selection.league);
        setMode("market");
        setSelectedRow(null);
        setSelectedKnowledge(null);
        setSettingsOpen(false);
        setPreferences((current) => {
          const next = {
            ...current,
            league: selection.league,
            categoryId: selection.categoryId,
            sourceByCategory: sourceByCategoryWith(
              current.sourceByCategory,
              selection.categoryId,
              selection.source,
            ),
          };
          savePreferences(next);
          return next;
        });
      }
    });
    void bridge.rendererReady().catch(() => undefined);
    return () => {
      unsubscribe();
    };
  }, [applyDesktopSettingsSnapshot, resetMobileWorkspaceScroll]);

  const loadOverview = useCallback(
    async (force = false) => {
      if (!league) return;
      const requestId = ++overviewRequestId.current;
      setLoading(true);
      setError("");
      try {
        const { envelope, normalized } = await loadCategoryMarket(
          league,
          category,
          source,
          force,
        );
        if (requestId !== overviewRequestId.current) return;
        overviewContext.current = {
          league,
          categoryId: category.id,
          source,
        };
        overviewEnvelopeRef.current = envelope;
        setOverview(normalized);
        setOverviewEnvelope(envelope);
        setPreferences((current) => {
          let changed = false;
          const watchlist = current.watchlist.map((entry) => {
            const fresh = normalized.rows.find((row) => row.key === entry.key);
            if (!fresh || entry.league !== league) return entry;
            changed = true;
            return {
              ...entry,
              row: fresh,
              marketFetchedAt: envelope.fetchedAt,
              marketStale: envelope.stale,
            };
          });
          const next = changed ? { ...current, watchlist } : current;
          if (changed) savePreferences(next);
          return next;
        });
        if (envelope.stale) {
          setMarketRetryRevision((value) => value + 1);
        }
      } catch (reason) {
        if (requestId === overviewRequestId.current) {
          const message = reason instanceof Error ? reason.message : String(reason);
          const disposition = marketFailureDisposition(
            overviewEnvelopeRef.current,
          );
          overviewEnvelopeRef.current = disposition.envelope;
          setOverviewEnvelope(disposition.envelope);
          if (disposition.clear) {
            overviewContext.current = null;
            setOverview(null);
            setSelectedRow(null);
            const indexKey = `${league}:${category.id}:${source}`;
            if (quickSearchIndex.current.delete(indexKey)) {
              setSurfaceRevision((value) => value + 1);
            }
          }
          setPreferences((current) => {
            let changed = false;
            const watchlist = current.watchlist.map((entry) => {
              if (
                entry.league !== league ||
                entry.row.categoryId !== category.id ||
                entry.row.source !== source ||
                entry.marketStale === true
              ) {
                return entry;
              }
              changed = true;
              return { ...entry, marketStale: true };
            });
            if (!changed) return current;
            const next = { ...current, watchlist };
            savePreferences(next);
            return next;
          });
          setError(message);
          setMarketRetryRevision((value) => value + 1);
        }
      } finally {
        if (requestId === overviewRequestId.current) setLoading(false);
      }
    },
    [category, league, source],
  );

  useEffect(() => {
    if (!league) return;
    overviewEnvelopeRef.current = null;
    overviewContext.current = null;
    setOverview(null);
    setOverviewEnvelope(null);
    setSelectedRow(null);
    setFilters(defaultFiltersForSource(source));
    setVisibleCount(80);
    loadOverview(false);
  }, [league, category.id, source, loadOverview]);

  useEffect(() => {
    if (!league) return undefined;
    const sourceDelay = source === "faustus"
      ? faustusRefreshDelayMs(overviewEnvelope)
      : marketRefreshDelayMs(
          overviewEnvelope,
          preferences.refreshMinutes,
        );
    const timeout = window.setTimeout(
      () => loadOverview(false),
      sourceDelay,
    );
    return () => window.clearTimeout(timeout);
  }, [
    league,
    loadOverview,
    overviewEnvelope?.expiresAt,
    overviewEnvelope?.fetchedAt,
    overviewEnvelope?.stale,
    marketRetryRevision,
    preferences.refreshMinutes,
  ]);

  useEffect(() => {
    if (refreshSignal > 0) void loadOverview(true);
  }, [loadOverview, refreshSignal]);

  useEffect(() => {
    const context = overviewContext.current;
    if (
      !overview ||
      !overviewEnvelope ||
      !context ||
      context.league !== league ||
      context.categoryId !== category.id ||
      context.source !== source
    ) {
      return;
    }
    const key = `${league}:${category.id}:${source}`;
    if (!isQuickSearchIndexGroupActionable(overviewEnvelope)) {
      if (quickSearchIndex.current.delete(key)) {
        setSurfaceRevision((value) => value + 1);
      }
      return;
    }
    quickSearchIndex.current.delete(key);
    quickSearchIndex.current.set(
      key,
      {
        rows: overview.rows.map((row) => toQuickRow(row, league)),
        fetchedAt: overviewEnvelope.fetchedAt,
        stale: overviewEnvelope.stale,
      },
    );
    while (quickSearchIndex.current.size > 8) {
      const oldest = quickSearchIndex.current.keys().next().value;
      if (oldest) quickSearchIndex.current.delete(oldest);
      else break;
    }
    setSurfaceRevision((value) => value + 1);
  }, [
    category.id,
    league,
    overview,
    overviewEnvelope,
    source,
  ]);

  useEffect(() => {
    if (!league || category.id === "currency") return undefined;
    const currency = categoryById.currency;
    const key = `${league}:currency:exchange`;
    let active = true;
    bridge
      .getOverview({
        league,
        type: currency.apiType,
        source: "exchange",
        force: false,
      })
      .then((envelope) => {
        if (!active) return;
        if (
          envelope.stale ||
          !isMarketSnapshotActionable(envelope)
        ) {
          if (quickSearchIndex.current.delete(key)) {
            setSurfaceRevision((value) => value + 1);
          }
          return;
        }
        const normalized = normalizeOverview(envelope.data, "exchange", currency);
        const current = quickSearchIndex.current.get(key);
        if (current && current.fetchedAt > envelope.fetchedAt) return;
        quickSearchIndex.current.set(
          key,
          {
            rows: normalized.rows.map((row) => toQuickRow(row, league)),
            fetchedAt: envelope.fetchedAt,
            stale: envelope.stale,
          },
        );
        setSurfaceRevision((value) => value + 1);
      })
      .catch(() => {
        if (!active) return;
        const size = quickSearchIndex.current.size;
        currentQuickSearchIndexRows(quickSearchIndex.current);
        if (quickSearchIndex.current.size !== size) {
          setSurfaceRevision((value) => value + 1);
        }
      });
    return () => {
      active = false;
    };
  }, [
    category.id,
    league,
    marketRetryRevision,
    overviewEnvelope?.expiresAt,
    overviewEnvelope?.fetchedAt,
    refreshSignal,
  ]);

  useEffect(() => {
    const pending = pendingSelection.current;
    const context = overviewContext.current;
    if (
      !pending ||
      !overview ||
      !context ||
      pending.league !== context.league ||
      pending.categoryId !== context.categoryId ||
      pending.source !== context.source
    ) {
      return;
    }
    const row = overview.rows.find((entry) => entry.key === pending.rowKey);
    // A quick-search/watch result can disappear between publication and the
    // destination refresh. Consume the navigation once its exact market has
    // loaded so a removed row cannot unexpectedly reopen after a later poll.
    pendingSelection.current = null;
    if (row) {
      setSelectedRow(row);
    }
  }, [overview, pendingSelectionVersion]);

  useEffect(() => {
    const indexedRows = currentQuickSearchIndexRows(quickSearchIndex.current);
    const watchedRows = actionableWatchesForLeague(
      preferences.watchlist,
      league,
    )
      .map((entry) => toQuickRow(entry.row, entry.league));
    const searchRows = dedupeQuickRows([...watchedRows, ...indexedRows]).filter(
      (row) => row.league === league,
    );
    const divineChaos = searchRows.find(
      (row) => row.categoryId === "currency" && row.name === "Divine Orb",
    )?.chaosValue;
    const currentContext = overviewContext.current;
    const overviewIsCurrent =
      currentContext?.league === league &&
      currentContext?.categoryId === category.id &&
      currentContext?.source === source;
    const overviewIsPublishable =
      overviewIsCurrent &&
      isQuickSearchIndexGroupActionable(overviewEnvelope);
    const topMovers = (overviewIsPublishable ? overview?.rows || [] : [])
      .filter(
        (row) =>
          row.change != null &&
          Number.isFinite(row.change) &&
          !row.lowConfidence,
      )
      .sort(
        (a, b) =>
          Math.abs(b.change || 0) - Math.abs(a.change || 0) ||
          (b.volume ?? b.listingCount ?? 0) -
            (a.volume ?? a.listingCount ?? 0),
      )
      .slice(0, 5)
      .map((row) => toQuickRow(row, league));
    const alerts = (watchInitialRefreshComplete ? preferences.watchlist : [])
      .filter((entry) => entry.league === league && isWatchTargetHit(entry))
      .flatMap((entry) => {
        const current =
          entry.targetUnit === "divine"
            ? entry.row.divineValue
            : entry.row.chaosValue;
        if (current == null || !Number.isFinite(current)) return [];
        return [{
          key: entry.key,
          name: entry.row.name,
          icon: entry.row.icon,
          current,
          target: entry.targetPrice!,
          unit: entry.targetUnit!,
          categoryId: entry.row.categoryId,
          source: entry.row.source,
          league: entry.league,
        }];
      });
    void bridge
      .publishSurfaceState({
        league,
        categoryLabel: category.label,
        fetchedAt: overviewEnvelope?.fetchedAt,
        stale: Boolean(overviewEnvelope?.stale),
        loading,
        divineChaos,
        alertCount: alerts.length,
        alerts,
        topMovers,
        searchRows,
        commands: quickCommands(commandData),
      })
      .catch(() => {
        // Browser preview and a closing desktop process may not own a surface.
      });
  }, [
    category.id,
    category.label,
    commandData,
    league,
    loading,
    overview,
    overviewEnvelope?.fetchedAt,
    overviewEnvelope?.stale,
    preferences.watchlist,
    source,
    surfaceRevision,
    watchInitialRefreshComplete,
  ]);

  useEffect(() => {
    const expiresAt = nextQuickSearchIndexExpiryAt(quickSearchIndex.current);
    if (expiresAt == null) return undefined;
    const timeout = window.setTimeout(() => {
      const size = quickSearchIndex.current.size;
      currentQuickSearchIndexRows(quickSearchIndex.current);
      if (quickSearchIndex.current.size !== size) {
        setSurfaceRevision((value) => value + 1);
      }
    }, Math.max(1_000, expiresAt - Date.now() + 250));
    return () => window.clearTimeout(timeout);
  }, [surfaceRevision]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        shortcutEventMatches(
          event,
          desktopSettingsRef.current.shortcuts.gameDataSearch,
        ) &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        setMode("knowledge");
        setSelectedRow(null);
        setSelectedKnowledge(null);
        setSettingsOpen(false);
        window.setTimeout(() => knowledgeSearchRef.current?.focus(), 0);
      }
      if (
        shortcutEventMatches(
          event,
          desktopSettingsRef.current.shortcuts.focusItemSearch,
        ) &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        setMode("market");
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else if (selectedKnowledge) setSelectedKnowledge(null);
        else if (selectedRow) setSelectedRow(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedKnowledge, selectedRow, settingsOpen]);

  const filteredRows = useMemo(
    () =>
      overview
        ? filterRows(overview.rows, filters, preferences.valueDisplay)
        : [],
    [filters, overview, preferences.valueDisplay],
  );
  const sortedRows = useMemo(
    () => sortRows(filteredRows, sort, preferences.valueDisplay),
    [filteredRows, preferences.valueDisplay, sort],
  );
  const visibleRows = sortedRows.slice(0, visibleCount);
  const watchKeys = useMemo(
    () =>
      new Set(
        preferences.watchlist
          .filter((entry) => entry.league === league)
          .map((entry) => entry.key),
      ),
    [league, preferences.watchlist],
  );
  const alertCount = watchInitialRefreshComplete
    ? preferences.watchlist.filter(isWatchTargetHit).length
    : 0;
  const selectedWatch = selectedRow
    ? preferences.watchlist.find((entry) =>
        isSameWatch(entry, league, selectedRow),
      )
    : undefined;

  const onCategory = (nextCategory: typeof category) => {
    const recent = [
      nextCategory.id,
      ...(preferences.lastViewed || []).filter((id) => id !== nextCategory.id),
    ].slice(0, 6);
    updatePreferences({
      categoryId: nextCategory.id,
      lastViewed: recent,
    });
    setMode("market");
    setCommandNavigation((current) => ({ nonce: current.nonce + 1 }));
    setSelectedKnowledge(null);
  };

  const switchMode = (nextMode: AppMode) => {
    resetMobileWorkspaceScroll();
    setMode(nextMode);
    setCommandNavigation((current) => ({ nonce: current.nonce + 1 }));
    setSelectedRow(null);
    setSelectedKnowledge(null);
    setSettingsOpen(false);
  };

  useEffect(() => {
    resetMobileWorkspaceScroll();
  }, [mode, resetMobileWorkspaceScroll]);

  useEffect(() => () => {
    if (mobileScrollResetFrame.current != null) {
      window.cancelAnimationFrame(mobileScrollResetFrame.current);
    }
  }, []);

  const onSource = (nextSource: DataSource) => {
    updatePreferences((current) => ({
      sourceByCategory: sourceByCategoryWith(
        current.sourceByCategory,
        category.id,
        nextSource,
      ),
    }));
  };

  const onSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "desc" ? "asc" : "desc",
          }
        : { key, direction: key === "name" ? "asc" : "desc" },
    );
  };

  const toggleWatch = (row: EconomyRow) => {
    const existing = preferences.watchlist.find((entry) =>
      isSameWatch(entry, league, row),
    );
    if (existing) {
      updateWatchlist(
        preferences.watchlist.filter(
          (entry) => !isSameWatch(entry, league, row),
        ),
      );
      return;
    }
    updateWatchlist([
      {
        key: row.key,
        row,
        league,
        addedAt: Date.now(),
        marketFetchedAt: overviewEnvelope?.fetchedAt,
        marketStale: overviewEnvelope?.stale ?? true,
      },
      ...preferences.watchlist,
    ]);
  };

  const saveWatch = (entry: WatchEntry) => {
    if (entry.targetPrice != null && entry.targetPrice > 0 && entry.targetUnit) {
      void preparePriceAlerts();
    }
    const identity = watchEntryIdentity(entry);
    const existing = preferences.watchlist.some(
      (item) => watchEntryIdentity(item) === identity,
    );
    updateWatchlist(
      existing
        ? preferences.watchlist.map((item) =>
            watchEntryIdentity(item) === identity ? entry : item,
          )
        : [entry, ...preferences.watchlist],
    );
  };

  const refreshWatchlist = useCallback(async (force = false) => {
    const watchedEntries = watchlistRef.current;
    if (watchedEntries.length === 0) return;
    const generation = ++watchRefreshGeneration.current;
    setWatchRefreshing(true);
    try {
      const groups = [
        ...new Map(
          watchedEntries.map((entry) => {
            const entryCategory = categoryById[entry.row.categoryId];
            const groupKey = `${entry.league}:${entry.row.categoryId}:${entry.row.source}`;
            return [
              groupKey,
              {
                league: entry.league,
                category: entryCategory,
                source: entry.row.source,
              },
            ];
          }),
        ).values(),
      ].filter((group) => group.category);
      const freshRows = new Map<
        string,
        { row: EconomyRow; fetchedAt: number; stale: boolean }
      >();
      const successfulGroups = new Set<string>();
      const failedGroups = new Set<string>();
      for (const group of groups) {
        const groupIdentity = watchMarketGroupIdentity(
          group.league,
          group.category.id,
          group.source,
        );
        try {
          const { normalized, envelope } = await loadCategoryMarket(
            group.league,
            group.category,
            group.source,
            force,
          );
          if (envelope.stale) failedGroups.add(groupIdentity);
          else successfulGroups.add(groupIdentity);
          normalized.rows.forEach((row) =>
            freshRows.set(watchIdentity(group.league, row.key), {
              row,
              fetchedAt: envelope.fetchedAt,
              stale: envelope.stale,
            }),
          );
        } catch {
          failedGroups.add(groupIdentity);
          // A single unavailable category should not block other watchlist updates.
        }
      }
      if (generation !== watchRefreshGeneration.current) return;
      setPreferences((current) => {
        if (generation !== watchRefreshGeneration.current) return current;
        const watchlist = mergeWatchlistMarketRefresh(
          current.watchlist,
          freshRows,
          successfulGroups,
          failedGroups,
        );
        if (watchlist === current.watchlist) return current;
        const next = { ...current, watchlist };
        savePreferences(next);
        return next;
      });
    } finally {
      if (generation === watchRefreshGeneration.current) {
        setWatchRefreshing(false);
        setWatchInitialRefreshComplete(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!watchRefreshScheduleKey) return undefined;
    void refreshWatchlist();
    const interval = window.setInterval(
      () => refreshWatchlist(),
      Math.max(5, preferences.refreshMinutes) * 60_000,
    );
    return () => window.clearInterval(interval);
  }, [
    preferences.refreshMinutes,
    refreshWatchlist,
    watchRefreshScheduleKey,
  ]);

  useEffect(() => {
    pruneAnnouncedWatchIdentities(
      announcedTargets.current,
      preferences.watchlist,
    );
    if (!watchInitialRefreshComplete) return;

    const nextStates = new Map<
      string,
      NonNullable<WatchEntry["lastAlertState"]>
    >();
    for (const entry of preferences.watchlist) {
      const identity = watchEntryIdentity(entry);
      const decision = watchAlertDecision(entry, true);
      if (!decision.state) continue;
      nextStates.set(identity, decision.state);
      const alreadyAnnounced = announcedTargets.current.has(identity);
      if (decision.state === "below") {
        announcedTargets.current.add(identity);
      } else {
        announcedTargets.current.delete(identity);
      }
      if (decision.notify && !alreadyAnnounced) {
        const current =
          entry.targetUnit === "chaos"
            ? entry.row.chaosValue
            : entry.row.divineValue;
        if (current == null || !Number.isFinite(current)) continue;
        const notificationId =
          [...identity].reduce(
            (value, character) =>
              ((value << 5) - value + character.charCodeAt(0)) | 0,
            17,
          ) & 0x7fffffff;
        void notifyPriceTarget(
          `${entry.row.name} reached your target`,
          `Now ${formatPrice(current)} ${entry.targetUnit}. Target: ${formatPrice(entry.targetPrice!)}.`,
          notificationId || 1,
        );
      }
    }
    if (nextStates.size > 0) {
      setPreferences((current) => {
        let changed = false;
        const watchlist = current.watchlist.map((entry) => {
          const state = nextStates.get(watchEntryIdentity(entry));
          if (!state || entry.lastAlertState === state) return entry;
          changed = true;
          return { ...entry, lastAlertState: state };
        });
        if (!changed) return current;
        const next = { ...current, watchlist };
        savePreferences(next);
        return next;
      });
    }
  }, [preferences.watchlist, watchInitialRefreshComplete]);

  useEffect(() => {
    if (!isNativeMobile) return undefined;
    let disposed = false;
    let appStateHandle: PluginListenerHandle | null = null;
    let networkHandle: PluginListenerHandle | null = null;

    void NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && !disposed) {
        setRefreshSignal((value) => value + 1);
        void refreshWatchlist();
      }
    }).then((handle) => {
      appStateHandle = handle;
      if (disposed) void handle.remove();
    });
    void Network.addListener("networkStatusChange", ({ connected }) => {
      if (connected && !disposed) {
        setRefreshSignal((value) => value + 1);
        void refreshWatchlist();
      }
    }).then((handle) => {
      networkHandle = handle;
      if (disposed) void handle.remove();
    });
    return () => {
      disposed = true;
      void appStateHandle?.remove();
      void networkHandle?.remove();
    };
  }, [refreshWatchlist]);

  useEffect(() => {
    if (!isNativeMobile) return undefined;
    let disposed = false;
    let handle: PluginListenerHandle | null = null;
    void NativeApp.addListener("backButton", () => {
      if (categorySheetOpen) setCategorySheetOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (selectedKnowledge) setSelectedKnowledge(null);
      else if (selectedRow) setSelectedRow(null);
      else if (mode !== "market") setMode("market");
      else void NativeApp.minimizeApp();
    }).then((listener) => {
      handle = listener;
      if (disposed) void listener.remove();
    });
    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, [categorySheetOpen, mode, selectedKnowledge, selectedRow, settingsOpen]);

  const updateDesktop = async (patch: Partial<DesktopSettings>) => {
    const { settingsRevision: _ignoredRevision, ...rawPatch } = patch;
    const safePatch = rawPatch as DesktopSettingsPatch;
    const [key, value] = Object.entries(safePatch)[0] || [];
    if (!key) return;
    const actions: Record<string, string> = {
      alwaysOnTop: "always-on-top",
      compact: "compact",
      clickThrough: "click-through",
      opacity: "opacity",
    };
    setDesktopSettings((current) => {
      const next = mergeDesktopSettingsPatch(current, safePatch);
      desktopSettingsRef.current = next;
      return next;
    });
    try {
      const saved = actions[key]
        ? await bridge.windowAction(actions[key], value)
        : await bridge.saveSettings(safePatch);
      if (saved) applyDesktopSettingsSnapshot(saved);
    } catch (reason) {
      try {
        applyDesktopSettingsSnapshot(await bridge.getSettings());
      } catch {
        // Keep the optimistic snapshot only when the authoritative state is unavailable.
      }
      throw reason;
    }
  };

  const setLeagueAndRemember = (nextLeague: string) => {
    setLeague(nextLeague);
    updatePreferences({ league: nextLeague });
  };

  const renderMarket = () => (
    <>
      <MarketHeader
        category={category}
        source={source}
        league={league}
        leagues={leagues}
        fetchedAt={overviewEnvelope?.fetchedAt}
        expiresAt={overviewEnvelope?.expiresAt}
        stale={Boolean(overviewEnvelope?.stale)}
        loading={loading}
        rowCount={overview?.rows.length || 0}
        alertCount={alertCount}
        onLeague={setLeagueAndRemember}
        onRefresh={() => loadOverview(true)}
      />

      {error && overview && !loading && (
        <div className="market-refresh-error" role="status">
          <CircleAlert size={15} />
          <span>
            <strong>Market refresh failed.</strong>
            {error}
          </span>
          <button type="button" onClick={() => void loadOverview(true)}>
            Retry
          </button>
        </div>
      )}

      {overview && !loading && (
        <MarketPulse rows={overview.rows} onSelect={setSelectedRow} />
      )}

      {overview && (
        <MarketFilters
          ref={searchRef}
          category={category}
          source={source}
          rows={overview.rows}
          filters={filters}
          display={preferences.valueDisplay}
          resultCount={sortedRows.length}
          onSource={onSource}
          onFilters={(nextFilters) => {
            setFilters(nextFilters);
            setVisibleCount(80);
          }}
          onDisplay={(valueDisplay) => updatePreferences({ valueDisplay })}
        />
      )}

      {loading && !overview ? (
        <LoadingState />
      ) : error && !overview ? (
        <div className="error-state">
          <CircleAlert size={28} />
          <h3>Couldn’t load the market</h3>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              if (league) {
                void loadOverview(true);
                return;
              }
              setError("");
              setLoading(true);
              setLeagueRetryRevision((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : overview ? (
        isMobileApp ? (
          <MobileEconomyList
            source={source}
            rows={sortedRows}
            visibleRows={visibleRows}
            display={preferences.valueDisplay}
            density={preferences.density}
            sort={sort}
            watchKeys={watchKeys}
            onSort={onSort}
            onSelect={(row) => {
              void tactileTap();
              setSelectedRow(row);
            }}
            onWatch={toggleWatch}
            onTrade={(row) => {
              const url = tradeUrl(row, league);
              if (!url) {
                setError("Exact Official Trade identity is unavailable for this market row.");
                return;
              }
              void bridge.openExternal(url);
            }}
            onShowMore={() => setVisibleCount((count) => count + 80)}
          />
        ) : (
          <EconomyTable
            source={source}
            rows={sortedRows}
            visibleRows={visibleRows}
            display={preferences.valueDisplay}
            density={preferences.density}
            sort={sort}
            items={overview.core.items}
            selectedKey={selectedRow?.key}
            watchKeys={watchKeys}
            onSort={onSort}
            onSelect={setSelectedRow}
            onWatch={toggleWatch}
            onTrade={(row) => {
              const url = tradeUrl(row, league);
              if (!url) {
                setError("Exact Official Trade identity is unavailable for this market row.");
                return;
              }
              void bridge.openExternal(url);
            }}
            onShowMore={() => setVisibleCount((count) => count + 80)}
          />
        )
      ) : null}
    </>
  );

  return (
    <div
      className={clsx(
        "app-shell",
        isMobileApp && "app-shell--mobile",
        desktopSettings.compact && "app-shell--compact",
        preferences.sidebarCollapsed && "app-shell--sidebar-collapsed",
        (selectedRow || selectedKnowledge) && "app-shell--details-open",
      )}
    >
      {isMobileApp ? (
        <MobileTopbar
          category={category}
          league={league}
          loading={loading}
          mode={mode}
          onCategories={() => setCategorySheetOpen(true)}
          onRefresh={() => loadOverview(true)}
        />
      ) : (
        <Titlebar
          alwaysOnTop={desktopSettings.alwaysOnTop}
          compact={desktopSettings.compact}
          clickThrough={desktopSettings.clickThrough}
          onAlwaysOnTop={(alwaysOnTop) => updateDesktop({ alwaysOnTop })}
          onCompact={(compact) => updateDesktop({ compact })}
          onOpenSettings={() => {
            setSettingsOpen(true);
            setSelectedRow(null);
          }}
        />
      )}

      {!isMobileApp && desktopSettings.compact && (
        <div className="compact-quickbar">
          <label>
            <select
              value={category.id}
              onChange={(event) => onCategory(categoryById[event.target.value])}
            >
              {categories.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <button
            type="button"
            className={mode === "knowledge" ? "is-active" : undefined}
            onClick={() => switchMode("knowledge")}
            title="Open Item Intel"
          >
            <Database size={14} />
            Intel
          </button>
          <button
            type="button"
            className={mode === "watchlist" ? "is-active" : undefined}
            onClick={() => setMode(mode === "watchlist" ? "market" : "watchlist")}
          >
            <Star size={14} fill={mode === "watchlist" ? "currentColor" : "none"} />
            {preferences.watchlist.length}
          </button>
          {alertCount > 0 && (
            <span>
              <BellRing size={13} />
              {alertCount}
            </span>
          )}
        </div>
      )}

      <div className="app-body">
        {!isMobileApp && (
          <Sidebar
            selectedCategory={category.id}
            collapsed={preferences.sidebarCollapsed}
            watchCount={preferences.watchlist.length}
            mode={mode}
            onMode={switchMode}
            onCategory={onCategory}
            onCollapsed={(sidebarCollapsed) =>
              updatePreferences({ sidebarCollapsed })
            }
          />
        )}

        <main
          className={clsx(
            "main-content",
            !isMobileApp &&
              (mode === "stash" || mode === "craft") &&
              "main-content--edge-to-edge",
          )}
          ref={mainContentRef}
        >
          {mode === "market" ? (
            renderMarket()
          ) : mode === "price-check" ? (
            <PriceCheckApp
              embedded
              leagueOverride={league}
              onClose={() => switchMode("market")}
            />
          ) : mode === "knowledge" ? (
            <KnowledgePanel
              ref={knowledgeSearchRef}
              onSelect={(entry) => {
                setSelectedKnowledge(entry);
                setSelectedRow(null);
                setSettingsOpen(false);
              }}
            />
          ) : mode === "toolkit" ? (
            <ToolkitPanel league={league} />
          ) : mode === "command" ? (
            <CommandCenterPanel navigation={commandNavigation} />
          ) : mode === "planner" ? (
            <BuildPlannerPanel
              league={league}
              savedBuildId={commandNavigation.resourceId}
              navigationNonce={commandNavigation.nonce}
            />
          ) : mode === "craft" ? (
            <CraftOfExilePanel />
          ) : mode === "stash" ? (
            <StashWealthPanel league={league} />
          ) : (
            <WatchlistPanel
              entries={preferences.watchlist}
              display={preferences.valueDisplay}
              refreshing={watchRefreshing}
              onDisplay={(valueDisplay: ValueDisplay) =>
                updatePreferences({ valueDisplay })
              }
              onSelect={(entry) => {
                const requested = watchMarketSelection(entry);
                const selection = {
                  ...requested,
                  source: normalizedSourceForCategory(
                    requested.categoryId,
                    requested.source,
                  ),
                };
                pendingSelection.current = selection;
                setPendingSelectionVersion((value) => value + 1);
                setLeague(selection.league);
                setMode("market");
                setSelectedRow(null);
                setSelectedKnowledge(null);
                setSettingsOpen(false);
                setPreferences((current) => {
                  const next = {
                    ...current,
                    league: selection.league,
                    categoryId: selection.categoryId,
                    sourceByCategory: sourceByCategoryWith(
                      current.sourceByCategory,
                      selection.categoryId,
                      selection.source,
                    ),
                  };
                  savePreferences(next);
                  return next;
                });
              }}
              onRemove={(entry) =>
                updateWatchlist(
                  preferences.watchlist.filter(
                    (item) =>
                      watchEntryIdentity(item) !== watchEntryIdentity(entry),
                  ),
                )
              }
              onRefresh={() => {
                void refreshWatchlist(true);
              }}
            />
          )}
        </main>

        {isMobileApp && (selectedRow || selectedKnowledge || settingsOpen) && (
          <button
            className="mobile-drawer-scrim"
            type="button"
            aria-label="Close open panel"
            onClick={() => {
              setSelectedRow(null);
              setSelectedKnowledge(null);
              setSettingsOpen(false);
            }}
          />
        )}
        {selectedRow && (
          <DetailsDrawer
            row={selectedRow}
            league={league}
            watch={selectedWatch}
            onClose={() => setSelectedRow(null)}
            onToggleWatch={toggleWatch}
            onSaveWatch={saveWatch}
          />
        )}
        {selectedKnowledge && (
          <KnowledgeDrawer
            entry={selectedKnowledge}
            onClose={() => setSelectedKnowledge(null)}
          />
        )}
        {settingsOpen && (
          <SettingsDrawer
            settings={desktopSettings}
            density={preferences.density}
            theme={preferences.theme}
            textScale={preferences.textScale}
            reducedMotion={preferences.reducedMotion}
            colorVision={preferences.colorVision}
            refreshMinutes={preferences.refreshMinutes}
            onClose={() => setSettingsOpen(false)}
            onSettings={updateDesktop}
            onDensity={(density) => updatePreferences({ density })}
            onTheme={(theme) => updatePreferences({ theme })}
            onTextScale={(textScale) => updatePreferences({ textScale })}
            onReducedMotion={(reducedMotion) => updatePreferences({ reducedMotion })}
            onColorVision={(colorVision) => updatePreferences({ colorVision })}
            onRefreshMinutes={(refreshMinutes) =>
              updatePreferences({ refreshMinutes })
            }
          />
        )}
      </div>

      {isMobileApp && (
        <>
          <MobileBottomNav
            mode={mode}
            watchCount={preferences.watchlist.length}
            alertCount={alertCount}
            settingsOpen={settingsOpen}
            onMarket={() => {
              switchMode("market");
            }}
            onPriceCheck={() => {
              switchMode("price-check");
            }}
            onKnowledge={() => {
              switchMode("knowledge");
              window.setTimeout(() => knowledgeSearchRef.current?.focus(), 0);
            }}
            onCommand={() => {
              switchMode("command");
            }}
            onWatchlist={() => {
              switchMode("watchlist");
            }}
            onSettings={() => {
              setSettingsOpen((current) => !current);
              setSelectedRow(null);
              setSelectedKnowledge(null);
            }}
          />
          <MobileCategorySheet
            open={categorySheetOpen}
            selectedId={category.id}
            recentIds={preferences.lastViewed || []}
            onClose={() => setCategorySheetOpen(false)}
            onSelect={(nextCategory) => {
              onCategory(nextCategory);
              setCategorySheetOpen(false);
            }}
          />
        </>
      )}

      {!isMobileApp && desktopSettings.clickThrough && (
        <div className="clickthrough-indicator">
          <span />
          Click-through active · Ctrl Shift L to unlock
        </div>
      )}

      {loading && overview && (
        <div className="background-loading">
          <LoaderCircle size={14} />
          Updating
        </div>
      )}
    </div>
  );
}
