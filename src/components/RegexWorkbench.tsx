import clsx from "clsx";
import {
  CircleAlert,
  Clipboard,
  Download,
  Info,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../lib/bridge";
import {
  buildMapRegexPropertyClauses,
  DEFAULT_MAP_REGEX_PROPERTIES,
  type MapRegexPropertySettings,
  type RegexStateMode,
} from "../lib/toolkit/map-regex-properties";
import {
  buildPoeRegex,
  normalizePoeSearchText,
  type RegexEntry,
  type RegexEntryMode,
  type RegexMatchMode,
} from "../lib/toolkit/poe-regex";
import {
  loadRegexDataPack,
  regexCategoryEntries,
  regexDataDiagnostic,
  resetRegexDataPackCache,
  type RegexDataCategory,
  type RegexDataPack,
} from "../lib/toolkit/regex-data";
import { pruneRegexSelections } from "../lib/toolkit/regex-profile-state";

type TokenMode = "exact" | "optimized";

interface CustomRegexEntry {
  id: string;
  label: string;
  mode?: RegexEntryMode;
}

interface RegexWorkbenchState {
  activeCategoryId: string;
  selections: Record<string, Record<string, RegexEntryMode>>;
  customEntries: Record<string, CustomRegexEntry[]>;
  tokenMode: TokenMode;
  wantMatch: RegexMatchMode;
  autoCopy: boolean;
  mapProperties: MapRegexPropertySettings;
}

interface RegexProfile {
  id: string;
  name: string;
  updatedAt: number;
  state: RegexWorkbenchState;
}

const PROFILE_STORAGE = "ninja-lens:toolkit:regex-profiles:v2";
const PROFILE_FILE_KIND = "ninja-lens-regex-profiles";
const ENTRY_PAGE_SIZE = 160;
const EMPTY_SELECTIONS: Record<string, RegexEntryMode> = {};
const EMPTY_CUSTOM_ENTRIES: CustomRegexEntry[] = [];
const SECTION_LABELS: Record<RegexDataCategory["section"], string> = {
  core: "Core tools",
  mechanic: "League mechanics",
  "official-items": "Official item groups",
  "official-stats": "Official modifier groups",
  "official-static": "Official static groups",
};

function cleanMapProperties(): MapRegexPropertySettings {
  return {
    ...DEFAULT_MAP_REGEX_PROPERTIES,
    mapRarity: { ...DEFAULT_MAP_REGEX_PROPERTIES.mapRarity },
    quality: { ...DEFAULT_MAP_REGEX_PROPERTIES.quality },
  };
}

function cleanState(): RegexWorkbenchState {
  return {
    activeCategoryId: "map-modifiers",
    selections: {},
    customEntries: {},
    tokenMode: "optimized",
    wantMatch: "any",
    autoCopy: false,
    mapProperties: cleanMapProperties(),
  };
}

function stateForCategory(
  current: RegexWorkbenchState,
  category: RegexDataCategory,
): RegexWorkbenchState {
  const tokenMode = current.tokenMode === "exact"
    ? (category.search.supportsExact ? "exact" : "optimized")
    : (category.search.supportsOptimized ? "optimized" : "exact");
  const wantMatch = current.wantMatch === "all"
    ? (category.search.supportsMatchAll ? "all" : "any")
    : (category.search.supportsMatchAny ? "any" : "all");
  const selections = pruneRegexSelections(
    { [category.id]: current.selections[category.id] || {} },
    [category],
  ).selections[category.id] || {};
  const customEntries = (current.customEntries[category.id] || []).map((entry) => ({
    ...entry,
    mode: entry.mode === "avoid" && !category.search.supportsAvoid ||
      entry.mode === "want" && !category.search.supportsWant
      ? undefined
      : entry.mode,
  }));
  return {
    ...current,
    activeCategoryId: category.id,
    tokenMode,
    wantMatch,
    selections: { ...current.selections, [category.id]: selections },
    customEntries: { ...current.customEntries, [category.id]: customEntries },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(9_999, parsed)) : 0;
}

function stateMode(value: unknown): RegexStateMode {
  return value === "include" || value === "exclude" ? value : "ignore";
}

function normalizeMapProperties(value: unknown): MapRegexPropertySettings {
  const source = isRecord(value) ? value : {};
  const rarity = isRecord(source.mapRarity) ? source.mapRarity : {};
  const quality = isRecord(source.quality) ? source.quality : {};
  return {
    quantity: boundedInteger(source.quantity),
    packSize: boundedInteger(source.packSize),
    moreMaps: boundedInteger(source.moreMaps),
    itemRarity: boundedInteger(source.itemRarity),
    corrupted: stateMode(source.corrupted),
    unidentified: stateMode(source.unidentified),
    mapRarity: {
      normal: Boolean(rarity.normal),
      magic: Boolean(rarity.magic),
      rare: Boolean(rarity.rare),
      mode: rarity.mode === "exclude" ? "exclude" : "include",
    },
    quality: {
      regular: boundedInteger(quality.regular),
      packSize: boundedInteger(quality.packSize),
      rarity: boundedInteger(quality.rarity),
      currency: boundedInteger(quality.currency),
      divination: boundedInteger(quality.divination),
      scarab: boundedInteger(quality.scarab),
      match: quality.match === "all" ? "all" : "any",
    },
  };
}

function normalizeState(value: unknown): RegexWorkbenchState | null {
  if (!isRecord(value)) return null;
  const selections: RegexWorkbenchState["selections"] = {};
  if (isRecord(value.selections)) {
    for (const [categoryId, rawEntries] of Object.entries(value.selections).slice(0, 100)) {
      if (!categoryId || categoryId.length > 160 || !isRecord(rawEntries)) continue;
      const modes: Record<string, RegexEntryMode> = {};
      for (const [entryId, mode] of Object.entries(rawEntries).slice(0, 30_000)) {
        if (entryId && entryId.length <= 200 && (mode === "avoid" || mode === "want")) modes[entryId] = mode;
      }
      if (Object.keys(modes).length) selections[categoryId] = modes;
    }
  }

  const customEntries: RegexWorkbenchState["customEntries"] = {};
  if (isRecord(value.customEntries)) {
    for (const [categoryId, rawEntries] of Object.entries(value.customEntries).slice(0, 100)) {
      if (!categoryId || categoryId.length > 160 || !Array.isArray(rawEntries)) continue;
      const entries = rawEntries.slice(0, 500).flatMap((entry): CustomRegexEntry[] => {
        if (!isRecord(entry)) return [];
        const id = typeof entry.id === "string" ? entry.id.slice(0, 200) : "";
        const label = typeof entry.label === "string" ? entry.label.trim().slice(0, 1_000) : "";
        if (!id || !label) return [];
        return [{ id, label, mode: entry.mode === "avoid" || entry.mode === "want" ? entry.mode : undefined }];
      });
      if (entries.length) customEntries[categoryId] = entries;
    }
  }

  return {
    activeCategoryId: typeof value.activeCategoryId === "string" ? value.activeCategoryId.slice(0, 160) : "map-modifiers",
    selections,
    customEntries,
    tokenMode: value.tokenMode === "exact" ? "exact" : "optimized",
    wantMatch: value.wantMatch === "all" ? "all" : "any",
    autoCopy: Boolean(value.autoCopy),
    mapProperties: normalizeMapProperties(value.mapProperties),
  };
}

function normalizeProfiles(value: unknown): RegexProfile[] {
  const rawProfiles = Array.isArray(value)
    ? value
    : isRecord(value) && value.kind === PROFILE_FILE_KIND && value.version === 1 && Array.isArray(value.profiles)
      ? value.profiles
      : [];
  return rawProfiles.slice(0, 100).flatMap((entry): RegexProfile[] => {
    if (!isRecord(entry)) return [];
    const state = normalizeState(entry.state);
    const id = typeof entry.id === "string" ? entry.id.slice(0, 200) : "";
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 100) : "";
    const updatedAt = Number(entry.updatedAt);
    if (!id || !name || !state || !Number.isFinite(updatedAt)) return [];
    return [{ id, name, updatedAt, state }];
  });
}

