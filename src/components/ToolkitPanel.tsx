import clsx from "clsx";
import {
  Braces,
  Bot,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  ExternalLink,
  FileClock,
  FilePenLine,
  FolderOpen,
  History,
  MessageSquareText,
  MapPinned,
  Paintbrush,
  Palette,
  PenLine,
  Pickaxe,
  RefreshCw,
  Save,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Trash2,
  Waypoints,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { categories, defaultSource } from "../config/categories";
import { bridge } from "../lib/bridge";
import { normalizeOverview } from "../lib/economy";
import { parsePoeItem } from "../lib/price-check/parser";
import type { ParsedPoeItem } from "../lib/price-check/types";
import {
  findMatchingFilterBlocks,
  itemFilterFileMatchesMode,
  itemFilterFileName,
  itemFilterModeFromFileName,
  ITEM_FILTER_ACTION_SCHEMA,
  ITEM_FILTER_EXTENSIONS,
  ITEM_FILTER_VISIBILITY_MATRIX,
  moveBaseType,
  parseItemFilter,
  removeBlockAction,
  replayFilterIntents,
  serializeItemFilter,
  setBlockAction,
  setBlockVisibility,
  setItemFilterMode,
  validateItemFilter,
  type FilterIntent,
  type FilterVisibility,
  type ItemFilterMode,
  type ItemFilterDocument,
} from "../lib/toolkit/item-filter";
import {
  calculateSocketRecipes,
  socketColourChances,
  type SocketRecolorInput,
} from "../lib/toolkit/socket-recolor";
import {
  auditFilterEconomy,
  calculateDustValue,
  divinationAreaExpectedValue,
  filterAuditEntries,
} from "../lib/toolkit/economy-audit";
import {
  sandboxedPluginUrl,
  trustedToolkitExternalUrl,
} from "../lib/toolkit/external-links";
import {
  mergePersistedPluginStorageIntoDraft,
  persistedPluginForPreview,
  pluginCapabilities,
  workspaceWithLatestPersistedPluginStorage,
  workspaceWithPersistedPluginStorage,
} from "../lib/toolkit/plugin-workspace";
import type { EconomyRow, ToolkitCheckpoint, ToolkitPlugin, ToolkitTextFile, ToolkitWorkspace } from "../types";
import { RegexWorkbench } from "./RegexWorkbench";
import { MapModCheckPanel } from "./MapModCheckPanel";
import { ClusterBackPanel } from "./ClusterBackPanel";
import { PoeEventLogPanel } from "./PoeEventLogPanel";
import { MappingJournalPanel } from "./MappingJournalPanel";
import "../toolkit.css";

type ToolkitTab = "filter" | "regex" | "map-mods" | "mapping-journal" | "event-log" | "cluster-back" | "recolor" | "audit" | "workspace";

const TABS: Array<{ id: ToolkitTab; label: string; icon: typeof Scissors }> = [
  { id: "filter", label: "Filter editor", icon: FilePenLine },
  { id: "regex", label: "Regex tool", icon: Braces },
  { id: "map-mods", label: "Map Mod Check", icon: ShieldCheck },
  { id: "mapping-journal", label: "Mapping Journal", icon: MapPinned },
  { id: "event-log", label: "PoE Event Log", icon: FileClock },
  { id: "cluster-back", label: "Cluster Back", icon: Waypoints },
  { id: "recolor", label: "Socket recolor", icon: Paintbrush },
  { id: "audit", label: "Economy audit", icon: ShieldCheck },
  { id: "workspace", label: "Overlay workspace", icon: Sparkles },
];

function itemFacts(item: ParsedPoeItem) {
  return {
    itemClass: item.itemClass,
    baseType: item.baseType,
    rarity: item.rarity,
    itemLevel: item.itemLevel,
    quality: item.quality,
    linkedSockets: item.links,
    sockets: item.sockets.reduce((sum, group) => sum + group.colors.length, 0),
    stackSize: item.stackSize,
    corrupted: item.corrupted,
    identified: item.identified,
    fractured: item.fractured,
    synthesised: item.synthesised,
    mirrored: item.mirrored,
    replica: item.replica,
    foulborn: item.foulborn,
    vestigial: item.vestigial,
    scourged: item.scourged,
    blightedMap: item.mapBlighted === "Blighted",
    uberBlightedMap: item.mapBlighted === "Blight-ravaged",
    gemLevel: item.gemLevel,
    mapTier: item.mapTier,
    memoryStrands: item.memoryStrands,
    width: item.width,
    height: item.height,
    influences: item.influences,
    socketGroups: item.sockets.map((group) => group.colors),
    hasImplicitMod: item.modifiers.some((modifier) => modifier.kind === "implicit"),
    hasEnchantment: item.modifiers.some((modifier) => modifier.kind === "enchant"),
  };
}

function filterColor(values: string[] | undefined, fallback: string) {
  const fallbackRgb = fallback.match(/[0-9a-f]{2}/gi)?.map((entry) => Number.parseInt(entry, 16)) || [255, 255, 255];
  const rgb = [0, 1, 2].map((index) => {
    const parsed = Number(values?.[index]);
    return Math.max(0, Math.min(255, Number.isFinite(parsed) ? parsed : fallbackRgb[index] || 0));
  });
  const parsedAlpha = Number(values?.[3]);
  return {
    hex: `#${rgb.map((entry) => Math.round(entry).toString(16).padStart(2, "0")).join("")}`,
    alpha: Math.max(0, Math.min(255, Number.isFinite(parsedAlpha) ? parsedAlpha : 255)),
  };
}

function filterColorValues(hex: string, alpha: number) {
  const rgb = hex.match(/[0-9a-f]{2}/gi)?.map((entry) => String(Number.parseInt(entry, 16))) || ["255", "255", "255"];
  return [...rgb, String(Math.max(0, Math.min(255, Math.round(alpha))))];
}

export function ToolkitPanel({ league }: { league: string }) {
  const [tab, setTab] = useState<ToolkitTab>("filter");
  return (
    <section className="toolkit-shell">
      <header className="toolkit-header">
        <div>
          <span>PLAYER TOOLKIT</span>
          <h1>PoE utilities, one workflow</h1>
          <p>Edits are explicit, reversible, and kept out of the game process.</p>
        </div>
        <div className="toolkit-safety"><ShieldCheck size={15} /> File-safe</div>
      </header>
      <nav className="toolkit-tabs" aria-label="Toolkit sections">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              type="button"
              key={entry.id}
              className={clsx(tab === entry.id && "is-active")}
              onClick={() => setTab(entry.id)}
            >
              <Icon size={15} />
              {entry.label}
            </button>
          );
        })}
      </nav>
      <div className="toolkit-content">
        {tab === "filter" && <FilterEditor />}
        {tab === "regex" && <RegexWorkbench />}
        {tab === "map-mods" && <MapModCheckPanel />}
        {tab === "mapping-journal" && <MappingJournalPanel league={league} />}
        {tab === "event-log" && <PoeEventLogPanel />}
        {tab === "cluster-back" && <ClusterBackPanel league={league} />}
        {tab === "recolor" && <SocketRecolorWorkbench league={league} />}
        {tab === "audit" && <EconomyAudit league={league} />}
        {tab === "workspace" && <OverlayWorkspace league={league} />}
      </div>
    </section>
  );
}

