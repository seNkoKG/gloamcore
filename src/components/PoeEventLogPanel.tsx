import clsx from "clsx";
import { EyeOff, FileClock, FolderOpen, Pause, Play, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bridge } from "../lib/bridge";
import type { PoeEventLogCategory, PoeEventLogState } from "../types";
import "../poe-event-log.css";

const FILTER_KEY = "gloamcore:poe-event-log:filters:v1";
const CATEGORIES: Array<{ id: PoeEventLogCategory; label: string }> = [
  { id: "zone", label: "Zones" }, { id: "level", label: "Levels" }, { id: "death", label: "Deaths" },
  { id: "status", label: "Status" }, { id: "whisper", label: "Whispers" }, { id: "trade", label: "Trade" },
  { id: "party", label: "Party" }, { id: "items", label: "Items" }, { id: "chat", label: "Public chat" }, { id: "other", label: "Other" },
];
const DEFAULT_FILTERS: Record<PoeEventLogCategory, boolean> = {
  zone: true, level: true, death: true, status: true, whisper: true,
  trade: true, party: true, items: true, chat: false, other: false,
};

function readFilters() {
  try {
    const value = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
    return value && typeof value === "object" ? { ...DEFAULT_FILTERS, ...value } : DEFAULT_FILTERS;
  } catch { return DEFAULT_FILTERS; }
}

export function PoeEventLogPanel() {
  const [state, setState] = useState<PoeEventLogState | null>(null);
  const [filters, setFilters] = useState(readFilters);
  const [mode, setMode] = useState<"events" | "raw">("events");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = bridge.onPoeEventLog((value) => active && setState(value));
    bridge.startPoeEventLog().then((value) => active && setState(value)).catch((error) => active && setState({
      settings: { version: 1, logPath: "" }, status: "error", error: error instanceof Error ? error.message : String(error), events: [],
    }));
    return () => { active = false; unsubscribe(); void bridge.stopPoeEventLog(); };
  }, []);

  const changeFilter = (category: PoeEventLogCategory) => {
    const next = { ...filters, [category]: !filters[category] };
    setFilters(next);
    localStorage.setItem(FILTER_KEY, JSON.stringify(next));
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...(state?.events || [])].reverse().filter((event) => {
      if (mode === "events" && !filters[event.category]) return false;
      return !needle || event.title.toLocaleLowerCase().includes(needle) || event.message.toLocaleLowerCase().includes(needle);
    });
  }, [filters, mode, query, state?.events]);

  const selectPath = async () => {
    setBusy(true);
    try { const value = await bridge.selectPoeEventLogPath(); if (value) setState(value); }
    finally { setBusy(false); }
  };

  const toggleWatching = async () => {
    setBusy(true);
    try { setState(state?.status === "watching" ? await bridge.stopPoeEventLog() : await bridge.startPoeEventLog()); }
    finally { setBusy(false); }
  };

  if (!state) return <div className="event-log-loading"><FileClock size={18}/> Opening Client.txt safely…</div>;

  return <div className="event-log-workbench">
    <header className="event-log-header"><div><FileClock size={19}/><span><h2>PoE Event Log</h2><p>Live, filterable PoE 1 events from Client.txt. Read-only and in memory.</p></span></div><span className={clsx("event-log-status", `is-${state.status}`)}><i/>{state.status}</span></header>
    <div className="event-log-controls">
      <div className="event-log-modes"><button type="button" className={mode === "events" ? "is-active" : ""} onClick={() => setMode("events")}>Events</button><button type="button" className={mode === "raw" ? "is-active" : ""} onClick={() => setMode("raw")}>Raw feed</button></div>
      <label className="event-log-search"><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter messages…"/></label>
      <button type="button" disabled={busy} onClick={toggleWatching}>{state.status === "watching" ? <Pause size={13}/> : <Play size={13}/>} {state.status === "watching" ? "Pause" : "Watch"}</button>
      <button type="button" disabled={busy} onClick={selectPath}><FolderOpen size={13}/> Client.txt</button>
      <button type="button" onClick={() => void bridge.clearPoeEventLog().then(setState)}><Trash2 size={13}/> Clear</button>
    </div>
    <div className="event-log-path"><span>{state.settings.logPath || "No Client.txt selected"}</span><em>{state.events.length}/500 in memory</em></div>
    {state.error && <p className="event-log-error" role="alert">{state.error}</p>}
    <div className="event-log-layout">
      <aside className="event-log-filters"><header>Event filters</header>{CATEGORIES.map((category) => <label key={category.id} className={filters[category.id] ? "is-active" : ""}><input type="checkbox" checked={filters[category.id]} onChange={() => changeFilter(category.id)}/><span>{category.label}</span><em>{state.events.filter((event) => event.category === category.id).length}</em></label>)}<section><EyeOff size={14}/><p>Public chat and unclassified lines start hidden. Raw feed shows every timestamped line currently held.</p></section></aside>
      <section className="event-log-feed" role="log" aria-label="Path of Exile events" aria-live="polite">{!visible.length ? <div className="event-log-empty">No events match the current view.</div> : visible.map((event) => <article key={event.id} className={`is-${event.category}`}><time>{event.time}</time><i/><span><header><strong>{event.title}</strong><em>{event.category}</em></header><p>{event.message}</p></span></article>)}</section>
    </div>
    <footer className="event-log-privacy"><ShieldCheck size={13}/><span>Privacy: events are never uploaded or saved. Only the selected log path and filter switches persist. Clearing or closing this view drops the in-memory feed.</span></footer>
  </div>;
}