function loadStoredProfiles() {
  if (typeof localStorage === "undefined") return [];
  try {
    return normalizeProfiles(JSON.parse(localStorage.getItem(PROFILE_STORAGE) || "[]"));
  } catch {
    return [];
  }
}

function cloneState(value: RegexWorkbenchState) {
  return JSON.parse(JSON.stringify(value)) as RegexWorkbenchState;
}

function mapPackAge(pack: RegexDataPack) {
  const timestamp = Date.parse(pack.update.officialRetrievedAt);
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000)) : null;
}

function NumericField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input type="number" min="0" max="9999" value={value || ""} placeholder="Any" onChange={(event) => onChange(boundedInteger(event.target.value))} />
    </label>
  );
}

function ModeButtons({ value, onChange, includeLabel = "Include" }: { value: RegexStateMode; onChange: (value: RegexStateMode) => void; includeLabel?: string }) {
  return (
    <span className="regex-segmented">
      {(["ignore", "include", "exclude"] as RegexStateMode[]).map((mode) => (
        <button type="button" key={mode} className={value === mode ? "is-active" : ""} onClick={() => onChange(mode)}>
          {mode === "include" ? includeLabel : mode}
        </button>
      ))}
    </span>
  );
}

function MapPropertyControls({ value, onChange }: { value: MapRegexPropertySettings; onChange: (value: MapRegexPropertySettings) => void }) {
  const update = <K extends keyof MapRegexPropertySettings>(key: K, next: MapRegexPropertySettings[K]) => onChange({ ...value, [key]: next });
  const updateQuality = <K extends keyof MapRegexPropertySettings["quality"]>(key: K, next: MapRegexPropertySettings["quality"][K]) => update("quality", { ...value.quality, [key]: next });
  return (
    <section className="regex-map-properties">
      <header>
        <div><strong>Map properties</strong><span>Every active property is ANDed with the modifier query.</span></div>
        <button type="button" onClick={() => onChange(cleanMapProperties())}>Clear properties</button>
      </header>
      <div className="regex-property-numbers">
        <NumericField label="Quantity % minimum" value={value.quantity} onChange={(next) => update("quantity", next)} />
        <NumericField label="Pack size % minimum" value={value.packSize} onChange={(next) => update("packSize", next)} />
        <NumericField label="More maps % minimum" value={value.moreMaps} onChange={(next) => update("moreMaps", next)} />
        <NumericField label="Item rarity % minimum" value={value.itemRarity} onChange={(next) => update("itemRarity", next)} />
      </div>
      <div className="regex-state-grid">
        <div><span>Corrupted</span><ModeButtons value={value.corrupted} onChange={(next) => update("corrupted", next)} /></div>
        <div><span>Unidentified</span><ModeButtons value={value.unidentified} onChange={(next) => update("unidentified", next)} /></div>
        <div className="regex-rarity-control">
          <span>Map rarity</span>
          <span className="regex-segmented regex-rarity-mode">
            {(["include", "exclude"] as const).map((mode) => <button type="button" key={mode} className={value.mapRarity.mode === mode ? "is-active" : ""} onClick={() => update("mapRarity", { ...value.mapRarity, mode })}>{mode}</button>)}
          </span>
          <span className="regex-rarity-checks">
            {(["normal", "magic", "rare"] as const).map((rarity) => <label key={rarity}><input type="checkbox" checked={value.mapRarity[rarity]} onChange={(event) => update("mapRarity", { ...value.mapRarity, [rarity]: event.target.checked })} />{rarity}</label>)}
          </span>
        </div>
      </div>
      <div className="regex-quality-head">
        <div><strong>Quality thresholds</strong><span>Quantity, pack size, rarity, currency, divination and scarab quality.</span></div>
        <span className="regex-segmented">
          {(["any", "all"] as const).map((mode) => <button type="button" key={mode} className={value.quality.match === mode ? "is-active" : ""} onClick={() => updateQuality("match", mode)}>Match {mode}</button>)}
        </span>
      </div>
      <div className="regex-quality-grid">
        <NumericField label="Regular quality %" value={value.quality.regular} onChange={(next) => updateQuality("regular", next)} />
        <NumericField label="Pack-size quality %" value={value.quality.packSize} onChange={(next) => updateQuality("packSize", next)} />
        <NumericField label="Rarity quality %" value={value.quality.rarity} onChange={(next) => updateQuality("rarity", next)} />
        <NumericField label="Currency quality %" value={value.quality.currency} onChange={(next) => updateQuality("currency", next)} />
        <NumericField label="Divination quality %" value={value.quality.divination} onChange={(next) => updateQuality("divination", next)} />
        <NumericField label="Scarab quality %" value={value.quality.scarab} onChange={(next) => updateQuality("scarab", next)} />
      </div>
    </section>
  );
}