function FilterEditor() {
  const [file, setFile] = useState<ToolkitTextFile | null>(null);
  const [document, setDocument] = useState<ItemFilterDocument | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [currentItem, setCurrentItem] = useState<ParsedPoeItem | null>(null);
  const [intents, setIntents] = useState<FilterIntent[]>([]);
  const [checkpoints, setCheckpoints] = useState<ToolkitCheckpoint[]>([]);
  const [syncUrl, setSyncUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = document?.blocks.find((block) => block.id === selectedId) || null;
  const problems = document ? validateItemFilter(document) : [];
  const matches = useMemo(
    () =>
      document && currentItem
        ? findMatchingFilterBlocks(document, itemFacts(currentItem))
        : [],
    [currentItem, document],
  );

  const openFilter = async () => {
    setBusy(true);
    setMessage("");
    try {
      const opened = await bridge.openToolkitText("filter");
      if (!opened) return;
      const parsed = parseItemFilter(opened.text, itemFilterModeFromFileName(opened.name));
      setFile(opened);
      setDocument(parsed);
      setSelectedId(parsed.blocks[0]?.id || "");
      setIntents([]);
      setCheckpoints(await bridge.listToolkitCheckpoints(opened.path));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const changeFilterMode = (mode: ItemFilterMode) => {
    if (!document || document.mode === mode) return;
    setDocument(setItemFilterMode(document, mode));
    setMessage(`Mode changed to ${mode === "ruthless" ? "Ruthless" : "Normal"}. Existing blocks were not rewritten; fix any incompatible visibility or alpha rules explicitly. Saving uses ${itemFilterFileName(file?.name || "GloamCore.filter", mode)}.`);
  };

  const captureItem = async () => {
    setBusy(true);
    setMessage("");
    try {
      const capture = await bridge.readClipboardItem();
      const parsed = parsePoeItem(capture.text);
      if (!parsed.valid) throw new Error(parsed.errors[0] || "Copy an item in Path of Exile first.");
      setCurrentItem(parsed);
      const result = document
        ? findMatchingFilterBlocks(document, itemFacts(parsed)).find((entry) => entry.firstMatch)
        : undefined;
      if (result) setSelectedId(result.block.id);
      setMessage(result ? `Matched ${result.block.tier}.` : "No definitive block matched this item.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const editVisibility = (value: FilterVisibility) => {
    if (!document || !selected) return;
    try {
      setDocument(setBlockVisibility(document, selected.id, value));
      setIntents((current) => [
        ...current,
        { kind: "visibility", blockId: selected.id, tier: selected.tier, value, createdAt: Date.now() },
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const editAction = (action: string, values: string[]) => {
    if (!document || !selected) return;
    try {
      setDocument(setBlockAction(document, selected.id, action, values));
      setIntents((current) => [
        ...current,
        { kind: "action", blockId: selected.id, tier: selected.tier, action, values, createdAt: Date.now() },
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const removeAction = (action: string) => {
    if (!document || !selected) return;
    setDocument(removeBlockAction(document, selected.id, action));
    setIntents((current) => [
      ...current,
      { kind: "action", blockId: selected.id, tier: selected.tier, action, values: null, createdAt: Date.now() },
    ]);
  };

  const editExclusiveAction = (actions: string[], action: string | null, values: string[] = []) => {
    if (!document || !selected) return;
    let next = document;
    const createdAt = Date.now();
    const nextIntents: FilterIntent[] = [];
    for (const candidate of actions) {
      next = removeBlockAction(next, selected.id, candidate);
      nextIntents.push({ kind: "action", blockId: selected.id, tier: selected.tier, action: candidate, values: null, createdAt });
    }
    if (action) {
      next = setBlockAction(next, selected.id, action, values);
      nextIntents.push({ kind: "action", blockId: selected.id, tier: selected.tier, action, values, createdAt });
    }
    setDocument(next);
    setIntents((current) => [...current, ...nextIntents]);
  };

  const retierCurrentItem = (targetBlockId: string) => {
    if (!document || !selected || !currentItem?.baseType || targetBlockId === selected.id) return;
    const target = document.blocks.find((block) => block.id === targetBlockId);
    if (!target) return;
    const next = moveBaseType(document, selected.id, currentItem.baseType, target.id);
    if (next === document) {
      setMessage(`${currentItem.baseType} could not be moved safely. Verify that it is an explicit source BaseType and that every target BaseType condition accepts it.`);
      return;
    }
    setDocument(next);
    setIntents((current) => [
      ...current,
      {
        kind: "move-base",
        blockId: selected.id,
        tier: selected.tier,
        baseType: currentItem.baseType,
        targetTier: target.tier,
        targetBlockId: target.id,
        createdAt: Date.now(),
      },
    ]);
    setSelectedId(target.id);
    setMessage(`Moved ${currentItem.baseType} to ${target.tier}. Save to commit the change.`);
  };

  const save = async () => {
    if (!document) return;
    setBusy(true);
    setMessage("");
    try {
      if (problems.length) throw new Error(problems[0]);
      const overwritePath = file?.path && itemFilterFileMatchesMode(file.name, document.mode)
        ? file.path
        : undefined;
      if (overwritePath) await bridge.createToolkitCheckpoint({ path: overwritePath, label: "Before save" });
      const saved = await bridge.saveToolkitText({
        path: overwritePath,
        text: serializeItemFilter(document),
        suggestedName: itemFilterFileName(file?.name || "GloamCore.filter", document.mode),
        kind: "filter",
        filterMode: document.mode,
      });
      if (!saved) return;
      if (!itemFilterFileMatchesMode(saved.name, document.mode)) {
        throw new Error(`${document.mode === "ruthless" ? "Ruthless" : "Normal"} filters must be saved as ${ITEM_FILTER_EXTENSIONS[document.mode]}.`);
      }
      const text = serializeItemFilter(document);
      const nextFile = { path: saved.path, name: saved.name, text };
      const selectedIndex = document.blocks.findIndex((block) => block.id === selectedId);
      const reparsed = parseItemFilter(text, document.mode);
      setFile(nextFile);
      setDocument(reparsed);
      setSelectedId(reparsed.blocks[Math.max(0, selectedIndex)]?.id || reparsed.blocks[0]?.id || "");
      setMessage(overwritePath
        ? "Saved. The previous file is available as a checkpoint."
        : `Saved as ${saved.name}; the original file was not overwritten.`);
      if (saved.path) setCheckpoints(await bridge.listToolkitCheckpoints(saved.path));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const syncOnline = async () => {
    if (!syncUrl.trim() || !document) return;
    const mode = document.mode;
    setBusy(true);
    setMessage("");
    try {
      const remote = parseItemFilter(await bridge.fetchToolkitText(syncUrl.trim()), mode);
      if (!remote.blocks.length) throw new Error("The downloaded text is not a valid item filter.");
      const replay = replayFilterIntents(remote, intents);
      setDocument(replay.document);
      setSelectedId(replay.document.blocks[0]?.id || "");
      setMessage(
        `Update loaded: ${replay.applied.length} local edits replayed, ${replay.skipped.length} need review.${replay.skipped[0] ? ` ${replay.skipped[0].reason}` : ""}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const syncDownloadedOnlineFilter = async () => {
    if (!document) return;
    const mode = document.mode;
    setBusy(true);
    setMessage("");
    try {
      const opened = await bridge.openToolkitText("filter");
      if (!opened) return;
      const remote = parseItemFilter(opened.text, mode);
      if (!remote.blocks.length) throw new Error("The selected OnlineFilters file is not a valid item filter.");
      const replay = replayFilterIntents(remote, intents);
      setDocument(replay.document);
      setSelectedId(replay.document.blocks[0]?.id || "");
      setMessage(`Downloaded online source loaded: ${replay.applied.length} local edits replayed, ${replay.skipped.length} need review.${replay.skipped[0] ? ` ${replay.skipped[0].reason}` : ""} Save writes to your current local copy.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (checkpoint: ToolkitCheckpoint) => {
    if (!file?.path || !document) return;
    const mode = document.mode;
    setBusy(true);
    try {
      const restored = await bridge.restoreToolkitCheckpoint({ path: file.path, id: checkpoint.id });
      const parsed = parseItemFilter(restored.text, mode);
      setFile(restored);
      setDocument(parsed);
      setSelectedId(parsed.blocks[0]?.id || "");
      setIntents([]);
      setCheckpoints(await bridge.listToolkitCheckpoints(file.path));
      setMessage(`Restored ${checkpoint.label}. A before-restore checkpoint was created.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!document) {
    return (
      <div className="toolkit-empty">
        <FolderOpen size={34} />
        <h2>Open your active .filter or .ruthlessfilter</h2>
        <p>The filename selects Normal or Ruthless validation. Untouched and unknown lines are preserved.</p>
        <button type="button" onClick={openFilter} disabled={busy}><FolderOpen size={15} /> Choose filter</button>
      </div>
    );
  }

  const font = selected?.statements.find((entry) => entry.key === "SetFontSize")?.values[0] || "40";
  const action = (key: string) => selected?.statements.find((entry) => entry.key === key);
  const textColor = filterColor(action("SetTextColor")?.values, "#ffffff");
  const borderColor = filterColor(action("SetBorderColor")?.values, "#35d9b5");
  const backgroundColor = filterColor(action("SetBackgroundColor")?.values, "#111820");
  const alertSound = action("PlayAlertSound")?.values[0] || action("PlayAlertSoundPositional")?.values[0] || "";
  const minimap = action("MinimapIcon")?.values.join(" ") || "";
  const beam = action("PlayEffect")?.values[0] || "";
  const dropSound = action("DisableDropSound") ? "disable" : action("EnableDropSound") ? "enable" : "inherit";
  const fontRange = ITEM_FILTER_ACTION_SCHEMA.SetFontSize.numberRanges[0];
  const minimumTextAlpha = document.mode === "ruthless"
    ? ITEM_FILTER_ACTION_SCHEMA.SetTextColor.ruthlessAlphaMinimum
    : 0;
  const allowedVisibilities = ITEM_FILTER_VISIBILITY_MATRIX[document.mode];

  return (
    <div className="filter-workbench">
      <div className="toolkit-toolbar">
        <button type="button" onClick={openFilter} disabled={busy}><FolderOpen size={14} /> {file?.name || "Open"}</button>
        <button type="button" onClick={captureItem} disabled={busy}><Clipboard size={14} /> Read copied item</button>
        <button type="button" className="is-primary" onClick={save} disabled={busy || problems.length > 0}><Save size={14} /> Save safely</button>
        <label className="filter-mode-control">Mode<select value={document.mode} onChange={(event) => changeFilterMode(event.target.value as ItemFilterMode)}><option value="normal">Normal (.filter)</option><option value="ruthless">Ruthless (.ruthlessfilter)</option></select></label>
        <span>{document.blocks.length} blocks · {intents.length} local edits</span>
      </div>

      {message && <div className="toolkit-message"><CircleAlert size={14} /> {message}</div>}
      {problems.length > 0 && <div className="toolkit-message"><CircleAlert size={14} /> {problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}</div>}

      <div className="filter-grid">
        <aside className="filter-tier-list">
          <label><Search size={13} /> Filter tiers</label>
          {document.blocks.map((block, index) => {
            const match = matches.find((entry) => entry.block === block);
            return (
              <button
                type="button"
                key={`${block.id}-${index}`}
                className={clsx(selected === block && "is-active", match?.firstMatch && "is-match")}
                onClick={() => setSelectedId(block.id)}
              >
                <span>{block.tier}</span>
                <small>{block.visibility} · block {index + 1}{match?.firstMatch ? " · ITEM" : ""}</small>
              </button>
            );
          })}
        </aside>

        <div className="filter-editor-card">
          <div className="filter-item-hero">
            <div>
              <small>{currentItem ? currentItem.itemClass : "ACTIVE BLOCK"}</small>
              <h2>{currentItem?.name || currentItem?.baseType || selected?.tier}</h2>
              <p>{currentItem?.baseType || "Copy an item to identify its first definitive match."}</p>
            </div>
            <div className="filter-visibility">
              {(["Show", "Hide", "Minimal"] as FilterVisibility[]).map((value) => (
                <button type="button" key={value} className={selected?.visibility === value ? "is-active" : ""} disabled={!allowedVisibilities.includes(value)} title={!allowedVisibilities.includes(value) ? `${value} is not valid in ${document.mode === "ruthless" ? "Ruthless" : "Normal"} filters.` : undefined} onClick={() => editVisibility(value)}>{value}</button>
              ))}
            </div>
          </div>

          <div className="toolkit-form-grid">
            <label>
              Move copied base to tier
              <span className="select-wrap">
                <select value={selected?.id || ""} disabled={!currentItem?.baseType} onChange={(event) => retierCurrentItem(event.target.value)}>
                  {document.blocks.map((block, index) => <option key={block.id} value={block.id}>{block.tier} · block {index + 1}</option>)}
                </select>
                <ChevronDown size={13} />
              </span>
            </label>
            <label>
              Font size
              <input type="range" min={fontRange.min} max={fontRange.max} value={font} onChange={(event) => editAction("SetFontSize", [event.target.value])} />
              <strong>{font}</strong>
            </label>
            <label>
              Text colour / alpha
              <span className="filter-color-control"><input type="color" value={textColor.hex} onChange={(event) => editAction("SetTextColor", filterColorValues(event.target.value, Math.max(minimumTextAlpha, textColor.alpha)))} /><input type="number" min={minimumTextAlpha} max="255" value={textColor.alpha} onChange={(event) => editAction("SetTextColor", filterColorValues(textColor.hex, Number(event.target.value)))} /></span>
            </label>
            <label>
              Border colour / alpha
              <span className="filter-color-control"><input type="color" value={borderColor.hex} onChange={(event) => editAction("SetBorderColor", filterColorValues(event.target.value, borderColor.alpha))} /><input type="number" min="0" max="255" value={borderColor.alpha} onChange={(event) => editAction("SetBorderColor", filterColorValues(borderColor.hex, Number(event.target.value)))} /></span>
            </label>
            <label>
              Background / alpha
              <span className="filter-color-control"><input type="color" value={backgroundColor.hex} onChange={(event) => editAction("SetBackgroundColor", filterColorValues(event.target.value, backgroundColor.alpha))} /><input type="number" min="0" max="255" value={backgroundColor.alpha} onChange={(event) => editAction("SetBackgroundColor", filterColorValues(backgroundColor.hex, Number(event.target.value)))} /></span>
            </label>
            <label>
              Alert sound
              <select value={alertSound} onChange={(event) => event.target.value ? editExclusiveAction(["PlayAlertSound", "PlayAlertSoundPositional"], "PlayAlertSound", [event.target.value, "100"]) : editExclusiveAction(["PlayAlertSound", "PlayAlertSoundPositional"], null)}><option value="">None</option>{Array.from({ length: 16 }, (_, index) => <option key={index + 1} value={index + 1}>Built-in {index + 1}</option>)}</select>
            </label>
            <label>
              Minimap icon
              <select value={minimap} onChange={(event) => event.target.value ? editAction("MinimapIcon", event.target.value.split(" ")) : removeAction("MinimapIcon")}><option value="">None</option><option value="2 Red Star">Red star</option><option value="2 Yellow Diamond">Yellow diamond</option><option value="1 Green Circle">Green circle</option><option value="0 Blue Hexagon">Blue hexagon</option><option value="0 White Cross">White cross</option></select>
            </label>
            <label>
              Ground beam
              <select value={beam} onChange={(event) => event.target.value ? editAction("PlayEffect", [event.target.value, "Temp"]) : removeAction("PlayEffect")}><option value="">None</option>{["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink", "White", "Brown"].map((value) => <option key={value}>{value}</option>)}</select>
            </label>
            <label>
              Normal drop sound
              <select value={dropSound} onChange={(event) => event.target.value === "inherit" ? editExclusiveAction(["DisableDropSound", "EnableDropSound"], null) : editExclusiveAction(["DisableDropSound", "EnableDropSound"], event.target.value === "disable" ? "DisableDropSound" : "EnableDropSound")}><option value="inherit">Inherit</option><option value="enable">Enable</option><option value="disable">Disable</option></select>
            </label>
          </div>

          <div className="filter-style-preview" style={{ color: `${textColor.hex}${Math.round(textColor.alpha).toString(16).padStart(2, "0")}`, borderColor: `${borderColor.hex}${Math.round(borderColor.alpha).toString(16).padStart(2, "0")}`, background: `${backgroundColor.hex}${Math.round(backgroundColor.alpha).toString(16).padStart(2, "0")}`, fontSize: `${Math.max(11, Number(font) / 2)}px` }}><small>IN-GAME STYLE PREVIEW</small><strong>{currentItem?.name || currentItem?.baseType || selected?.tier}</strong><span>{alertSound ? `Sound ${alertSound}` : "No alert"}{minimap ? ` · ${minimap}` : ""}{beam ? ` · ${beam} beam` : ""}</span></div>

          <div className="filter-statements">
            <h3>Conditions and effects</h3>
            {selected?.statements.map((statement, index) => (
              <div key={`${statement.key}-${index}`}>
                <span>{statement.key}</span>
                <code>{statement.operator} {statement.values.join(" · ")}</code>
              </div>
            ))}
          </div>
        </div>

        <aside className="filter-side-card">
          <section>
            <h3><RefreshCw size={14} /> Online filter sync</h3>
            <p>Download a fresh source, then replay edits by block identity and tier—not old line numbers.</p>
            <input placeholder="https://www.pathofexile.com/..." value={syncUrl} onChange={(event) => setSyncUrl(event.target.value)} />
            <button type="button" onClick={syncOnline} disabled={busy || !syncUrl.trim()}>Check and replay</button>
            <button type="button" onClick={syncDownloadedOnlineFilter} disabled={busy}><FolderOpen size={13} /> Open in-game OnlineFilters source</button>
          </section>
          <section>
            <h3><History size={14} /> Checkpoints</h3>
            {checkpoints.length ? checkpoints.slice(0, 8).map((checkpoint) => (
              <button type="button" className="checkpoint-row" key={checkpoint.id} onClick={() => restore(checkpoint)}>
                <FileClock size={13} />
                <span>{checkpoint.label}<small>{new Date(checkpoint.createdAt).toLocaleString()}</small></span>
              </button>
            )) : <p>No checkpoints yet. Saving creates one automatically.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function SocketRecolorWorkbench({ league }: { league: string }) {
  const [input, setInput] = useState<SocketRecolorInput>({
    requirementStrength: 0,
    requirementDexterity: 0,
    requirementIntelligence: 0,
    itemLevel: 0,
    quality: 0,
    sockets: 0,
    red: 0,
    green: 0,
    blue: 0,
  });
  const [rates, setRates] = useState({ chromaticChaos: 1, trichromatismChaos: 300 });
  const [rateSource, setRateSource] = useState("Fallback assumptions — load the current league rates before comparing chaos cost.");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => calculateSocketRecipes(input, rates), [input, rates]);
  const chances = socketColourChances(input);
  const update = (key: keyof SocketRecolorInput, value: string) => setInput((current) => ({ ...current, [key]: numberValue(value) }));

  const readCopiedItem = async () => {
    setBusy(true);
    setMessage("");
    try {
      const capture = await bridge.readClipboardItem();
      const item = parsePoeItem(capture.text);
      if (!item.valid) throw new Error(item.errors[0] || "Copy a socketed Path of Exile item first.");
      const colors = item.sockets.flatMap((group) => group.colors).filter((color) => /^[RGBW]$/.test(color));
      if (!colors.length) throw new Error("The copied item has no recolourable R/G/B/W sockets.");
      setInput((current) => ({
        ...current,
        requirementStrength: 0,
        requirementDexterity: 0,
        requirementIntelligence: 0,
        itemLevel: item.itemLevel || 0,
        quality: item.quality || 0,
        sockets: colors.length,
        red: colors.filter((color) => color === "R").length,
        green: colors.filter((color) => color === "G").length,
        blue: colors.filter((color) => color === "B").length,
      }));
      setMessage(`Loaded ${item.baseType}: ${colors.length} recolourable sockets. Enter the base item's intrinsic Str/Dex/Int requirements; clipboard requirements can include socketed gems, so they are intentionally not guessed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const loadLiveRates = async () => {
    const currency = categories.find((entry) => entry.id === "currency");
    const omens = categories.find((entry) => entry.id === "omens");
    if (!currency || !omens) return;
    setBusy(true);
    setMessage("");
    try {
      const load = async (category: typeof currency) => {
        const source = defaultSource(category);
        const envelope = await bridge.getOverview({ league, type: category.apiType, source, force: true });
        return { rows: normalizeOverview(envelope.data, source, category).rows, stale: envelope.stale };
      };
      const [currencyResult, omenResult] = await Promise.all([load(currency), load(omens)]);
      const chromatic = currencyResult.rows.find((row) => row.name.toLowerCase() === "chromatic orb")?.chaosValue;
      const omen = omenResult.rows.find((row) => row.name.toLowerCase() === "omen of trichromatism")?.chaosValue;
      if (!(chromatic && chromatic > 0) || !(omen && omen > 0)) {
        throw new Error("The current economy feeds did not return both Chromatic Orb and Omen of Trichromatism prices.");
      }
      setRates({ chromaticChaos: chromatic, trichromatismChaos: omen });
      setRateSource(`${league} live economy rates${currencyResult.stale || omenResult.stale ? " (cached/stale)" : ""}.`);
      setMessage("Current Chromatic Orb and Omen rates loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="recolor-workbench">
      <section className="recolor-config">
        <div className="recolor-heading"><div><h2>3.29 socket recolor</h2><p>Public Siveran/Scalpel calculator-model estimates with white dilution, non-white crafts, and Trichromatism.</p></div><button type="button" onClick={() => void readCopiedItem()} disabled={busy}><Clipboard size={13} /> Read copied item</button></div>
        {message && <div className="toolkit-message"><CircleAlert size={14} /> {message}</div>}
        <div className="toolkit-form-grid recolor-fields">
          {([
            ["requirementStrength", "Strength req"],
            ["requirementDexterity", "Dexterity req"],
            ["requirementIntelligence", "Intelligence req"],
            ["itemLevel", "Item level"],
            ["quality", "Quality"],
            ["sockets", "Sockets"],
            ["red", "Wanted red"],
            ["green", "Wanted green"],
            ["blue", "Wanted blue"],
          ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" value={input[key]} min="0" max={key === "sockets" ? 6 : undefined} onChange={(event) => update(key, event.target.value)} /></label>)}
        </div>
        <div className="socket-chances">
          <span className="is-red">R {(chances.r * 100).toFixed(1)}%</span>
          <span className="is-green">G {(chances.g * 100).toFixed(1)}%</span>
          <span className="is-blue">B {(chances.b * 100).toFixed(1)}%</span>
          <span className="is-white">W {(chances.w * 100).toFixed(1)}%</span>
        </div>
        <p className="recolor-source-note">These are reference-calculator estimates, not independently measured game guarantees. Abyssal and resonator sockets are excluded. Desired R/G/B starts from the copied socket colours and remains editable.</p>
      </section>
      <section className="recolor-results">
        <div className="recolor-rate-heading"><div><strong>Cost assumptions</strong><small>{rateSource}</small></div><button type="button" onClick={() => void loadLiveRates()} disabled={busy}><RefreshCw size={13} /> Load live rates</button></div>
        <div className="recolor-rate-row">
          <label>Chromatic chaos <input type="number" step="0.01" value={rates.chromaticChaos} onChange={(event) => { setRates((current) => ({ ...current, chromaticChaos: numberValue(event.target.value) })); setRateSource("Manual rate assumptions."); }} /></label>
          <label>Omen chaos <input type="number" value={rates.trichromatismChaos} onChange={(event) => { setRates((current) => ({ ...current, trichromatismChaos: numberValue(event.target.value) })); setRateSource("Manual rate assumptions."); }} /></label>
        </div>
        <div className="recolor-table-head"><span>Method</span><span>Chance</span><span>Average</span><span>Chaos</span></div>
        {rows.map((row, index) => (
          <div className={clsx("recolor-row", index === 0 && row.averageChaos != null && "is-best")} key={row.key}>
            <span>{row.label}{index === 0 && row.averageChaos != null && <small>BEST</small>}</span>
            <span>{(row.chance * 100).toFixed(row.chance < 0.01 ? 3 : 1)}%</span>
            <span>{row.chromaticCost != null ? `${Math.ceil(row.chromaticCost)} chrom` : row.omenCost != null ? `${row.omenCost.toFixed(2)} omen` : `${row.averageAttempts.toFixed(1)} rolls`}</span>
            <strong>{row.averageChaos == null ? "—" : row.averageChaos.toFixed(1)}</strong>
          </div>
        ))}
        {!rows.length && <div className="toolkit-message"><CircleAlert size={14} /> Read a copied item, then enter its intrinsic base requirements and select at least one wanted colour.</div>}
      </section>
    </div>
  );
}

type EconomyToolView = "audit" | "dust" | "cards";

function EconomyAudit({ league }: { league: string }) {
  const [view, setView] = useState<EconomyToolView>("audit");
  const [categoryId, setCategoryId] = useState("divination-cards");
  const [rows, setRows] = useState<EconomyRow[]>([]);
  const [file, setFile] = useState<ToolkitTextFile | null>(null);
  const [document, setDocument] = useState<ItemFilterDocument | null>(null);
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [targetBlockId, setTargetBlockId] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dustBase, setDustBase] = useState("1");
  const [dustLevel, setDustLevel] = useState("84");
  const [dustQuality, setDustQuality] = useState("20");
  const [dustInfluences, setDustInfluences] = useState("0");
  const [cardWeights, setCardWeights] = useState<Record<string, number>>({});
  const [excludedCards, setExcludedCards] = useState<Set<string>>(new Set());

  const entries = useMemo(() => auditFilterEconomy(document, rows), [document, rows]);
  const tiers = useMemo(
    () => Array.from(new Set(document?.blocks.map((block) => block.tier) || [])),
    [document],
  );
  const visible = useMemo(
    () => filterAuditEntries(entries, {
      query,
      tier,
      minimumChaos: minimum === "" ? null : Number(minimum),
      maximumChaos: maximum === "" ? null : Number(maximum),
    }),
    [entries, maximum, minimum, query, tier],
  );
  const dustValue = calculateDustValue(Number(dustBase) || 0, {
    itemLevel: Number(dustLevel) || 0,
    quality: Number(dustQuality) || 0,
    influences: Number(dustInfluences) || 0,
  });
  const cardEv = divinationAreaExpectedValue(
    entries.map((entry) => ({
      chaosValue: entry.chaosValue,
      stackSize: rows.find((row) => row.key === entry.key)?.stackSize || 1,
      weight: cardWeights[entry.key] || 0,
      excluded: excludedCards.has(entry.key),
    })),
  );

  const openFilter = async () => {
    setBusy(true);
    try {
      const opened = await bridge.openToolkitText("filter");
      if (!opened) return;
      const parsed = parseItemFilter(opened.text, itemFilterModeFromFileName(opened.name));
      if (!parsed.blocks.length) throw new Error("This file has no valid item-filter blocks.");
      setFile(opened);
      setDocument(parsed);
      setTargetBlockId(parsed.blocks[0]?.id || "");
      setMessage(`Loaded ${parsed.blocks.length} filter blocks.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const loadMarket = async (requestedId = categoryId) => {
    const category = categories.find((entry) => entry.id === requestedId);
    if (!category) return;
    setBusy(true);
    setMessage("");
    try {
      const source = defaultSource(category);
      const envelope = await bridge.getOverview({
        league,
        type: category.apiType,
        source,
        force: true,
      });
      const normalized = normalizeOverview(envelope.data, source, category);
      setRows(normalized.rows);
      setSelectedKeys(new Set());
      setMessage(`${normalized.rows.length} live ${category.label.toLowerCase()} prices loaded for ${league}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const applyMoves = () => {
    if (!document || !targetBlockId) return;
    const target = document.blocks.find((block) => block.id === targetBlockId);
    if (!target) return;
    let next = document;
    const moved = new Set<string>();
    for (const entry of entries) {
      if (!selectedKeys.has(entry.key) || !entry.sourceBlockId || moved.has(entry.baseType)) continue;
      const candidate = moveBaseType(next, entry.sourceBlockId, entry.baseType, target.id);
      if (candidate !== next) moved.add(entry.baseType);
      next = candidate;
    }
    setDocument(next);
    setSelectedKeys(new Set());
    setMessage(moved.size
      ? `${moved.size} base type${moved.size === 1 ? "" : "s"} moved to ${target.tier}. Save to commit the changes.`
      : "No selected base could be moved safely; re-check its exact source and target blocks.");
  };

  const saveAudit = async () => {
    if (!document || !file) return;
    setBusy(true);
    try {
      if (file.path) {
        await bridge.createToolkitCheckpoint({ path: file.path, label: "Before economy audit" });
      }
      const text = serializeItemFilter(document);
      const saved = await bridge.saveToolkitText({
        path: file.path,
        text,
        suggestedName: itemFilterFileName(file.name, document.mode),
        kind: "filter",
        filterMode: document.mode,
      });
      if (saved) setFile({ ...file, ...saved, text });
      setMessage("Audit edits saved. The previous filter is available as a checkpoint.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const changeView = (next: EconomyToolView) => {
    setView(next);
    const nextCategory = next === "cards" ? "divination-cards" : next === "dust" ? "unique-armours" : categoryId;
    setCategoryId(nextCategory);
    if (next !== "audit") void loadMarket(nextCategory);
  };

  return (
    <div className="economy-audit">
      <div className="toolkit-subtabs">
        <button type="button" className={view === "audit" ? "is-active" : ""} onClick={() => changeView("audit")}><ChartNoAxesCombined size={14} /> Price audit</button>
        <button type="button" className={view === "dust" ? "is-active" : ""} onClick={() => changeView("dust")}><Pickaxe size={14} /> Dust explorer</button>
        <button type="button" className={view === "cards" ? "is-active" : ""} onClick={() => changeView("cards")}><Sparkles size={14} /> Div card EV</button>
      </div>

      {message && <div className="toolkit-message"><CircleAlert size={14} /> {message}</div>}

      {view === "audit" && (
        <>
          <div className="toolkit-toolbar audit-toolbar">
            <button type="button" onClick={openFilter} disabled={busy}><FolderOpen size={14} /> {file?.name || "Open filter"}</button>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
            <button type="button" onClick={() => loadMarket()} disabled={busy || !league}><RefreshCw size={14} /> Load live prices</button>
            <button type="button" className="is-primary" onClick={saveAudit} disabled={busy || !file || !document}><Save size={14} /> Save filter</button>
          </div>
          <div className="audit-controls">
            <label><Search size={13} /><input value={query} placeholder="Find item or base" onChange={(event) => setQuery(event.target.value)} /></label>
            <label>Current tier<select value={tier} onChange={(event) => setTier(event.target.value)}><option value="all">All tiers</option>{tiers.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Min chaos<input type="number" min="0" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
            <label>Max chaos<input type="number" min="0" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></label>
            <label>Move selected to<select value={targetBlockId} onChange={(event) => setTargetBlockId(event.target.value)}>{document?.blocks.map((block, index) => <option key={block.id} value={block.id}>{block.tier} · block {index + 1}</option>)}</select></label>
            <button type="button" onClick={applyMoves} disabled={!selectedKeys.size || !targetBlockId}>Apply {selectedKeys.size} reviewed moves</button>
          </div>
          <div className="audit-table-head"><span></span><span>Item / base</span><span>Live price</span><span>Current filter tier</span></div>
          <div className="audit-table">
            {visible.map((entry) => (
              <label key={entry.key} className={selectedKeys.has(entry.key) ? "is-selected" : ""}>
                <input type="checkbox" checked={selectedKeys.has(entry.key)} disabled={!entry.sourceBlockId} onChange={(event) => setSelectedKeys((current) => { const next = new Set(current); if (event.target.checked) next.add(entry.key); else next.delete(entry.key); return next; })} />
                <span>{entry.icon && <img src={entry.icon} alt="" />}<strong>{entry.name}</strong><small>{entry.baseType}</small></span>
                <span><strong>{entry.chaosValue.toFixed(entry.chaosValue < 10 ? 1 : 0)} c</strong><small>{entry.listingCount == null ? "exchange" : `${entry.listingCount} listings`}</small></span>
                <span className={entry.visibility === "Hide" || entry.ambiguityCount > 0 ? "is-hidden-tier" : ""}>{entry.ambiguityCount > 0 ? `${entry.ambiguityCount} explicit blocks` : entry.sourceTier || "Not explicitly tiered"}<small>{entry.ambiguityCount > 0 ? "Ambiguous — edit in Filter editor" : entry.visibility || "Needs review"}</small></span>
              </label>
            ))}
            {!visible.length && <div className="toolkit-empty compact"><ShieldCheck size={25} /><p>{rows.length ? "No rows match these audit controls." : "Load a category to compare live prices with your filter."}</p></div>}
          </div>
        </>
      )}

      {view === "dust" && (
        <div className="economy-explorer-grid">
          <section className="economy-calculator">
            <h2>Unique dust formula calculator</h2>
            <p>Applies the 65–84 item-level clamp plus entered quality and influence multipliers. Treat the result as an estimate unless the current base-dust coefficient and league formula have been independently verified.</p>
            <label>Base dust<input type="number" min="0" value={dustBase} onChange={(event) => setDustBase(event.target.value)} /></label>
            <label>Item level<input type="number" min="1" max="100" value={dustLevel} onChange={(event) => setDustLevel(event.target.value)} /></label>
            <label>Quality<input type="number" min="0" max="30" value={dustQuality} onChange={(event) => setDustQuality(event.target.value)} /></label>
            <label>Influences<input type="number" min="0" max="6" value={dustInfluences} onChange={(event) => setDustInfluences(event.target.value)} /></label>
            <output><small>DISENCHANT VALUE</small><strong>{dustValue.toLocaleString()} dust</strong></output>
          </section>
          <section className="economy-live-list"><h2>Live unique prices</h2>{entries.slice(0, 80).map((entry) => <div key={entry.key}>{entry.icon && <img src={entry.icon} alt="" />}<span>{entry.name}<small>{entry.baseType}</small></span><strong>{entry.chaosValue.toFixed(1)} c</strong></div>)}</section>
        </div>
      )}

      {view === "cards" && (
        <div className="card-ev-grid">
          <section className="card-ev-summary"><small>MANUAL WEIGHTED VALUE PER CARD DROP</small><strong>{cardEv.perDrop.toFixed(2)} chaos</strong><span>Total included weight: {cardEv.totalWeight.toLocaleString()}</span><p>Prices are live; area drop weights are manual because this build does not bundle a verified current area-weight dataset. Exclude suspicious prices without deleting the card.</p></section>
          <div className="card-ev-table">
            {entries.slice(0, 150).map((entry) => {
              const row = rows.find((candidate) => candidate.key === entry.key);
              return <div key={entry.key} className={excludedCards.has(entry.key) ? "is-excluded" : ""}>{entry.icon && <img src={entry.icon} alt="" />}<span><strong>{entry.name}</strong><small>{entry.chaosValue.toFixed(1)} c / stack {row?.stackSize || 1}</small></span><label>Weight<input type="number" min="0" value={cardWeights[entry.key] || ""} onChange={(event) => setCardWeights((current) => ({ ...current, [entry.key]: Number(event.target.value) || 0 }))} /></label><button type="button" onClick={() => setExcludedCards((current) => { const next = new Set(current); if (next.has(entry.key)) next.delete(entry.key); else next.add(entry.key); return next; })}>{excludedCards.has(entry.key) ? "Include" : "Outlier"}</button></div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type WorkspaceTab = "macros" | "cheats" | "whiteboard" | "themes" | "plugins";
type WhiteboardStroke = {
  id: string;
  tool: "free" | "highlighter" | "line" | "rect" | "circle" | "arrow" | "triangle" | "text" | "image" | "ruler" | "radius" | "mirror";
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
  text?: string;
  fontSize?: number;
  src?: string;
  source?: { x: number; y: number; w: number; h: number };
};
type WhiteboardSnapshot = { id: string; name: string; createdAt: number; strokes: unknown[] };

const EMPTY_WORKSPACE: ToolkitWorkspace = {
  version: 1,
  macros: [],
  cheatSheets: [],
  theme: { accent: "#35d9b5", background: "#080f14", density: "compact" },
  whiteboard: { strokes: [], snapshots: [] },
  overlayBounds: {},
  stashScroll: { enabled: false, modifier: "Ctrl" },
  plugins: [],
};

export function Whiteboard({
  strokes,
  onChange,
  snapshots = [],
  onSnapshotsChange,
  canImportImage = false,
  onError,
}: {
  strokes: unknown[];
  onChange: (strokes: WhiteboardStroke[]) => void;
  snapshots?: WhiteboardSnapshot[];
  onSnapshotsChange?: (snapshots: WhiteboardSnapshot[]) => void;
  canImportImage?: boolean;
  onError?: (message: string) => void;
}) {
  const [tool, setTool] = useState<WhiteboardStroke["tool"]>("free");
  const [color, setColor] = useState("#35d9b5");
  const [width, setWidth] = useState(3);
  const [textValue, setTextValue] = useState("Note");
  const [fontSize, setFontSize] = useState(24);
  const [snapshotName, setSnapshotName] = useState("");
  const [redo, setRedo] = useState<WhiteboardStroke[]>([]);
  const [liveFrame, setLiveFrame] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [draft, setDraft] = useState<WhiteboardStroke | null>(null);
  const safeStrokes = strokes.filter((entry): entry is WhiteboardStroke => Boolean(entry && typeof entry === "object" && Array.isArray((entry as WhiteboardStroke).points)));

  useEffect(() => {
    if (!safeStrokes.some((entry) => entry.tool === "mirror")) return undefined;
    let active = true;
    let timer = 0;
    const refresh = async () => {
      try {
        const frame = await bridge.captureToolkitGameWindow();
        if (active && frame) setLiveFrame(frame);
      } catch {
        // A mirror simply pauses while PoE is not the foreground window.
      }
      if (active) timer = window.setTimeout(refresh, 600);
    };
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [safeStrokes.some((entry) => entry.tool === "mirror")]);

  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * 1000, y: ((event.clientY - rect.top) / rect.height) * 600 };
  };
  const start = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const first = point(event);
    if (tool === "text") {
      if (!textValue.trim()) return;
      onChange([...safeStrokes, { id: crypto.randomUUID(), tool, color, width, points: [first], text: textValue.trim(), fontSize }].slice(-500));
      setRedo([]);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ id: crypto.randomUUID(), tool, color, width, points: [first] });
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    const next = point(event);
    setDraft((current) => !current ? null : {
      ...current,
      points: current.tool === "free" ? [...current.points, next] : [current.points[0], next],
    });
  };
  const finish = () => {
    if (draft && draft.points.length > 1) {
      let committed = draft;
      if (draft.tool === "mirror") {
        const first = draft.points[0];
        const last = draft.points.at(-1) || first;
        committed = {
          ...draft,
          source: {
            x: Math.max(0, Math.min(first.x, last.x) / 1000),
            y: Math.max(0, Math.min(first.y, last.y) / 600),
            w: Math.max(0.01, Math.abs(last.x - first.x) / 1000),
            h: Math.max(0.01, Math.abs(last.y - first.y) / 600),
          },
        };
      }
      onChange([...safeStrokes, committed].slice(-500));
      setRedo([]);
    }
    setDraft(null);
  };
  const renderStroke = (stroke: WhiteboardStroke) => {
    const first = stroke.points[0];
    const last = stroke.points.at(-1) || first;
    if (!first) return null;
    const x = Math.min(first.x, last.x);
    const y = Math.min(first.y, last.y);
    const w = Math.abs(last.x - first.x);
    const h = Math.abs(last.y - first.y);
    if (stroke.tool === "rect") return <rect key={stroke.id} x={x} y={y} width={w} height={h} />;
    if (stroke.tool === "circle" || stroke.tool === "radius") return <g key={stroke.id}><ellipse cx={(first.x + last.x) / 2} cy={(first.y + last.y) / 2} rx={w / 2} ry={h / 2} />{stroke.tool === "radius" && <text x={(first.x + last.x) / 2} y={(first.y + last.y) / 2} fill={stroke.color} stroke="none" textAnchor="middle" fontSize="18">r {Math.round(Math.max(w, h) / 2)}</text>}</g>;
    if (stroke.tool === "triangle") return <polygon key={stroke.id} points={`${(first.x + last.x) / 2},${y} ${x + w},${y + h} ${x},${y + h}`} />;
    if (stroke.tool === "text") return <text key={stroke.id} x={first.x} y={first.y} fill={stroke.color} stroke="none" fontSize={stroke.fontSize || 24}>{(stroke.text || "").split("\n").map((line, index) => <tspan key={index} x={first.x} dy={index ? "1.2em" : 0}>{line}</tspan>)}</text>;
    if (stroke.tool === "image" && stroke.src) return <image key={stroke.id} href={stroke.src} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" />;
    if (stroke.tool === "mirror") {
      const source = stroke.source || { x: x / 1000, y: y / 600, w: Math.max(0.01, w / 1000), h: Math.max(0.01, h / 600) };
      const clipId = `mirror-${stroke.id}`;
      return <g key={stroke.id}><defs><clipPath id={clipId}><rect x={x} y={y} width={w} height={h} /></clipPath></defs><rect x={x} y={y} width={w} height={h} fill="#0d1a20" />{liveFrame && <image href={liveFrame.dataUrl} x={x - (source.x / source.w) * w} y={y - (source.y / source.h) * h} width={w / source.w} height={h / source.h} clipPath={`url(#${clipId})`} preserveAspectRatio="none" />}<text x={x + 8} y={y + 20} fill={stroke.color} stroke="none" fontSize="14">{liveFrame ? "LIVE" : "PoE focus required"}</text></g>;
    }
    if (stroke.tool === "ruler") {
      const distance = Math.hypot(last.x - first.x, last.y - first.y);
      return <g key={stroke.id}><line x1={first.x} y1={first.y} x2={last.x} y2={last.y} /><line x1={first.x - 6} y1={first.y} x2={first.x + 6} y2={first.y} /><line x1={last.x - 6} y1={last.y} x2={last.x + 6} y2={last.y} /><text x={(first.x + last.x) / 2} y={(first.y + last.y) / 2 - 8} fill={stroke.color} stroke="none" textAnchor="middle" fontSize="17">{Math.round(distance)} px</text></g>;
    }
    if (stroke.tool === "line" || stroke.tool === "arrow") return <line key={stroke.id} x1={first.x} y1={first.y} x2={last.x} y2={last.y} markerEnd={stroke.tool === "arrow" ? "url(#whiteboard-arrow)" : undefined} />;
    const path = stroke.points.map((entry, index) => `${index ? "L" : "M"}${entry.x.toFixed(1)},${entry.y.toFixed(1)}`).join(" ");
    return <path key={stroke.id} d={path} opacity={stroke.tool === "highlighter" ? 0.35 : 1} />;
  };

  const importImage = async () => {
    try {
      const image = await bridge.openToolkitImage();
      if (!image) return;
      const element: WhiteboardStroke = { id: crypto.randomUUID(), tool: "image", color, width: 1, points: [{ x: 180, y: 90 }, { x: 820, y: 510 }], src: image.dataUrl };
      onChange([...safeStrokes, element].slice(-500));
      setRedo([]);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  };

  const undo = () => {
    const removed = safeStrokes.at(-1);
    if (!removed) return;
    setRedo((current) => [...current, removed].slice(-100));
    onChange(safeStrokes.slice(0, -1));
  };

  const redoStroke = () => {
    const restored = redo.at(-1);
    if (!restored) return;
    setRedo((current) => current.slice(0, -1));
    onChange([...safeStrokes, restored].slice(-500));
  };

  const saveSnapshot = () => {
    if (!onSnapshotsChange || !snapshotName.trim()) return;
    onSnapshotsChange([...snapshots, { id: crypto.randomUUID(), name: snapshotName.trim(), createdAt: Date.now(), strokes: safeStrokes }].slice(-24));
    setSnapshotName("");
  };
  return (
    <div className="whiteboard-workspace">
      <div className="whiteboard-tools">
        <select value={tool} onChange={(event) => setTool(event.target.value as WhiteboardStroke["tool"])}>{(["free", "highlighter", "line", "arrow", "rect", "circle", "triangle", "text", "ruler", "radius", "mirror"] as const).map((value) => <option key={value}>{value}</option>)}</select>
        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} title="Stroke colour" />
        <label>Width<input type="range" min="1" max="12" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label>
        {tool === "text" && <><input className="whiteboard-text-input" value={textValue} maxLength={4000} onChange={(event) => setTextValue(event.target.value)} /><input className="whiteboard-font-input" type="number" min="8" max="144" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value) || 24)} /></>}
        {canImportImage && <button type="button" onClick={() => { void importImage(); }}>Image</button>}
        <button type="button" onClick={undo} disabled={!safeStrokes.length}>Undo</button>
        <button type="button" onClick={redoStroke} disabled={!redo.length}>Redo</button>
        <button type="button" onClick={() => { setRedo([]); onChange([]); }}>Clear</button>
        {onSnapshotsChange && <div className="whiteboard-snapshots"><input value={snapshotName} placeholder="Snapshot" onChange={(event) => setSnapshotName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveSnapshot()} /><button type="button" disabled={!snapshotName.trim()} onClick={saveSnapshot}>Save</button><select defaultValue="" onChange={(event) => { const snapshot = snapshots.find((entry) => entry.id === event.target.value); if (snapshot) onChange(snapshot.strokes as WhiteboardStroke[]); event.target.value = ""; }}><option value="">Load snapshot…</option>{snapshots.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></div>}
      </div>
      <svg viewBox="0 0 1000 600" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
        <defs><pattern id="whiteboard-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="rgba(110,145,155,.12)" strokeWidth="1" /></pattern><marker id="whiteboard-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke" /></marker></defs>
        <rect width="1000" height="600" fill="url(#whiteboard-grid)" />
        {[...safeStrokes, ...(draft ? [draft] : [])].map((stroke) => <g key={stroke.id} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round">{renderStroke(stroke)}</g>)}
      </svg>
    </div>
  );
}

const PLUGIN_PROTOCOL = "gloamcore-plugin/v1";

function pluginMessage(value: unknown): { id: string; type: string; key?: string; value?: string; url?: string } | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (source.protocol !== PLUGIN_PROTOCOL) return null;
  const id = String(source.id || "").replace(/[\0\r\n]/g, "").slice(0, 80);
  const type = String(source.type || "").replace(/[\0\r\n]/g, "").slice(0, 80);
  if (!id || !type) return null;
  return {
    id,
    type,
    key: typeof source.key === "string" && source.key.length <= 80 ? source.key : undefined,
    value: typeof source.value === "string" && source.value.length <= 16 * 1024 ? source.value : undefined,
    url: typeof source.url === "string" && source.url.length <= 2048 ? source.url : undefined,
  };
}

function SandboxedPluginHost({
  plugin,
  league,
  onStorage,
}: {
  plugin: ToolkitPlugin;
  league: string;
  onStorage: (update: (storage: Record<string, string>) => Record<string, string>) => Promise<void>;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const reply = (id: string, ok: boolean, result?: unknown, error?: string) => {
      frame.current?.contentWindow?.postMessage({ protocol: PLUGIN_PROTOCOL, id, ok, result, error }, "*");
    };
    const listener = (event: MessageEvent) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow) return;
      const request = pluginMessage(event.data);
      if (!request) return;
      void (async () => {
        try {
          if (request.type === "hello" || request.type === "get-context") {
            reply(request.id, true, {
              host: "GloamCore",
              apiVersion: 1,
              pluginId: plugin.id,
              poeVersion: 1,
              league,
              capabilities: pluginCapabilities(),
              permissions: plugin.permissions,
            });
            return;
          }
          if (request.type === "get-leagues") {
            const leagues = await bridge.getLeagues();
            reply(request.id, true, leagues.data.map((entry) => entry.name));
            return;
          }
          if (request.type === "storage:get") {
            reply(request.id, true, request.key ? plugin.storage[request.key] ?? null : plugin.storage);
            return;
          }
          if (request.type === "storage:set") {
            if (!request.key || request.value == null) throw new Error("A storage key and string value are required.");
            await onStorage((storage) => ({ ...storage, [request.key!]: request.value! }));
            reply(request.id, true, true);
            return;
          }
          if (request.type === "storage:delete") {
            if (!request.key) throw new Error("A storage key is required.");
            await onStorage((storage) => {
              const next = { ...storage };
              delete next[request.key!];
              return next;
            });
            reply(request.id, true, true);
            return;
          }
          if (request.type === "get-current-item") {
            if (!plugin.permissions.currentItem) throw new Error("Current-item access is disabled for this plugin.");
            const capture = await bridge.readClipboardItem();
            reply(request.id, true, capture.validPrefix ? { capture, item: parsePoeItem(capture.text) } : null);
            return;
          }
          if (request.type === "capture-game") {
            if (!plugin.permissions.gameCapture) throw new Error("Game capture is disabled for this plugin.");
            reply(request.id, true, await bridge.captureToolkitGameWindow());
            return;
          }
          if (request.type === "open-external") {
            if (!plugin.permissions.openExternal) throw new Error("External-link access is disabled for this plugin.");
            if (!request.url || !trustedToolkitExternalUrl(request.url)) {
              throw new Error("Only trusted Path of Exile reference links can open outside the sandbox.");
            }
            await bridge.openExternal(request.url);
            reply(request.id, true, true);
            return;
          }
          throw new Error("Unsupported plugin request.");
        } catch (error) {
          reply(request.id, false, undefined, error instanceof Error ? error.message : String(error));
        }
      })();
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [league, onStorage, plugin]);

  const source = sandboxedPluginUrl(plugin.url);
  return source
    ? <iframe ref={frame} title={`Sandboxed toolkit plugin: ${plugin.name}`} src={source.toString()} sandbox="allow-scripts" referrerPolicy="no-referrer" />
    : <div className="planner-empty"><CircleAlert size={24} /><p>Enter a standard HTTPS plugin URL without credentials.</p></div>;
}

function OverlayWorkspace({ league }: { league: string }) {
  const [tab, setTab] = useState<WorkspaceTab>("macros");
  const [workspace, setWorkspace] = useState<ToolkitWorkspace>(EMPTY_WORKSPACE);
  const [persistedWorkspace, setPersistedWorkspace] = useState<ToolkitWorkspace | null>(null);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pluginPreview, setPluginPreview] = useState("");
  const workspaceRef = useRef(workspace);
  const persistedWorkspaceRef = useRef<ToolkitWorkspace | null>(persistedWorkspace);
  const workspaceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  workspaceRef.current = workspace;
  persistedWorkspaceRef.current = persistedWorkspace;

  function queueWorkspaceSave<T>(operation: () => Promise<T>) {
    const pending = workspaceSaveQueueRef.current.catch(() => undefined).then(operation);
    workspaceSaveQueueRef.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  useEffect(() => {
    let active = true;
    bridge.getToolkitWorkspace().then((value) => {
      if (!active) return;
      setWorkspace(value);
      setPersistedWorkspace(value);
    }).catch((error) => {
      if (active) setLoadError(error instanceof Error ? error.message : String(error));
    }).finally(() => active && setLoaded(true));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--teal", workspace.theme.accent);
    document.documentElement.style.setProperty("--bg-0", workspace.theme.background);
    document.documentElement.dataset.toolkitDensity = workspace.theme.density;
  }, [workspace.theme]);

  const save = async (next = workspace) => {
    try {
      const result = await queueWorkspaceSave(() => bridge.saveToolkitWorkspace(
        workspaceWithLatestPersistedPluginStorage(next, persistedWorkspaceRef.current),
      ));
      workspaceRef.current = result.workspace;
      persistedWorkspaceRef.current = result.workspace;
      setWorkspace(result.workspace);
      setPersistedWorkspace(result.workspace);
      setMessage(result.failures.length
        ? `${result.failures.length} macro shortcut${result.failures.length === 1 ? "" : "s"} could not register: ${result.failures[0].error}`
        : "Toolkit workspace saved and enabled.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const openOverlay = async (kind: "cheats" | "whiteboard") => {
    if (!(await save())) return;
    try {
      await bridge.showToolkitOverlay(kind);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const updateMacro = (id: string, patch: Partial<ToolkitWorkspace["macros"][number]>) => setWorkspace((current) => ({ ...current, macros: current.macros.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) }));
  const addMacro = () => setWorkspace((current) => ({ ...current, macros: [...current.macros, { id: crypto.randomUUID(), label: "Hideout", hotkey: "Ctrl+Alt+H", text: "/hideout", enabled: false }] }));
  const addSheet = () => setWorkspace((current) => ({ ...current, cheatSheets: [...current.cheatSheets, { id: crypto.randomUUID(), title: "New cheat sheet", category: "General", body: "Add reminders, encounter steps, or league notes here.", url: "", image: "", pinned: false }] }));
  const addPlugin = () => setWorkspace((current) => ({ ...current, plugins: [...current.plugins, {
    id: crypto.randomUUID(),
    name: "New plugin",
    url: "",
    enabled: false,
    permissions: { currentItem: false, gameCapture: false, openExternal: false },
    storage: {},
  }] }));
  const persistPluginStorage = (id: string, update: (storage: Record<string, string>) => Record<string, string>) => {
    const operation = queueWorkspaceSave(async () => {
      const savedBase = persistedWorkspaceRef.current;
      if (!savedBase) throw new Error("Save and enable this plugin before it can store data.");
      const plugin = savedBase.plugins.find((entry) => entry.id === id);
      if (!plugin) throw new Error("The saved plugin no longer exists.");
      const saved = await bridge.saveToolkitWorkspace(workspaceWithPersistedPluginStorage(savedBase, id, update(plugin.storage)));
      persistedWorkspaceRef.current = saved.workspace;
      setPersistedWorkspace(saved.workspace);
      setWorkspace((draft) => {
        const merged = mergePersistedPluginStorageIntoDraft(draft, saved.workspace, id);
        workspaceRef.current = merged;
        return merged;
      });
    });
    return operation.catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
      throw error;
    });
  };
  const importSheetImage = async (id: string) => {
    try {
      const image = await bridge.openToolkitImage();
      if (!image) return;
      setWorkspace((current) => ({ ...current, cheatSheets: current.cheatSheets.map((entry) => entry.id === id ? { ...entry, image: image.dataUrl } : entry) }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const recoverWorkspace = async () => {
    try {
      const recovered = await bridge.recoverToolkitWorkspace();
      workspaceRef.current = recovered.workspace;
      persistedWorkspaceRef.current = recovered.workspace;
      setWorkspace(recovered.workspace);
      setPersistedWorkspace(recovered.workspace);
      setLoadError("");
      setMessage(recovered.backupName
        ? `The invalid workspace was archived as ${recovered.backupName}. A clean workspace is ready.`
        : "A clean workspace is ready.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!loaded) return <div className="toolkit-empty"><RefreshCw className="is-spinning" size={30} /><p>Loading overlay workspace…</p></div>;
  if (loadError) return <div className="toolkit-empty"><CircleAlert size={30} /><p>{loadError}</p><button type="button" onClick={() => { void recoverWorkspace(); }}>Archive invalid workspace and start clean</button></div>;
  return (
    <div className="overlay-workspace">
      <div className="toolkit-subtabs workspace-subtabs">
        {([
          ["macros", MessageSquareText], ["cheats", StickyNote], ["whiteboard", PenLine], ["themes", Palette], ["plugins", Bot],
        ] as Array<[WorkspaceTab, typeof Bot]>).map(([value, Icon]) => <button type="button" key={value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}><Icon size={14} />{value}</button>)}
        <button type="button" className="workspace-save" onClick={() => save()}><Save size={14} /> Save & enable</button>
      </div>
      {message && <div className="toolkit-message"><CircleAlert size={14} />{message}</div>}

      {tab === "macros" && <div className="workspace-panel"><header><div><h2>Focus-gated chat macros</h2><p>One hotkey press sends one chat line only when Path of Exile is foreground. Nothing is injected into the game.</p></div><button type="button" onClick={addMacro}>Add macro</button></header><div className="stash-scroll-row"><label><input type="checkbox" checked={workspace.stashScroll.enabled} onChange={(event) => setWorkspace((current) => ({ ...current, stashScroll: { ...current.stashScroll, enabled: event.target.checked } }))} /> Scroll stash tabs with</label><select value={workspace.stashScroll.modifier} onChange={(event) => setWorkspace((current) => ({ ...current, stashScroll: { ...current.stashScroll, modifier: event.target.value as "Ctrl" | "Shift" | "Alt" } }))}><option>Ctrl</option><option>Shift</option><option>Alt</option></select><span>+ mouse wheel outside the stash grid. Off by default.</span></div><div className="macro-table"><div className="macro-head"><span>On</span><span>Label</span><span>Hotkey</span><span>Chat text</span><span></span></div>{workspace.macros.map((macro) => <div key={macro.id}><input type="checkbox" checked={macro.enabled} onChange={(event) => updateMacro(macro.id, { enabled: event.target.checked })} /><input value={macro.label} onChange={(event) => updateMacro(macro.id, { label: event.target.value })} /><input value={macro.hotkey} onChange={(event) => updateMacro(macro.id, { hotkey: event.target.value })} /><input value={macro.text} maxLength={512} onChange={(event) => updateMacro(macro.id, { text: event.target.value.replace(/[\r\n]/g, "") })} /><button type="button" onClick={() => setWorkspace((current) => ({ ...current, macros: current.macros.filter((entry) => entry.id !== macro.id) }))}><Trash2 size={13} /></button></div>)}{!workspace.macros.length && <p className="workspace-none">No macros are enabled by default. Add only the commands you actually want.</p>}</div></div>}

      {tab === "cheats" && (
        <div className="workspace-panel">
          <header>
            <div><h2>Cheat-sheet library</h2><p>Organize encounter steps, images, and trusted Path of Exile reference links. Pin only the sheets you want in the overlay.</p></div>
            <div className="workspace-header-actions"><button type="button" onClick={() => { void openOverlay("cheats"); }}>Open overlay</button><button type="button" onClick={addSheet}>Add sheet</button></div>
          </header>
          <div className="cheat-grid">
            {workspace.cheatSheets.map((sheet) => {
              const trustedUrl = sheet.url ? trustedToolkitExternalUrl(sheet.url) : null;
              return (
                <article key={sheet.id}>
                  {sheet.image && <img className="cheat-editor-image" src={sheet.image} alt="" />}
                  <div><input value={sheet.category} onChange={(event) => setWorkspace((current) => ({ ...current, cheatSheets: current.cheatSheets.map((entry) => entry.id === sheet.id ? { ...entry, category: event.target.value } : entry) }))} /><label><input type="checkbox" checked={sheet.pinned} onChange={(event) => setWorkspace((current) => ({ ...current, cheatSheets: current.cheatSheets.map((entry) => entry.id === sheet.id ? { ...entry, pinned: event.target.checked } : entry) }))} />Pinned</label></div>
                  <input className="cheat-title" value={sheet.title} onChange={(event) => setWorkspace((current) => ({ ...current, cheatSheets: current.cheatSheets.map((entry) => entry.id === sheet.id ? { ...entry, title: event.target.value } : entry) }))} />
                  <textarea value={sheet.body} onChange={(event) => setWorkspace((current) => ({ ...current, cheatSheets: current.cheatSheets.map((entry) => entry.id === sheet.id ? { ...entry, body: event.target.value } : entry) }))} />
                  <div><button type="button" className="cheat-image-button" onClick={() => { void importSheetImage(sheet.id); }}>{sheet.image ? "Replace image" : "Add image"}</button>{sheet.image && <button type="button" onClick={() => setWorkspace((current) => ({ ...current, cheatSheets: current.cheatSheets.map((entry) => entry.id === sheet.id ? { ...entry, image: "" } : entry) }))}>Remove</button>}</div>
                  <div>
                    <input value={sheet.url} placeholder="Trusted PoE reference URL" aria-invalid={Boolean(sheet.url && !trustedUrl)} onChange={(event) => setWorkspace((current) => ({ ...current, cheatSheets: current.cheatSheets.map((entry) => entry.id === sheet.id ? { ...entry, url: event.target.value } : entry) }))} />
                    {sheet.url && <button type="button" disabled={!trustedUrl} title={trustedUrl ? "Open trusted PoE reference" : "External links are limited to trusted PoE reference sites"} onClick={() => { if (trustedUrl) void bridge.openExternal(trustedUrl.toString()).catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }}><ExternalLink size={13} /></button>}
                    <button type="button" onClick={() => setWorkspace((current) => ({ ...current, cheatSheets: current.cheatSheets.filter((entry) => entry.id !== sheet.id) }))}><Trash2 size={13} /></button>
                  </div>
                  {sheet.url && !trustedUrl && <small className="workspace-link-error">Use poe.ninja, pathofexile.com, poewiki.net, Craft of Exile, or PoEDB.</small>}
                </article>
              );
            })}
            {!workspace.cheatSheets.length && <p className="workspace-none">Nothing is pinned by default.</p>}
          </div>
        </div>
      )}

      {tab === "whiteboard" && <div className="whiteboard-tab"><div className="whiteboard-open-row"><span>The overlay opens without taking focus from Path of Exile.</span><button type="button" onClick={() => { void openOverlay("whiteboard"); }}>Open live overlay</button></div><Whiteboard canImportImage onError={setMessage} strokes={workspace.whiteboard.strokes} snapshots={workspace.whiteboard.snapshots} onChange={(strokes) => setWorkspace((current) => ({ ...current, whiteboard: { ...current.whiteboard, strokes } }))} onSnapshotsChange={(snapshots) => setWorkspace((current) => ({ ...current, whiteboard: { ...current.whiteboard, snapshots } }))} /></div>}

      {tab === "themes" && <div className="theme-workspace"><section><h2>Theme palette</h2><p>Changes apply immediately and persist only after Save & enable.</p><label>Accent<input type="color" value={workspace.theme.accent} onChange={(event) => setWorkspace((current) => ({ ...current, theme: { ...current.theme, accent: event.target.value } }))} /></label><label>Base background<input type="color" value={workspace.theme.background} onChange={(event) => setWorkspace((current) => ({ ...current, theme: { ...current.theme, background: event.target.value } }))} /></label><label>Density<select value={workspace.theme.density} onChange={(event) => setWorkspace((current) => ({ ...current, theme: { ...current.theme, density: event.target.value as "compact" | "comfortable" } }))}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label></section><div className="theme-preview" style={{ background: workspace.theme.background, borderColor: workspace.theme.accent }}><small style={{ color: workspace.theme.accent }}>ACTIVE THEME</small><h3>Readable in the middle of a map</h3><p>High contrast panels, restrained colour, and your chosen accent.</p><button type="button" style={{ background: workspace.theme.accent }}>Primary action</button></div></div>}

      {tab === "plugins" && (
        <div className="workspace-panel">
          <header><div><h2>Permissioned plugin host</h2><p>Any standard HTTPS tool may run in an origin-isolated frame. Host APIs are opt-in; opening outside the sandbox is restricted to trusted Path of Exile reference sites.</p></div><button type="button" onClick={addPlugin}>Add plugin</button></header>
          <div className="plugin-grid">
            <aside>{workspace.plugins.map((plugin) => {
              const validPluginUrl = Boolean(sandboxedPluginUrl(plugin.url));
              const savedPlugin = persistedPluginForPreview(workspace, persistedWorkspace, plugin.id);
              return (
                <div key={plugin.id} className={pluginPreview === plugin.id ? "is-active" : ""}>
                  <input type="checkbox" checked={plugin.enabled} onChange={(event) => setWorkspace((current) => ({ ...current, plugins: current.plugins.map((entry) => entry.id === plugin.id ? { ...entry, enabled: event.target.checked } : entry) }))} />
                  <span><input value={plugin.name} onChange={(event) => setWorkspace((current) => ({ ...current, plugins: current.plugins.map((entry) => entry.id === plugin.id ? { ...entry, name: event.target.value } : entry) }))} /><input value={plugin.url} aria-invalid={Boolean(plugin.url && !validPluginUrl)} onChange={(event) => setWorkspace((current) => ({ ...current, plugins: current.plugins.map((entry) => entry.id === plugin.id ? { ...entry, url: event.target.value } : entry) }))} /></span>
                  <button type="button" disabled={!savedPlugin || !validPluginUrl} title={savedPlugin ? "Open saved plugin" : "Save and enable this exact plugin configuration first"} onClick={() => setPluginPreview(plugin.id)}>Open</button>
                  <button type="button" onClick={() => setWorkspace((current) => ({ ...current, plugins: current.plugins.filter((entry) => entry.id !== plugin.id) }))}><Trash2 size={12} /></button>
                  <section className="plugin-permissions">
                    <label><input type="checkbox" checked={plugin.permissions.currentItem} onChange={(event) => setWorkspace((current) => ({ ...current, plugins: current.plugins.map((entry) => entry.id === plugin.id ? { ...entry, permissions: { ...entry.permissions, currentItem: event.target.checked } } : entry) }))} /> Copied item</label>
                    <label><input type="checkbox" checked={plugin.permissions.gameCapture} onChange={(event) => setWorkspace((current) => ({ ...current, plugins: current.plugins.map((entry) => entry.id === plugin.id ? { ...entry, permissions: { ...entry.permissions, gameCapture: event.target.checked } } : entry) }))} /> Focused-game capture</label>
                    <label><input type="checkbox" checked={plugin.permissions.openExternal} onChange={(event) => setWorkspace((current) => ({ ...current, plugins: current.plugins.map((entry) => entry.id === plugin.id ? { ...entry, permissions: { ...entry.permissions, openExternal: event.target.checked } } : entry) }))} /> Open trusted PoE links</label>
                  </section>
                </div>
              );
            })}</aside>
            <main>{(() => { const plugin = persistedPluginForPreview(workspace, persistedWorkspace, pluginPreview); return plugin && sandboxedPluginUrl(plugin.url) ? <SandboxedPluginHost plugin={plugin} league={league} onStorage={(storage) => persistPluginStorage(plugin.id, storage)} /> : <div className="planner-empty"><Bot size={28} /><p>Save and enable an unchanged plugin before opening it.</p></div>; })()}</main>
          </div>
          <p className="plugin-api-note">Plugin messages use <code>{PLUGIN_PROTOCOL}</code>. Permissions stay off until you enable them and press Save &amp; enable. External-link requests accept only the desktop trusted PoE reference allowlist.</p>
        </div>
      )}
    </div>
  );
}
