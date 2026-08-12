import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  checkForGameDataUpdate,
  loadGameData,
  rollbackGameData,
  type GameDataStatus,
  type NavigatorDataPack,
  type NavigatorRouteStep,
} from "../lib/game-data";
import {
  ACTIVE_PLANNER_WORKSPACE_KEY,
  parseActivePlannerWorkspace,
} from "../lib/planner/planner-workspace";
import "./CommandCenterPanel.css";

const AtlasCommandCenter = lazy(() => import("./AtlasCommandCenter").then((module) => ({
  default: module.AtlasCommandCenter,
})));

type BanditChoice = "kill" | "alira" | "kraityn" | "oak";
type CommandTab = "route" | "gems" | "atlas" | "data";

const NAVIGATOR_STATE_KEY = "gloamcore:league-navigator:v1";
const UPDATE_CHECK_KEY = "gloamcore:game-data-last-check:v1";
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1_000;

interface NavigatorState {
  version: 1;
  gameVersion: string;
  characterClass: string;
  bandit: BanditChoice;
  library: boolean;
  act: number;
  completed: string[];
}

const banditLabels: Record<BanditChoice, { title: string; detail: string }> = {
  kill: { title: "Kill all", detail: "Route through Eramir's outcome" },
  alira: { title: "Help Alira", detail: "Use the Alira route branch" },
  kraityn: { title: "Help Kraityn", detail: "Use the Kraityn route branch" },
  oak: { title: "Help Oak", detail: "Use the Oak route branch" },
};

function defaultNavigatorState(gameVersion: string, navigator: NavigatorDataPack): NavigatorState {
  return {
    version: 1,
    gameVersion,
    characterClass: navigator.classes[0] || "Scion",
    bandit: "kill",
    library: false,
    act: 1,
    completed: [],
  };
}

function loadNavigatorState(gameVersion: string, navigator: NavigatorDataPack): NavigatorState {
  const fallback = defaultNavigatorState(gameVersion, navigator);
  try {
    const value = JSON.parse(localStorage.getItem(NAVIGATOR_STATE_KEY) || "null") as Partial<NavigatorState> | null;
    if (!value || value.version !== 1) return fallback;
    const stepIds = new Set(navigator.acts.flatMap((act) => act.steps.map((step) => step.id)));
    const bandit = ["kill", "alira", "kraityn", "oak"].includes(String(value.bandit))
      ? value.bandit as BanditChoice
      : fallback.bandit;
    return {
      version: 1,
      gameVersion,
      characterClass: navigator.classes.includes(String(value.characterClass)) ? String(value.characterClass) : fallback.characterClass,
      bandit,
      library: Boolean(value.library),
      act: Number.isSafeInteger(value.act) && Number(value.act) >= 1 && Number(value.act) <= 10 ? Number(value.act) : 1,
      completed: Array.isArray(value.completed)
        ? [...new Set(value.completed.filter((id): id is string => typeof id === "string" && stepIds.has(id)))].slice(0, 1_000)
        : [],
    };
  } catch {
    return fallback;
  }
}

function conditionMatches(condition: string, bandit: BanditChoice, library: boolean) {
  if (condition === "LIBRARY") return library;
  if (condition === "BANDIT_KILL") return bandit === "kill";
  if (condition === "!BANDIT_KILL") return bandit !== "kill";
  if (condition === "BANDIT_ALIRA") return bandit === "alira";
  if (condition === "BANDIT_KRAITYN") return bandit === "kraityn";
  if (condition === "BANDIT_OAK") return bandit === "oak";
  return false;
}

export function routeStepIsVisible(step: NavigatorRouteStep, bandit: BanditChoice, library: boolean) {
  return step.conditions.every((condition) => conditionMatches(condition, bandit, library));
}

function activePlannerGemNames() {
  try {
    const raw = localStorage.getItem(ACTIVE_PLANNER_WORKSPACE_KEY);
    if (!raw) return [];
    const workspace = parseActivePlannerWorkspace(raw);
    return [...new Set((workspace.snapshot.build?.skillGroups || [])
      .filter((group) => group.enabled)
      .flatMap((group) => group.gems.filter((gem) => gem.enabled).map((gem) => gem.name))
      .filter(Boolean))].sort();
  } catch {
    return [];
  }
}