export function RegexWorkbench() {
  const [pack, setPack] = useState<RegexDataPack | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [state, setState] = useState<RegexWorkbenchState>(cleanState);
  const [profiles, setProfiles] = useState<RegexProfile[]>(loadStoredProfiles);
  const [profileName, setProfileName] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [entrySearch, setEntrySearch] = useState("");
  const [customText, setCustomText] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(ENTRY_PAGE_SIZE);
  const [message, setMessage] = useState("");
  const lastAutoCopy = useRef("");

  useEffect(() => {
    let active = true;
    setLoadError("");
    setPack(null);
    loadRegexDataPack().then((value) => {
      if (!active) return;
      if (!value) {
        setLoadError(`Regex data pack unavailable (${regexDataDiagnostic()}).`);
        return;
      }
      setPack(value);
      setState((current) => {
        const category = value.categories.find((entry) => entry.id === current.activeCategoryId) || value.categories[0];
        return category ? stateForCategory(current, category) : current;
      });
    }).catch((error) => active && setLoadError(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
  }, [loadAttempt]);

  const activeCategory = pack?.categories.find((category) => category.id === state.activeCategoryId) || null;
  const baseEntries = useMemo(
    () => pack && activeCategory ? regexCategoryEntries(pack, activeCategory.id) : [],
    [activeCategory, pack],
  );
  const entryIndex = useMemo(() => new Map(baseEntries.map((entry) => [entry.id, entry])), [baseEntries]);
  const currentSelections = state.selections[state.activeCategoryId] || EMPTY_SELECTIONS;
  const currentCustom = state.customEntries[state.activeCategoryId] || EMPTY_CUSTOM_ENTRIES;
  const searchNeedle = normalizePoeSearchText(entrySearch);
  const displayRows = useMemo(() => [
    ...baseEntries.map((entry) => ({ id: entry.id, label: entry.label, text: entry.text || entry.label, custom: false })),
    ...currentCustom.map((entry) => ({ id: entry.id, label: entry.label, text: entry.label, custom: true })),
  ].filter((entry) => !searchNeedle || normalizePoeSearchText(`${entry.label} ${entry.text}`).includes(searchNeedle)), [baseEntries, currentCustom, searchNeedle]);
  const visibleRows = displayRows.slice(0, visibleLimit);

  const result = useMemo(() => {
    const selectedEntries = Object.entries(currentSelections).flatMap(([id, mode]): RegexEntry[] => {
      if (mode === "avoid" && !activeCategory?.search.supportsAvoid ||
        mode === "want" && !activeCategory?.search.supportsWant) return [];
      const entry = entryIndex.get(id);
      return entry ? [{ ...entry, selected: true, mode }] : [];
    });
    selectedEntries.push(...currentCustom.flatMap((entry): RegexEntry[] => entry.mode &&
      (entry.mode !== "avoid" || activeCategory?.search.supportsAvoid) &&
      (entry.mode !== "want" || activeCategory?.search.supportsWant)
      ? [{ id: entry.id, label: entry.label, text: entry.label, selected: true, mode: entry.mode }]
      : []));
    const mapClauses = activeCategory?.id === "map-modifiers"
      ? buildMapRegexPropertyClauses(state.mapProperties)
      : { requiredPatterns: [], avoidEntries: [] };
    selectedEntries.push(...mapClauses.avoidEntries);
    return buildPoeRegex(selectedEntries, {
      exact: state.tokenMode === "exact",
      wantMatch: state.wantMatch,
      requiredPatterns: mapClauses.requiredPatterns,
      universe: [...baseEntries, ...currentCustom.map((entry) => entry.label)],
    });
  }, [activeCategory?.id, baseEntries, currentCustom, currentSelections, entryIndex, state.mapProperties, state.tokenMode, state.wantMatch]);

  useEffect(() => {
    if (!state.autoCopy || !result.valid || result.overflow || result.chunks.length !== 1 || !result.expression || lastAutoCopy.current === result.expression) return;
    let active = true;
    navigator.clipboard.writeText(result.expression).then(() => {
      if (!active) return;
      lastAutoCopy.current = result.expression;
      setMessage("Regex copied automatically.");
    }).catch((error) => active && setMessage(`Auto-copy failed: ${error instanceof Error ? error.message : String(error)}`));
    return () => { active = false; };
  }, [result, state.autoCopy]);

  useEffect(() => setVisibleLimit(ENTRY_PAGE_SIZE), [entrySearch, state.activeCategoryId]);

  if (loadError) return <div className="toolkit-empty"><CircleAlert size={34} /><h2>Regex database did not load</h2><p>{loadError}</p><button type="button" onClick={() => { resetRegexDataPackCache(); setLoadAttempt((current) => current + 1); }}><RefreshCw size={14} /> Retry database load</button></div>;
  if (!pack || !activeCategory) return <div className="toolkit-empty"><RefreshCw className="is-spinning" size={30} /><p>Loading and validating the bundled 8.8 MiB regex database…</p></div>;

  const filteredCategories = pack.categories.filter((category) => {
    const needle = normalizePoeSearchText(categorySearch);
    return !needle || normalizePoeSearchText(`${category.label} ${category.description} ${category.search.aliases.join(" ")}`).includes(needle);
  });
  const categorySections = (Object.keys(SECTION_LABELS) as RegexDataCategory["section"][]).map((section) => ({
    section,
    categories: filteredCategories.filter((category) => category.section === section),
  })).filter((group) => group.categories.length);
  const selectedCount = Object.keys(currentSelections).length + currentCustom.filter((entry) => entry.mode).length;
  const packAge = mapPackAge(pack);

  const setSelection = (id: string, mode: RegexEntryMode) => setState((current) => {
    const category = { ...(current.selections[current.activeCategoryId] || {}) };
    if (category[id] === mode) delete category[id];
    else category[id] = mode;
    return { ...current, selections: { ...current.selections, [current.activeCategoryId]: category } };
  });
  const setCustomMode = (id: string, mode: RegexEntryMode) => setState((current) => ({
    ...current,
    customEntries: {
      ...current.customEntries,
      [current.activeCategoryId]: (current.customEntries[current.activeCategoryId] || []).map((entry) => entry.id === id ? { ...entry, mode: entry.mode === mode ? undefined : mode } : entry),
    },
  }));
  const removeCustom = (id: string) => setState((current) => ({
    ...current,
    customEntries: { ...current.customEntries, [current.activeCategoryId]: (current.customEntries[current.activeCategoryId] || []).filter((entry) => entry.id !== id) },
  }));
  const addCustom = (mode: RegexEntryMode) => {
    const label = customText.trim();
    if (!label) return;
    setState((current) => ({
      ...current,
      customEntries: {
        ...current.customEntries,
        [current.activeCategoryId]: [...(current.customEntries[current.activeCategoryId] || []), { id: `custom:${crypto.randomUUID()}`, label: label.slice(0, 1_000), mode }],
      },
    }));
    setCustomText("");
  };
  const reset = () => {
    setState(cleanState());
    setEntrySearch("");
    setCustomText("");
    setMessage("Workbench reset. Nothing is selected.");
  };
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} copied.`);
    } catch (error) {
      setMessage(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const persistProfiles = (next: RegexProfile[]) => {
    localStorage.setItem(PROFILE_STORAGE, JSON.stringify(next));
    setProfiles(next);
  };
  const saveProfile = () => {
    const name = profileName.trim();
    if (!name) return;
    try {
      const existing = profiles.find((profile) => profile.name.toLowerCase() === name.toLowerCase());
      const profile: RegexProfile = { id: existing?.id || crypto.randomUUID(), name: name.slice(0, 100), updatedAt: Date.now(), state: cloneState(state) };
      persistProfiles([...profiles.filter((entry) => entry.id !== profile.id), profile].sort((left, right) => right.updatedAt - left.updatedAt));
      setProfileName("");
      const action = existing ? "Updated" : "Saved";
      setMessage(`${action} profile “${profile.name}” locally.${packAge != null && packAge > 14 ? ` The ${packAge}-day-old data pack is stale; rebuild it before treating category coverage as current.` : ""}`);
    } catch (error) {
      setMessage(`Profile save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const loadProfile = (profile: RegexProfile) => {
    const next = cloneState(profile.state);
    const pruned = pruneRegexSelections(next.selections, pack.categories);
    next.selections = pruned.selections;
    const category = pack.categories.find((entry) => entry.id === next.activeCategoryId) || pack.categories[0];
    setState(category ? stateForCategory(next, category) : next);
    setEntrySearch("");
    setMessage(`Loaded profile “${profile.name}”.${pruned.removed ? ` Removed ${pruned.removed} saved selection${pruned.removed === 1 ? "" : "s"} no longer present in the verified data pack.` : ""}${packAge != null && packAge > 14 ? ` The ${packAge}-day-old data pack is stale; verify selections against the current league.` : ""}`);
  };
  const deleteProfile = (id: string) => {
    try {
      persistProfiles(profiles.filter((profile) => profile.id !== id));
      setMessage("Profile deleted.");
    } catch (error) {
      setMessage(`Profile delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const exportProfiles = async () => {
    try {
      const saved = await bridge.saveToolkitText({
        kind: "text",
        suggestedName: "Ninja-Lens-Regex-Profiles.json",
        text: JSON.stringify({ kind: PROFILE_FILE_KIND, version: 1, exportedAt: new Date().toISOString(), profiles }, null, 2),
      });
      if (saved) setMessage(`Exported ${profiles.length} profile${profiles.length === 1 ? "" : "s"} to ${saved.name}.`);
    } catch (error) {
      setMessage(`Profile export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const importProfiles = async () => {
    try {
      const opened = await bridge.openToolkitText("text");
      if (!opened) return;
      const imported = normalizeProfiles(JSON.parse(opened.text));
      if (!imported.length) throw new Error("The file contains no valid Ninja Lens regex profiles.");
      const merged = new Map(profiles.map((profile) => [profile.id, profile]));
      imported.forEach((profile) => merged.set(profile.id, profile));
      const next = [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 100);
      persistProfiles(next);
      setMessage(`Imported ${imported.length} profile${imported.length === 1 ? "" : "s"} from ${opened.name}.`);
    } catch (error) {
      setMessage(`Profile import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="regex-workbench">
      <section className="regex-output-card">
        <div className="regex-output-head">
          <span>{activeCategory.label} · {state.tokenMode === "optimized" ? "verified optimized" : "exact"}</span>
          <strong className={clsx(result.overflow && "is-over")}>{result.characterCount}/250</strong>
        </div>
        <code>{result.expression || "Nothing selected. Choose AVOID or WANT below."}</code>
        <div className="regex-output-actions">
          <button type="button" className="is-primary" disabled={!result.expression || result.overflow || !result.valid} onClick={() => void copy(result.expression, "Regex")}><Clipboard size={14} /> Copy regex</button>
          <label><input type="checkbox" checked={state.autoCopy} onChange={(event) => setState((current) => ({ ...current, autoCopy: event.target.checked }))} /> Auto-copy one valid chunk</label>
          <span>{selectedCount} selected · {result.tokens.length} clauses</span>
        </div>
        {result.optimizationFallbacks.length > 0 && <div className="regex-notice is-advisory"><Info size={13} /> {result.optimizationFallbacks.length} selection{result.optimizationFallbacks.length === 1 ? "" : "s"} fell back to exact because no shorter token was proven unique.</div>}
        {result.overflow && <div className={clsx("regex-notice", result.chunksAreLossless ? "is-safe" : "is-advisory")}><CircleAlert size={13} />{result.chunksAreLossless ? `Use all ${result.chunks.length} chunks and combine their matches. The split is lossless.` : "These chunks are advisory only. Separate searches change AND or exclusion semantics, so refine the selection for one exact query."}</div>}
        {result.oversizedTerms.length > 0 && <div className="regex-notice is-advisory"><CircleAlert size={13} /> {result.oversizedTerms.length} complete term{result.oversizedTerms.length === 1 ? " is" : "s are"} longer than the in-game limit and cannot be split safely.</div>}
        {result.chunks.length > 1 && <div className="regex-chunks">{result.chunks.map((chunk, index) => <article key={`${index}-${chunk}`}><header><span>Chunk {index + 1}</span><strong>{chunk.length}/250</strong></header><code>{chunk}</code><button type="button" onClick={() => void copy(chunk, `Chunk ${index + 1}`)}><Clipboard size={13} /> Copy</button></article>)}</div>}
      </section>

      {message && <div className="toolkit-message"><CircleAlert size={14} />{message}<button type="button" aria-label="Dismiss message" onClick={() => setMessage("")}><X size={13} /></button></div>}
      {packAge != null && packAge > 14 && <div className="toolkit-message"><CircleAlert size={14} />The bundled regex data is {packAge} days old. Results remain local, but category completeness may lag the current league.</div>}

      <div className="regex-top-controls">
        <span className="regex-token-mode" role="group" aria-label="Regex token mode">
          <button type="button" className={state.tokenMode === "optimized" ? "is-active" : ""} disabled={!activeCategory.search.supportsOptimized} onClick={() => setState((current) => ({ ...current, tokenMode: "optimized" }))}>Verified optimized</button>
          <button type="button" className={state.tokenMode === "exact" ? "is-active" : ""} disabled={!activeCategory.search.supportsExact} onClick={() => setState((current) => ({ ...current, tokenMode: "exact" }))}>Exact</button>
        </span>
        <span className="regex-token-mode" role="group" aria-label="Wanted modifier matching">
          <button type="button" className={state.wantMatch === "any" ? "is-active" : ""} disabled={!activeCategory.search.supportsMatchAny} onClick={() => setState((current) => ({ ...current, wantMatch: "any" }))}>WANT any</button>
          <button type="button" className={state.wantMatch === "all" ? "is-active" : ""} disabled={!activeCategory.search.supportsMatchAll} onClick={() => setState((current) => ({ ...current, wantMatch: "all" }))}>WANT all</button>
        </span>
        <button type="button" className="regex-reset" onClick={reset}><Trash2 size={13} /> Reset all</button>
      </div>

      {activeCategory.id === "map-modifiers" && <MapPropertyControls value={state.mapProperties} onChange={(mapProperties) => setState((current) => ({ ...current, mapProperties }))} />}

      <div className="regex-layout">
        <aside className="regex-category-panel">
          <header><strong>Database</strong><span>{pack.categories.length} current categories</span></header>
          <label className="regex-search"><Search size={13} /><input value={categorySearch} placeholder="Find a category…" onChange={(event) => setCategorySearch(event.target.value)} /></label>
          <div className="regex-category-list">
            {categorySections.map((group) => <section key={group.section}><h3>{SECTION_LABELS[group.section]}</h3>{group.categories.map((category) => <button type="button" key={category.id} className={state.activeCategoryId === category.id ? "is-active" : ""} onClick={() => { setState((current) => stateForCategory(current, category)); setEntrySearch(""); }}><span>{category.label}</span><small>{category.entries.length.toLocaleString()}</small></button>)}</section>)}
            {!categorySections.length && <p>No category matches.</p>}
          </div>
        </aside>

        <main className="regex-selector">
          <header className="regex-selector-head">
            <div><strong>{activeCategory.label}</strong><span>{activeCategory.description}</span></div>
            <span>{displayRows.length.toLocaleString()} matching · {baseEntries.length.toLocaleString()} database rows</span>
          </header>
          <div className="regex-entry-tools">
            <label className="regex-search"><Search size={13} /><input value={entrySearch} placeholder={activeCategory.search.placeholder || "Search current category…"} onChange={(event) => setEntrySearch(event.target.value)} /></label>
            <div className="regex-custom-add"><input value={customText} placeholder="Add exact in-game wording…" onChange={(event) => setCustomText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addCustom("want")} /><button type="button" disabled={!customText.trim() || !activeCategory.search.supportsAvoid} onClick={() => addCustom("avoid")}>Add AVOID</button><button type="button" disabled={!customText.trim() || !activeCategory.search.supportsWant} onClick={() => addCustom("want")}>Add WANT</button></div>
          </div>
          <div className="regex-row-head"><span>Current in-game text</span><span>AVOID</span><span>WANT</span><span></span></div>
          <div className="regex-entry-list">
            {visibleRows.map((entry) => {
              const customEntry = entry.custom ? currentCustom.find((candidate) => candidate.id === entry.id) : undefined;
              const mode = customEntry?.mode || currentSelections[entry.id];
              const toggle = entry.custom ? setCustomMode : setSelection;
              return <div key={entry.id} className={clsx(mode && "is-selected", mode && `is-${mode}`)}><span><strong>{entry.label}</strong>{entry.text !== entry.label && <small>{entry.text}</small>}{entry.custom && <em>CUSTOM</em>}</span><button type="button" className={mode === "avoid" ? "is-active" : ""} aria-pressed={mode === "avoid"} disabled={!activeCategory.search.supportsAvoid} onClick={() => toggle(entry.id, "avoid")}>Avoid</button><button type="button" className={mode === "want" ? "is-active" : ""} aria-pressed={mode === "want"} disabled={!activeCategory.search.supportsWant} onClick={() => toggle(entry.id, "want")}>Want</button>{entry.custom ? <button type="button" className="regex-delete-custom" aria-label={`Delete ${entry.label}`} onClick={() => removeCustom(entry.id)}><X size={12} /></button> : <span />}</div>;
            })}
            {!visibleRows.length && <p className="workspace-none">No entry matches this search. Add current in-game wording as a custom entry if needed.</p>}
          </div>
          {visibleLimit < displayRows.length && <button type="button" className="regex-load-more" onClick={() => setVisibleLimit((current) => current + ENTRY_PAGE_SIZE)}>Show {Math.min(ENTRY_PAGE_SIZE, displayRows.length - visibleLimit).toLocaleString()} more</button>}
        </main>

        <aside className="regex-profile-panel">
          <section>
            <header><strong>Named profiles</strong><span>Full selections and map logic</span></header>
            <div className="regex-profile-save"><input value={profileName} placeholder="Profile name" onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveProfile()} /><button type="button" disabled={!profileName.trim()} onClick={saveProfile}><Save size={13} /> Save</button></div>
            <div className="regex-profile-files"><button type="button" onClick={() => void importProfiles()}><Upload size={13} /> Import</button><button type="button" disabled={!profiles.length} onClick={() => void exportProfiles()}><Download size={13} /> Export</button></div>
            <div className="regex-profile-list">{profiles.map((profile) => <div key={profile.id}><button type="button" onClick={() => loadProfile(profile)}><strong>{profile.name}</strong><small>{new Date(profile.updatedAt).toLocaleString()}</small></button><button type="button" aria-label={`Delete ${profile.name}`} onClick={() => deleteProfile(profile.id)}><Trash2 size={12} /></button></div>)}{!profiles.length && <p>No profiles saved. Saving captures the entire logical workbench state.</p>}</div>
          </section>
          <section className="regex-provenance">
            <header><strong>Data freshness</strong><span className={clsx(packAge != null && packAge > 14 && "is-stale")}>{packAge == null ? "Unknown age" : packAge === 0 ? "Retrieved today" : `${packAge} days old`}</span></header>
            <p>Generated {new Date(pack.generatedAt).toLocaleString()}. Official Trade data retrieved {new Date(pack.update.officialRetrievedAt).toLocaleString()}.</p>
            <div>{pack.sources.map((source) => <span key={source.id}><strong>{source.label}</strong><small>{source.kind}{source.version ? ` · ${source.version}` : ""}</small></span>)}</div>
            <details><summary><Info size={12} /> Coverage and limitations</summary><ul>{pack.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><code>{pack.update.command}</code></details>
          </section>
        </aside>
      </div>
    </div>
  );
}
