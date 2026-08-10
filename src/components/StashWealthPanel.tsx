import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Plug,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { categoryById, defaultSource } from "../config/categories";
import { normalizeOverview } from "../lib/economy";
import { bridge, isDesktop } from "../lib/bridge";
import { formatPrice, formatRelativeTime } from "../lib/format";
import { CurrencyMark } from "./CurrencyMark";
import {
  categoryIdsForFamilies,
  classifyStashItem,
  STASH_FAMILY_LABELS,
} from "../lib/stash/stash-classify";
import { buildStashPriceIndex, type StashPricingOverview } from "../lib/stash/stash-pricing";
import {
  buildSnapshot,
  orderedFamilies,
  snapshotDelta,
  valueStashTabs,
  type StashValuationResult,
} from "../lib/stash/stash-valuator";
import {
  loadStashSnapshotHistory,
  loadStashSession,
  pushStashSnapshot,
  saveStashSession,
} from "../lib/stash/stash-storage";
import type {
  PoeOAuthStatus,
  PoeStashLeague,
  PoeStashRealm,
  PoeStashTabSummary,
  StashProgressEvent,
  ValueDisplay,
} from "../types";
import type {
  StashSnapshot,
  StashTabValuation,
} from "../lib/stash/stash-types";

type Busy = "idle" | "listing" | "syncing" | "pricing";

const AUTO_SYNC_OPTIONS: Array<{ minutes: 0 | 15 | 30 | 60; label: string }> = [
  { minutes: 0, label: "Auto-sync: off" },
  { minutes: 15, label: "Auto-sync: 15 min" },
  { minutes: 30, label: "Auto-sync: 30 min" },
  { minutes: 60, label: "Auto-sync: 60 min" },
];

const REALMS: Array<{ value: PoeStashRealm; label: string }> = [
  { value: "pc", label: "PC" },
  { value: "xbox", label: "Xbox" },
  { value: "sony", label: "PlayStation" },
];

function moneyValue(chaos: number, divine: number, display: ValueDisplay) {
  return display === "divine" ? divine : chaos;
}

function Money({
  chaos,
  divine,
  display,
  className,
}: {
  chaos: number;
  divine: number;
  display: ValueDisplay;
  className?: string;
}) {
  const unit = display === "divine" ? "divine" : "chaos";
  return (
    <span className={clsx("stash-money", className)}>
      <CurrencyMark unit={unit} size="small" />
      <strong>{formatPrice(moneyValue(chaos, divine, display))}</strong>
    </span>
  );
}

function roundedChaos(value: number) {
  return Math.round(value);
}

