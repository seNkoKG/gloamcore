import clsx from "clsx";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  ChevronDown,
  CircleGauge,
  Clipboard,
  Copy,
  Gem,
  FolderOpen,
  GitBranch,
  History,
  LoaderCircle,
  Maximize2,
  MoreHorizontal,
  Network,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Swords,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { bridge } from "../lib/bridge";
import {
  emptyPobBuild,
  enrichPobBuildWithCharacterAssets,
  importedPobGemArtworkKey,
  parsePobXml,
  pobStatCategory,
  pobStatLabel,
  pobStatPercent,
  itemsWithPassiveSpecLoadout,
  serializePobXml,
  specsWithActiveJewelLoadout,
  type ImportedPassiveSpec,
  type ImportedPobBuild,
  type ImportedPobItem,
} from "../lib/planner/pob-build";
import {
  ACTIVE_PLANNER_WORKSPACE_KEY,
  comparePlannerBuilds,
  createPlannerSnapshot,
  LEGACY_SAVED_PLANNER_BUILDS_KEYS,
  parseActivePlannerWorkspace,
  parseSavedPlannerBuilds,
  recoverSavedPlannerLibrary,
  SAVED_PLANNER_BUILDS_KEY,
  sanitizePlannerSnapshot,
  serializeActivePlannerWorkspace,
  serializeSavedPlannerBuilds,
  upsertSavedPlannerBuild,
  type PlannerWorkspaceTab,
  type PlannerWorkspaceSnapshot,
} from "../lib/planner/planner-workspace";
import { readMigratedStorage } from "../lib/storage-migration";
import { materializeImportedPassiveSpec, materializeImportedPassiveTree } from "../lib/planner/cluster-jewel-graph";
import { PlannerAsyncRevisionGuard, type PlannerAsyncRequestToken } from "../lib/planner/planner-async-guard";
import {
  jewelSocketOverlayName,
  timelessJewelSprites,
  timelessJewelVisual,
} from "../lib/planner/jewel-visuals";
import {
  allocatePassivePath,
  buildPassiveAllocationContext,
  classStartNode,
  countAllocatedPassivePoints,
  dependentAllocatedNodes,
  extendPassiveTracePath,
  isAllocatedClassConnected,
  retainConnectedAllocatedPassives,
  refundNodeAndDependents,
  searchPassiveNodes,
  shortestAllocationPath,
} from "../lib/planner/passive-graph";
import {
  orderedMasteryEffects,
  passiveTreeConnections,
  passiveTreeViewportWithCircles,
  resizedPassiveTreeViewport,
  visiblePassiveNodes,
} from "../lib/planner/passive-render";
import type {
  PassiveTreeData,
  PassiveTreeNodeData,
  PassiveTreeSpriteRect,
  PobEngineConfigInput,
  PobEngineDiagnostic,
  PobEngineGemCatalogEntry,
  PobEngineScalar,
  PobEngineSkillGroup,
  PobNodePower,
  PobTimelessAffectedNode,
  PobTimelessHuntResultEntry,
  PobTimelessModifierCatalogEntry,
  PoeCharacterImportRequest,
  PoeCharacterSummary,
  PlannerItemArtworkAsset,
  PlannerItemArtworkRequest,
} from "../types";
import {
  PlannerBuildsPanel,
  PlannerCalcsPanel,
  PlannerConfigPanel,
  PlannerItemsPanel,
  PlannerSkillsPanel,
  presentPlannerItem,
} from "./PlannerPanels";
import "../planner.css";

type PlannerTab = PlannerWorkspaceTab;
type Viewport = { x: number; y: number; scale: number };
type TreeSelection = { classId: number; ascendancyId: number; secondaryAscendancyId: number };
type TreeHistory = TreeSelection & { allocated: Set<number>; masteryEffects: Record<number, number>; label: string; at: number };
type TreeHover = { node: PassiveTreeNodeData; x: number; y: number; width: number; height: number };
type MasteryPicker = { nodeId: number; path: number[] };
type NodePowerMetric = "blend" | "offence" | "defence";
type TreeViewCommand = { action: "zoom-in" | "zoom-out" | "fit" | "focus"; nodeId?: number; nonce: number };

const PLANNER_TABS: PlannerTab[] = ["tree", "items", "skills", "config", "calcs", "builds", "notes", "history"];

async function resolvePlannerArtwork(items: PlannerItemArtworkRequest["items"]) {
  const sources = new Map<number, string>();
  const dimensions = new Map<number, Pick<PlannerItemArtworkAsset, "width" | "height">>();
  for (let offset = 0; offset < items.length; offset += 128) {
    const batch = await bridge.resolvePlannerItemArtwork({ items: items.slice(offset, offset + 128) });
    for (const [rawId, asset] of Object.entries(batch)) {
      if (typeof asset?.src === "string" && asset.src.startsWith("data:image/")) {
        const id = Number(rawId);
        sources.set(id, asset.src);
        if (asset.width && asset.height) dimensions.set(id, { width: asset.width, height: asset.height });
      }
    }
  }
  return { sources, dimensions };
}

function PlannerTabGlyph({ tab }: { tab: PlannerTab }) {
  switch (tab) {
    case "tree": return <GitBranch size={14}/>;
    case "items": return <Package size={14}/>;
    case "skills": return <Swords size={14}/>;
    case "config": return <Settings2 size={14}/>;
    case "calcs": return <Activity size={14}/>;
    case "builds": return <Boxes size={14}/>;
    case "notes": return <BookOpen size={14}/>;
    case "history": return <History size={14}/>;
  }
}

function railStat(build: ImportedPobBuild | null, ...names: string[]) {
  if (!build) return null;
  for (const name of names) {
    const stat = build.playerStats.find((candidate) => candidate.name === name);
    if (stat) return stat;
  }
  return null;
}

function railValue(stat: ReturnType<typeof railStat>, suffix = "") {
  if (!stat) return "—";
  if (stat.name === "CritMultiplier") return `${Number((stat.value * 100).toFixed(1)).toLocaleString("en-US")}%`;
  if (stat.name === "EffectiveMovementSpeedMod") {
    const percent = Number(((stat.value - 1) * 100).toFixed(1));
    return `${percent > 0 ? "+" : ""}${percent.toLocaleString("en-US")}%`;
  }
  const value = Math.abs(stat.value) >= 1000
    ? Math.round(stat.value).toLocaleString("en-US")
    : Number(stat.value.toFixed(Math.abs(stat.value) < 10 ? 2 : 1)).toLocaleString("en-US");
  return `${value}${stat.percent ? "%" : suffix}`;
}

function playerStatsFromEngine(stats: Record<string, PobEngineScalar>) {
  return Object.entries(stats)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .map(([name, value]) => ({
      name,
      label: pobStatLabel(name),
      value,
      category: pobStatCategory(name),
      percent: pobStatPercent(name),
    }));
}

function buildWithEngineCalculation(
  build: ImportedPobBuild,
  calculation: {
    stats: Record<string, PobEngineScalar>;
    mainSocketGroup: number | null;
    skillGroups: PobEngineSkillGroup[];
    items?: Array<{ id: number; raw: string; primarySlot: string }>;
    className?: string | null;
    ascendancyName?: string | null;
  },
) {
  const metadata = new Map(calculation.skillGroups.map((group) => [group.index, group]));
  return {
    ...build,
    className: calculation.className || build.className,
    ascendancyName: calculation.ascendancyName && calculation.ascendancyName !== "None"
      ? calculation.ascendancyName
      : build.ascendancyName,
    mainSocketGroup: calculation.mainSocketGroup || build.mainSocketGroup,
    skillGroups: build.skillGroups.map((group, index) => {
      const engineGroup = metadata.get(index + 1);
      return engineGroup ? {
        ...group,
        mainActiveSkill: engineGroup.mainActiveSkill,
        activeSkills: engineGroup.activeSkills.map((skill) => ({
          index: skill.index,
          name: skill.name,
          ...(skill.parts.length ? { parts: skill.parts } : {}),
          ...(skill.sourceGemIndex > 0 ? { sourceGemIndex: skill.sourceGemIndex } : {}),
          ...(skill.stages ? { stages: skill.stages } : {}),
          ...(skill.mine ? { mine: true } : {}),
          ...(skill.minions.length ? { minions: skill.minions } : {}),
          ...(skill.minionSkills.length ? { minionSkills: skill.minionSkills } : {}),
        })),
      } : group;
    }),
    playerStats: playerStatsFromEngine(calculation.stats),
    statSource: "pob-engine" as const,
  };
}

function PlannerStatRail({ build, collapsed, onCollapsed, onRecalculate, calculating }: {
  build: ImportedPobBuild | null;
  collapsed: boolean;
  onCollapsed: () => void;
  onRecalculate: () => void;
  calculating: boolean;
}) {
  const mainSkill = build?.skillGroups[Math.max(0, (build.mainSocketGroup || 1) - 1)]
    || build?.skillGroups.find((group) => group.enabled);
  const mainActiveSkill = mainSkill?.activeSkills?.find((skill) => skill.index === (mainSkill.mainActiveSkill || 1));
  const hasFullDpsGroups = Boolean(build?.skillGroups.some((group) => group.enabled && group.includeInFullDps));
  const sections = [
    { title: "Offence", rows: [
      [hasFullDpsGroups ? "Full DPS" : "Combined DPS", hasFullDpsGroups ? railStat(build, "FullDPS", "CombinedDPS") : railStat(build, "CombinedDPS", "TotalDPS")],
      ["Hit DPS", railStat(build, "TotalDPS")],
      ["Crit chance", railStat(build, "PreEffectiveCritChance", "CritChance")],
      ["Effective crit", railStat(build, "CritChance")],
      ["Crit multi", railStat(build, "CritMultiplier")],
      ["Rate", railStat(build, "Speed", "SpeedWithSlams")],
    ] },
    { title: "Defence", rows: [
      ["Armour", railStat(build, "Armour")],
      ["Evasion", railStat(build, "Evasion")],
      ["Attack block", railStat(build, "EffectiveBlockChance", "BlockChance")],
      ["Spell block", railStat(build, "EffectiveSpellBlockChance", "SpellBlockChance")],
      ["Suppression", railStat(build, "EffectiveSpellSuppressionChance", "SpellSuppressionChance")],
    ] },
    { title: "Recovery", rows: [
      ["Life regen", railStat(build, "LifeRegen", "LifeRegenRecovery")],
      ["Mana regen", railStat(build, "ManaRegen", "ManaRegenRecovery")],
      ["ES recharge", railStat(build, "EnergyShieldRecharge")],
      ["Move speed", railStat(build, "EffectiveMovementSpeedMod", "MovementSpeedMod")],
    ] },
    { title: "Resistances", rows: [
      ["Fire", railStat(build, "FireResist")],
      ["Cold", railStat(build, "ColdResist")],
      ["Lightning", railStat(build, "LightningResist")],
      ["Chaos", railStat(build, "ChaosResist")],
    ] },
  ];
  return <aside className={clsx("planner-stat-rail", collapsed && "is-collapsed")}>
    <button type="button" className="planner-stat-collapse" onClick={onCollapsed} title={collapsed ? "Show build statistics" : "Hide build statistics"}>
      {collapsed ? <PanelLeftOpen size={14}/> : <PanelLeftClose size={14}/>}
    </button>
    {!collapsed && <>
      <div className="planner-vitals">
        <span><strong>{railValue(railStat(build, "LifeUnreserved", "Life"))}</strong><small>Life</small></span>
        <span><strong>{railValue(railStat(build, "EnergyShield"))}</strong><small>ES</small></span>
        <span><strong>{railValue(railStat(build, "ManaUnreserved", "Mana"))}</strong><small>Mana</small></span>
      </div>
      <section className="planner-active-skill"><small>Main skill</small><strong>{mainActiveSkill?.name || mainSkill?.gems.find((gem) => gem.enabled && gem.support !== true && !/support/i.test(`${gem.skillId} ${gem.gemId || ""}`))?.name || mainSkill?.label || "No evaluated skill"}</strong></section>
      {!build?.playerStats.length && <button type="button" className="planner-stat-empty" onClick={onRecalculate} disabled={calculating || !build}>
        {calculating ? <LoaderCircle className="is-spinning" size={13}/> : <CircleGauge size={13}/>} Calculate build stats
      </button>}
      <div className="planner-stat-sections">{sections.map((section) => <section key={section.title}>
        <h3>{section.title}</h3>
        {section.rows.map(([label, stat]) => <div key={label as string}><span>{label as string}</span><strong>{railValue(stat as ReturnType<typeof railStat>)}</strong></div>)}
      </section>)}</div>
      <footer><span className={build?.statSource === "pob-engine" ? "is-live" : ""}/>{build?.statSource === "pob-engine" ? "Verified local PoB" : "Imported PoB snapshot"}</footer>
    </>}
  </aside>;
}

const TIMELESS_JEWELS = [
  { id: 1, name: "Glorious Vanity", faction: "Vaal", className: "vaal", seed: 100, variants: ["Xibaqua · Divine Flesh", "Doryani · Corrupted Soul", "Ahuana · Immortal Ambition"] },
  { id: 2, name: "Lethal Pride", faction: "Karui", className: "karui", seed: 10000, variants: ["Kaom · Strength of Blood", "Rakiata · Tempered by War", "Akoya · Chainbreaker"] },
  { id: 3, name: "Brutal Restraint", faction: "Maraketh", className: "maraketh", seed: 500, variants: ["Asenath · Dance with Death", "Nasima · Second Sight", "Balbala · The Traitor"] },
  { id: 4, name: "Militant Faith", faction: "Templar", className: "templar", seed: 2000, variants: ["Avarius · Power of Purpose", "Dominus · Inner Conviction", "Maxarius · Transcendence"] },
  { id: 5, name: "Elegant Hubris", faction: "Eternal", className: "eternal", seed: 2000, variants: ["Cadiro · Supreme Decadence", "Victario · Supreme Grandstanding", "Caspiro · Supreme Ostentation"] },
  { id: 6, name: "Heroic Tragedy", faction: "Kalguur", className: "kalguur", seed: 100, variants: ["Vorana · Black Scythe Training", "Uhtred · Celestial Mathematics", "Medved · The Unbreaking Circle"] },
] as const;