function shortRevision(value: string) {
  return value.slice(0, 12);
}

export function CommandCenterPanel() {
  const [data, setData] = useState<GameDataStatus | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [message, setMessage] = useState("Loading validated PoE data…");
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<CommandTab>("route");
  const [navigatorState, setNavigatorState] = useState<NavigatorState | null>(null);
  const [gemQuery, setGemQuery] = useState("");
  const [buildOnly, setBuildOnly] = useState(false);
  const plannerGems = useMemo(activePlannerGemNames, []);

  useEffect(() => {
    let cancelled = false;
    void loadGameData().then(async (loaded) => {
      if (cancelled) return;
      setData(loaded);
      setNavigatorState(loadNavigatorState(loaded.bundle.manifest.gameVersion, loaded.bundle.navigator));
      setMessage(loaded.recoveredFromPrevious
        ? "Recovered the previous validated data pack after rejecting an invalid active cache."
        : `Validated PoE ${loaded.bundle.manifest.gameVersion} data is active.`);
      const lastCheck = Number(localStorage.getItem(UPDATE_CHECK_KEY) || 0);
      if (Date.now() - lastCheck < UPDATE_INTERVAL_MS) return;
      setChecking(true);
      try {
        const result = await checkForGameDataUpdate();
        if (cancelled) return;
        localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now()));
        setData(result.data);
        setNavigatorState((current) => current
          ? loadNavigatorState(result.data.bundle.manifest.gameVersion, result.data.bundle.navigator)
          : loadNavigatorState(result.data.bundle.manifest.gameVersion, result.data.bundle.navigator));
        setMessage(result.status === "updated"
          ? `Activated validated PoE ${result.data.bundle.manifest.gameVersion} data.`
          : "The validated game-data pack is current.");
      } catch (error) {
        if (!cancelled) setMessage(`Automatic data check could not complete; the validated local pack remains active. ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }).catch((error) => {
      if (!cancelled) {
        setLoadingError(error instanceof Error ? error.message : String(error));
        setMessage("");
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!navigatorState) return;
    localStorage.setItem(NAVIGATOR_STATE_KEY, JSON.stringify(navigatorState));
  }, [navigatorState]);

  const visibleSteps = useMemo(() => {
    if (!data || !navigatorState) return [];
    return data.bundle.navigator.acts.find((entry) => entry.act === navigatorState.act)?.steps
      .filter((step) => routeStepIsVisible(step, navigatorState.bandit, navigatorState.library)) || [];
  }, [data, navigatorState]);
  const completed = useMemo(() => new Set(navigatorState?.completed || []), [navigatorState?.completed]);
  const gemResults = useMemo(() => {
    if (!data || !navigatorState) return [];
    const query = gemQuery.trim().toLocaleLowerCase();
    const buildNames = new Set(plannerGems.map((name) => name.toLocaleLowerCase()));
    return data.bundle.navigator.gems.filter((gem) => {
      if (buildOnly && !buildNames.has(gem.name.toLocaleLowerCase())) return false;
      if (query && !`${gem.name} ${gem.attribute}`.toLocaleLowerCase().includes(query)) return false;
      return true;
    }).sort((left, right) => left.requiredLevel - right.requiredLevel || left.name.localeCompare(right.name)).slice(0, 80);
  }, [buildOnly, data, gemQuery, navigatorState, plannerGems]);

  const updateState = (patch: Partial<NavigatorState>) => {
    setNavigatorState((current) => current ? { ...current, ...patch } : current);
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const result = await checkForGameDataUpdate();
      localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now()));
      setData(result.data);
      setNavigatorState(loadNavigatorState(result.data.bundle.manifest.gameVersion, result.data.bundle.navigator));
      setMessage(result.status === "updated"
        ? `Activated validated PoE ${result.data.bundle.manifest.gameVersion} data. Route progress was migrated by stable step ID.`
        : "The validated game-data pack is current.");
    } catch (error) {
      setMessage(`Update rejected; the current validated pack was not changed. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setChecking(false);
    }
  };

  if (loadingError) {
    return <section className="command-center command-center--error"><h1>League Command Center unavailable</h1><p>{loadingError}</p></section>;
  }
  if (!data || !navigatorState) {
    return <section className="command-center command-center--loading"><div className="command-loader" /><p>{message}</p></section>;
  }

  const navigator = data.bundle.navigator;
  return (
    <section className="command-center">
      <header className="command-hero">
        <img src={navigator.art.questIcon.url} alt="Path of Exile quest icon" />
        <div>
          <small>PATH OF EXILE 1 · {data.bundle.manifest.gameVersion}</small>
          <h1>League Command Center</h1>
          <p>Exact campaign guidance and an official-data Atlas planner behind one patch-safe integrity boundary.</p>
        </div>
        <span className="command-data-badge">{data.bundle.origin.toUpperCase()} · VERIFIED</span>
      </header>

      <nav className="command-tabs" aria-label="League command tools">
        <button type="button" className={tab === "route" ? "is-active" : undefined} onClick={() => setTab("route")}>Campaign route</button>
        <button type="button" className={tab === "gems" ? "is-active" : undefined} onClick={() => setTab("gems")}>Gem acquisition</button>
        <button type="button" className={tab === "atlas" ? "is-active" : undefined} onClick={() => setTab("atlas")}>Atlas planner</button>
        <button type="button" className={tab === "data" ? "is-active" : undefined} onClick={() => setTab("data")}>Data health</button>
      </nav>

      {tab === "route" && (
        <div className="command-workspace">
          <aside className="command-route-settings">
            <label>
              <span>Character class</span>
              <select value={navigatorState.characterClass} onChange={(event) => updateState({ characterClass: event.target.value })}>
                {navigator.classes.map((entry) => <option key={entry}>{entry}</option>)}
              </select>
            </label>
            <fieldset>
              <legend>Bandit outcome</legend>
              <div className="bandit-grid">
                {(Object.keys(banditLabels) as BanditChoice[]).map((choice) => (
                  <button key={choice} type="button" className={navigatorState.bandit === choice ? "is-active" : undefined} onClick={() => updateState({ bandit: choice })}>
                    <img src={navigator.art.bandits[choice].url} alt={navigator.art.bandits[choice].name} />
                    <span><strong>{banditLabels[choice].title}</strong><small>{banditLabels[choice].detail}</small></span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="command-toggle">
              <input type="checkbox" checked={navigatorState.library} onChange={(event) => updateState({ library: event.target.checked })} />
              <span><strong>Library detour</strong><small>Include the optional Act 3 library branch</small></span>
            </label>
          </aside>

          <article className="command-route">
            <div className="act-selector" aria-label="Campaign act">
              {navigator.acts.map((entry) => (
                <button key={entry.act} type="button" className={navigatorState.act === entry.act ? "is-active" : undefined} onClick={() => updateState({ act: entry.act })}>{entry.act}</button>
              ))}
            </div>
            <div className="route-heading">
              <div><small>CAMPAIGN</small><h2>Act {navigatorState.act}</h2></div>
              <span>{visibleSteps.filter((step) => completed.has(step.id)).length} / {visibleSteps.length} complete</span>
            </div>
            <ol className="route-steps">
              {visibleSteps.map((step) => (
                <li key={step.id} className={completed.has(step.id) ? "is-complete" : undefined}>
                  <label>
                    <input type="checkbox" checked={completed.has(step.id)} onChange={() => {
                      const next = new Set(completed);
                      if (next.has(step.id)) next.delete(step.id); else next.add(step.id);
                      updateState({ completed: [...next].slice(0, 1_000) });
                    }} />
                    <span className={`route-kind route-kind--${step.kind}`}>{step.kind}</span>
                    <strong>{step.label}</strong>
                  </label>
                </li>
              ))}
            </ol>
          </article>
        </div>
      )}

      {tab === "gems" && (
        <div className="gem-workspace">
          <div className="gem-toolbar">
            <label><span>Find a gem</span><input value={gemQuery} onChange={(event) => setGemQuery(event.target.value)} placeholder="Search active or support gems" /></label>
            <label><span>Character class</span><select value={navigatorState.characterClass} onChange={(event) => updateState({ characterClass: event.target.value })}>{navigator.classes.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
            <label className="command-toggle">
              <input type="checkbox" checked={buildOnly} disabled={!plannerGems.length} onChange={(event) => setBuildOnly(event.target.checked)} />
              <span><strong>Active Build Lab gems</strong><small>{plannerGems.length ? `${plannerGems.length} enabled gems detected` : "No active imported build detected"}</small></span>
            </label>
          </div>
          <div className="gem-results">
            {gemResults.map((gem) => {
              const sources = gem.acquisitions.filter((entry) => !entry.classes.length || entry.classes.includes(navigatorState.characterClass));
              return (
                <article key={gem.id}>
                  <header><div><small>{gem.support ? "SUPPORT" : "ACTIVE"} · LEVEL {gem.requiredLevel}</small><h3>{gem.name}</h3></div><span>{gem.attribute || "Any attribute"}</span></header>
                  {sources.length ? <ul>{sources.map((source, index) => (
                    <li key={`${source.kind}-${source.questId}-${source.offerId}-${index}`}><strong>{source.kind === "quest" ? "Quest reward" : "Vendor"}</strong><span>Act {source.act} · {source.quest}{source.npc ? ` · ${source.npc}` : ""}</span></li>
                  ))}</ul> : <p>No quest or vendor acquisition is listed for {navigatorState.characterClass} in this source pack.</p>}
                </article>
              );
            })}
          </div>
        </div>
      )}

      {tab === "atlas" && (
        <Suspense fallback={<div className="command-atlas-loading"><div className="command-loader" /><p>Preparing the official Atlas tree…</p></div>}>
          <AtlasCommandCenter atlas={data.bundle.atlas} />
        </Suspense>
      )}

      {tab === "data" && (
        <div className="data-health">
          <section><small>ACTIVE GAME VERSION</small><strong>{data.bundle.manifest.gameVersion}</strong><span>{data.bundle.origin === "remote" ? "Validated remote update" : "Bundled release fallback"}</span></section>
          <section><small>ATLAS SOURCE</small><strong>{shortRevision(data.bundle.atlas.source.revision)}</strong><span>Grinding Gear Games export</span></section>
          <section><small>NAVIGATOR SOURCE</small><strong>{shortRevision(navigator.source.revision)}</strong><span>Exile Leveling · MIT</span></section>
          <section><small>PACK INTEGRITY</small><strong>SHA-256</strong><span>Both packs verified before activation</span></section>
          <div className="data-health-message"><p>{message}</p><span>Automatic checks run at most once every six hours while this workspace is opened. Failed or partial updates never replace the active pack.</span></div>
          <div className="data-health-actions">
            <button type="button" disabled={checking} onClick={() => void checkNow()}>{checking ? "Checking…" : "Check for league data"}</button>
            <button type="button" disabled={checking || data.bundle.origin !== "remote"} onClick={() => void rollbackGameData().then((rolledBack) => {
              setData(rolledBack);
              setNavigatorState(loadNavigatorState(rolledBack.bundle.manifest.gameVersion, rolledBack.bundle.navigator));
              setMessage(`Rolled back to validated PoE ${rolledBack.bundle.manifest.gameVersion} data.`);
            }).catch((error) => setMessage(error instanceof Error ? error.message : String(error)))}>Roll back data pack</button>
          </div>
          <footer>Game logic is not inferred. Atlas data comes from GGG’s official export; campaign and gem sources come from the pinned Exile Leveling data set. PoE artwork remains property of Grinding Gear Games.</footer>
        </div>
      )}
    </section>
  );
}
