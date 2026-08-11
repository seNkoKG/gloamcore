import clsx from "clsx";
import { Clipboard, Keyboard, LoaderCircle, Save, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bridge } from "../lib/bridge";
import type { MapModifierDefinition, MapModCheckResult, MapModCheckSettings, MapModRating } from "../types";
import "../map-mod-check.css";

const RATINGS: Array<{ value: MapModRating; label: string }> = [
  { value: "good", label: "Good" },
  { value: "warn", label: "Warn" },
  { value: "bad", label: "Bad" },
  { value: "ignore", label: "Ignore" },
];

const EMPTY: MapModCheckSettings = {
  version: 1,
  enabled: true,
  hotkey: "CommandOrControl+Alt+M",
  rules: {},
  customRules: {},
};

export function MapModCheckPanel() {
  const [settings, setSettings] = useState<MapModCheckSettings>(EMPTY);
  const [definitions, setDefinitions] = useState<MapModifierDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MapModCheckResult | null>(null);
  const [lastText, setLastText] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [shortcutError, setShortcutError] = useState("");

  useEffect(() => {
    let active = true;
    bridge.getMapModCheck()
      .then((value) => {
        if (!active) return;
        setSettings(value.settings);
        setDefinitions(value.definitions);
        setShortcutError(value.shortcutError);
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return definitions.filter((entry) => !needle || entry.label.toLocaleLowerCase().includes(needle));
  }, [definitions, query]);

  const saveSettings = async (next: MapModCheckSettings) => {
    setSettings(next);
    setSaving(true);
    setMessage("");
    try {
      const saved = await bridge.saveMapModCheck(next);
      setSettings(saved.settings);
      setShortcutError(saved.shortcutError);
      if (lastText) setResult(await bridge.checkMapMods(lastText));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const setRating = (entry: MapModifierDefinition, rating: MapModRating) => {
    const rules = { ...settings.rules };
    if (rules[entry.id] === rating) delete rules[entry.id];
    else rules[entry.id] = rating;
    void saveSettings({ ...settings, rules });
  };

  const setCustomRating = (canonical: string, rating: MapModRating) => {
    const customRules = { ...settings.customRules };
    if (customRules[canonical] === rating) delete customRules[canonical];
    else customRules[canonical] = rating;
    void saveSettings({ ...settings, customRules });
  };

  const checkClipboard = async () => {
    setChecking(true);
    setMessage("");
    try {
      const capture = await bridge.readClipboardItem();
      setLastText(capture.text);
      setResult(await bridge.checkMapMods(capture.text));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };

  if (loading) return <div className="map-mod-loading"><LoaderCircle className="is-spinning" size={18}/> Loading canonical map modifiers…</div>;

  return <div className="map-mod-workbench">
    <section className="map-mod-main">
      <header>
        <div><ShieldCheck size={18}/><span><h2>Map Mod Check</h2><p>Rate only the modifiers that matter to your build. Unrated rules stay neutral.</p></span></div>
        <button type="button" onClick={checkClipboard} disabled={checking}>{checking ? <LoaderCircle className="is-spinning" size={14}/> : <Clipboard size={14}/>} Check copied map</button>
      </header>
      <div className="map-mod-hotkey">
        <label><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}/> In-game hotkey</label>
        <label><Keyboard size={13}/><input aria-label="Map Mod Check hotkey" value={settings.hotkey} onChange={(event) => setSettings({ ...settings, hotkey: event.target.value })}/></label>
        <button type="button" disabled={saving} onClick={() => void saveSettings(settings)}><Save size={13}/> {saving ? "Saving…" : "Save"}</button>
        <small>Hover a PoE 1 map and press once. GloamCore sends one copy action and opens a temporary overlay.</small>
      </div>
      {(shortcutError || message) && <p className="map-mod-message" role="alert">{message || shortcutError}</p>}
      {result && <section className={clsx("map-mod-result", `is-${result.overall}`)}>
        <header><span><small>{result.ok ? result.baseType || "Map" : "Capture rejected"}</small><strong>{result.name}</strong></span><b>{result.ok ? result.overall === "unknown" ? "NEUTRAL" : result.overall.toUpperCase() : "NOT A MAP"}</b></header>
        {!result.ok ? <p>{result.error}</p> : <div>{result.results.filter((entry) => entry.rating !== "ignore").map((entry) => <article key={entry.id} className={`is-${entry.rating}`}><i/><span><strong>{entry.line}</strong>{!entry.known && <small>Not in the canonical pack — rate this exact normalized line if needed.</small>}</span><em>{entry.rating === "unset" ? "Unrated" : entry.rating}</em>{!entry.known && entry.canonical && <div>{RATINGS.map((choice) => <button type="button" key={choice.value} className={entry.rating === choice.value ? "is-selected" : ""} onClick={() => setCustomRating(entry.canonical!, choice.value)}>{choice.label}</button>)}</div>}</article>)}</div>}
      </section>}
      <div className="map-mod-search"><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search 104 canonical map modifier lines…"/><span>{visible.length}/{definitions.length}</span></div>
      <div className="map-mod-rules">{visible.map((entry) => <article key={entry.id}><span>{entry.label}</span><div>{RATINGS.map((choice) => <button type="button" key={choice.value} className={clsx(`is-${choice.value}`, settings.rules[entry.id] === choice.value && "is-selected")} onClick={() => setRating(entry, choice.value)}>{choice.label}</button>)}</div></article>)}</div>
    </section>
    <aside className="map-mod-guide"><h3>How verdicts work</h3><dl><div><dt className="is-bad">Bad</dt><dd>Any bad modifier makes the map bad.</dd></div><div><dt className="is-warn">Warn</dt><dd>Warnings win when there is no bad modifier.</dd></div><div><dt className="is-good">Good</dt><dd>Shown only when every relevant line is good or ignored.</dd></div><div><dt>Neutral</dt><dd>Nothing is assumed. Unrated modifiers remain visible.</dd></div></dl><p>The matcher checks explicit, implicit, and enchant lines against data generated from GGG Trade, PoE Wiki Cargo, and the installed Path of Building dataset.</p></aside>
  </div>;
}