function TimelessLens({ tree, allocated, xml, engineReady, artwork, onClose, onFocus }: {
  tree: PassiveTreeData;
  allocated: ReadonlySet<number>;
  xml: string;
  engineReady: boolean;
  artwork: ReadonlyMap<number, string>;
  onClose: () => void;
  onFocus: (nodeId: number) => void;
}) {
  const sockets = useMemo(() => tree.nodes.filter((node) => node.jewelSocket && !node.ascendancyName).sort((left, right) => Number(allocated.has(right.id)) - Number(allocated.has(left.id)) || left.id - right.id), [allocated, tree.nodes]);
  const [jewelType, setJewelType] = useState(2);
  const [conquerorId, setConquerorId] = useState(1);
  const [socketId, setSocketId] = useState(sockets[0]?.id || 0);
  const [seed, setSeed] = useState(10000);
  const [scope, setScope] = useState<"allocated" | "reachable" | "radius">("reachable");
  const [maxPoints, setMaxPoints] = useState(5);
  const [catalog, setCatalog] = useState<PobTimelessModifierCatalogEntry[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [targets, setTargets] = useState<Record<string, { weight: number; weight2: number; minimum: number }>>({});
  const [results, setResults] = useState<PobTimelessHuntResultEntry[]>([]);
  const [affected, setAffected] = useState<PobTimelessAffectedNode[]>([]);
  const [selectedResult, setSelectedResult] = useState<string | null>(null);
  const [summary, setSummary] = useState("Loading official Path of Building modifier data…");
  const [loading, setLoading] = useState(false);
  const jewel = TIMELESS_JEWELS.find((entry) => entry.id === jewelType) || TIMELESS_JEWELS[1];

  useEffect(() => {
    setSeed(jewel.seed);
    setConquerorId(1);
    setTargets({});
    setResults([]);
    setAffected([]);
  }, [jewel.seed, jewelType]);

  useEffect(() => {
    if (!xml || !sockets.length || !engineReady) return;
    let active = true;
    setLoading(true);
    setSummary("Reading the verified PoB Timeless Jewel catalog…");
    bridge.huntPobTimeless({ xml, jewelType, socketId: socketId || sockets[0].id, targets: [], scope, maxPoints, maxResults: 50 })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setSummary(`${result.message}${result.detail ? ` ${result.detail}` : ""}`);
          return;
        }
        setCatalog(result.hunt.catalog);
        setSummary(`${result.hunt.catalog.length} official ${result.hunt.jewelName} outcomes · seeds ${result.hunt.minimumSeed.toLocaleString()}–${result.hunt.maximumSeed.toLocaleString()}${result.hunt.seedStep > 1 ? ` step ${result.hunt.seedStep}` : ""}`);
      })
      .catch((error) => active && setSummary(error instanceof Error ? error.message : String(error)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [engineReady, jewelType, maxPoints, scope, socketId, xml]);

  const runHunt = async () => {
    if (!Object.keys(targets).length) {
      setSummary("Choose at least one transformed or augmented modifier to rank seeds.");
      return;
    }
    setLoading(true);
    setResults([]);
    setAffected([]);
    setSummary(`Decoding and ranking every official seed in ${socketId ? "the selected socket" : `all ${sockets.length} tree sockets`}…`);
    try {
      const result = await bridge.huntPobTimeless({
        xml, jewelType, ...(socketId ? { socketId } : { socketIds: sockets.map((socket) => socket.id) }), scope, maxPoints, maxResults: 100,
        targets: Object.entries(targets).map(([id, target]) => ({ id, ...target })),
      });
      if (!result.ok) {
        setSummary(`${result.message}${result.detail ? ` ${result.detail}` : ""}`);
        return;
      }
      setResults(result.hunt.results);
      setSummary(`Ranked ${result.hunt.searchedSeeds.toLocaleString()} seed/socket combinations across ${result.hunt.socketCount} socket${result.hunt.socketCount === 1 ? "" : "s"} and ${result.hunt.candidateNodes} ${scope === "radius" ? "in-radius" : scope} passives in ${(result.durationMilliseconds / 1000).toFixed(2)}s.`);
    } catch (error) {
      setSummary(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const previewSeed = async (nextSeed = seed, nextSocketId = socketId) => {
    if (!nextSocketId) {
      setSummary("Choose one socket to decode directly, or run the hunt and open a ranked socket/seed result.");
      return;
    }
    setLoading(true);
    setSelectedResult(`${nextSocketId}:${nextSeed}`);
    setSeed(nextSeed);
    setSummary(`Decoding ${jewel.name} seed ${nextSeed.toLocaleString()} with PoB…`);
    try {
      const result = await bridge.previewPobTimeless({ xml, jewelType, conquerorId, socketId: nextSocketId, seed: nextSeed });
      if (!result.ok) {
        setSummary(`${result.message}${result.detail ? ` ${result.detail}` : ""}`);
        return;
      }
      setAffected(result.preview.affectedNodes);
      setSummary(`${result.preview.affectedNodes.length} exact transformations decoded from Path of Building ${result.engine.version} in ${(result.durationMilliseconds / 1000).toFixed(2)}s.`);
    } catch (error) {
      setSummary(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const filteredCatalog = catalog.filter((entry) => !catalogQuery || `${entry.name} ${entry.stats.join(" ")}`.toLowerCase().includes(catalogQuery.toLowerCase()));
  return <div className="timeless-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="timeless-lens" role="dialog" aria-modal="true" aria-labelledby="timeless-lens-title">
      <header><span><Gem size={17}/><span><small>GLOAMCORE · VERIFIED POB LUT</small><strong id="timeless-lens-title">Timeless Lens</strong></span></span><p>{summary}</p><button type="button" aria-label="Close Timeless Lens" onClick={onClose}><X size={15}/></button></header>
      <div className="timeless-grid">
        <aside className="timeless-jewel-picker"><h3>Choose lineage</h3>{TIMELESS_JEWELS.map((entry) => <button type="button" key={entry.id} className={jewelType === entry.id ? "is-active" : ""} onClick={() => setJewelType(entry.id)}><span className={`timeless-jewel-icon is-${entry.className}`}>{artwork.get(entry.id) ? <img src={artwork.get(entry.id)} alt="" draggable={false}/> : <Gem size={20}/>}</span><span><strong>{entry.name}</strong><small>{entry.faction}</small></span></button>)}
          <label>Conqueror<select value={conquerorId} onChange={(event) => setConquerorId(Number(event.target.value))}>{jewel.variants.map((variant, index) => <option key={variant} value={index + 1}>{variant}</option>)}</select></label>
          <label>Tree socket<select value={socketId} onChange={(event) => setSocketId(Number(event.target.value))}><option value={0}>All jewel sockets ({sockets.length})</option>{sockets.map((socket) => <option key={socket.id} value={socket.id}>{allocated.has(socket.id) ? "● " : ""}Jewel Socket #{socket.id}</option>)}</select></label>
          <div className="timeless-scope"><small>Candidate passives</small>{(["allocated", "reachable", "radius"] as const).map((value) => <button type="button" key={value} className={scope === value ? "is-active" : ""} onClick={() => setScope(value)}>{value}</button>)}</div>
          {scope === "reachable" && <label>Reachable within <input type="number" min="1" max="30" value={maxPoints} onChange={(event) => setMaxPoints(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}/><span>points</span></label>}
          <div className="timeless-seed-preview"><label>Inspect seed<input type="number" value={seed} step={jewelType === 5 ? 20 : 1} onChange={(event) => setSeed(Number(event.target.value) || jewel.seed)}/></label><button type="button" disabled={loading || !engineReady || !socketId} onClick={() => previewSeed()}>{loading ? <LoaderCircle className="is-spinning" size={12}/> : <Search size={12}/>} Decode seed</button></div>
        </aside>
        <main className="timeless-priorities">
          <header><span><strong>Weighted priorities</strong><small>{Object.keys(targets).length} selected · exact PoB IDs</small></span><button type="button" onClick={() => setTargets({})}>Clear</button></header>
          <div className="timeless-selected-targets">{Object.entries(targets).map(([id, target]) => { const entry = catalog.find((candidate) => candidate.id === id); if (!entry) return null; const hasSecondary = jewelType === 1 && entry.kind === "replacement" && entry.stats.length > 1; return <article key={id}><button type="button" aria-label={`Remove ${entry.name}`} onClick={() => setTargets((current) => { const next = { ...current }; delete next[id]; return next; })}><X size={11}/></button><span><strong>{entry.name}</strong><small>{entry.stats.join(" · ")}</small></span><label>Weight<input type="number" min="-1000" max="1000" step="0.25" value={target.weight} onChange={(event) => setTargets((current) => ({ ...current, [id]: { ...target, weight: Number(event.target.value) || 0 } }))}/></label><label className={!hasSecondary ? "is-disabled" : ""}>Weight 2<input type="number" min="-1000" max="1000" step="0.25" disabled={!hasSecondary} value={target.weight2} onChange={(event) => setTargets((current) => ({ ...current, [id]: { ...target, weight2: Number(event.target.value) || 0 } }))}/></label><label>Min weight<input type="number" min="0" max="100000" step="0.25" value={target.minimum} onChange={(event) => setTargets((current) => ({ ...current, [id]: { ...target, minimum: Number(event.target.value) || 0 } }))}/></label></article>; })}{!Object.keys(targets).length && <p>Select outcomes below. Primary/secondary weights rank exact rolls; minimum weight rejects results below a required contribution.</p>}</div>
          <label className="timeless-mod-search"><Search size={12}/><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search transformed and augmented modifiers…"/><small>{filteredCatalog.length}</small></label>
          <div className="timeless-mod-catalog">{filteredCatalog.map((entry) => <button type="button" key={entry.id} className={targets[entry.id] ? "is-selected" : ""} onClick={() => setTargets((current) => current[entry.id] ? current : { ...current, [entry.id]: { weight: 1, weight2: 0, minimum: 0 } })}><span><strong>{entry.name}</strong><small>{entry.stats.join(" · ")}</small></span><em>{entry.kind}</em><Plus size={11}/></button>)}</div>
          <button type="button" className="timeless-hunt-run" disabled={loading || !engineReady || !Object.keys(targets).length} onClick={runHunt}>{loading ? <LoaderCircle className="is-spinning" size={13}/> : <Sparkles size={13}/>} Hunt every official seed</button>
        </main>
        <aside className="timeless-results">
          <header><span><strong>{affected.length ? `Seed ${seed.toLocaleString()}` : "Ranked seeds"}</strong><small>{affected.length ? `${affected.filter((node) => node.allocated).length} allocated transformations` : `${results.length} best outcomes`}</small></span>{affected.length > 0 && <button type="button" onClick={() => setAffected([])}>Back to ranks</button>}</header>
          {affected.length ? <div className="timeless-transform-list">{affected.map((node) => <button type="button" key={node.id} className={node.allocated ? "is-allocated" : ""} onClick={() => onFocus(node.id)}><i/><span><small>{node.type} · #{node.id}{node.allocated ? " · allocated" : ""}</small><em>{node.name}</em><strong>{node.transformedName}</strong>{node.stats.map((stat) => <b key={stat}>{stat}</b>)}</span></button>)}</div> : <div className="timeless-rank-list">{results.map((result, index) => <button type="button" key={`${result.socketId}:${result.seed}`} className={selectedResult === `${result.socketId}:${result.seed}` ? "is-active" : ""} onClick={() => previewSeed(result.seed, result.socketId)}><em>#{index + 1}</em><span><strong>Seed {result.seed.toLocaleString()}</strong><small>Socket #{result.socketId} · {result.hits.map((hit) => `${hit.count}× ${hit.name}`).join(" · ")}</small></span><b>{Number(result.score.toFixed(2)).toLocaleString()}</b></button>)}{!results.length && <p>Select weighted priorities, choose the relevant allocation scope, then run the hunt. Results are decoded from PoB’s official seed lookup tables.</p>}</div>}
        </aside>
      </div>
    </section>
  </div>;
}

function passiveNodeKind(node: PassiveTreeNodeData) {
  if (node.classStartIds.length) return "Class start";
  if (node.isAscendancyStart) return "Ascendancy start";
  if (node.mastery) return "Mastery";
  if (node.keystone) return "Keystone";
  if (node.notable) return "Notable";
  if (node.jewelSocket) return "Jewel socket";
  return node.ascendancyName ? "Ascendancy passive" : "Passive";
}

function passiveRecipeLabel(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
}

export function PassiveNodeTooltip({
  hover,
  allocated,
  previewPath,
  dependents,
  socketedItem,
  usedMasteryEffects,
  radiusSummary,
  nodePower,
  selectedAscendancyName,
  selectedSecondaryName,
}: {
  hover: TreeHover;
  allocated: boolean;
  previewPath: readonly number[];
  dependents: ReadonlySet<number>;
  socketedItem: ImportedPobItem | null;
  usedMasteryEffects: ReadonlySet<number>;
  radiusSummary: string | null;
  nodePower?: PobNodePower | null;
  selectedAscendancyName: string;
  selectedSecondaryName: string;
}) {
  const { node } = hover;
  const gap = 14;
  const margin = 8;
  const leftRoom = Math.max(0, hover.x - gap - margin);
  const rightRoom = Math.max(0, hover.width - hover.x - gap - margin);
  const aboveRoom = Math.max(0, hover.y - gap - margin);
  const belowRoom = Math.max(0, hover.height - hover.y - gap - margin);
  const placeLeft = leftRoom >= rightRoom;
  const placeAbove = aboveRoom >= belowRoom;
  const orderedMasteryOptions = orderedMasteryEffects(node);
  const masteryOptions = orderedMasteryOptions.length;
  const availableMasteryOptions = orderedMasteryOptions.filter(({ id }) => (
    id === node.selectedMasteryEffect || !usedMasteryEffects.has(id)
  ));
  const socketView = socketedItem ? presentPlannerItem(socketedItem) : null;
  const switchesAscendancy = Boolean(node.ascendancyName) && (node.bloodline
    ? node.ascendancyName !== selectedSecondaryName
    : node.ascendancyName !== selectedAscendancyName);
  return (
    <div
      className="passive-tooltip"
      style={{
        ...(placeLeft ? { right: hover.width - hover.x + gap } : { left: hover.x + gap }),
        ...(placeAbove ? { bottom: hover.height - hover.y + gap } : { top: hover.y + gap }),
        maxWidth: Math.max(96, Math.min(310, placeLeft ? leftRoom : rightRoom)),
        maxHeight: Math.max(80, placeAbove ? aboveRoom : belowRoom),
      }}
      role="tooltip"
    >
      <header>
        <small>{passiveNodeKind(node).toLocaleUpperCase()}</small>
        <em className={allocated ? "is-allocated" : previewPath.length ? "is-preview" : ""}>
          {allocated ? "Allocated" : previewPath.length ? `${previewPath.length} point${previewPath.length === 1 ? "" : "s"}` : "Unallocated"}
        </em>
      </header>
      <strong>{node.name}</strong>
      <div className="passive-tooltip-mods">
        {node.stats.length
          ? node.stats.map((stat, index) => <span key={`${index}-${stat}`}>{stat}</span>)
          : <span className="is-muted">No direct modifiers</span>}
        {Boolean(node.grantedPassivePoints) && <span>Grants {node.grantedPassivePoints} Passive Skill Point{node.grantedPassivePoints === 1 ? "" : "s"}</span>}
      </div>
      {node.reminderText?.length ? <div className="passive-tooltip-reminder">{node.reminderText.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div> : null}
      {node.flavourText?.length ? <div className="passive-tooltip-flavour">{node.flavourText.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div> : null}
      {node.recipe?.length ? <section className="passive-tooltip-recipe"><small>Anoint recipe</small><b>{node.recipe.map(passiveRecipeLabel).join(" + ")}</b></section> : null}
      {node.mastery && !node.selectedMasteryEffect && availableMasteryOptions.length > 0 && <section className="passive-tooltip-mastery-options"><small>Available mastery options</small>{availableMasteryOptions.map(({ id, effect }) => <div key={id}><b>{effect.stats.join(" · ") || "Mastery effect"}</b>{effect.reminderText.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div>)}</section>}
      {socketedItem && socketView && (
        <section className="passive-tooltip-item">
          <small>{socketView.rarityLabel} socketed jewel</small>
          <b>{socketedItem.name}</b>
          {socketedItem.baseType !== socketedItem.name && <i>{socketedItem.baseType}</i>}
          {socketView.statuses.length > 0 && <div className="passive-tooltip-item-statuses">{socketView.statuses.map((status) => <em key={status}>{status}</em>)}</div>}
          {socketView.properties.length > 0 && <dl>{socketView.properties.map((property) => <div key={property.label}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl>}
          {socketView.modifiers.length > 0 && <div className="passive-tooltip-item-modifiers">{socketView.modifiers.map((modifier, index) => <span key={`${modifier.text}-${index}`}>{modifier.badges.length > 0 && <small>{modifier.badges.join(" · ")}</small>}{modifier.text}</span>)}</div>}
        </section>
      )}
      {radiusSummary && <section className="passive-tooltip-radius"><small>Jewel radius</small><span>{radiusSummary}</span></section>}
      {nodePower && <section className="passive-tooltip-power">
        <small>Exact PoB node power · {nodePower.distance} point{nodePower.distance === 1 ? "" : "s"}</small>
        <div><span>Combined DPS</span><b className={nodePower.offence >= 0 ? "is-positive" : "is-negative"}>{nodePower.offence >= 0 ? "+" : ""}{(nodePower.offence * 100).toFixed(2)}%</b></div>
        <div><span>Defence index</span><b className={nodePower.defence >= 0 ? "is-positive" : "is-negative"}>{nodePower.defence >= 0 ? "+" : ""}{(nodePower.defence * 100).toFixed(2)}%</b></div>
      </section>}
      <footer>
        {switchesAscendancy
          ? `Left-click switches to this ${node.bloodline ? "bloodline" : "ascendancy"}${node.bloodline ? "." : "; cross-class switches preserve the tree only when its class start is connected."}`
          : allocated && node.mastery
            ? "Left-click refunds this mastery. Right-click changes its selected effect."
          : allocated && !node.classStartIds.length
          ? `Left-click refunds ${dependents.size} allocated node${dependents.size === 1 ? "" : "s"}.`
          : previewPath.length
            ? `Left-click allocates this node and ${Math.max(0, previewPath.length - 1)} leading node${previewPath.length - 1 === 1 ? "" : "s"}.`
            : node.mastery
              ? "A mastery must be reached from an allocated adjacent passive."
              : "No legal path from the selected class tree."}
        {masteryOptions > 0 && <span>{node.selectedMasteryEffect ? "Selected mastery effect" : "Choose a mastery effect when allocating"} · {masteryOptions} option{masteryOptions === 1 ? "" : "s"}</span>}
        {node.multipleChoiceOption && <span>Allocating this choice refunds the other choice in its group.</span>}
        {node.isBlighted && <span>This is a Blight-only passive-tree variant.</span>}
      </footer>
    </div>
  );
}

const MAX_HISTORY = 120;

function normalizedTreeVersion(value: string | undefined) {
  const normalized = String(value || "").trim().replace(/\./g, "_").toLocaleLowerCase();
  const base = normalized.replace(/_(?:ruthless|alternate)(?:_(?:ruthless|alternate))*$/, "");
  return `${base}${/(?:^|_)ruthless(?:_|$)/.test(normalized) ? "_ruthless" : ""}${/(?:^|_)alternate(?:_|$)/.test(normalized) ? "_alternate" : ""}`;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function officialTreeUrl(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  classId: number,
  ascendancyId: number,
  secondaryAscendancyId: number,
) {
  const classStarts = new Set(tree.nodes.filter((node) => node.classStartIds.length > 0 || node.isAscendancyStart).map((node) => node.id));
  const ids = [...allocated].filter((id) => id > 0 && id < 65536 && !classStarts.has(id)).slice(0, 255);
  const bytes = new Uint8Array(7 + ids.length * 2 + 2);
  bytes.set([0, 0, 0, 6, classId, ((secondaryAscendancyId & 3) << 2) | (ascendancyId & 3), ids.length]);
  ids.forEach((id, index) => {
    bytes[7 + index * 2] = Math.floor(id / 256);
    bytes[8 + index * 2] = id % 256;
  });
  return `https://www.pathofexile.com/passive-skill-tree/${base64Url(bytes)}`;
}

function resolveRemoteBuildUrl(raw: string) {
  const url = new URL(raw);
  if (url.hostname === "pobb.in" && !url.pathname.endsWith("/raw")) url.pathname += "/raw";
  if ((url.hostname === "pastebin.com" || url.hostname === "www.pastebin.com") && !url.pathname.startsWith("/raw/")) {
    url.pathname = `/raw${url.pathname}`;
  }
  return url.toString();
}

function withSelectedPassiveStarts(
  tree: PassiveTreeData,
  source: Iterable<number>,
  classId: number,
  ascendancyId = 0,
  secondaryAscendancyId = 0,
) {
  const next = new Set(source);
  const start = classStartNode(tree, classId);
  if (start) next.add(start.id);
  const ascendancyName = tree.classes.find((entry) => entry.id === classId)
    ?.ascendancies.find((entry) => entry.id === ascendancyId)?.internalId;
  const secondaryName = tree.alternateAscendancies?.find((entry) => entry.id === secondaryAscendancyId)?.internalId;
  for (const name of [ascendancyName, secondaryName]) {
    if (!name) continue;
    const ascendancyStart = tree.nodes.find((node) => node.isAscendancyStart && node.ascendancyName === name);
    if (ascendancyStart) next.add(ascendancyStart.id);
  }
  return next;
}

function normalizedSpecAllocation(
  tree: PassiveTreeData,
  spec: ImportedPassiveSpec | null | undefined,
  items: readonly ImportedPobItem[],
  source: Iterable<number>,
  classId: number,
  ascendancyId = 0,
  secondaryAscendancyId = 0,
) {
  const materialized = materializeImportedPassiveTree(tree, spec, items);
  const next = withSelectedPassiveStarts(
    materialized.tree,
    source,
    classId,
    ascendancyId,
    secondaryAscendancyId,
  );
  for (const nodeId of materialized.mappedExtendedAllocations) next.add(nodeId);
  const selectedClass = tree.classes.find((entry) => entry.id === classId);
  const ascendancyName = selectedClass?.ascendancies.find((entry) => entry.id === ascendancyId)?.internalId;
  const secondaryName = tree.alternateAscendancies?.find((entry) => entry.id === secondaryAscendancyId)?.internalId;
  return retainConnectedAllocatedPassives(
    materialized.tree,
    next,
    classId,
    ascendancyName,
    secondaryName,
    buildPassiveAllocationContext(materialized.tree, spec, items),
  );
}

function PassiveTreeCanvas({
  tree,
  allocated,
  previewed,
  refundPreview,
  highlighted,
  hoveredId,
  classId,
  ascendancyName,
  secondaryAscendancyName,
  socketedItems,
  itemArtwork,
  powerScores,
  powerMetric,
  powerMax,
  viewCommand,
  onAllocate,
  onRefund,
  onMastery,
  onHover,
}: {
  tree: PassiveTreeData;
  allocated: ReadonlySet<number>;
  previewed: ReadonlySet<number>;
  refundPreview: ReadonlySet<number>;
  highlighted: ReadonlySet<number>;
  hoveredId: number | null;
  classId: number;
  ascendancyName: string;
  secondaryAscendancyName: string;
  socketedItems: ReadonlyMap<number, ImportedPobItem>;
  itemArtwork: ReadonlyMap<number, string>;
  powerScores: ReadonlyMap<number, PobNodePower> | null;
  powerMetric: NodePowerMetric;
  powerMax: Readonly<Record<string, number>>;
  viewCommand: TreeViewCommand | null;
  onAllocate: (node: PassiveTreeNodeData) => void;
  onRefund: (node: PassiveTreeNodeData) => void;
  onMastery: (node: PassiveTreeNodeData) => void;
  onHover: (node: PassiveTreeNodeData | null, point?: { x: number; y: number; width: number; height: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, scale: 0.03 });
  const [revision, setRevision] = useState(0);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const jewelImagesRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const drag = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);

  const visibleNodes = useMemo(
    () => visiblePassiveNodes(tree, ascendancyName, secondaryAscendancyName),
    [ascendancyName, secondaryAscendancyName, tree],
  );
  const connections = useMemo(() => passiveTreeConnections(visibleNodes), [visibleNodes]);
  const visibleGroupIds = useMemo(() => new Set(visibleNodes.map((node) => node.groupId)), [visibleNodes]);
  const visibleGroups = useMemo(
    () => (tree.groups || []).filter((group) => visibleGroupIds.has(group.id)),
    [tree.groups, visibleGroupIds],
  );
  const groupMap = useMemo(() => new Map(visibleGroups.map((group) => [group.id, group])), [visibleGroups]);
  const timelessCircles = useMemo(() => {
    const nodes = new Map(visibleNodes.map((node) => [node.id, node]));
    return [...socketedItems].flatMap(([nodeId, item]) => {
      const node = nodes.get(nodeId);
      const visual = allocated.has(nodeId) ? timelessJewelVisual(item) : null;
      return node && visual ? [{ x: node.x, y: node.y, radius: visual.radius }] : [];
    });
  }, [allocated, socketedItems, visibleNodes]);
  const powerMaximum = useMemo(() => {
    const scores = [...(powerScores?.values() || [])];
    if (powerMetric === "offence") return Math.max(0.000001, Number(powerMax.offence) || 0, ...scores.map((entry) => Math.max(0, entry.offence)));
    if (powerMetric === "defence") return Math.max(0.000001, Number(powerMax.defence) || 0, ...scores.map((entry) => Math.max(0, entry.defence)));
    return 2;
  }, [powerMax, powerMetric, powerScores]);

  useEffect(() => {
    let active = true;
    const images = new Map<string, HTMLImageElement>();
    imagesRef.current = images;
    for (const [sheet, source] of Object.entries(tree.assets?.sheets || {})) {
      const image = new Image();
      images.set(sheet, image);
      image.onload = image.onerror = () => active && setRevision((value) => value + 1);
      image.src = source.src;
    }
    setRevision((value) => value + 1);
    return () => {
      active = false;
      for (const image of images.values()) image.onload = image.onerror = null;
    };
  }, [tree.assets]);

  useEffect(() => {
    let active = true;
    const images = new Map<number, HTMLImageElement>();
    jewelImagesRef.current = images;
    for (const [nodeId, item] of socketedItems) {
      const source = item.icon || itemArtwork.get(item.id);
      if (!source) continue;
      const image = new Image();
      images.set(nodeId, image);
      image.onload = image.onerror = () => active && setRevision((value) => value + 1);
      image.src = source;
    }
    setRevision((value) => value + 1);
    return () => {
      active = false;
      for (const image of images.values()) image.onload = image.onerror = null;
    };
  }, [itemArtwork, socketedItems]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const view = viewportRef.current;
    const screen = (node: PassiveTreeNodeData) => ({ x: node.x * view.scale + view.x, y: node.y * view.scale + view.y });
    const isSelectedTree = (name: string | null | undefined) => (
      !name || name === ascendancyName || name === secondaryAscendancyName
    );
    const images = imagesRef.current;

    const background = tree.assets?.backgrounds.Background2;
    const backgroundImage = background && images.get(background.sheet);
    if (backgroundImage?.complete && backgroundImage.naturalWidth) {
      const pattern = context.createPattern(backgroundImage, "repeat");
      context.fillStyle = pattern || "#071016";
    } else {
      context.fillStyle = "#071016";
    }
    context.fillRect(0, 0, width, height);
    const vignette = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, "rgba(2,10,15,.04)");
    vignette.addColorStop(0.72, "rgba(2,9,13,.18)");
    vignette.addColorStop(1, "rgba(1,5,8,.66)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);

    const drawSprite = (
      sprite: PassiveTreeSpriteRect | null | undefined,
      x: number,
      y: number,
      options: { half?: boolean; opacity?: number } = {},
    ) => {
      if (!sprite) return false;
      const image = images.get(sprite.sheet);
      if (!image?.complete || !image.naturalWidth || sprite.w <= 0 || sprite.h <= 0) return false;
      const drawWidth = sprite.w * view.scale * 2.66;
      const drawHeight = sprite.h * view.scale * 2.66;
      if (drawWidth < 0.35 || drawHeight < 0.35) return false;
      context.save();
      context.globalAlpha *= options.opacity ?? 1;
      if (options.half) {
        context.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, x - drawWidth / 2, y - drawHeight, drawWidth, drawHeight);
        context.translate(0, 2 * y);
        context.scale(1, -1);
        context.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, x - drawWidth / 2, y - drawHeight, drawWidth, drawHeight);
      } else {
        context.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
      }
      context.restore();
      return true;
    };

    const drawSpriteSized = (
      sprite: PassiveTreeSpriteRect | null | undefined,
      x: number,
      y: number,
      size: number,
      rotation: number,
      opacity: number,
    ) => {
      if (!sprite || size < 0.35) return false;
      const image = images.get(sprite.sheet);
      if (!image?.complete || !image.naturalWidth || sprite.w <= 0 || sprite.h <= 0) return false;
      context.save();
      context.globalAlpha *= opacity;
      context.translate(x, y);
      context.rotate(rotation);
      context.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, -size / 2, -size / 2, size, size);
      context.restore();
      return true;
    };

    for (const group of visibleGroups) {
      const x = group.x * view.scale + view.x;
      const y = group.y * view.scale + view.y;
      if (x < -180 || x > width + 180 || y < -180 || y > height + 180) continue;
      if (group.ascendancyName && group.isAscendancyStart) {
        drawSprite(
          tree.assets?.ascendancies[`Classes${group.ascendancyName}`],
          x,
          y,
          { opacity: isSelectedTree(group.ascendancyName) ? 1 : 0.42 },
        );
      } else if (group.background) {
        drawSprite(
          tree.assets?.groupBackgrounds[group.background.image],
          x,
          y,
          { half: group.background.isHalfImage, opacity: 0.78 },
        );
      }
    }

    for (const [nodeId, item] of socketedItems) {
      if (!allocated.has(nodeId)) continue;
      const node = visibleNodes.find((entry) => entry.id === nodeId);
      const visual = timelessJewelVisual(item);
      if (!node || !visual) continue;
      const point = screen(node);
      const diameter = visual.radius * view.scale * 2;
      const sprites = timelessJewelSprites(tree.assets?.jewelRadii, visual);
      drawSpriteSized(sprites[0], point.x, point.y, diameter, -0.7, 0.7);
      drawSpriteSized(sprites[1], point.x, point.y, diameter, 0.7, 0.7);
    }

    for (const connection of connections) {
      const from = screen(connection.from);
      const to = screen(connection.to);
      if ((from.x < -30 && to.x < -30) || (from.x > width + 30 && to.x > width + 30) || (from.y < -30 && to.y < -30) || (from.y > height + 30 && to.y > height + 30)) continue;
      const active = allocated.has(connection.from.id) && allocated.has(connection.to.id);
      const refunding = active
        && (refundPreview.has(connection.from.id) || refundPreview.has(connection.to.id));
      context.save();
      context.globalAlpha = isSelectedTree(connection.from.ascendancyName) ? 1 : 0.42;
      const preview = !active
        && (allocated.has(connection.from.id) || previewed.has(connection.from.id))
        && (allocated.has(connection.to.id) || previewed.has(connection.to.id))
        && (previewed.has(connection.from.id) || previewed.has(connection.to.id));
      context.strokeStyle = refunding
        ? "rgba(255,91,91,.94)"
        : active
          ? "rgba(73,235,199,.88)"
        : preview
          ? "rgba(218,242,255,.92)"
          : "rgba(118,137,139,.24)";
      context.lineWidth = active || preview ? Math.max(1.35, view.scale * 31) : Math.max(0.7, view.scale * 15);
      context.beginPath();
      const group = connection.from.groupId === connection.to.groupId ? groupMap.get(connection.from.groupId || -1) : null;
      if (group && connection.from.orbit === connection.to.orbit && Number(connection.from.orbit) > 0) {
        const centerX = group.x * view.scale + view.x;
        const centerY = group.y * view.scale + view.y;
        const radius = Math.hypot(connection.from.x - group.x, connection.from.y - group.y) * view.scale;
        const start = Math.atan2(connection.from.y - group.y, connection.from.x - group.x);
        let end = Math.atan2(connection.to.y - group.y, connection.to.x - group.x);
        while (end - start > Math.PI) end -= Math.PI * 2;
        while (end - start < -Math.PI) end += Math.PI * 2;
        context.arc(centerX, centerY, radius, start, end, end < start);
      } else {
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
      }
      context.stroke();
      context.restore();
    }

    for (const node of visibleNodes) {
      const point = screen(node);
      if (point.x < -20 || point.x > width + 20 || point.y < -20 || point.y > height + 20) continue;
      const active = allocated.has(node.id);
      const preview = previewed.has(node.id);
      const refunding = refundPreview.has(node.id);
      const match = highlighted.has(node.id);
      const hovered = hoveredId === node.id;
      const start = node.classStartIds.includes(classId);
      const nodePower = powerScores?.get(node.id);
      context.save();
      context.globalAlpha = isSelectedTree(node.ascendancyName) ? 1 : 0.42;
      if (powerScores && !nodePower && !active && !start) context.globalAlpha *= 0.28;
      if (nodePower && !active) {
        const offenceMaximum = Math.max(0.000001, Number(powerMax.offence) || powerMaximum);
        const defenceMaximum = Math.max(0.000001, Number(powerMax.defence) || powerMaximum);
        const rawPower = powerMetric === "offence"
          ? nodePower.offence / powerMaximum
          : powerMetric === "defence"
            ? nodePower.defence / powerMaximum
            : (nodePower.offence / offenceMaximum) + (nodePower.defence / defenceMaximum);
        const intensity = Math.max(0, Math.min(1, rawPower));
        if (intensity > 0.005) {
          const heatRadius = Math.max(7, (node.keystone ? 132 : node.notable || node.mastery || node.jewelSocket ? 96 : 66) * view.scale);
          const hue = 24 + intensity * 142;
          context.beginPath();
          context.arc(point.x, point.y, heatRadius, 0, Math.PI * 2);
          context.fillStyle = `hsla(${hue},78%,55%,${0.08 + intensity * 0.3})`;
          context.fill();
          context.strokeStyle = `hsla(${hue},82%,68%,${0.35 + intensity * 0.6})`;
          context.lineWidth = 1 + intensity * 2;
          context.stroke();
        }
      }
      let rendered = false;
      if (node.classStartIds.length) {
        const className = tree.classes.find((entry) => node.classStartIds.includes(entry.id))?.name.toLowerCase().replace(/\s+/g, "") || "scion";
        rendered = drawSprite(
          active || start ? tree.assets?.startNodes[`center${className}`] : tree.assets?.startNodes.PSStartNodeBackgroundInactive,
          point.x,
          point.y,
        );
      } else if (node.isAscendancyStart) {
        rendered = drawSprite(tree.assets?.ascendancies.AscendancyMiddle, point.x, point.y);
      } else {
        rendered = drawSprite(active ? node.spriteActive : node.spriteInactive, point.x, point.y);
        if (!node.mastery) {
          const prefix = node.ascendancyName ? "Ascendancy" : node.keystone ? "Keystone" : node.notable ? "Notable" : node.jewelSocket ? "Jewel" : "PSSkill";
          const suffix = node.ascendancyName
            ? `${node.notable ? "FrameLarge" : "FrameSmall"}${active ? "Allocated" : preview ? "CanAllocate" : "Normal"}`
            : node.keystone
              ? `Frame${active ? "Allocated" : preview ? "CanAllocate" : "Unallocated"}`
              : node.notable
                ? `Frame${active ? "Allocated" : preview ? "CanAllocate" : "Unallocated"}`
                : node.jewelSocket
                  ? `Frame${active ? "Allocated" : preview ? "CanAllocate" : "Unallocated"}`
                  : `Frame${active ? "Active" : preview ? "Highlighted" : ""}`;
          const frameName = `${prefix}${suffix}`;
          rendered = drawSprite(tree.assets?.frames[frameName] || tree.assets?.ascendancies[frameName], point.x, point.y) || rendered;
        }
      }
      const socketedItem = node.jewelSocket ? socketedItems.get(node.id) : null;
      if (socketedItem && active) {
        const overlayName = jewelSocketOverlayName(
          socketedItem,
          Boolean(node.expansionJewel && node.expansionJewel.size < 2),
        );
        if (overlayName) rendered = drawSprite(tree.assets?.jewels[overlayName], point.x, point.y) || rendered;
      }
      const fallbackRadius = node.keystone ? 6 : node.notable || node.mastery ? 4.4 : node.jewelSocket ? 4 : 2.35;
      if (!rendered) {
        context.beginPath();
        context.arc(point.x, point.y, fallbackRadius, 0, Math.PI * 2);
        context.fillStyle = refunding ? "#ff5b5b" : active ? "#39dcb9" : preview ? "#d9f4ff" : match ? "#ffd76c" : start ? "#ef9f45" : node.ascendancyName ? "#8a6de9" : "#314551";
        context.fill();
      }
      const jewelImage = socketedItem && jewelImagesRef.current.get(node.id);
      if (jewelImage?.complete && jewelImage.naturalWidth) {
        const radius = Math.max(3.3, Math.min(20, 42 * view.scale * 2.66));
        context.save();
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.clip();
        context.fillStyle = "#071017";
        context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
        context.drawImage(jewelImage, point.x - radius, point.y - radius, radius * 2, radius * 2);
        context.restore();
        context.beginPath();
        context.arc(point.x, point.y, radius + .7, 0, Math.PI * 2);
        context.strokeStyle = active ? "rgba(230,255,248,.96)" : "rgba(156,174,182,.8)";
        context.lineWidth = Math.max(1, view.scale * 14);
        context.stroke();
      }
      if (active || preview || match || start || hovered) {
        const radius = Math.max(fallbackRadius + 1.5, (node.keystone ? 112 : node.notable || node.mastery || node.jewelSocket ? 78 : 55) * view.scale);
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.strokeStyle = refunding ? "rgba(255,91,91,.96)" : active ? "rgba(92,255,219,.86)" : preview ? "#e6f7ff" : match ? "#fff2bd" : hovered ? "#ffffff" : "#ffd8a3";
        context.lineWidth = match || hovered ? 2 : 1;
        context.stroke();
      }
      context.restore();
    }
  }, [allocated, ascendancyName, classId, connections, groupMap, highlighted, hoveredId, powerMax, powerMaximum, powerMetric, powerScores, previewed, refundPreview, secondaryAscendancyName, socketedItems, tree.assets, tree.classes, visibleGroups, visibleNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let previousSize = { width: 0, height: 0 };
    const resize = () => {
      const nextSize = { width: canvas.clientWidth, height: canvas.clientHeight };
      if (nextSize.width <= 0 || nextSize.height <= 0) return;
      if (previousSize.width > 0 && previousSize.height > 0) {
        if (nextSize.width === previousSize.width && nextSize.height === previousSize.height) return;
        viewportRef.current = resizedPassiveTreeViewport(viewportRef.current, previousSize, nextSize);
      } else {
        viewportRef.current = passiveTreeViewportWithCircles(tree, nextSize.width, nextSize.height, timelessCircles);
      }
      previousSize = nextSize;
      setRevision((value) => value + 1);
    };
    const fit = () => {
      previousSize = { width: canvas.clientWidth, height: canvas.clientHeight };
      if (previousSize.width <= 0 || previousSize.height <= 0) return;
      viewportRef.current = passiveTreeViewportWithCircles(tree, canvas.clientWidth, canvas.clientHeight, timelessCircles);
      setRevision((value) => value + 1);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    fit();
    return () => observer.disconnect();
  }, [ascendancyName, classId, secondaryAscendancyName, timelessCircles, tree.game, tree.sourcePath, tree.version]);

  useEffect(() => redraw(), [redraw, revision]);

  useEffect(() => {
    if (!viewCommand) return;
    const canvas = canvasRef.current;
    if (!canvas || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
    if (viewCommand.action === "fit") {
      viewportRef.current = passiveTreeViewportWithCircles(tree, canvas.clientWidth, canvas.clientHeight, timelessCircles);
    } else if (viewCommand.action === "focus") {
      const node = visibleNodes.find((entry) => entry.id === viewCommand.nodeId);
      if (!node) return;
      const baseScale = Math.min(canvas.clientWidth, canvas.clientHeight) / Math.max(1, Number(tree.size) || 24000);
      const scale = Math.max(viewportRef.current.scale, baseScale * 4.5);
      viewportRef.current = { scale, x: canvas.clientWidth / 2 - node.x * scale, y: canvas.clientHeight / 2 - node.y * scale };
    } else {
      const factor = viewCommand.action === "zoom-in" ? 1.35 : 1 / 1.35;
      const view = viewportRef.current;
      const centerX = canvas.clientWidth / 2;
      const centerY = canvas.clientHeight / 2;
      const worldX = (centerX - view.x) / view.scale;
      const worldY = (centerY - view.y) / view.scale;
      const baseScale = Math.min(canvas.clientWidth, canvas.clientHeight) / Math.max(1, Number(tree.size) || 24000);
      const scale = Math.min(baseScale * (1.2 ** 12), Math.max(baseScale, view.scale * factor));
      viewportRef.current = { scale, x: centerX - worldX * scale, y: centerY - worldY * scale };
    }
    onHover(null);
    setRevision((value) => value + 1);
  }, [onHover, timelessCircles, tree, viewCommand, visibleNodes]);

  const nearest = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const view = viewportRef.current;
    let best: PassiveTreeNodeData | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const node of visibleNodes) {
      const dx = node.x * view.scale + view.x - x;
      const dy = node.y * view.scale + view.y - y;
      const next = dx * dx + dy * dy;
      const spriteRadius = Math.max(
        node.keystone ? 7 : node.notable || node.mastery || node.jewelSocket ? 6 : 4,
        Math.min(34, (node.spriteActive?.w || node.spriteInactive?.w || (node.keystone ? 112 : node.notable || node.mastery || node.jewelSocket ? 78 : 55)) * view.scale * 1.33 + 3),
      );
      if (next <= spriteRadius * spriteRadius && next < distance) {
        best = node;
        distance = next;
      }
    }
    return best;
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, originX: viewportRef.current.x, originY: viewportRef.current.y, moved: false };
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = drag.current;
    if (active) {
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
      viewportRef.current = { ...viewportRef.current, x: active.originX + dx, y: active.originY + dy };
      setRevision((value) => value + 1);
      if (active.moved) {
        onHover(null);
        return;
      }
    }
    const node = nearest(event.clientX, event.clientY);
    const rect = event.currentTarget.getBoundingClientRect();
    onHover(node, { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height });
  };

  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = drag.current;
    drag.current = null;
    if (!active?.moved && event.button === 0) {
      const node = nearest(event.clientX, event.clientY);
      if (node) {
        if (allocated.has(node.id)) onRefund(node);
        else onAllocate(node);
      }
    }
  };

  const wheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const view = viewportRef.current;
    const worldX = (mouseX - view.x) / view.scale;
    const worldY = (mouseY - view.y) / view.scale;
    const baseScale = Math.min(rect.width, rect.height) / Math.max(1, Number(tree.size) || 24000);
    const scale = Math.min(baseScale * (1.2 ** 12), Math.max(baseScale, view.scale * Math.exp(-event.deltaY * 0.0012)));
    viewportRef.current = { scale, x: mouseX - worldX * scale, y: mouseY - worldY * scale };
    onHover(null);
    setRevision((value) => value + 1);
  };

  return (
    <canvas
      ref={canvasRef}
      className="passive-tree-canvas"
      tabIndex={0}
      aria-label="Interactive Path of Building passive tree. Drag to pan, use the mouse wheel to zoom, and use the search field to locate passives."
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => { drag.current = null; onHover(null); }}
      onPointerLeave={() => onHover(null)}
      onWheel={wheel}
      onDoubleClick={(event) => {
        viewportRef.current = passiveTreeViewportWithCircles(tree, event.currentTarget.clientWidth, event.currentTarget.clientHeight, timelessCircles);
        onHover(null);
        setRevision((value) => value + 1);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const node = nearest(event.clientX, event.clientY);
        if (node?.mastery && allocated.has(node.id)) onMastery(node);
      }}
    />
  );
}

export function BuildPlannerPanel() {
  const [tree, setTree] = useState<PassiveTreeData | null>(null);
  const [build, setBuild] = useState<ImportedPobBuild | null>(null);
  const [itemArtwork, setItemArtwork] = useState<Map<number, string>>(new Map());
  const [itemArtworkDimensions, setItemArtworkDimensions] = useState<Map<number, Pick<PlannerItemArtworkAsset, "width" | "height">>>(new Map());
  const [gemArtwork, setGemArtwork] = useState<Map<string, string>>(new Map());
  const [timelessArtwork, setTimelessArtwork] = useState<Map<number, string>>(new Map());
  const [specs, setSpecs] = useState<ImportedPassiveSpec[]>([]);
  const [activeSpecId, setActiveSpecId] = useState("");
  const [allocated, setAllocated] = useState<Set<number>>(new Set());
  const [classId, setClassId] = useState(0);
  const [ascendancyId, setAscendancyId] = useState(0);
  const [tab, setTab] = useState<PlannerTab>("tree");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<TreeHover | null>(null);
  const [traceMode, setTraceMode] = useState(false);
  const [tracePath, setTracePath] = useState<number[]>([]);
  const [masteryPicker, setMasteryPicker] = useState<MasteryPicker | null>(null);
  const [unsavedMasteryEffects, setUnsavedMasteryEffects] = useState<Record<number, number>>({});
  const [unsavedSecondaryAscendancyId, setUnsavedSecondaryAscendancyId] = useState(0);
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"pob" | "character">("pob");
  const [characterMode, setCharacterMode] = useState<"public" | "oauth">("public");
  const [accountName, setAccountName] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [realm, setRealm] = useState<PoeCharacterImportRequest["realm"]>("pc");
  const [characters, setCharacters] = useState<PoeCharacterSummary[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [history, setHistory] = useState<TreeHistory[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedBuilds, setSavedBuilds] = useState<PlannerWorkspaceSnapshot[]>([]);
  const [savedLibraryError, setSavedLibraryError] = useState("");
  const [recoveringSavedLibrary, setRecoveringSavedLibrary] = useState(false);
  const [activeSavedId, setActiveSavedId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [editedSinceImport, setEditedSinceImport] = useState(false);
  const [engineCapability, setEngineCapability] = useState<PobEngineDiagnostic | null>(null);
  const [gemCatalog, setGemCatalog] = useState<PobEngineGemCatalogEntry[]>([]);
  const [configCatalog, setConfigCatalog] = useState<PobEngineConfigInput[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [statRailCollapsed, setStatRailCollapsed] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [viewCommand, setViewCommand] = useState<TreeViewCommand | null>(null);
  const [powerMetric, setPowerMetric] = useState<NodePowerMetric>("blend");
  const [powerDepth, setPowerDepth] = useState(5);
  const [nodePowers, setNodePowers] = useState<PobNodePower[]>([]);
  const [nodePowerMax, setNodePowerMax] = useState<Record<string, number>>({});
  const [analyzingNodes, setAnalyzingNodes] = useState(false);
  const [analysisDrawerOpen, setAnalysisDrawerOpen] = useState(false);
  const [timelessOpen, setTimelessOpen] = useState(false);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const workspaceAutosaveLockedRef = useRef(false);
  const asyncGuardRef = useRef(new PlannerAsyncRevisionGuard());
  const plannerIdentityRef = useRef({ build, specs, activeSpecId, tree });
  plannerIdentityRef.current = { build, specs, activeSpecId, tree };

  useEffect(() => {
    let active = true;
    const items = (build?.items || [])
      .filter((item) => (!item.icon || !item.width || !item.height) && (item.name || item.baseType))
      .map((item) => ({ id: item.id, name: item.name, baseType: item.baseType }));
    setItemArtwork(new Map());
    setItemArtworkDimensions(new Map());
    if (!items.length) return () => { active = false; };
    void (async () => {
      const resolved = await resolvePlannerArtwork(items);
      if (active) {
        setItemArtwork(resolved.sources);
        setItemArtworkDimensions(resolved.dimensions);
      }
    })().catch(() => {
      if (active) {
        setItemArtwork(new Map());
        setItemArtworkDimensions(new Map());
      }
    });
    return () => { active = false; };
  }, [build?.items]);

  useEffect(() => {
    let active = true;
    const byKey = new Map((build?.skillGroups || []).flatMap((group) => group.gems).map((gem) => [importedPobGemArtworkKey(gem), gem]));
    const entries = [...byKey.entries()].filter(([, gem]) => !gem.icon);
    if (!entries.length) {
      setGemArtwork(new Map());
      return () => { active = false; };
    }
    void resolvePlannerArtwork(entries.map(([, gem], index) => ({
      id: index + 1,
      name: gem.name,
      metadataId: gem.gemId,
    }))).then((resolved) => {
      if (!active) return;
      setGemArtwork(new Map(entries.flatMap(([key], index) => {
        const source = resolved.sources.get(index + 1);
        return source ? [[key, source] as const] : [];
      })));
    }).catch(() => active && setGemArtwork(new Map()));
    return () => { active = false; };
  }, [build?.skillGroups]);

  useEffect(() => {
    let active = true;
    void resolvePlannerArtwork(TIMELESS_JEWELS.map((entry) => ({ id: entry.id, name: entry.name })))
      .then((resolved) => active && setTimelessArtwork(resolved.sources))
      .catch(() => active && setTimelessArtwork(new Map()));
    return () => { active = false; };
  }, []);

  const markPlannerChanged = () => asyncGuardRef.current.markChanged();
  const beginReplacement = () => asyncGuardRef.current.begin("replacement");
  const replacementCanApply = (token: PlannerAsyncRequestToken, action: string) => {
    const status = asyncGuardRef.current.inspect(token);
    if (status === "current") return true;
    if (status === "changed") setMessage(`The build changed while ${action}; the current workspace was kept.`);
    return false;
  };
  const reportReplacementError = (token: PlannerAsyncRequestToken, action: string, error: unknown) => {
    if (replacementCanApply(token, action)) setMessage(error instanceof Error ? error.message : String(error));
  };

  const initialiseTree = (value: PassiveTreeData, label: string) => {
    markPlannerChanged();
    const initialClassId = value.classes[0]?.id ?? 0;
    const start = classStartNode(value, initialClassId);
    const initial = new Set(start ? [start.id] : []);
    setTree(value);
    setBuild(null);
    setGemCatalog([]);
    setConfigCatalog([]);
    setSpecs([]);
    setActiveSpecId("");
    setUnsavedMasteryEffects({});
    setUnsavedSecondaryAscendancyId(0);
    setMasteryPicker(null);
    setTraceMode(false);
    setTracePath([]);
    setClassId(initialClassId);
    setAscendancyId(0);
    setAllocated(initial);
    setHistory([{ allocated: initial, masteryEffects: {}, classId: initialClassId, ascendancyId: 0, secondaryAscendancyId: 0, label, at: Date.now() }]);
    setHistoryIndex(0);
    setEditedSinceImport(false);
    setActiveSavedId("");
    setBaselineId("");
    setRealm(value.game === "poe2" ? "poe2" : "pc");
    setImportMode("pob");
    setCharacters([]);
  };

  useEffect(() => {
    try {
      const raw = readMigratedStorage(
        localStorage,
        SAVED_PLANNER_BUILDS_KEY,
        LEGACY_SAVED_PLANNER_BUILDS_KEYS,
      );
      setSavedBuilds(parseSavedPlannerBuilds(raw));
      setSavedLibraryError("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSavedLibraryError(detail);
      setMessage(`The local build library is locked: ${detail} Its original data was not changed. Open Builds to save an exact recovery copy and reset it.`);
    }
  }, []);

  useEffect(() => {
    if (tree?.game === "poe2" && importMode !== "pob") setImportMode("pob");
  }, [importMode, tree?.game]);

  useEffect(() => {
    let active = true;
    bridge.diagnosePobEngine()
      .then((result) => active && setEngineCapability(result))
      .catch((error) => active && setEngineCapability({
        ok: false,
        authoritative: false,
        available: false,
        capability: "unavailable",
        code: "POB_ENGINE_DIAGNOSTIC_FAILED",
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      }));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setTraceMode(true);
      if (event.key === "Escape") {
        setMasteryPicker(null);
        setImportOpen(false);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setTraceMode(false);
        setTracePath([]);
      }
    };
    const blur = () => {
      setTraceMode(false);
      setTracePath([]);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      let defaultTree: PassiveTreeData | null = null;
      try {
        defaultTree = await bridge.getPassiveTreeData({ game: "poe1" });
        if (!active) return;
        const raw = localStorage.getItem(ACTIVE_PLANNER_WORKSPACE_KEY);
        if (!raw) {
          initialiseTree(defaultTree, "New build");
          return;
        }

        let envelope: ReturnType<typeof parseActivePlannerWorkspace>;
        try {
          envelope = parseActivePlannerWorkspace(raw);
        } catch (error) {
          workspaceAutosaveLockedRef.current = true;
          throw error;
        }
        const snapshot = envelope.snapshot;
        const targetTree = defaultTree.game === snapshot.game
          && (!snapshot.treeVersion || normalizedTreeVersion(defaultTree.version) === normalizedTreeVersion(snapshot.treeVersion))
          ? defaultTree
          : await bridge.getPassiveTreeData({ game: snapshot.game, treeVersion: snapshot.treeVersion || undefined });
        if (!active) return;
        const snapshotSpecs = snapshot.specs.map((spec) => materializeImportedPassiveSpec(targetTree, spec, snapshot.build?.items || []).spec);
        const snapshotSpec = snapshotSpecs.find((entry) => entry.id === snapshot.activeSpecId) || snapshotSpecs[0] || null;
        const restored = normalizedSpecAllocation(
          targetTree,
          snapshotSpec,
          snapshot.build?.items || [],
          snapshot.allocated,
          snapshot.classId,
          snapshot.ascendancyId,
          snapshotSpec?.secondaryAscendClassId || 0,
        );
        setTree(targetTree);
        setBuild(snapshot.build ? { ...snapshot.build, items: itemsWithPassiveSpecLoadout(snapshot.build.items, snapshotSpec) } : null);
        setGemCatalog([]);
        setConfigCatalog([]);
        setSpecs(snapshotSpecs);
        setActiveSpecId(snapshotSpec?.id || "");
        setUnsavedMasteryEffects({ ...(snapshotSpec?.masteryEffects || {}) });
        setUnsavedSecondaryAscendancyId(snapshotSpec?.secondaryAscendClassId || 0);
        setClassId(snapshot.classId);
        setAscendancyId(snapshot.ascendancyId);
        setAllocated(restored);
        setHistory([{ allocated: restored, masteryEffects: { ...(snapshotSpec?.masteryEffects || {}) }, classId: snapshot.classId, ascendancyId: snapshot.ascendancyId, secondaryAscendancyId: snapshotSpec?.secondaryAscendClassId || 0, label: "Restored session", at: Date.now() }]);
        setHistoryIndex(0);
        setEditedSinceImport(snapshot.editedSinceImport);
        setRealm(targetTree.game === "poe2" ? "poe2" : "pc");
        setTab(envelope.tab);
        setMessage(`Restored ${snapshot.name} from the last planner session.`);
      } catch (error) {
        if (!active) return;
        if (defaultTree) initialiseTree(defaultTree, "New build");
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) {
          setWorkspaceHydrated(true);
          setBusy(false);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workspaceHydrated || !tree || workspaceAutosaveLockedRef.current) return undefined;
    const timer = window.setTimeout(() => {
      const effectiveSpecs = specs.length ? specs : [{
        id: "current",
        title: "Current tree",
        treeVersion: tree.version,
        classId,
        ascendClassId: ascendancyId,
        secondaryAscendClassId: unsavedSecondaryAscendancyId,
        nodes: [...allocated],
        masteryEffects: { ...unsavedMasteryEffects },
      } satisfies ImportedPassiveSpec];
      const snapshot = createPlannerSnapshot({
        id: "active-workspace",
        name: build ? `${build.ascendancyName || build.className} · Level ${build.level}` : "Active planner workspace",
        game: tree.game,
        treeVersion: tree.version,
        build,
        specs: effectiveSpecs,
        activeSpecId: activeSpecId || effectiveSpecs[0].id,
        classId,
        ascendancyId,
        allocated,
        editedSinceImport,
      });
      try {
        localStorage.setItem(ACTIVE_PLANNER_WORKSPACE_KEY, serializeActivePlannerWorkspace(snapshot, tab));
      } catch (error) {
        workspaceAutosaveLockedRef.current = true;
        setMessage(`The active planner workspace could not be autosaved: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [activeSpecId, allocated, ascendancyId, build, classId, editedSinceImport, specs, tab, tree, unsavedMasteryEffects, unsavedSecondaryAscendancyId, workspaceHydrated]);

  const changeGame = async (game: "poe1" | "poe2") => {
    if (game === tree?.game) return;
    const hasWorkspaceToReplace = Boolean(build || specs.length || editedSinceImport || historyIndex > 0);
    if (hasWorkspaceToReplace && !window.confirm(
      `Switch to ${game === "poe2" ? "PoE 2" : "PoE 1"}? The current unsaved workspace will be replaced. Save it first if you want to keep it.`,
    )) return;
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    setMessage("");
    try {
      const value = await bridge.getPassiveTreeData({ game });
      if (!replacementCanApply(request, "the game tree was loading")) return;
      initialiseTree(value, `New ${game === "poe2" ? "PoE 2" : "PoE 1"} build`);
      setMessage(`${game === "poe2" ? "PoE 2" : "PoE 1"} tree ${value.version.replace("_", ".")} loaded.`);
    } catch (error) {
      reportReplacementError(request, "the game tree was loading", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const activePassiveSpec = specs.find((entry) => entry.id === activeSpecId) || null;
  const secondaryAscendancyId = activePassiveSpec?.secondaryAscendClassId ?? unsavedSecondaryAscendancyId;
  const materializationSpec = useMemo(() => activePassiveSpec || (tree ? {
    id: "current",
    title: "Current tree",
    treeVersion: tree.version,
    classId,
    ascendClassId: ascendancyId,
    secondaryAscendClassId: unsavedSecondaryAscendancyId,
    nodes: [...allocated],
    masteryEffects: unsavedMasteryEffects,
  } : null), [activePassiveSpec, allocated, ascendancyId, classId, tree, unsavedMasteryEffects, unsavedSecondaryAscendancyId]);
  const treeMatchesActiveSpec = !materializationSpec?.treeVersion || normalizedTreeVersion(tree?.version) === normalizedTreeVersion(materializationSpec.treeVersion);
  const materializedTree = useMemo(
    () => tree && treeMatchesActiveSpec ? materializeImportedPassiveTree(tree, materializationSpec, build?.items || []).tree : null,
    [build?.items, materializationSpec, tree, treeMatchesActiveSpec],
  );
  const currentClass = tree?.classes.find((entry) => entry.id === classId) || tree?.classes[0];
  const currentAscendancy = currentClass?.ascendancies.find((entry) => entry.id === ascendancyId);
  const secondaryAscendancyName = tree?.alternateAscendancies?.find(
    (entry) => entry.id === secondaryAscendancyId,
  )?.internalId || "";
  const hoverNodeId = hover?.node.id ?? null;
  const allocationContext = useMemo(
    () => materializedTree
      ? buildPassiveAllocationContext(materializedTree, materializationSpec, build?.items || [])
      : { remoteProviders: [] },
    [build?.items, materializationSpec, materializedTree],
  );
  const searchResults = useMemo(() => materializedTree ? searchPassiveNodes(materializedTree, query) : [], [materializedTree, query]);
  const highlighted = useMemo(() => new Set(searchResults.map((node) => node.id)), [searchResults]);
  const nodePowerMap = useMemo(() => new Map(nodePowers.map((entry) => [entry.id, entry])), [nodePowers]);
  const rankedNodePowers = useMemo(() => nodePowers
    .filter((entry) => !entry.allocated)
    .sort((left, right) => {
      const score = (entry: PobNodePower) => powerMetric === "offence"
        ? entry.offence
        : powerMetric === "defence"
          ? entry.defence
          : (entry.offence / Math.max(0.000001, Number(nodePowerMax.offence) || 1)) + (entry.defence / Math.max(0.000001, Number(nodePowerMax.defence) || 1));
      return score(right) - score(left);
    }), [nodePowerMax, nodePowers, powerMetric]);
  useEffect(() => {
    setNodePowers([]);
    setNodePowerMax({});
    setAnalysisDrawerOpen(false);
  }, [activeSpecId, allocated, build, tree?.version]);
  const previewPath = useMemo(() => (
    materializedTree && hoverNodeId != null && !allocated.has(hoverNodeId)
      ? shortestAllocationPath(
          materializedTree,
          allocated,
          hoverNodeId,
          classId,
          currentAscendancy?.internalId,
          secondaryAscendancyName,
          allocationContext,
        )
      : []
  ), [allocated, allocationContext, classId, currentAscendancy?.internalId, hoverNodeId, materializedTree, secondaryAscendancyName]);
  useEffect(() => {
    if (!traceMode || !materializedTree || hoverNodeId == null || allocated.has(hoverNodeId) || !previewPath.length) return;
    setTracePath((current) => extendPassiveTracePath(materializedTree, current, hoverNodeId, previewPath));
  }, [allocated, hoverNodeId, materializedTree, previewPath, traceMode]);
  const displayedPreviewPath = traceMode && tracePath.length ? tracePath : previewPath;
  const previewed = useMemo(() => new Set(displayedPreviewPath), [displayedPreviewPath]);
  const hoverDependents = useMemo(() => (
    materializedTree && hoverNodeId != null && allocated.has(hoverNodeId)
      ? dependentAllocatedNodes(
          materializedTree,
          allocated,
          hoverNodeId,
          classId,
          currentAscendancy?.internalId,
          secondaryAscendancyName,
          allocationContext,
        )
      : new Set<number>()
  ), [allocated, allocationContext, classId, currentAscendancy?.internalId, hoverNodeId, materializedTree, secondaryAscendancyName]);
  const hoverSocketedItem = useMemo(() => {
    if (!hover || !build || !activePassiveSpec?.sockets) return null;
    const itemId = Number(activePassiveSpec.sockets[hover.node.id]);
    return build.items.find((item) => item.id === itemId) || null;
  }, [activePassiveSpec?.sockets, build, hoverNodeId]);
  const socketedItems = useMemo(() => {
    const items = new Map<number, ImportedPobItem>();
    if (!build || !activePassiveSpec?.sockets) return items;
    const itemById = new Map(build.items.filter((item) => item.equipped).map((item) => [item.id, item]));
    for (const [rawNodeId, rawItemId] of Object.entries(activePassiveSpec.sockets)) {
      const item = itemById.get(Number(rawItemId));
      if (item) items.set(Number(rawNodeId), item);
    }
    return items;
  }, [activePassiveSpec?.sockets, build]);
  const hoverRadiusSummary = useMemo(() => {
    if (hoverNodeId == null || !materializedTree) return null;
    const provider = allocationContext.remoteProviders.find((entry) => entry.providerId === hoverNodeId);
    if (!provider) return null;
    const center = materializedTree.nodes.find((node) => node.id === provider.centerId);
    const behavior = provider.kind === "impossible-escape" ? "Impossible Escape" : provider.keystoneOnly ? "Foulborn Intuitive Leap" : "Intuitive Leap";
    return `${behavior}: ${provider.affected.size} eligible passive${provider.affected.size === 1 ? "" : "s"}${center && center.id !== provider.providerId ? ` around ${center.name}` : " in radius"}.`;
  }, [allocationContext.remoteProviders, hoverNodeId, materializedTree]);
  const materializedNodeMap = useMemo(
    () => new Map(materializedTree?.nodes.map((node) => [node.id, node]) || []),
    [materializedTree],
  );
  const pointCounts = useMemo(
    () => materializedTree
      ? countAllocatedPassivePoints(materializedTree, allocated)
      : { passive: 0, ascendancy: 0, secondaryAscendancy: 0, sockets: 0 },
    [allocated, materializedTree],
  );
  const passiveCount = pointCounts.passive;
  const secondaryAscendancyCount = pointCounts.secondaryAscendancy;
  const ascendancyCount = pointCounts.ascendancy - pointCounts.secondaryAscendancy;
  const historyPointLabel = (entry: TreeHistory) => {
    if (!materializedTree) return `${entry.allocated.size} allocated`;
    const counts = countAllocatedPassivePoints(materializedTree, entry.allocated);
    const parts = [`${counts.passive} passive`];
    if (counts.ascendancy - counts.secondaryAscendancy > 0) parts.push(`${counts.ascendancy - counts.secondaryAscendancy} ascendancy`);
    if (counts.secondaryAscendancy > 0) parts.push(`${counts.secondaryAscendancy} bloodline`);
    return parts.join(" · ");
  };
  const currentMasteryEffects = activePassiveSpec?.masteryEffects || unsavedMasteryEffects;
  const usedMasteryEffectIds = useMemo(
    () => new Set(Object.entries(currentMasteryEffects)
      .filter(([rawNodeId]) => allocated.has(Number(rawNodeId)))
      .map(([, effectId]) => Number(effectId))),
    [allocated, currentMasteryEffects],
  );
  const treeLinkUnsupported = tree?.game === "poe2"
    || secondaryAscendancyId > 0
    || Object.keys(currentMasteryEffects).length > 0
    || [...allocated].some((id) => id >= 0x10000);

  const commitAllocated = (
    next: Set<number>,
    label: string,
    masteryEffects: Record<number, number> = currentMasteryEffects,
    selection: TreeSelection = { classId, ascendancyId, secondaryAscendancyId },
  ) => {
    markPlannerChanged();
    setAllocated(next);
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, nodes: [...next] } : spec));
    setHistory((current) => {
      const trimmed = current.slice(0, historyIndex + 1);
      return [...trimmed, { allocated: new Set(next), masteryEffects: { ...masteryEffects }, ...selection, label, at: Date.now() }].slice(-MAX_HISTORY);
    });
    setHistoryIndex((current) => Math.min(current + 1, MAX_HISTORY - 1));
    setEditedSinceImport(true);
  };

  const updateMasteryEffect = (nodeId: number, effectId: number | null) => {
    if (activeSpecId) {
      setSpecs((current) => current.map((spec) => {
        if (spec.id !== activeSpecId) return spec;
        const masteryEffects = { ...spec.masteryEffects };
        if (effectId == null) delete masteryEffects[nodeId];
        else masteryEffects[nodeId] = effectId;
        return { ...spec, masteryEffects };
      }));
    } else {
      setUnsavedMasteryEffects((current) => {
        const next = { ...current };
        if (effectId == null) delete next[nodeId];
        else next[nodeId] = effectId;
        return next;
      });
    }
  };

  const clearMasteryEffects = (nodeIds: ReadonlySet<number>) => {
    if (!nodeIds.size) return;
    if (activeSpecId) {
      setSpecs((current) => current.map((spec) => {
        if (spec.id !== activeSpecId) return spec;
        const masteryEffects = { ...spec.masteryEffects };
        for (const nodeId of nodeIds) delete masteryEffects[nodeId];
        return { ...spec, masteryEffects };
      }));
    } else {
      setUnsavedMasteryEffects((current) => {
        const next = { ...current };
        for (const nodeId of nodeIds) delete next[nodeId];
        return next;
      });
    }
  };

  const replaceMasteryEffects = (masteryEffects: Record<number, number>) => {
    if (activeSpecId) {
      setSpecs((current) => current.map((spec) => (
        spec.id === activeSpecId ? { ...spec, masteryEffects: { ...masteryEffects } } : spec
      )));
    } else {
      setUnsavedMasteryEffects({ ...masteryEffects });
    }
  };

  const openMasteryPicker = (node: PassiveTreeNodeData, knownPath?: number[]) => {
    if (!materializedTree || !node.mastery) return;
    const options = orderedMasteryEffects(node);
    if (!options.length) {
      setMessage("Path of Building did not provide mastery effects for this tree node.");
      return;
    }
    const usedElsewhere = new Set(Object.entries(currentMasteryEffects)
      .filter(([rawNodeId]) => Number(rawNodeId) !== node.id && allocated.has(Number(rawNodeId)))
      .map(([, effectId]) => Number(effectId)));
    if (!options.some(({ id }) => !usedElsewhere.has(id))) {
      setMessage(`Every ${node.name} effect is already allocated on another mastery.`);
      return;
    }
    const path = allocated.has(node.id) ? [] : knownPath || shortestAllocationPath(
      materializedTree,
      allocated,
      node.id,
      classId,
      currentAscendancy?.internalId,
      secondaryAscendancyName,
      allocationContext,
    );
    if (!allocated.has(node.id) && !path.length) {
      setMessage("That mastery is not connected to the current class/ascendancy tree.");
      return;
    }
    setMasteryPicker({ nodeId: node.id, path });
  };

  const chooseMasteryEffect = (effectId: number) => {
    if (!masteryPicker || !materializedTree) return;
    const node = materializedTree.nodes.find((entry) => entry.id === masteryPicker.nodeId);
    if (!node) return;
    const masteryEffects = { ...currentMasteryEffects, [node.id]: effectId };
    updateMasteryEffect(node.id, effectId);
    const next = allocated.has(node.id)
      ? new Set(allocated)
      : allocatePassivePath(materializedTree, allocated, masteryPicker.path, node.id);
    commitAllocated(next, `${allocated.has(node.id) ? "Changed" : "Allocated"} ${node.name} mastery`, masteryEffects);
    setMasteryPicker(null);
  };

  const activateVisibleAscendancy = (node: PassiveTreeNodeData) => {
    if (!tree || !materializedTree || !node.ascendancyName) return false;
    if (node.bloodline) {
      if (node.ascendancyName === secondaryAscendancyName) return false;
      const target = tree.alternateAscendancies?.find((entry) => entry.internalId === node.ascendancyName);
      if (!target) return true;
      let next = new Set([...allocated].filter((id) => !materializedNodeMap.get(id)?.bloodline));
      const start = materializedTree.nodes.find((entry) => entry.isAscendancyStart && entry.bloodline && entry.ascendancyName === target.internalId);
      if (start) next.add(start.id);
      const path = shortestAllocationPath(materializedTree, next, node.id, classId, currentAscendancy?.internalId, target.internalId, allocationContext);
      if (!next.has(node.id) && path.length) next = allocatePassivePath(materializedTree, next, path, node.id);
      setUnsavedSecondaryAscendancyId(target.id);
      commitAllocated(next, `Selected ${target.name}${path.length ? ` and allocated ${node.name}` : ""}`, currentMasteryEffects, { classId, ascendancyId, secondaryAscendancyId: target.id });
      setSpecs((current) => current.map((spec) => spec.id === activeSpecId
        ? { ...spec, secondaryAscendClassId: target.id, nodes: [...next] }
        : spec));
      return true;
    }

    let targetClass: PassiveTreeData["classes"][number] | undefined;
    let targetAscendancy: PassiveTreeData["classes"][number]["ascendancies"][number] | undefined;
    for (const candidateClass of tree.classes) {
      const candidateAscendancy = candidateClass.ascendancies.find((entry) => entry.internalId === node.ascendancyName);
      if (candidateAscendancy) {
        targetClass = candidateClass;
        targetAscendancy = candidateAscendancy;
        break;
      }
    }
    if (!targetClass || !targetAscendancy) return true;
    if (targetClass.id === classId && targetAscendancy.id === ascendancyId) return false;
    const crossClass = targetClass.id !== classId;
    if (crossClass && passiveCount > 0 && !isAllocatedClassConnected(materializedTree, allocated, classId, targetClass.id)) {
      setMessage(`Connect your allocated tree to the ${targetClass.name} start before switching without a reset. Use the Class selector if you intend to reset the tree.`);
      return true;
    }
    let next = new Set([...allocated].filter((id) => {
      const candidate = materializedNodeMap.get(id);
      if (candidate?.classStartIds.length) return false;
      return !candidate?.ascendancyName || Boolean(candidate.bloodline);
    }));
    next = withSelectedPassiveStarts(
      materializedTree,
      next,
      targetClass.id,
      targetAscendancy.id,
      secondaryAscendancyId,
    );
    const path = shortestAllocationPath(
      materializedTree,
      next,
      node.id,
      targetClass.id,
      targetAscendancy.internalId,
      secondaryAscendancyName,
      allocationContext,
    );
    if (!next.has(node.id) && path.length) next = allocatePassivePath(materializedTree, next, path, node.id);
    setClassId(targetClass.id);
    setAscendancyId(targetAscendancy.id);
    commitAllocated(next, `Switched to ${targetAscendancy.name}${path.length ? ` and allocated ${node.name}` : ""}`, currentMasteryEffects, { classId: targetClass.id, ascendancyId: targetAscendancy.id, secondaryAscendancyId });
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId
      ? { ...spec, classId: targetClass.id, ascendClassId: targetAscendancy.id, nodes: [...next] }
      : spec));
    return true;
  };

  const allocate = (node: PassiveTreeNodeData, alternatePath?: readonly number[]) => {
    if (!materializedTree || allocated.has(node.id)) return;
    if (activateVisibleAscendancy(node)) return;
    const path = alternatePath?.length ? [...alternatePath] : shortestAllocationPath(
      materializedTree,
      allocated,
      node.id,
      classId,
      currentAscendancy?.internalId,
      secondaryAscendancyName,
      allocationContext,
    );
    if (!path.length) {
      setMessage("That node is not connected to the current class/ascendancy tree.");
      return;
    }
    if (node.mastery && !node.selectedMasteryEffect) {
      openMasteryPicker(node, path);
      return;
    }
    const next = allocatePassivePath(materializedTree, allocated, path, node.id);
    commitAllocated(next, `Allocated ${node.name}${path.length > 1 ? ` (+${path.length - 1} path)` : ""}`);
  };

  const refund = (node: PassiveTreeNodeData) => {
    if (!materializedTree || !allocated.has(node.id) || node.classStartIds.length > 0) return;
    const next = refundNodeAndDependents(
      materializedTree,
      allocated,
      node.id,
      classId,
      currentAscendancy?.internalId,
      secondaryAscendancyName,
      allocationContext,
    );
    const removedMasteries = new Set([...allocated].filter((id) => (
      !next.has(id) && Boolean(materializedTree.nodes.find((entry) => entry.id === id)?.mastery)
    )));
    clearMasteryEffects(removedMasteries);
    const masteryEffects = { ...currentMasteryEffects };
    for (const id of removedMasteries) delete masteryEffects[id];
    commitAllocated(next, `Refunded ${node.name} and disconnected dependents`, masteryEffects);
  };

  const changeClass = (nextClassId: number) => {
    if (!tree) return;
    setClassId(nextClassId);
    setAscendancyId(0);
    setUnsavedSecondaryAscendancyId(0);
    const start = classStartNode(tree, nextClassId);
    const next = new Set(start ? [start.id] : []);
    setUnsavedMasteryEffects({});
    commitAllocated(next, `Changed class to ${tree.classes.find((entry) => entry.id === nextClassId)?.name}`, {}, { classId: nextClassId, ascendancyId: 0, secondaryAscendancyId: 0 });
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, classId: nextClassId, ascendClassId: 0, secondaryAscendClassId: 0, nodes: [...next], masteryEffects: {} } : spec));
  };

  const changeAscendancy = (nextAscendancyId: number) => {
    if (!tree) return;
    const next = new Set([...allocated].filter((id) => {
      const node = materializedNodeMap.get(id);
      return !node?.ascendancyName || Boolean(node.bloodline);
    }));
    const selectedAscendancy = currentClass?.ascendancies.find((entry) => entry.id === nextAscendancyId);
    if (selectedAscendancy) {
      const ascendancyStart = materializedTree?.nodes.find((node) => (
        node.isAscendancyStart && node.ascendancyName === selectedAscendancy.internalId
      ));
      if (ascendancyStart) next.add(ascendancyStart.id);
    }
    setAscendancyId(nextAscendancyId);
    commitAllocated(next, `Changed ascendancy to ${selectedAscendancy?.name || "None"}`, currentMasteryEffects, { classId, ascendancyId: nextAscendancyId, secondaryAscendancyId });
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, ascendClassId: nextAscendancyId, nodes: [...next] } : spec));
  };

  const changeSecondaryAscendancy = (nextSecondaryId: number) => {
    if (!tree) return;
    const next = new Set([...allocated].filter((id) => !materializedNodeMap.get(id)?.bloodline));
    const selected = tree.alternateAscendancies?.find((entry) => entry.id === nextSecondaryId);
    if (selected) {
      const start = materializedTree?.nodes.find((node) => (
        node.isAscendancyStart && node.bloodline && node.ascendancyName === selected.internalId
      ));
      if (start) next.add(start.id);
    }
    setUnsavedSecondaryAscendancyId(nextSecondaryId);
    commitAllocated(next, `Changed bloodline to ${selected?.name || "None"}`, currentMasteryEffects, { classId, ascendancyId, secondaryAscendancyId: nextSecondaryId });
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId
      ? { ...spec, secondaryAscendClassId: nextSecondaryId, nodes: [...next] }
      : spec));
  };

  const applyBuild = (nextBuild: ImportedPobBuild, targetTree: PassiveTreeData | null = tree, notice = "") => {
    if (!targetTree) return;
    markPlannerChanged();
    const nextSpecs = nextBuild.specs.map((spec) => {
      const randomized = { ...spec, id: `${spec.id}-${crypto.randomUUID()}` };
      return materializeImportedPassiveSpec(targetTree, randomized, nextBuild.items).spec;
    });
    const active = nextSpecs[Math.max(0, Math.min(nextSpecs.length - 1, nextBuild.activeSpec - 1))] || nextSpecs[0];
    const nextAllocated = normalizedSpecAllocation(
      targetTree,
      active,
      nextBuild.items,
      active.nodes,
      active.classId,
      active.ascendClassId,
      active.secondaryAscendClassId,
    );
    setTree(targetTree);
    setRealm(targetTree.game === "poe2" ? "poe2" : "pc");
    setBuild(nextBuild);
    setSpecs(nextSpecs);
    setActiveSpecId(active.id);
    setUnsavedMasteryEffects({});
    setUnsavedSecondaryAscendancyId(active.secondaryAscendClassId);
    setMasteryPicker(null);
    setClassId(active.classId);
    setAscendancyId(active.ascendClassId);
    setAllocated(nextAllocated);
    setHistory([{ allocated: new Set(nextAllocated), masteryEffects: { ...active.masteryEffects }, classId: active.classId, ascendancyId: active.ascendClassId, secondaryAscendancyId: active.secondaryAscendClassId, label: "Imported build", at: Date.now() }]);
    setHistoryIndex(0);
    setEditedSinceImport(false);
    setActiveSavedId("");
    setImportOpen(false);
    setMessage(`Imported level ${nextBuild.level} ${nextBuild.ascendancyName || nextBuild.className}: ${nextSpecs.length} tree spec, ${nextBuild.items.length} items, ${nextBuild.skillGroups.length} skill groups.${notice ? ` ${notice}` : ""}`);
  };

  const importBuild = async (raw = importText, activeRequest?: PlannerAsyncRequestToken) => {
    if (!tree) return;
    if (!activeRequest) markPlannerChanged();
    const request = activeRequest || beginReplacement();
    setBusy(true);
    setMessage("");
    setGemCatalog([]);
    setConfigCatalog([]);
    try {
      let value = raw.trim();
      if (/^https?:\/\//i.test(value)) value = await bridge.fetchToolkitText(resolveRemoteBuildUrl(value));
      if (value.startsWith("{")) {
        const workspace = sanitizePlannerSnapshot(JSON.parse(value));
        if (!workspace) {
          throw new Error("This JSON is not a supported build workspace.");
        }
        const workspaceTree = tree.game === workspace.game && (!workspace.treeVersion || normalizedTreeVersion(tree.version) === normalizedTreeVersion(workspace.treeVersion))
          ? tree
          : await bridge.getPassiveTreeData({ game: workspace.game, treeVersion: workspace.treeVersion || undefined });
        if (!replacementCanApply(request, "the build workspace was loading")) return;
        const workspaceSpecs = workspace.specs.map((spec) => (
          materializeImportedPassiveSpec(workspaceTree, spec, workspace.build?.items || []).spec
        ));
        const workspaceSpec = workspaceSpecs.find((entry) => entry.id === workspace.activeSpecId) || null;
        const next = normalizedSpecAllocation(
          workspaceTree,
          workspaceSpec,
          workspace.build?.items || [],
          workspace.allocated,
          Number(workspace.classId) || 0,
          Number(workspace.ascendancyId) || 0,
          workspaceSpec?.secondaryAscendClassId || 0,
        );
        markPlannerChanged();
        setTree(workspaceTree);
        setRealm(workspaceTree.game === "poe2" ? "poe2" : "pc");
        setBuild(workspace.build ? { ...workspace.build, items: itemsWithPassiveSpecLoadout(workspace.build.items, workspaceSpec) } : null);
        setSpecs(workspaceSpecs);
        setActiveSpecId(workspace.activeSpecId || "");
        setUnsavedSecondaryAscendancyId(workspaceSpec?.secondaryAscendClassId || 0);
        setClassId(Number(workspace.classId) || 0);
        setAscendancyId(Number(workspace.ascendancyId) || 0);
        setAllocated(next);
        setEditedSinceImport(workspace.editedSinceImport);
        setActiveSavedId(workspace.id);
        setHistory([{ allocated: next, masteryEffects: { ...(workspaceSpec?.masteryEffects || {}) }, classId: Number(workspace.classId) || 0, ascendancyId: Number(workspace.ascendancyId) || 0, secondaryAscendancyId: workspaceSpec?.secondaryAscendClassId || 0, label: "Opened workspace", at: Date.now() }]);
        setHistoryIndex(0);
        setImportOpen(false);
        setMessage("Build workspace opened.");
        return;
      }
      const xml = await bridge.decodePobBuild(value);
      const parsed = parsePobXml(xml);
      const importedSpec = parsed.specs[Math.max(0, Math.min(parsed.specs.length - 1, parsed.activeSpec - 1))] || parsed.specs[0];
      const requestedVersion = importedSpec?.treeVersion.trim();
      const requestedGame = requestedVersion ? (/^0_/.test(requestedVersion) ? "poe2" : "poe1") : tree.game;
      const targetTree = requestedVersion && (normalizedTreeVersion(tree.version) !== normalizedTreeVersion(requestedVersion) || tree.game !== requestedGame)
        ? await bridge.getPassiveTreeData({ game: requestedGame, treeVersion: requestedVersion })
        : tree;
      let importedBuild = parsed;
      let calculationNotice = "";
      if (requestedGame === "poe1") {
        const calculated = await bridge.calculatePobBuild({
          xml,
          name: `${parsed.ascendancyName || parsed.className || "Character"} · imported build`,
        });
        if (calculated.ok) {
          importedBuild = buildWithEngineCalculation(parsed, calculated.calculation);
          setGemCatalog(calculated.calculation.gemCatalog);
          setConfigCatalog(calculated.calculation.configCatalog);
          calculationNotice = `Verified and recalculated with Path of Building ${calculated.engine.version}.`;
        } else {
          calculationNotice = `${parsed.playerStats.length ? "The saved PoB snapshot was retained" : "No calculated snapshot is available"}; ${calculated.message}`;
          setEngineCapability(await bridge.diagnosePobEngine());
        }
      }
      if (!replacementCanApply(request, "the Path of Building import was loading")) return;
      applyBuild(importedBuild, targetTree, calculationNotice);
      setImportText("");
    } catch (error) {
      reportReplacementError(request, "the build import was loading", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const openBuild = async () => {
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    try {
      const opened = await bridge.openToolkitText("build");
      if (!replacementCanApply(request, "the build file picker was open")) return;
      if (opened) await importBuild(opened.text, request);
    } catch (error) {
      reportReplacementError(request, "the build file picker was open", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const clipboardBuild = async () => {
    setImportText(await bridge.readPlannerClipboard());
    setImportOpen(true);
  };

  const characterRequest = (character?: string): PoeCharacterImportRequest => ({
    mode: characterMode,
    realm,
    accountName: characterMode === "public" ? accountName.trim() : undefined,
    accessToken: characterMode === "oauth" ? accessToken.trim() : undefined,
    character,
  });

  const loadCharacters = async () => {
    if (tree?.game === "poe2") {
      setMessage("Exact PoE 2 account import is disabled until a verified PoB2 importer can preserve skills, all weapon-set specialisations, and quest rewards. Import a PoB2 code or XML instead.");
      return;
    }
    const request = beginReplacement();
    setBusy(true);
    setMessage("");
    setGemCatalog([]);
    setConfigCatalog([]);
    try {
      const result = await bridge.listPoeCharacters(characterRequest());
      if (!asyncGuardRef.current.isLatest(request)) return;
      setCharacters(result);
      setSelectedCharacter(result[0]?.name || "");
      setMessage(`${result.length} character${result.length === 1 ? "" : "s"} available to import.`);
    } catch (error) {
      if (asyncGuardRef.current.isLatest(request)) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const loadCharacter = async () => {
    if (!selectedCharacter || !tree) return;
    if (tree.game === "poe2") {
      setMessage("Exact PoE 2 account import is disabled until a verified PoB2 importer can preserve skills, all weapon-set specialisations, and quest rewards. Import a PoB2 code or XML instead.");
      return;
    }
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    setMessage("");
    try {
      const character = await bridge.getPoeCharacter(characterRequest(selectedCharacter));
      const imported = await bridge.importPobCharacter({ character });
      if (!imported.ok) {
        throw new Error(`${imported.message}${imported.detail ? ` ${imported.detail}` : ""}`);
      }
      const parsed = enrichPobBuildWithCharacterAssets(parsePobXml(imported.xml), character);
      const importedSpec = parsed.specs[Math.max(0, Math.min(parsed.specs.length - 1, parsed.activeSpec - 1))] || parsed.specs[0];
      if (!importedSpec?.treeVersion) throw new Error("Path of Building returned no passive-tree version for this character.");
      const targetTree = await bridge.getPassiveTreeData({ game: "poe1", treeVersion: importedSpec.treeVersion });
      if (!replacementCanApply(request, "the character import was loading")) return;
      const importedBuild: ImportedPobBuild = {
        ...buildWithEngineCalculation(parsed, imported.calculation),
        config: {
          ...parsed.config,
          league: String(character.league || parsed.config.league || ""),
          realm: String(character.realm || parsed.config.realm || realm || "pc"),
        },
        statSource: "pob-engine",
        notes: parsed.notes || `Imported through Path of Building ${imported.engine.version} from the official Path of Exile character API.`,
      };
      setGemCatalog(imported.calculation.gemCatalog);
      setConfigCatalog(imported.calculation.configCatalog);
      applyBuild(importedBuild, targetTree);
      setAccessToken("");
    } catch (error) {
      reportReplacementError(request, "the character import was loading", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const undo = () => {
    if (historyIndex <= 0) return;
    markPlannerChanged();
    const index = historyIndex - 1;
    const next = new Set(history[index].allocated);
    setHistoryIndex(index);
    setAllocated(next);
    setClassId(history[index].classId);
    setAscendancyId(history[index].ascendancyId);
    setUnsavedSecondaryAscendancyId(history[index].secondaryAscendancyId);
    replaceMasteryEffects(history[index].masteryEffects);
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, classId: history[index].classId, ascendClassId: history[index].ascendancyId, secondaryAscendClassId: history[index].secondaryAscendancyId, nodes: [...next] } : spec));
    setEditedSinceImport(true);
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    markPlannerChanged();
    const index = historyIndex + 1;
    const next = new Set(history[index].allocated);
    setHistoryIndex(index);
    setAllocated(next);
    setClassId(history[index].classId);
    setAscendancyId(history[index].ascendancyId);
    setUnsavedSecondaryAscendancyId(history[index].secondaryAscendancyId);
    replaceMasteryEffects(history[index].masteryEffects);
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, classId: history[index].classId, ascendClassId: history[index].ascendancyId, secondaryAscendClassId: history[index].secondaryAscendancyId, nodes: [...next] } : spec));
    setEditedSinceImport(true);
  };

  const restoreHistory = (index: number) => {
    const entry = history[index];
    if (!entry) return;
    markPlannerChanged();
    const next = new Set(entry.allocated);
    setAllocated(next);
    setClassId(entry.classId);
    setAscendancyId(entry.ascendancyId);
    setUnsavedSecondaryAscendancyId(entry.secondaryAscendancyId);
    replaceMasteryEffects(entry.masteryEffects);
    setHistoryIndex(index);
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, classId: entry.classId, ascendClassId: entry.ascendancyId, secondaryAscendClassId: entry.secondaryAscendancyId, nodes: [...next] } : spec));
    setEditedSinceImport(true);
  };

  const selectSpec = async (id: string) => {
    const spec = specs.find((entry) => entry.id === id);
    if (!spec || !tree) return;
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    try {
      let targetTree = tree;
      const requestedVersion = spec.treeVersion.trim();
      const requestedGame = requestedVersion ? (/^0_/.test(requestedVersion) ? "poe2" : "poe1") : tree.game;
      if (requestedVersion && (normalizedTreeVersion(tree.version) !== normalizedTreeVersion(requestedVersion) || tree.game !== requestedGame)) {
        targetTree = await bridge.getPassiveTreeData({ game: requestedGame, treeVersion: requestedVersion });
      }
      if (!replacementCanApply(request, "the passive-tree spec was loading")) return;
      const next = normalizedSpecAllocation(
        targetTree,
        spec,
        build?.items || [],
        spec.nodes,
        spec.classId,
        spec.ascendClassId,
        spec.secondaryAscendClassId,
      );
      markPlannerChanged();
      if (targetTree !== tree) {
        setTree(targetTree);
        setRealm(targetTree.game === "poe2" ? "poe2" : "pc");
      }
      setActiveSpecId(id);
      setBuild((current) => current ? { ...current, items: itemsWithPassiveSpecLoadout(current.items, spec) } : current);
      setMasteryPicker(null);
      setHover(null);
      setTraceMode(false);
      setTracePath([]);
      setUnsavedSecondaryAscendancyId(spec.secondaryAscendClassId);
      setClassId(spec.classId);
      setAscendancyId(spec.ascendClassId);
      setAllocated(next);
      setSpecs((current) => current.map((entry) => entry.id === id ? { ...entry, nodes: [...next] } : entry));
      setHistory([{ allocated: next, masteryEffects: { ...spec.masteryEffects }, classId: spec.classId, ascendancyId: spec.ascendClassId, secondaryAscendancyId: spec.secondaryAscendClassId, label: `Opened ${spec.title}`, at: Date.now() }]);
      setHistoryIndex(0);
      setEditedSinceImport(true);
    } catch (error) {
      reportReplacementError(request, "the passive-tree spec was loading", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const addSpec = () => {
    markPlannerChanged();
    const spec: ImportedPassiveSpec = {
      ...(activePassiveSpec || {} as ImportedPassiveSpec),
      id: `spec-${crypto.randomUUID()}`,
      title: `Tree ${specs.length + 1}`,
      treeVersion: tree?.version || "",
      classId,
      ascendClassId: ascendancyId,
      secondaryAscendClassId: secondaryAscendancyId,
      nodes: [...allocated],
      masteryEffects: { ...(activePassiveSpec?.masteryEffects || unsavedMasteryEffects) },
    };
    setSpecs((current) => [...current, spec]);
    setActiveSpecId(spec.id);
    setEditedSinceImport(true);
  };

  const copyTreeUrl = async () => {
    if (!tree || treeLinkUnsupported) {
      setMessage("Use Copy PoB for mastery, cluster-jewel, bloodline, or PoE 2 trees; the official compact tree URL cannot preserve those sections safely.");
      return;
    }
    const url = officialTreeUrl(tree, allocated, classId, ascendancyId, secondaryAscendancyId);
    await navigator.clipboard.writeText(url);
    setMessage("Official Path of Exile passive-tree URL copied.");
  };

  const persistedSpecs = () => specs.length ? specs : [{
    id: "current",
    title: "Current tree",
    treeVersion: tree?.version || "",
    classId,
    ascendClassId: ascendancyId,
    secondaryAscendClassId: secondaryAscendancyId,
    nodes: [...allocated],
    masteryEffects: { ...unsavedMasteryEffects },
  } satisfies ImportedPassiveSpec];

  const buildWithCurrentIdentity = (source: ImportedPobBuild) => ({
    ...source,
    className: currentClass?.name || source.className,
    ascendancyName: currentAscendancy?.name || "",
  });

  const saveWorkspace = async () => {
    if (!tree) return;
    const effectiveSpecs = persistedSpecs();
    const snapshot = createPlannerSnapshot({
      id: activeSavedId || undefined,
      game: tree.game,
      treeVersion: tree.version,
      build: build ? buildWithCurrentIdentity(build) : null,
      specs: effectiveSpecs,
      activeSpecId: activeSpecId || effectiveSpecs[0].id,
      classId,
      ascendancyId,
      allocated,
      editedSinceImport,
    });
    const text = JSON.stringify(snapshot, null, 2);
    const saved = await bridge.saveToolkitText({
      text,
      suggestedName: `${build?.className || currentClass?.name || "character"}-gloamcore.json`,
      kind: "build",
    });
    if (saved) setMessage(`Saved ${saved.name}.`);
  };

  const editBuild = (nextBuild: ImportedPobBuild) => {
    markPlannerChanged();
    setBuild(nextBuild);
    setEditedSinceImport(true);
    if (!tree || !materializationSpec || !specs.length) return;

    const loadoutSpecs = specsWithActiveJewelLoadout(nextBuild, specs, activeSpecId);
    const loadoutSpec = loadoutSpecs.find((spec) => spec.id === activeSpecId) || loadoutSpecs[0];
    if (!loadoutSpec) {
      setSpecs(loadoutSpecs);
      return;
    }
    const nextTree = materializeImportedPassiveTree(tree, loadoutSpec, nextBuild.items).tree;
    const nextContext = buildPassiveAllocationContext(nextTree, loadoutSpec, nextBuild.items);
    const nextAllocated = retainConnectedAllocatedPassives(
      nextTree,
      allocated,
      classId,
      currentAscendancy?.internalId,
      secondaryAscendancyName,
      nextContext,
    );
    const nextNodeMap = new Map(nextTree.nodes.map((node) => [node.id, node]));
    const nextMasteryEffects = Object.fromEntries(Object.entries(loadoutSpec.masteryEffects)
      .filter(([rawNodeId, rawEffectId]) => {
        const node = nextNodeMap.get(Number(rawNodeId));
        if (!node?.mastery || !nextAllocated.has(Number(rawNodeId))) return false;
        return orderedMasteryEffects(node).some(({ id }) => id === Number(rawEffectId));
      })
      .map(([rawNodeId, rawEffectId]) => [Number(rawNodeId), Number(rawEffectId)]));
    const allocationChanged = nextAllocated.size !== allocated.size
      || [...nextAllocated].some((id) => !allocated.has(id));
    const masteryChanged = Object.keys(nextMasteryEffects).length !== Object.keys(loadoutSpec.masteryEffects).length
      || Object.entries(nextMasteryEffects).some(([nodeId, effectId]) => loadoutSpec.masteryEffects[Number(nodeId)] !== effectId);
    const nextSpecs = loadoutSpecs.map((spec) => spec.id === loadoutSpec.id
      ? { ...spec, nodes: [...nextAllocated], masteryEffects: nextMasteryEffects }
      : spec);
    setSpecs(nextSpecs);
    if (!allocationChanged && !masteryChanged) return;
    setAllocated(nextAllocated);
    setMasteryPicker(null);
    setHover(null);
    setHistory((current) => {
      return current.map((entry) => {
        const entryClass = tree.classes.find((candidate) => candidate.id === entry.classId);
        const entryAscendancyName = entryClass?.ascendancies.find((candidate) => candidate.id === entry.ascendancyId)?.internalId;
        const entrySecondaryName = tree.alternateAscendancies?.find((candidate) => candidate.id === entry.secondaryAscendancyId)?.internalId;
        const entryAllocated = retainConnectedAllocatedPassives(
          nextTree,
          entry.allocated,
          entry.classId,
          entryAscendancyName,
          entrySecondaryName,
          nextContext,
        );
        const masteryEffects = Object.fromEntries(Object.entries(entry.masteryEffects).filter(([rawNodeId, rawEffectId]) => {
          const node = nextNodeMap.get(Number(rawNodeId));
          if (!node?.mastery || !entryAllocated.has(Number(rawNodeId))) return false;
          return orderedMasteryEffects(node).some(({ id }) => id === Number(rawEffectId));
        }));
        return { ...entry, allocated: entryAllocated, masteryEffects };
      });
    });
    if (allocationChanged) {
      const removed = Math.max(0, allocated.size - nextAllocated.size);
      setMessage(`Jewel loadout updated. Refunded ${removed} passive${removed === 1 ? "" : "s"} that no longer had a legal Path of Building dependency.`);
    } else if (masteryChanged) {
      setMessage("Jewel loadout updated. Removed mastery choices that are no longer available on the active tree.");
    }
  };

  const editNotes = (notes: string) => {
    markPlannerChanged();
    setBuild((current) => ({ ...(current || emptyPobBuild(currentClass?.name || "Scion")), notes }));
    setEditedSinceImport(true);
  };

  const currentSnapshot = (name?: string, tags: string[] = [], id = activeSavedId || undefined) => {
    if (!tree) return null;
    const existing = savedBuilds.find((entry) => entry.id === id);
    const effectiveSpecs = persistedSpecs();
    return createPlannerSnapshot({
      id,
      name: name || existing?.name,
      tags: tags.length ? tags : existing?.tags,
      game: tree.game,
      treeVersion: tree.version,
      build: build ? buildWithCurrentIdentity(build) : null,
      specs: effectiveSpecs,
      activeSpecId: activeSpecId || effectiveSpecs[0].id,
      classId,
      ascendancyId,
      allocated,
      editedSinceImport,
      createdAt: existing?.createdAt,
    });
  };

  const persistSavedBuilds = (next: PlannerWorkspaceSnapshot[]) => {
    if (savedLibraryError) {
      setTab("builds");
      setMessage("The local build library is locked. Save an exact recovery copy and reset it before making library changes.");
      return false;
    }
    try {
      parseSavedPlannerBuilds(localStorage.getItem(SAVED_PLANNER_BUILDS_KEY));
      const serialized = serializeSavedPlannerBuilds(next);
      localStorage.setItem(SAVED_PLANNER_BUILDS_KEY, serialized);
      setSavedBuilds(next);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      try {
        parseSavedPlannerBuilds(localStorage.getItem(SAVED_PLANNER_BUILDS_KEY));
      } catch {
        setSavedLibraryError(detail);
        setTab("builds");
      }
      setMessage(`The local build library was not changed: ${detail}`);
      return false;
    }
  };

  const recoverSavedLibrary = async () => {
    setRecoveringSavedLibrary(true);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const result = await recoverSavedPlannerLibrary({
        storage: localStorage,
        saveRecoveryCopy: (original) => bridge.saveToolkitText({
          text: original,
          suggestedName: `GloamCore-build-library-recovery-${timestamp}.txt`,
          kind: "text",
        }),
      });
      if (result.status === "cancelled") {
        setMessage("Recovery was cancelled. The original local build library is still locked and unchanged.");
        return;
      }
      setSavedLibraryError("");
      setSavedBuilds([]);
      setActiveSavedId("");
      setBaselineId("");
      setMessage(result.status === "missing"
        ? "The local build library no longer contains damaged data and is ready to use."
        : `Saved the exact recovery copy as ${result.backupName} and reset the local build library.`);
    } catch (error) {
      setMessage(`The local build library was not reset: ${error instanceof Error ? error.message : String(error)} Its original data remains unchanged.`);
    } finally {
      setRecoveringSavedLibrary(false);
    }
  };

  const saveToLibrary = (name: string, tags: string[]) => {
    const snapshot = currentSnapshot(name, tags);
    if (!snapshot) return;
    if (!persistSavedBuilds(upsertSavedPlannerBuild(savedBuilds, snapshot))) return;
    setActiveSavedId(snapshot.id);
    setMessage(`Saved ${snapshot.name} to the local build library.`);
  };

  const loadSnapshot = async (snapshot: PlannerWorkspaceSnapshot) => {
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    try {
      let targetTree = tree;
      if (!targetTree || targetTree.game !== snapshot.game || (snapshot.treeVersion && normalizedTreeVersion(targetTree.version) !== normalizedTreeVersion(snapshot.treeVersion))) {
        targetTree = await bridge.getPassiveTreeData({ game: snapshot.game, treeVersion: snapshot.treeVersion || undefined });
      }
      if (!replacementCanApply(request, `the ${snapshot.name} workspace was loading`)) return;
      const snapshotSpecs = snapshot.specs.map((spec) => (
        materializeImportedPassiveSpec(targetTree, spec, snapshot.build?.items || []).spec
      ));
      const snapshotSpec = snapshotSpecs.find((entry) => entry.id === snapshot.activeSpecId) || null;
      const next = normalizedSpecAllocation(
        targetTree,
        snapshotSpec,
        snapshot.build?.items || [],
        snapshot.allocated,
        snapshot.classId,
        snapshot.ascendancyId,
        snapshotSpec?.secondaryAscendClassId || 0,
      );
      markPlannerChanged();
      setTree(targetTree);
      setRealm(targetTree.game === "poe2" ? "poe2" : "pc");
      setBuild(snapshot.build ? { ...snapshot.build, items: itemsWithPassiveSpecLoadout(snapshot.build.items, snapshotSpec) } : null);
      setGemCatalog([]);
      setConfigCatalog([]);
      setSpecs(snapshotSpecs);
      setActiveSpecId(snapshot.activeSpecId);
      setUnsavedSecondaryAscendancyId(snapshotSpec?.secondaryAscendClassId || 0);
      setClassId(snapshot.classId);
      setAscendancyId(snapshot.ascendancyId);
      setAllocated(next);
      setHistory([{ allocated: next, masteryEffects: { ...(snapshotSpec?.masteryEffects || {}) }, classId: snapshot.classId, ascendancyId: snapshot.ascendancyId, secondaryAscendancyId: snapshotSpec?.secondaryAscendClassId || 0, label: `Opened ${snapshot.name}`, at: Date.now() }]);
      setHistoryIndex(0);
      setEditedSinceImport(snapshot.editedSinceImport);
      setActiveSavedId(snapshot.id);
      setMessage(`Opened ${snapshot.name}.`);
    } catch (error) {
      reportReplacementError(request, `the ${snapshot.name} workspace was loading`, error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const duplicateSnapshot = (snapshot: PlannerWorkspaceSnapshot) => {
    const duplicate = createPlannerSnapshot({ ...snapshot, id: undefined, name: `${snapshot.name} copy`, allocated: snapshot.allocated, now: Date.now() });
    if (persistSavedBuilds(upsertSavedPlannerBuild(savedBuilds, duplicate))) {
      setMessage(`Duplicated ${snapshot.name}.`);
    }
  };

  const exportSnapshot = async (snapshot: PlannerWorkspaceSnapshot) => {
    const saved = await bridge.saveToolkitText({ text: JSON.stringify(snapshot, null, 2), suggestedName: `${snapshot.name.replace(/[^a-z0-9_-]+/gi, "-") || "build"}.json`, kind: "build" });
    if (saved) setMessage(`Exported ${saved.name}.`);
  };

  const copyPobCode = async () => {
    if (!tree) return;
    const effectiveBuild = buildWithCurrentIdentity(build || emptyPobBuild(currentClass?.name || "Scion"));
    const sourceSpecs = persistedSpecs();
    // Official character payloads use opaque hashes_ex. Materialize again at
    // the export boundary so Copy PoB is lossless even before any user edit.
    const effectiveSpecs = sourceSpecs.map((spec) => materializeImportedPassiveSpec(tree, spec, effectiveBuild.items).spec);
    const xml = serializePobXml(effectiveBuild, effectiveSpecs, activeSpecId || effectiveSpecs[0].id);
    const code = await bridge.encodePobBuild(xml);
    await navigator.clipboard.writeText(code);
    setMessage("Path of Building import code copied. PoB will recalculate outputs after import.");
  };

  const recalculateWithPob = async () => {
    if (!tree || tree.game !== "poe1") return;
    const request = asyncGuardRef.current.begin("calculation");
    const sourceIdentity = plannerIdentityRef.current;
    let changedMessageShown = false;
    const requestStatus = () => {
      const status = asyncGuardRef.current.inspect(request);
      if (status === "superseded") return status;
      const currentIdentity = plannerIdentityRef.current;
      const identityChanged = currentIdentity.build !== sourceIdentity.build
        || currentIdentity.specs !== sourceIdentity.specs
        || currentIdentity.activeSpecId !== sourceIdentity.activeSpecId
        || currentIdentity.tree !== sourceIdentity.tree;
      if (status === "changed" || identityChanged) {
        if (!changedMessageShown) {
          changedMessageShown = true;
          setMessage("The build changed while Path of Building was calculating; the current edits were kept. Recalculate again for fresh outputs.");
        }
        return "changed" as const;
      }
      return "current" as const;
    };
    const effectiveBuild = buildWithCurrentIdentity(build || emptyPobBuild(currentClass?.name || "Scion"));
    const sourceSpecs = persistedSpecs();
    const effectiveSpecs = sourceSpecs.map((spec) => materializeImportedPassiveSpec(tree, spec, effectiveBuild.items).spec);
    const effectiveActiveSpecId = activeSpecId || effectiveSpecs[0]?.id || "";
    const xml = serializePobXml(effectiveBuild, effectiveSpecs, effectiveActiveSpecId);
    setCalculating(true);
    setMessage("Calculating the current build in an isolated local Path of Building process…");
    try {
      const result = await bridge.calculatePobBuild({
        xml,
        name: `${effectiveBuild.ascendancyName || effectiveBuild.className || "Character"} · Local plan`,
      });
      if (requestStatus() !== "current") return;
      if (!result.ok) {
        const diagnostic = await bridge.diagnosePobEngine();
        if (requestStatus() !== "current") return;
        setMessage(`${result.message}${result.detail ? ` ${result.detail}` : ""}`);
        setEngineCapability(diagnostic);
        return;
      }
      const calculatedBuild = buildWithEngineCalculation(effectiveBuild, result.calculation);
      setGemCatalog(result.calculation.gemCatalog);
      setConfigCatalog(result.calculation.configCatalog);
      const playerStats = calculatedBuild.playerStats;
      markPlannerChanged();
      setBuild({
        ...calculatedBuild,
        xml,
        specs: effectiveSpecs,
      });
      setSpecs(effectiveSpecs);
      if (!activeSpecId && effectiveActiveSpecId) setActiveSpecId(effectiveActiveSpecId);
      setEditedSinceImport(false);
      const warnings = result.calculation.warnings.length
        ? ` ${result.calculation.warnings.length} PoB warning${result.calculation.warnings.length === 1 ? "" : "s"} reported.`
        : "";
      setMessage(`Calculated ${playerStats.length} numeric outputs with Path of Building ${result.engine.version} in ${(result.durationMilliseconds / 1000).toFixed(2)}s.${warnings}`);
    } catch (error) {
      if (requestStatus() === "current") setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setCalculating(false);
    }
  };

  const commitValidatedItemBuild = async (candidate: ImportedPobBuild) => {
    if (!tree || tree.game !== "poe1") return { ok: false, message: "Path of Building item validation is available for PoE 1 builds only." };
    if (engineCapability?.ok !== true) return { ok: false, message: engineCapability?.message || "The verified local Path of Building engine is unavailable." };
    const request = asyncGuardRef.current.begin("calculation");
    const effectiveBuild = buildWithCurrentIdentity(candidate);
    const sourceSpecs = persistedSpecs();
    const effectiveSpecs = sourceSpecs.map((spec) => materializeImportedPassiveSpec(tree, spec, effectiveBuild.items).spec);
    const effectiveActiveSpecId = activeSpecId || effectiveSpecs[0]?.id || "";
    const xml = serializePobXml(effectiveBuild, effectiveSpecs, effectiveActiveSpecId);
    const changedItemIds = new Set(effectiveBuild.items.filter((item) => {
      const current = build?.items.find((entry) => entry.id === item.id);
      return !current || current.text !== item.text;
    }).map((item) => item.id));
    setCalculating(true);
    try {
      const result = await bridge.calculatePobBuild({
        xml,
        name: `${effectiveBuild.ascendancyName || effectiveBuild.className || "Character"} · item validation`,
      });
      if (!asyncGuardRef.current.isLatest(request)) return { ok: false, message: "The build changed while the item was being validated. Review the current build and try again." };
      if (!result.ok) {
        setEngineCapability(await bridge.diagnosePobEngine());
        return { ok: false, message: `${result.message}${result.detail ? ` ${result.detail}` : ""}` };
      }
      const acceptedIds = new Set(result.calculation.items.map((item) => Number(item.id)));
      const rejected = [...changedItemIds].filter((id) => !acceptedIds.has(id));
      if (rejected.length) {
        return { ok: false, message: "Path of Building rejected this item. Verify the rarity, item name, exact base type, and modifier text; no build data was changed." };
      }
      const calculatedBuild = buildWithEngineCalculation(effectiveBuild, result.calculation);
      setGemCatalog(result.calculation.gemCatalog);
      setConfigCatalog(result.calculation.configCatalog);
      markPlannerChanged();
      setBuild({ ...calculatedBuild, xml, specs: effectiveSpecs });
      setSpecs(effectiveSpecs);
      setEditedSinceImport(false);
      setMessage(`Item accepted and recalculated by Path of Building ${result.engine.version}.`);
      return { ok: true, message: "Item accepted by Path of Building." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setCalculating(false);
    }
  };

  const analyzePassivePower = async () => {
    if (!tree || tree.game !== "poe1" || engineCapability?.ok !== true) return;
    const effectiveBuild = buildWithCurrentIdentity(build || emptyPobBuild(currentClass?.name || "Scion"));
    const sourceSpecs = persistedSpecs();
    const effectiveSpecs = sourceSpecs.map((spec) => materializeImportedPassiveSpec(tree, spec, effectiveBuild.items).spec);
    const xml = serializePobXml(effectiveBuild, effectiveSpecs, activeSpecId || effectiveSpecs[0]?.id || "");
    setAnalyzingNodes(true);
    setMessage(`Path of Building is evaluating every passive within ${powerDepth} point${powerDepth === 1 ? "" : "s"} of the current tree…`);
    try {
      const result = await bridge.analyzePobNodes({
        xml,
        maxPoints: powerDepth,
        name: `${effectiveBuild.ascendancyName || effectiveBuild.className || "Character"} · passive power`,
      });
      if (!result.ok) {
        setMessage(`${result.message}${result.detail ? ` ${result.detail}` : ""}`);
        return;
      }
      setNodePowers(result.analysis.nodePowers);
      setNodePowerMax(result.analysis.powerMax);
      setAnalysisDrawerOpen(true);
      setMessage(`Path of Building ${result.engine.version} scored ${result.analysis.nodePowers.length} passives in ${(result.durationMilliseconds / 1000).toFixed(2)}s. Heatmap and ranked notables are now live.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzingNodes(false);
    }
  };

  const baseline = savedBuilds.find((entry) => entry.id === baselineId) || null;
  const comparison = baseline ? comparePlannerBuilds({ build, allocated: [...allocated] }, baseline) : null;

  if (busy && !tree) return <div className="planner-loading"><LoaderCircle className="is-spinning" /><strong>Loading authoritative Path of Building tree…</strong></div>;
  if (!tree) return <div className="toolkit-empty"><Network size={34} /><h2>Passive tree unavailable</h2><p>{message}</p></div>;
  let timelessXml = "";
  if (timelessOpen && tree.game === "poe1") {
    const effectiveBuild = buildWithCurrentIdentity(build || emptyPobBuild(currentClass?.name || "Scion"));
    const effectiveSpecs = persistedSpecs().map((spec) => materializeImportedPassiveSpec(tree, spec, effectiveBuild.items).spec);
    timelessXml = serializePobXml(effectiveBuild, effectiveSpecs, activeSpecId || effectiveSpecs[0]?.id || "");
  }

  return (
    <section className="planner-shell" data-game={tree.game}>
      <header className="planner-commandbar">
        <div className="planner-build-context">
          <span className="planner-orbit-mark"><Network size={17}/></span>
          <div className="planner-file-menu">
            <button type="button" className={actionsOpen ? "is-open" : ""} onClick={() => setActionsOpen((value) => !value)}><span><small>{tree.game === "poe2" ? "POE 2" : "POE 1"} · POB {tree.version.replace("_", ".")}</small><strong>{build ? `${build.ascendancyName || build.className} · Level ${build.level}` : "Local build"}</strong></span><ChevronDown size={12}/></button>
            {actionsOpen && <div className="planner-file-dropdown">
              <button type="button" onClick={() => { setActionsOpen(false); void saveWorkspace(); }}><Save size={13}/><span>Save as file</span><kbd>Ctrl+S</kbd></button>
              <button type="button" onClick={() => { setActionsOpen(false); void openBuild(); }}><FolderOpen size={13}/><span>Open build</span></button>
              <button type="button" onClick={() => { setActionsOpen(false); setImportOpen(true); }}><Upload size={13}/><span>Import build</span><kbd>Ctrl+I</kbd></button>
              <hr/><button type="button" onClick={() => { setActionsOpen(false); void copyPobCode(); }}><Clipboard size={13}/><span>Copy PoB code</span></button>
              <button type="button" disabled={treeLinkUnsupported} onClick={() => { setActionsOpen(false); void copyTreeUrl(); }}><Copy size={13}/><span>Copy tree link</span></button>
              <hr/><button type="button" onClick={() => { setActionsOpen(false); undo(); }} disabled={historyIndex <= 0}><ArrowLeft size={13}/><span>Undo tree change</span></button>
              <button type="button" onClick={() => { setActionsOpen(false); redo(); }} disabled={historyIndex >= history.length - 1}><ArrowRight size={13}/><span>Redo tree change</span></button>
            </div>}
          </div>
          <label className="planner-context-card"><small>Character</small><select aria-label="Character class" value={classId} onChange={(event) => changeClass(Number(event.target.value))}>{tree.classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label className="planner-context-card"><small>Ascendancy · LV {build?.level || 1}</small><select aria-label="Ascendancy" value={ascendancyId} onChange={(event) => changeAscendancy(Number(event.target.value))}><option value={0}>None</option>{currentClass?.ascendancies.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label className="planner-context-card planner-context-spec"><small>Tree spec</small><span><select value={activeSpecId} onChange={(event) => { void selectSpec(event.target.value); }}><option value="">Current tree</option>{specs.map((spec) => <option key={spec.id} value={spec.id}>{spec.title}</option>)}</select><button type="button" aria-label="Duplicate tree spec" onClick={addSpec}><Plus size={12}/></button></span></label>
        </div>
        <nav className="planner-tabs" aria-label="Build planner sections" role="tablist">{PLANNER_TABS.slice(0, 6).map((value) => <button type="button" role="tab" aria-selected={tab === value} key={value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}><PlannerTabGlyph tab={value}/><span>{value}</span></button>)}</nav>
        <div className="planner-command-actions">
          <label className="planner-game-select"><select aria-label="Game" value={tree.game} disabled={busy} onChange={(event) => { void changeGame(event.target.value as "poe1" | "poe2"); }}><option value="poe1">PoE 1</option><option value="poe2">PoE 2</option></select></label>
          {Boolean(tree.alternateAscendancies?.length) && <label className="planner-bloodline-select"><select aria-label="Bloodline" value={secondaryAscendancyId} onChange={(event) => changeSecondaryAscendancy(Number(event.target.value))}><option value={0}>No bloodline</option>{tree.alternateAscendancies?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
          <button type="button" onClick={recalculateWithPob} disabled={calculating || tree.game !== "poe1" || engineCapability?.ok !== true} title="Recalculate with the verified local Path of Building engine">{calculating ? <LoaderCircle className="is-spinning" size={14}/> : <RefreshCw size={14}/>}<span>Recalculate</span></button>
          <button type="button" className="is-primary" onClick={() => { if (tree.game === "poe2") setImportMode("pob"); setImportOpen(true); }}><Upload size={14}/><span>Import</span></button>
          <button type="button" aria-label="More planner actions" onClick={() => setActionsOpen((value) => !value)}><MoreHorizontal size={15}/></button>
        </div>
      </header>
      {message && <div className="planner-message"><span>{message}</span><button type="button" aria-label="Dismiss planner message" onClick={() => setMessage("")}><X size={13} /></button></div>}
      <div className="planner-workspace">
        <PlannerStatRail build={build} collapsed={statRailCollapsed} onCollapsed={() => setStatRailCollapsed((value) => !value)} onRecalculate={recalculateWithPob} calculating={calculating}/>
        <div className="planner-surface">
          <div className="planner-body">
        {tab === "tree" && (
          <div className="passive-tree-stage">
            {materializedTree
              ? <PassiveTreeCanvas tree={materializedTree} allocated={allocated} previewed={previewed} refundPreview={hoverDependents} highlighted={highlighted} hoveredId={hoverNodeId} classId={classId} ascendancyName={currentAscendancy?.internalId || ""} secondaryAscendancyName={secondaryAscendancyName} socketedItems={socketedItems} itemArtwork={itemArtwork} powerScores={nodePowers.length ? nodePowerMap : null} powerMetric={powerMetric} powerMax={nodePowerMax} viewCommand={viewCommand} onAllocate={(node) => allocate(node, traceMode && tracePath[tracePath.length - 1] === node.id ? tracePath : undefined)} onRefund={refund} onMastery={openMasteryPicker} onHover={(node, point) => setHover(node && point ? { node, ...point } : null)} />
              : <div className="planner-loading"><LoaderCircle className="is-spinning" /><strong>Loading the matching PoB {activePassiveSpec?.treeVersion} tree…</strong></div>}
            <div className="tree-toolbar">
              <button type="button" title="Zoom in" onClick={() => setViewCommand({ action: "zoom-in", nonce: Date.now() })}><ZoomIn size={14}/></button>
              <button type="button" title="Zoom out" onClick={() => setViewCommand({ action: "zoom-out", nonce: Date.now() })}><ZoomOut size={14}/></button>
              <button type="button" title="Fit tree" onClick={() => setViewCommand({ action: "fit", nonce: Date.now() })}><Maximize2 size={14}/></button>
              <span/>
              <button type="button" title="Undo" disabled={historyIndex <= 0} onClick={undo}><ArrowLeft size={14}/></button>
              <button type="button" title="Redo" disabled={historyIndex >= history.length - 1} onClick={redo}><ArrowRight size={14}/></button>
              <label className="tree-search"><Search size={13}/><input aria-label="Search passive tree" value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search nodes, stats, #id'/>{query && <small>{searchResults.length}</small>}</label>
            </div>
            <div className="tree-spec-float"><GitBranch size={12}/><span>{activePassiveSpec?.title || "Current tree"}</span><b>{passiveCount}/{tree.points.total}</b></div>
            <div className="tree-power-dock">
              <div className="tree-power-mode"><span><CircleGauge size={13}/> Node power</span>{(["blend", "offence", "defence"] as NodePowerMetric[]).map((metric) => <button type="button" key={metric} className={powerMetric === metric ? "is-active" : ""} onClick={() => setPowerMetric(metric)}>{metric === "blend" ? "Blend" : metric === "offence" ? "DPS" : "Defence"}</button>)}</div>
              <div className="tree-power-run"><span>Path</span>{[3, 5, 10, 15].map((depth) => <button type="button" key={depth} className={powerDepth === depth ? "is-active" : ""} onClick={() => setPowerDepth(depth)}>{depth}</button>)}<button type="button" className="is-run" disabled={analyzingNodes || tree.game !== "poe1" || engineCapability?.ok !== true} onClick={analyzePassivePower}>{analyzingNodes ? <LoaderCircle className="is-spinning" size={12}/> : <Activity size={12}/>} Analyze</button></div>
              <button type="button" className="tree-timeless-trigger" onClick={() => setTimelessOpen(true)}><Gem size={13}/> Timeless lens</button>
            </div>
            <div className="tree-points-dock"><strong>{passiveCount}</strong><span>/{tree.points.total} passive</span><i/>
              <strong>{ascendancyCount}</strong><span>/{tree.points.ascendancy} ascend</span>{secondaryAscendancyName && <><i/><strong>{secondaryAscendancyCount}</strong><span>/{tree.points.ascendancy} bloodline</span></>}
            </div>
            {analysisDrawerOpen && nodePowers.length > 0 && <aside className="tree-analysis-drawer">
              <header><span><Activity size={14}/><strong>PoB power report</strong><small>{nodePowers.length} nodes · ≤{powerDepth} pts</small></span><button type="button" aria-label="Close node power report" onClick={() => setAnalysisDrawerOpen(false)}><X size={13}/></button></header>
              <div className="tree-analysis-legend"><span>Low</span><i/><span>High</span></div>
              <section>{rankedNodePowers.filter((entry) => entry.type === "Notable" || entry.type === "Keystone").slice(0, 14).map((entry, index) => <button type="button" key={entry.id} onClick={() => { setQuery(`#${entry.id}`); setViewCommand({ action: "focus", nodeId: entry.id, nonce: Date.now() }); }}><em>{index + 1}</em><span><strong>{entry.name}</strong><small>{entry.type} · {entry.distance} pt{entry.distance === 1 ? "" : "s"}</small></span><b><i>{entry.offence >= 0 ? "+" : ""}{(entry.offence * 100).toFixed(1)}% DPS</i><small>{entry.defence >= 0 ? "+" : ""}{(entry.defence * 100).toFixed(1)}% DEF</small></b></button>)}</section>
            </aside>}
            <div className={`tree-help${traceMode ? " is-tracing" : ""}`}>{traceMode ? `Shift trace · ${tracePath.length} node${tracePath.length === 1 ? "" : "s"} · hover adjacent passives, then click the final node` : "Drag to pan · wheel to zoom · double-click resets view · hold Shift to trace a custom path · left-click allocates or refunds · right-click changes an allocated mastery"}</div>
            {hover && <PassiveNodeTooltip hover={hover} allocated={allocated.has(hover.node.id)} previewPath={displayedPreviewPath} dependents={hoverDependents} socketedItem={hoverSocketedItem} usedMasteryEffects={usedMasteryEffectIds} radiusSummary={hoverRadiusSummary} nodePower={nodePowerMap.get(hover.node.id) || null} selectedAscendancyName={currentAscendancy?.internalId || ""} selectedSecondaryName={secondaryAscendancyName} />}
            {masteryPicker && materializedTree && (() => {
              const node = materializedTree.nodes.find((entry) => entry.id === masteryPicker.nodeId);
              if (!node) return null;
              const usedElsewhere = new Set(Object.entries(currentMasteryEffects)
                .filter(([rawNodeId]) => Number(rawNodeId) !== node.id && allocated.has(Number(rawNodeId)))
                .map(([, effectId]) => Number(effectId)));
              const options = orderedMasteryEffects(node)
                .filter(({ id }) => !usedElsewhere.has(id));
              return (
                <div className="mastery-picker-scrim" onMouseDown={(event) => event.target === event.currentTarget && setMasteryPicker(null)}>
                  <section className="mastery-picker" role="dialog" aria-modal="true" aria-labelledby="planner-mastery-title">
                    <header><span><Network size={16} /><strong id="planner-mastery-title">{node.name}</strong></span><button type="button" aria-label="Close mastery choices" onClick={() => setMasteryPicker(null)}><X size={15} /></button></header>
                    <p>{allocated.has(node.id) ? "Choose a replacement effect." : `Choose an effect to allocate this mastery${masteryPicker.path.length > 1 ? ` and ${masteryPicker.path.length - 1} leading passives` : ""}.`} {options.length}/{orderedMasteryEffects(node).length} effects available; PoB allows each effect only once.</p>
                    <div>{options.map(({ id: effectId, effect }, optionIndex) => {
                      return <button type="button" autoFocus={optionIndex === 0} key={effectId} className={node.selectedMasteryEffect === effectId ? "is-selected" : ""} onClick={() => chooseMasteryEffect(effectId)}><b>{effect.stats.join(" · ") || "Mastery effect"}</b>{effect.reminderText.map((line, index) => <small key={`${index}-${line}`}>{line}</small>)}</button>;
                    })}</div>
                  </section>
                </div>
              );
            })()}
          </div>
        )}
        {tab === "items" && <PlannerItemsPanel build={build} artwork={itemArtwork} artworkDimensions={itemArtworkDimensions} onChange={editBuild} onCommitItem={commitValidatedItemBuild} />}
        {tab === "skills" && <PlannerSkillsPanel build={build} artwork={gemArtwork} catalog={gemCatalog} onChange={editBuild} />}
        {tab === "config" && <PlannerConfigPanel build={build} catalog={configCatalog} onChange={editBuild} />}
        {tab === "calcs" && <PlannerCalcsPanel build={build} editedSinceImport={editedSinceImport} comparison={comparison} />}
        {tab === "builds" && <PlannerBuildsPanel builds={savedBuilds} activeId={activeSavedId} baselineId={baselineId} libraryError={savedLibraryError} recoveringLibrary={recoveringSavedLibrary} onRecoverLibrary={recoverSavedLibrary} onSave={saveToLibrary} onLoad={loadSnapshot} onDelete={(id) => { if (!persistSavedBuilds(savedBuilds.filter((entry) => entry.id !== id))) return; if (activeSavedId === id) setActiveSavedId(""); if (baselineId === id) setBaselineId(""); }} onDuplicate={duplicateSnapshot} onBaseline={setBaselineId} onExport={exportSnapshot} />}
        {tab === "notes" && <div className="planner-notes"><textarea aria-label="Build notes" value={build?.notes || ""} placeholder="Build notes, campaign reminders, gearing steps…" onChange={(event) => editNotes(event.target.value)} /></div>}
        {tab === "history" && <div className="planner-history"><header><History size={16} /><strong>Tree timeline</strong><button type="button" onClick={() => { const initial = history[0]; if (initial) { restoreHistory(0); setHistory([initial]); } }}><RotateCcw size={13} /> Reset to start</button></header>{[...history].reverse().map((entry, reverseIndex) => { const index = history.length - reverseIndex - 1; return <button type="button" key={`${entry.at}-${index}`} className={index === historyIndex ? "is-active" : ""} onClick={() => restoreHistory(index)}><span>{entry.label}</span><small>{historyPointLabel(entry)} · {new Date(entry.at).toLocaleTimeString()}</small></button>; })}</div>}
          </div>
          <nav className="planner-edge-tabs" aria-label="Planner utilities">
            <button type="button" className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}><History size={13}/><span>History</span></button>
            <button type="button" className={tab === "notes" ? "is-active" : ""} onClick={() => setTab("notes")}><BookOpen size={13}/><span>Notes</span></button>
          </nav>
          {timelessOpen && materializedTree && <TimelessLens
            tree={materializedTree}
            allocated={allocated}
            xml={timelessXml}
            engineReady={engineCapability?.ok === true && tree.game === "poe1"}
            artwork={timelessArtwork}
            onClose={() => setTimelessOpen(false)}
            onFocus={(nodeId) => { setTimelessOpen(false); setQuery(`#${nodeId}`); setViewCommand({ action: "focus", nodeId, nonce: Date.now() }); }}
          />}
        </div>
      </div>

      {importOpen && <div className="planner-import-scrim" onMouseDown={(event) => event.target === event.currentTarget && setImportOpen(false)}><section className="planner-import" role="dialog" aria-modal="true" aria-labelledby="planner-import-title"><header><span><Clipboard size={17} /><strong id="planner-import-title">Import character or build</strong></span><button type="button" aria-label="Close build import" onClick={() => setImportOpen(false)}><X size={16} /></button></header><nav><button type="button" className={importMode === "pob" ? "is-active" : ""} onClick={() => setImportMode("pob")}>PoB / build link</button><button type="button" className={importMode === "character" ? "is-active" : ""} onClick={() => setImportMode("character")}>My character</button></nav>{importMode === "pob" ? <><p>Paste a {tree.game === "poe2" ? "PoB2" : "PoB"} code/XML, pobb.in or Pastebin link. You can also open an XML file. Full build imports retain tree specs, items, gems, config, and notes.</p><textarea aria-label="PoB build code or XML" autoFocus value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={`${tree.game === "poe2" ? "PoB2" : "PoB"} code, XML, or supported build URL…`} /><div><button type="button" onClick={clipboardBuild}><Clipboard size={14} /> Read clipboard</button><button type="button" onClick={openBuild}><FolderOpen size={14} /> Open XML</button><button type="button" className="is-primary" onClick={() => importBuild()} disabled={!importText.trim() || busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Upload size={14} />} Import</button></div></> : <div className="character-import"><p>Public profiles work with an account name. Private profiles use a temporary official OAuth token with the <code>account:characters</code> scope; the token is never saved. Character nodes are matched only against the selected game’s installed PoB tree.</p><div className="character-import-mode"><button type="button" className={characterMode === "public" ? "is-active" : ""} onClick={() => { setCharacterMode("public"); setCharacters([]); }}>Public profile</button><button type="button" className={characterMode === "oauth" ? "is-active" : ""} onClick={() => { setCharacterMode("oauth"); setCharacters([]); }}>Official OAuth</button></div><label>Realm<select value={realm} onChange={(event) => { setRealm(event.target.value as PoeCharacterImportRequest["realm"]); setCharacters([]); }}>{tree.game === "poe2" ? <option value="poe2">PC (PoE 2)</option> : <><option value="pc">PC (PoE 1)</option><option value="xbox">Xbox</option><option value="sony">Sony</option></>}</select></label>{characterMode === "public" ? <label>Account name<input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="AccountName#1234" /></label> : <label>OAuth access token<input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="off" placeholder="Temporary account:characters token" /></label>}<button type="button" onClick={loadCharacters} disabled={busy || (characterMode === "public" ? !accountName.trim() : !accessToken.trim())}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCw size={14} />} Load character list</button>{characters.length > 0 && <><label>Character<select value={selectedCharacter} onChange={(event) => setSelectedCharacter(event.target.value)}>{characters.map((character) => <option key={character.id || character.name} value={character.name}>{character.name} · {character.class} {character.level} · {character.league || "No league"}</option>)}</select></label><button type="button" className="is-primary" onClick={loadCharacter} disabled={busy || !selectedCharacter}><Upload size={14} /> Import selected character</button></>}</div>}</section></div>}
    </section>
  );
}