function LeagueSelector({
  leagues,
  value,
  onChange,
  disabled,
}: {
  leagues: PoeStashLeague[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="value-display-select"
      value={value}
      disabled={disabled || leagues.length === 0}
      onChange={(event) => onChange(event.target.value)}
      aria-label="League"
    >
      {leagues.length === 0 && <option value="">Loading leagues…</option>}
      {value === "" && leagues.length > 0 && <option value="">Select league</option>}
      {leagues.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
    </select>
  );
}

export function StashWealthPanel({ league: appLeague }: { league: string }) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<PoeOAuthStatus>({
    connected: false,
    scope: "",
    username: "",
  });
  const [connectingPoe, setConnectingPoe] = useState(false);
  const [manualTokenMode, setManualTokenMode] = useState(false);
  const [realm, setRealm] = useState<PoeStashRealm>(() => loadStashSession()?.realm || "pc");
  const [leagues, setLeagues] = useState<PoeStashLeague[]>([]);
  const [leagueId, setLeagueId] = useState("");
  const [tabs, setTabs] = useState<PoeStashTabSummary[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoSyncMinutes, setAutoSyncMinutes] = useState<0 | 15 | 30 | 60>(
    () => loadStashSession()?.autoSyncMinutes || 0,
  );
  const [busy, setBusy] = useState<Busy>("idle");
  const [progress, setProgress] = useState<StashProgressEvent | null>(null);
  const [pricingDone, setPricingDone] = useState(0);
  const [pricingTotal, setPricingTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StashValuationResult | null>(null);
  const [history, setHistory] = useState<StashSnapshot[]>(() => loadStashSnapshotHistory().snapshots);
  const [display, setDisplay] = useState<ValueDisplay>("chaos");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => loadStashSession()?.lastSyncAt || null);

  const busyRef = useRef(false);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const oauthRef = useRef(oauthStatus);
  oauthRef.current = oauthStatus;
  const leagueRef = useRef(leagueId);
  leagueRef.current = leagueId;
  const realmRef = useRef(realm);
  realmRef.current = realm;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const autoSyncMinutesRef = useRef(autoSyncMinutes);
  autoSyncMinutesRef.current = autoSyncMinutes;

  const syncNow = useCallback(
    async (silent: boolean) => {
      if (busyRef.current) return;
      const accessToken = tokenRef.current;
      const league = leagueRef.current;
      if (!league) return;
      if (!accessToken && !oauthRef.current.connected) return;
      busyRef.current = true;
      setBusy("syncing");
      try {
        const details = await bridge.syncPoeStash({
          realm: realmRef.current,
          league,
          ...(accessToken ? { accessToken } : {}),
        });
        const categories = new Set<string>();
        for (const tab of details) {
          for (const item of tab.items || []) {
            const family = classifyStashItem(item);
            if (family === "other") continue;
            for (const categoryId of categoryIdsForFamilies([family])) categories.add(categoryId);
          }
        }
        setBusy("pricing");
        setPricingTotal(categories.size);
        setPricingDone(0);
        const index = await buildIndex([...categories], league, setPricingDone);
        const selected = details.filter((tab) => selectedRef.current.has(tab.id));
        const valuation = valueStashTabs(selected, index);
        const snapshot = buildSnapshot(valuation, league, realmRef.current);
        const loaded = loadStashSnapshotHistory();
        pushStashSnapshot(snapshot, loaded);
        saveStashSession({
          version: 1,
          realm: realmRef.current,
          league,
          lastSyncAt: Date.now(),
          autoSyncMinutes: autoSyncMinutesRef.current,
          tabCount: details.length,
        });
        setLastSyncAt(Date.now());
        setResult(valuation);
        setHistory(loadStashSnapshotHistory().snapshots);
        setTabs(
          details.map(({ id, name, type, index: tabIndex, path }) => ({
            id,
            name,
            type,
            index: tabIndex,
            path,
          })),
        );
        setSelectedIds(new Set(selected.map((tab) => tab.id)));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        busyRef.current = false;
        setBusy("idle");
      }
    },
    [],
  );

  const loadTabs = useCallback(async () => {
    if (!leagueRef.current) return;
    if (!tokenRef.current && !oauthRef.current.connected) return;
    setError(null);
    setBusy("listing");
    try {
      const listed = await bridge.listPoeStashTabs({
        realm: realmRef.current,
        league: leagueRef.current,
        ...(tokenRef.current ? { accessToken: tokenRef.current } : {}),
      });
      setTabs(listed);
      setSelectedIds(new Set(listed.map((tab) => tab.id)));
      setBusy("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy("idle");
    }
  }, []);

  const loadLeagues = useCallback(async () => {
    if (!isDesktop) return;
    try {
      const listed = await bridge.getPoeStashLeagues({ realm });
      setLeagues(listed);
      const sessionLeague = loadStashSession()?.league;
      const appHint = appLeague.replace(/^poe1\./, "").replace(/^poe2\./, "");
      const preferred = [sessionLeague, appHint, listed[0]?.id].find(
        (id) => id && listed.some((entry) => entry.id === id),
      );
      if (preferred) setLeagueId(preferred);
      else if (listed.length > 0) setLeagueId(listed[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [realm, appLeague]);

  useEffect(() => {
    void loadLeagues();
  }, [loadLeagues]);

  useEffect(() => {
    if (!isDesktop) return undefined;
    return bridge.onStashProgress((event) => setProgress(event));
  }, []);

  useEffect(() => {
    if (!isDesktop) return undefined;
    let alive = true;
    bridge
      .getPoeOAuthStatus()
      .then((status) => {
        if (alive) setOauthStatus(status);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (autoSyncMinutes === 0 || (!tokenRef.current && !oauthRef.current.connected) || !tabsRef.current) return undefined;
    const handle = window.setInterval(() => {
      void syncNow(true);
    }, autoSyncMinutes * 60_000);
    return () => window.clearInterval(handle);
  }, [autoSyncMinutes, syncNow]);

  const connectPoe = useCallback(async () => {
    setConnectingPoe(true);
    setError(null);
    try {
      const connection = await bridge.connectPoeOAuth({});
      setOauthStatus({
        connected: true,
        scope: connection.scope || "",
        username: connection.username || "",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnectingPoe(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setToken("");
    setTabs(null);
    setSelectedIds(new Set());
    setResult(null);
    setError(null);
    setOauthStatus({ connected: false, scope: "" });
    if (isDesktop) {
      void bridge.disconnectPoeOAuth().catch(() => undefined);
    }
  }, []);

  const loggedIn = Boolean(token.trim()) || oauthStatus.connected;

  const toggleTab = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const delta = useMemo(() => {
    if (history.length < 2) return null;
    return snapshotDelta(history[history.length - 2], history[history.length - 1]);
  }, [history]);

  const previousTabChaos = useMemo(() => {
    if (history.length < 2) return new Map<string, number>();
    return new Map(history[history.length - 2].tabs.map((tab) => [tab.id, tab.chaos]));
  }, [history]);

  const families = useMemo(() => {
    if (!result) return [];
    return orderedFamilies(result.families);
  }, [result]);
  const maxFamilyChaos = useMemo(() => {
    const values = families.map((family) => (result?.families || {})[family]?.chaos || 0);
    return Math.max(0, ...values);
  }, [families, result]);

  return (
    <section className="stash-page">
      <div className="stash-header">
        <div>
          <p className="eyebrow">STASH WEALTH</p>
          <h1>Stash wealth</h1>
        </div>
        {isDesktop && (
          <div className="stash-header-side">
            <label className="value-display" title="Display unit">
              <Wallet size={14} />
              <span className="value-display-label">Unit</span>
              <select
                value={display}
                onChange={(event) => setDisplay(event.target.value as ValueDisplay)}
              >
                <option value="chaos">Chaos</option>
                <option value="divine">Divine</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {!isDesktop ? (
        <div className="stash-empty">
          <ShieldCheck size={28} />
          <h2>Desktop app required</h2>
          <p>Stash wealth tracking reads your GGG stash through the desktop app OAuth flow.</p>
        </div>
      ) : (
        <>
          <div className="stash-connect">
            {!loggedIn && (
              <div className="stash-connect-toolbar">
                <button
                  type="button"
                  className={clsx("stash-button", "stash-button--primary")}
                  disabled={connectingPoe || busy !== "idle"}
                  onClick={() => void connectPoe()}
                  title="Sign in with your pathofexile.com account"
                >
                  {connectingPoe ? (
                    <Loader2 className="is-spinning" size={15} />
                  ) : (
                    <Plug size={15} />
                  )}
                  {connectingPoe ? "Waiting for authorization…" : "Connect Path of Exile"}
                </button>
                <button
                  type="button"
                  className="stash-button"
                  onClick={() => setManualTokenMode((current) => !current)}
                  title="Paste an OAuth token instead of using the one-click connection"
                >
                  <KeyRound size={15} />
                  {manualTokenMode ? "Hide token field" : "Paste a token instead"}
                </button>
              </div>
            )}
            {!loggedIn ? (
              <div className="stash-connect-row">
                {manualTokenMode && (
                  <label className="stash-token-field">
                    <span>OAuth token (manual)</span>
                  <div className="stash-token-input">
                    <input
                      type={showToken ? "text" : "password"}
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="Paste your pathofexile.com OAuth token"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="stash-token-toggle"
                      onClick={() => setShowToken((current) => !current)}
                      title={showToken ? "Hide token" : "Show token"}
                    >
                      {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <small>
                    Tokens are never stored. Prefer the one-click connection — this field is a
                    manual fallback.
                  </small>
                  </label>
                )}
                <div className="stash-connect-controls">
                  <select
                    className="value-display-select"
                    value={realm}
                    onChange={(event) => {
                      setRealm(event.target.value as PoeStashRealm);
                      setTabs(null);
                      setResult(null);
                    }}
                    aria-label="Realm"
                  >
                    {REALMS.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                  <LeagueSelector leagues={leagues} value={leagueId} onChange={setLeagueId} />
                  <button
                    type="button"
                    className={clsx("stash-button", "stash-button--primary")}
                    disabled={
                      !leagueId || busy !== "idle" || (!token.trim() && !oauthStatus.connected)
                    }
                    onClick={() => void loadTabs()}
                  >
                    {busy === "listing" ? (
                      <Loader2 className="is-spinning" size={15} />
                    ) : (
                      <Layers size={15} />
                    )}
                    Load stash tabs
                  </button>
                </div>
              </div>
            ) : (
              <div className="stash-connect-row stash-connect-row--active">
                <span className="stash-connected-label">
                  <span className="pulse-dot" />
                  {oauthStatus.connected ? "Connected to Path of Exile" : "Connected"} · {leagueId}
                </span>
                <select
                  className="value-display-select"
                  value={realm}
                  onChange={(event) => {
                    setRealm(event.target.value as PoeStashRealm);
                    setTabs(null);
                    setResult(null);
                  }}
                  aria-label="Realm"
                >
                  {REALMS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <select
                  className="value-display-select"
                  value={autoSyncMinutes}
                  onChange={(event) =>
                    setAutoSyncMinutes(Number(event.target.value) as 0 | 15 | 30 | 60)
                  }
                  aria-label="Auto-sync interval"
                >
                  {AUTO_SYNC_OPTIONS.map((entry) => (
                    <option key={entry.minutes} value={entry.minutes}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={clsx("stash-button", "stash-button--primary")}
                  disabled={busy !== "idle"}
                  onClick={() => void syncNow(false)}
                  title="Sync stash tabs and re-value"
                >
                  {busy === "syncing" || busy === "pricing" ? (
                    <Loader2 className="is-spinning" size={15} />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  Sync &amp; value
                </button>
                <button type="button" className="stash-button" onClick={disconnect}>
                  <LogOut size={15} />
                  Disconnect
                </button>
                {lastSyncAt != null && (
                  <span className="stash-last-sync">Last sync {formatRelativeTime(lastSyncAt)}</span>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="stash-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {busy === "syncing" && (
            <div className="stash-progress">
              <div className="stash-progress-label">
                {progress
                  ? `Reading tabs… ${progress.index + 1}/${progress.total}`
                  : "Reading stash tabs…"}
              </div>
              <div className="stash-progress-track">
                <div
                  className="stash-progress-bar"
                  style={{
                    width: progress && progress.total > 0
                      ? `${((progress.index + 1) / progress.total) * 100}%`
                      : "12%",
                  }}
                />
              </div>
            </div>
          )}
          {busy === "pricing" && (
            <div className="stash-progress">
              <div className="stash-progress-label">
                Pricing items… {pricingDone}/{pricingTotal} poe.ninja feeds
              </div>
              <div className="stash-progress-track">
                <div
                  className="stash-progress-bar"
                  style={{
                    width: pricingTotal > 0 ? `${(pricingDone / pricingTotal) * 100}%` : "100%",
                  }}
                />
              </div>
            </div>
          )}

          {tabs && tabs.length > 0 && (
            <div className="stash-tabs-card">
              <div className="stash-tabs-head">
                <strong>
                  {tabs.length} treasured tab{tabs.length === 1 ? "" : "s"}
                </strong>
                <span className="stash-tabs-hint">
                  GGG OAuth exposes limited stash tabs only.
                </span>
                <button
                  type="button"
                  className="stash-link"
                  onClick={() => setSelectedIds(new Set(tabs.map((tab) => tab.id)))}
                >
                  Select all
                </button>
              </div>
              <div className="stash-tab-list">
                {tabs.slice(0, 40).map((tab) => (
                  <label key={tab.id} className="stash-tab-row">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(tab.id)}
                      onChange={() => toggleTab(tab.id)}
                    />
                    <span className="stash-tab-name">
                      {tab.path && tab.path.length > 0 && (
                        <span className="stash-tab-path">{tab.path.join(" › ")} › </span>
                      )}
                      {tab.name}
                    </span>
                    <span className="stash-tab-type">{tab.type}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="stash-dashboard">
              <div className="stash-cards">
                <div className="stash-card">
                  <span className="stash-card-label">Net worth</span>
                  <Money
                    chaos={roundedChaos(result.chaos)}
                    divine={result.divine}
                    display={display}
                    className="stash-card-value"
                  />
                  <span className="stash-card-sub">
                    {result.pricedItemCount} priced / {result.unpricedItemCount} unpriced items
                  </span>
                </div>
                <div className="stash-card">
                  <span className="stash-card-label">Since last snapshot</span>
                  {delta ? (
                    <>
                      <Money
                        chaos={roundedChaos(delta.chaos)}
                        divine={delta.divine}
                        display={display}
                        className={clsx("stash-card-value", delta.chaos >= 0 ? "is-up" : "is-down")}
                      />
                      {delta.chaosPerHour != null && (
                        <span
                          className={clsx(
                            "stash-card-sub",
                            delta.chaosPerHour >= 0 ? "is-up" : "is-down",
                          )}
                        >
                          {delta.chaosPerHour >= 0 ? "+" : ""}
                          {formatPrice(delta.chaosPerHour)} c/h
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="stash-card-sub">Sync twice to see a rate</span>
                  )}
                </div>
                <div className="stash-card">
                  <span className="stash-card-label">Tabs</span>
                  <strong className="stash-card-value">{result.tabs.length}</strong>
                  <span className="stash-card-sub">
                    {result.itemCount} items · {result.overviewCount} price feeds
                    {result.pricesStale && " · stale"}
                  </span>
                </div>
              </div>

              {history.length >= 2 && <HistoryChart snapshots={history} display={display} />}

              {families.length > 0 && (
                <div className="stash-family-card">
                  <h3>Wealth by family</h3>
                  <div className="stash-family-list">
                    {families.map((family) => {
                      const value = (result.families || {})[family];
                      const chaos = value?.chaos || 0;
                      return (
                        <div key={family} className="stash-family-row">
                          <span className="stash-family-name">
                            {STASH_FAMILY_LABELS[family]}
                            <small>{value?.count || 0} units</small>
                          </span>
                          <div className="stash-family-bar-track">
                            <div
                              className="stash-family-bar"
                              style={{ width: `${maxFamilyChaos > 0 ? (chaos / maxFamilyChaos) * 100 : 0}%` }}
                            />
                          </div>
                          <Money chaos={roundedChaos(chaos)} divine={value?.divine || 0} display={display} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="stash-table-card">
                <h3>Tabs</h3>
                <table className="stash-table">
                  <thead>
                    <tr>
                      <th>Tab</th>
                      <th>Items</th>
                      <th className="is-numeric">Value</th>
                      <th className="is-numeric">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.tabs
                      .slice()
                      .sort((a, b) => b.chaos - a.chaos)
                      .map((tab) => (
                        <TabRow key={tab.id} tab={tab} display={display} previous={previousTabChaos.get(tab.id)} />
                      ))}
                  </tbody>
                </table>
              </div>

              {result.topItems.length > 0 && (
                <div className="stash-table-card">
                  <h3>Most valuable items</h3>
                  <table className="stash-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Family</th>
                        <th className="is-numeric">Qty</th>
                        <th className="is-numeric">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.topItems.slice(0, 12).map((top, index) => (
                        <tr key={`${top.name}:${index}`}>
                          <td className="stash-item-name">{top.name}</td>
                          <td className="stash-item-family">{STASH_FAMILY_LABELS[top.family]}</td>
                          <td className="is-numeric">{top.quantity}</td>
                          <td className="is-numeric">
                            <Money chaos={roundedChaos(top.chaos)} divine={top.divine} display={display} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!result && busy === "idle" && tabs && (
            <div className="stash-empty">
              <TrendingUp size={28} />
              <h2>Ready to value your stash</h2>
              <p>Click “Sync &amp; value” to read tabs, price items and record a snapshot.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TabRow({
  tab,
  display,
  previous,
}: {
  tab: StashTabValuation;
  display: ValueDisplay;
  previous: number | undefined;
}) {
  const difference = previous == null ? null : tab.chaos - previous;
  return (
    <tr>
      <td className="stash-item-name">
        {tab.path && tab.path.length > 0 && (
          <span className="stash-tab-path">{tab.path.join(" › ")} › </span>
        )}
        {tab.name}
      </td>
      <td className="is-numeric">{tab.itemCount}</td>
      <td className="is-numeric">
        <Money chaos={roundedChaos(tab.chaos)} divine={tab.divine} display={display} />
      </td>
      <td className={clsx("is-numeric", difference != null && difference >= 0 ? "is-up" : "is-down")}>
        {difference == null ? "—" : difference >= 0 ? "+" : ""}{formatPrice(difference ?? 0)}
      </td>
    </tr>
  );
}

function HistoryChart({ snapshots, display }: { snapshots: StashSnapshot[]; display: ValueDisplay }) {
  const visible = snapshots.slice(-60);
  const values = visible.map((snapshot) =>
    display === "divine" ? snapshot.divine : snapshot.chaos,
  );
  const width = 640;
  const height = 140;
  const maximum = Math.max(...values);
  const minimum = Math.min(...values);
  const span = maximum - minimum || 1;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - minimum) / span) * (height - 16) - 8;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1];
  const first = values[0];
  const rising = last >= first;
  return (
    <div className="stash-chart-card">
      <div className="stash-chart-head">
        <h3>Wealth history</h3>
        <span className={clsx("stash-chart-trend", rising ? "is-up" : "is-down")}>
          {rising ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {formatPrice(Math.abs(last - first))} {display === "divine" ? "div" : "c"}
        </span>
      </div>
      <svg
        className="stash-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Stash net worth over time"
      >
        <defs>
          <linearGradient id="stash-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill="url(#stash-chart-fill)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--teal)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {visible.map((snapshot, index) => {
          if (index === values.length - 1) {
            const [x, y] = points.split(" ")[index].split(",").map(Number);
            return <circle key={snapshot.createdAt} cx={x} cy={y} r="3.5" fill="var(--teal)" />;
          }
          return null;
        })}
      </svg>
    </div>
  );
}

async function buildIndex(
  categoryList: string[],
  league: string,
  onProgress: (done: number) => void,
) {
  const overviews: StashPricingOverview[] = [];
  let done = 0;
  const worker = async (categoryId: string) => {
    const category = categoryById[categoryId];
    if (!category) {
      onProgress(++done);
      return;
    }
    const source = defaultSource(category);
    const envelope = await bridge.getOverview({
      league,
      type: category.apiType,
      source,
    });
    const rows = normalizeOverview(envelope.data, source, category).rows;
    overviews.push({ categoryId, rows, fetchedAt: envelope.fetchedAt, stale: envelope.stale });
    onProgress(++done);
  };
  const queue = [...categoryList];
  const workers: Promise<void>[] = [];
  for (let index = 0; index < Math.min(3, queue.length); index += 1) {
    workers.push((async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await worker(next);
      }
    })());
  }
  await Promise.all(workers);
  return buildStashPriceIndex(overviews);
}