import clsx from "clsx";
import {
  Clock3,
  Download,
  FolderOpen,
  MapPinned,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { categories, defaultSource } from "../config/categories";
import { bridge } from "../lib/bridge";
import { normalizeOverview } from "../lib/economy";
import { loadGameData } from "../lib/game-data";
import type { MappingJournalSession, MappingJournalState } from "../types";
import "../mapping-journal.css";

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function formatLocal(timestamp: number | null) {
  if (timestamp == null) return "Not observed";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(timestamp);
}

function mapKey(value: string) {
  return value.toLocaleLowerCase().replace(/\s+map$/, "").replace(/[^a-z0-9]+/g, "");
}

function sessionDuration(session: MappingJournalSession, state: MappingJournalState, now: number) {
  if (state.activeSessionId !== session.id || state.activeSince == null) return session.activeMilliseconds;
  return session.activeMilliseconds + Math.max(0, now - state.activeSince);
}

interface AtlasMapSprite {
  filename: string;
  width: number;
  height: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function PoeMapArt({ icon, sprite, className = "" }: { icon?: string; sprite: AtlasMapSprite | null; className?: string }) {
  if (icon) return <img className={className} src={icon} alt="" />;
  if (sprite) return <span className={clsx("mapping-journal-atlas-art", className)}><span style={{
    width: sprite.w,
    height: sprite.h,
    backgroundImage: `url("${sprite.filename}")`,
    backgroundPosition: `-${sprite.x}px -${sprite.y}px`,
    backgroundSize: `${sprite.width}px ${sprite.height}px`,
  }} /></span>;
  return <span className={clsx("mapping-journal-map-fallback", className)}><MapPinned size={18}/></span>;
}

export function MappingJournalPanel({ league }: { league: string }) {
  const [state, setState] = useState<MappingJournalState | null>(null);
  const [character, setCharacter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [mapArt, setMapArt] = useState<Record<string, string>>({});
  const [atlasMapSprite, setAtlasMapSprite] = useState<AtlasMapSprite | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = bridge.onMappingJournal((value) => {
      if (!active) return;
      setState(value);
      setCharacter((current) => current || value.settings.activeCharacter);
    });
    bridge.getMappingJournal().then((value) => {
      if (!active) return;
      setState(value);
      setCharacter(value.settings.activeCharacter);
    }).catch((error) => active && setMessage(error instanceof Error ? error.message : String(error)));
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!state?.activeSessionId) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state?.activeSessionId]);

  useEffect(() => {
    let active = true;
    const category = categories.find((entry) => entry.id === "maps");
    if (!category || !league) return undefined;
    const source = defaultSource(category);
    bridge.getOverview({ league, type: category.apiType, source }).then((envelope) => {
      if (!active) return;
      const rows = normalizeOverview(envelope.data, source, category).rows;
      const artwork: Record<string, string> = {};
      for (const row of rows) {
        if (!row.icon) continue;
        for (const label of [row.name, row.baseType || "", row.itemType || ""]) {
          const key = mapKey(label);
          if (key && !artwork[key]) artwork[key] = row.icon;
        }
      }
      setMapArt(artwork);
    }).catch(() => {
      // The journal remains fully usable without network artwork.
    });
    return () => { active = false; };
  }, [league]);

  useEffect(() => {
    let active = true;
    loadGameData().then(({ bundle }) => {
      if (!active) return;
      const sheet = bundle.atlas.sprites.normalActive;
      const coordinates = sheet.coords["Art/2DArt/SkillIcons/passives/AtlasTrees/Mapnode.png"];
      if (coordinates) setAtlasMapSprite({
        filename: sheet.filename,
        width: sheet.width,
        height: sheet.height,
        ...coordinates,
      });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!state?.sessions.length || selectedId) return;
    const latest = state.sessions.at(-1);
    if (!latest) return;
    setSelectedId(latest.id);
    setNotes(latest.notes);
    setTags(latest.tags.join(", "));
  }, [selectedId, state?.sessions]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...(state?.sessions || [])].reverse().filter((session) => !needle || [
      session.areaName, session.areaId, session.notes, ...session.tags,
    ].some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [query, state?.sessions]);
  const selected = state?.sessions.find((session) => session.id === selectedId) || null;
  const sessionArt = (session: MappingJournalSession | null) => {
    if (!session) return "";
    // A wrong map icon is worse than the current official Atlas map sprite.
    return mapArt[mapKey(session.areaName)] || "";
  };
  const observed = (state?.sessions || []).reduce((sum, session) => sum + sessionDuration(session, state!, now), 0);
  const deaths = (state?.sessions || []).reduce((sum, session) => sum + session.deaths, 0);

  const chooseSession = (session: MappingJournalSession) => {
    setSelectedId(session.id);
    setNotes(session.notes);
    setTags(session.tags.join(", "));
    setMessage("");
  };

  const saveSettings = async (enabled: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const value = await bridge.updateMappingJournalSettings({ enabled, activeCharacter: character });
      setState(value);
      setCharacter(value.settings.activeCharacter);
      setMessage(enabled
        ? value.settings.activeCharacter
          ? `Watching map sessions; deaths count only exact “${value.settings.activeCharacter}” system lines.`
          : "Watching map sessions. Set the exact active character name to enable death counting."
        : "Mapping Journal paused. Existing sessions remain local.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseLog = async () => {
    setBusy(true);
    setMessage("");
    try {
      const value = await bridge.selectPoeEventLogPath();
      if (value) setState(await bridge.getMappingJournal());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveSession = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const value = await bridge.updateMappingJournalSession({
        id: selected.id,
        notes,
        tags: tags.split(","),
      });
      setState(value);
      const saved = value.sessions.find((session) => session.id === selected.id);
      if (saved) {
        setNotes(saved.notes);
        setTags(saved.tags.join(", "));
      }
      setMessage("Local notes and tags saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    if (!selected || !window.confirm(`Remove the ${selected.areaName} session from this local journal?`)) return;
    setBusy(true);
    try {
      const value = await bridge.removeMappingJournalSession(selected.id);
      setState(value);
      const next = value.sessions.at(-1) || null;
      setSelectedId(next?.id || "");
      setNotes(next?.notes || "");
      setTags(next?.tags.join(", ") || "");
      setMessage("Session removed from the local journal.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!state?.sessions.length || !window.confirm(`Permanently remove all ${state.sessions.length} local Mapping Journal sessions?`)) return;
    setBusy(true);
    try {
      setState(await bridge.clearMappingJournal());
      setSelectedId(""); setNotes(""); setTags("");
      setMessage("All local Mapping Journal sessions removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const result = await bridge.exportMappingJournalCsv();
      if (result) setMessage(`Exported ${result.rows} sessions to ${result.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <div className="mapping-journal-loading"><MapPinned size={22}/> Opening the local Mapping Journal…</div>;
  const active = state.sessions.find((session) => session.id === state.activeSessionId) || null;
  const headerArt = sessionArt(active);

  return <div className="mapping-journal">
    <header className="mapping-journal-header">
      <div className="mapping-journal-title-art">
        <PoeMapArt icon={headerArt} sprite={atlasMapSprite} />
        <div><span>LOCAL POE 1 ACTIVITY</span><h2>Mapping Journal</h2><p>Verified map entries, observed in-area time, exact-character deaths, and your notes.</p></div>
      </div>
      <div className={clsx("mapping-journal-live", state.settings.enabled && state.log.status === "watching" && "is-live")}><i/>{state.settings.enabled ? state.log.status : "paused"}</div>
    </header>

    <section className="mapping-journal-setup">
      <label><UserRoundCheck size={14}/><span>Active character <small>Exact, case-sensitive death match</small></span><input value={character} maxLength={64} onChange={(event) => setCharacter(event.target.value)} placeholder="Character name" /></label>
      <button type="button" disabled={busy} onClick={() => void saveSettings(state.settings.enabled)}><ShieldCheck size={14}/> Save identity</button>
      <button type="button" disabled={busy} onClick={() => void saveSettings(!state.settings.enabled)} className={state.settings.enabled ? "is-stop" : "is-primary"}>{state.settings.enabled ? "Pause journal" : "Enable journal"}</button>
      <button type="button" disabled={busy} onClick={() => void chooseLog()}><FolderOpen size={14}/> Client.txt</button>
      <p title={state.log.path}>{state.log.path || "No PoE 1 Client.txt selected"}</p>
    </section>

    {(message || state.storageError || state.log.error) && <div className="mapping-journal-message" role="status">{message || state.storageError || state.log.error}</div>}

    <section className="mapping-journal-summary">
      <article><strong>{state.sessions.length.toLocaleString()}</strong><span>Map instances</span></article>
      <article><strong>{formatDuration(observed)}</strong><span>Observed in-area</span></article>
      <article><strong>{deaths.toLocaleString()}</strong><span>Exact-character deaths</span></article>
      <article><strong>{active?.areaName || "None"}</strong><span>Active map instance</span></article>
    </section>

    <div className="mapping-journal-toolbar">
      <label><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search maps, tags, notes…" /></label>
      <span>{visible.length} shown</span>
      <button type="button" disabled={busy || !state.sessions.length} onClick={() => void exportCsv()}><Download size={13}/> Export CSV</button>
      <button type="button" disabled={busy || !state.sessions.length} onClick={() => void clearAll()}><Trash2 size={13}/> Clear all</button>
    </div>

    <div className="mapping-journal-layout">
      <section className="mapping-journal-list" aria-label="Map sessions">
        {!visible.length ? <div className="mapping-journal-empty"><MapPinned size={28}/><strong>No verified map sessions yet</strong><p>Enable the journal and enter a PoE 1 area whose internal ID starts with <code>MapWorlds</code>. Existing log history is deduplicated.</p></div> : visible.map((session) => {
          const icon = sessionArt(session);
          const isActive = state.activeSessionId === session.id;
          return <button type="button" key={session.id} className={clsx(selectedId === session.id && "is-selected", isActive && "is-active")} onClick={() => chooseSession(session)}>
            <PoeMapArt icon={icon} sprite={atlasMapSprite} />
            <span><strong>{session.areaName}</strong><small>{formatLocal(session.firstEnteredAt)} · area {session.areaLevel}</small><em>{formatDuration(sessionDuration(session, state, now))} observed · {session.entries} entr{session.entries === 1 ? "y" : "ies"} · {session.deaths} death{session.deaths === 1 ? "" : "s"}</em></span>
            {isActive && <i>LIVE</i>}
          </button>;
        })}
      </section>

      <aside className="mapping-journal-detail">
        {!selected ? <div className="mapping-journal-empty compact"><Clock3 size={24}/><strong>Select a map session</strong><p>Its observed facts and local annotations appear here.</p></div> : <>
          <header><div><span>{selected.areaId}</span><h3>{selected.areaName}</h3></div><PoeMapArt icon={sessionArt(selected)} sprite={atlasMapSprite} /></header>
          <dl>
            <div><dt>First entry</dt><dd>{formatLocal(selected.firstEnteredAt)}</dd></div>
            <div><dt>Last entry</dt><dd>{formatLocal(selected.lastEnteredAt)}</dd></div>
            <div><dt>Exit boundary</dt><dd>{state.activeSessionId === selected.id ? "Active now" : formatLocal(selected.lastExitedAt)}</dd></div>
            <div><dt>Observed time</dt><dd>{formatDuration(sessionDuration(selected, state, now))}{selected.timingIncomplete ? " · incomplete" : ""}</dd></div>
            <div><dt>Entries</dt><dd>{selected.entries}</dd></div>
            <div><dt>Deaths</dt><dd>{selected.deaths}{selected.lastDeathAt ? ` · last ${formatLocal(selected.lastDeathAt)}` : ""}</dd></div>
          </dl>
          <label>Tags <small>Comma-separated, {state.limits.tags} maximum</small><input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={state.limits.tags * (state.limits.tagLength + 2)} placeholder="Delirium, farming test, boss" /></label>
          <label>Notes <small>{notes.length}/{state.limits.noteLength}</small><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={state.limits.noteLength} placeholder="Your manual observations only…" /></label>
          <div className="mapping-journal-actions"><button type="button" className="is-primary" disabled={busy} onClick={() => void saveSession()}>Save notes</button><button type="button" disabled={busy} onClick={() => void removeSelected()}><Trash2 size={13}/> Remove</button></div>
        </>}
      </aside>
    </div>

    <footer><ShieldCheck size={14}/><p><strong>Fact boundary:</strong> a session requires a client-safe instance ID, a <code>MapWorlds…</code> generation line, and the matching area-entry line. Time covers only observed entry-to-next-generation intervals. Deaths require the exact configured character. GloamCore does not infer loot, profit, completion, boss kills, portals, or hidden game state.</p></footer>
  </div>;
}
