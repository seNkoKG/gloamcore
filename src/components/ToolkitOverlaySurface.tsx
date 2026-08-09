import { CircleAlert, ExternalLink, Pin, RefreshCw, StickyNote, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../lib/bridge";
import { trustedToolkitExternalUrl } from "../lib/toolkit/external-links";
import type { ToolkitWorkspace } from "../types";
import { Whiteboard } from "./ToolkitPanel";
import "../toolkit-overlay.css";

const EMPTY: ToolkitWorkspace = {
  version: 1,
  macros: [],
  cheatSheets: [],
  theme: { accent: "#35d9b5", background: "#080f14", density: "compact" },
  whiteboard: { strokes: [], snapshots: [] },
  overlayBounds: {},
  stashScroll: { enabled: false, modifier: "Ctrl" },
  plugins: [],
};

export function ToolkitOverlaySurface() {
  const surface = new URLSearchParams(window.location.search).get("surface") || "";
  const kind = surface.endsWith("whiteboard") ? "whiteboard" : "cheats";
  const [workspace, setWorkspace] = useState<ToolkitWorkspace>(EMPTY);
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [hasLoadedWorkspace, setHasLoadedWorkspace] = useState(false);
  const saveTimer = useRef(0);
  const pendingWorkspace = useRef<ToolkitWorkspace | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setHasLoadedWorkspace(false);
    bridge.getToolkitWorkspace()
      .then((value) => {
        if (!active) return;
        setWorkspace(value);
        setHasLoadedWorkspace(true);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    const close = (event: KeyboardEvent) => event.key === "Escape" && void bridge.hideToolkitOverlay();
    window.addEventListener("keydown", close);
    return () => { active = false; window.removeEventListener("keydown", close); };
  }, [loadAttempt]);

  useEffect(() => () => {
    window.clearTimeout(saveTimer.current);
    if (pendingWorkspace.current) void bridge.saveToolkitWorkspace(pendingWorkspace.current).catch(() => undefined);
  }, []);

  const saveWorkspace = (next: ToolkitWorkspace) => {
    setWorkspace(next);
    pendingWorkspace.current = next;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const pending = pendingWorkspace.current;
      pendingWorkspace.current = null;
      if (!pending) return;
      void bridge.saveToolkitWorkspace(pending).catch((reason) => {
        setError(`Workspace save failed: ${reason instanceof Error ? reason.message : String(reason)}`);
      });
    }, 180);
  };

  const pinned = workspace.cheatSheets.filter((sheet) => sheet.pinned);
  const categories = useMemo(() => ["All", ...Array.from(new Set(pinned.map((sheet) => sheet.category)))], [pinned]);
  const visible = pinned.filter((sheet) => category === "All" || sheet.category === category);

  useEffect(() => {
    if (!categories.includes(category)) setCategory("All");
  }, [categories, category]);

  return (
    <section className="toolkit-overlay-surface" style={{ "--overlay-accent": workspace.theme.accent, "--overlay-bg": workspace.theme.background } as React.CSSProperties}>
      <header className="toolkit-overlay-titlebar">
        <span>{kind === "whiteboard" ? <><Pin size={14} /> Live whiteboard</> : <><StickyNote size={14} /> Pinned cheat sheets</>}</span>
        <small>Esc closes</small>
        <button type="button" onClick={() => bridge.hideToolkitOverlay()} aria-label="Close overlay"><X size={15} /></button>
      </header>
      {loading ? <div className="overlay-empty">Loading…</div> : error && !hasLoadedWorkspace ? (
        <div className="overlay-empty overlay-error"><CircleAlert size={22} /><span>{error}</span><button type="button" onClick={() => setLoadAttempt((current) => current + 1)}><RefreshCw size={12} /> Retry</button></div>
      ) : kind === "whiteboard" ? (
        <Whiteboard strokes={workspace.whiteboard.strokes} snapshots={workspace.whiteboard.snapshots} onChange={(strokes) => {
          const next = { ...workspace, whiteboard: { ...workspace.whiteboard, strokes } };
          saveWorkspace(next);
        }} onSnapshotsChange={(snapshots) => {
          const next = { ...workspace, whiteboard: { ...workspace.whiteboard, snapshots } };
          saveWorkspace(next);
        }} />
      ) : (
        <div className="cheat-overlay-body">
          {categories.length > 1 && <nav>{categories.map((value) => <button type="button" className={category === value ? "is-active" : ""} key={value} onClick={() => setCategory(value)}>{value}</button>)}</nav>}
          {error && <div className="overlay-inline-error"><CircleAlert size={12} /> {error}</div>}
          <main>{visible.map((sheet) => { const url = sheet.url ? trustedToolkitExternalUrl(sheet.url) : null; return <article key={sheet.id}>{sheet.image && <img src={sheet.image} alt="" />}<small>{sheet.category}</small><strong>{sheet.title}</strong><p>{sheet.body}</p>{url && <button type="button" onClick={() => { void bridge.openExternal(url.toString()).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }}><ExternalLink size={12} /> Open reference</button>}</article>; })}{!visible.length && <div className="overlay-empty">Pin cheat sheets in Player toolkit → Overlay workspace first.</div>}</main>
        </div>
      )}
    </section>
  );
}
