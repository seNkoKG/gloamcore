import clsx from "clsx";
import { CircleAlert, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../lib/bridge";
import type { MapModCheckResult } from "../types";
import "../map-mod-check.css";

export function MapModCheckOverlaySurface() {
  const [result, setResult] = useState<MapModCheckResult | null>(null);
  useEffect(() => { void bridge.getMapModOverlayResult().then(setResult); }, []);
  return <section className={clsx("map-mod-overlay", `is-${result?.overall || "unknown"}`)}>
    <header><span>{result?.ok ? <ShieldCheck size={15}/> : <CircleAlert size={15}/>} Map Mod Check</span><small>closes automatically</small><button type="button" aria-label="Close Map Mod Check" onClick={() => void bridge.hideMapModOverlay()}><X size={14}/></button></header>
    {!result ? <p>Reading map…</p> : <><div className="map-mod-overlay-verdict"><span><small>{result.baseType || "Copied item"}</small><strong>{result.name}</strong></span><b>{result.ok ? result.overall === "unknown" ? "NEUTRAL" : result.overall.toUpperCase() : "INVALID"}</b></div>{!result.ok ? <p>{result.error}</p> : <main>{result.results.filter((entry) => entry.rating !== "ignore").map((entry) => <div key={entry.id} className={`is-${entry.rating}`}><i/><span>{entry.line}</span><b>{entry.rating === "unset" ? "UNRATED" : entry.rating.toUpperCase()}</b></div>)}{!result.results.length && <p>No canonical map modifiers were found.</p>}</main>}</>}
  </section>;
}
