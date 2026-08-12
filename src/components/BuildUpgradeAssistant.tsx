import { AlertTriangle, ArrowRight, CheckCircle2, Cpu, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { bridge, isDesktop } from "../lib/bridge";
import {
  assertComparableBuildUpgradeSnapshots,
  buildAuthoritativeUpgradeComparison,
  buildUpgradeFactChanges,
  buildUpgradeSnapshotFingerprint,
  serializeBuildUpgradeSnapshot,
  type AuthoritativeBuildUpgradeComparison,
} from "../lib/planner/build-upgrade";
import {
  comparePlannerBuilds,
  formatPobStatValue,
  type PlannerBuildComparison,
  type PlannerWorkspaceSnapshot,
} from "../lib/planner/planner-workspace";
import type { PobEngineDiagnostic } from "../types";
import "../build-upgrade.css";

interface BuildUpgradeAssistantProps {
  current: PlannerWorkspaceSnapshot | null;
  savedBuilds: PlannerWorkspaceSnapshot[];
  engineCapability: PobEngineDiagnostic | null;
  onOpenBuilds: () => void;
  onImportSnapshot?: (raw: string) => { ok: boolean; message: string };
}

interface SnapshotOption {
  key: string;
  kind: "current" | "saved";
  snapshot: PlannerWorkspaceSnapshot;
}

const categoryLabels: Record<string, string> = {
  offence: "Offence",
  defence: "Defence",
  recovery: "Recovery",
  resources: "Resources",
  resistances: "Resistances",
  attributes: "Attributes",
  charges: "Charges",
  other: "Other",
};

function optionLabel(option: SnapshotOption) {
  const build = option.snapshot.build;
  const identity = build
    ? `${build.ascendancyName || build.className || "Character"} · Lv ${build.level}`
    : "Tree-only workspace";
  return `${option.kind === "current" ? "Current · " : ""}${option.snapshot.name} — ${identity}`;
}

function storedSnapshotStatus(snapshot: PlannerWorkspaceSnapshot) {
  if (!snapshot.build) return "No complete PoB build";
  if (snapshot.editedSinceImport) return "Edited after last calculation";
  if (snapshot.build.statSource !== "pob-engine") return "No verified PoB outputs stored";
  return `Stored PoB snapshot · ${new Date(snapshot.updatedAt).toLocaleString()}`;
}

function formatStatDifference(stat: PlannerBuildComparison["stats"][number]) {
  if (stat.name === "EffectiveMovementSpeedMod") {
    const value = Number((stat.delta * 100).toFixed(1));
    return `${value > 0 ? "+" : ""}${value}%`;
  }
  const value = formatPobStatValue({ name: stat.name, value: stat.delta, percent: stat.percent });
  return `${stat.delta > 0 ? "+" : ""}${value}`;
}

function SnapshotCard({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: string;
  options: SnapshotOption[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.key === value);
  return <article className="upgrade-snapshot-card">
    <header><span>{title}</span><small>{selected?.kind === "current" ? "live workspace" : "saved snapshot"}</small></header>
    <select aria-label={`${title} build`} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose a build…</option>
      {options.map((option) => <option key={option.key} value={option.key}>{optionLabel(option)}</option>)}
    </select>
    {selected && <div>
      <strong>{selected.snapshot.build?.ascendancyName || selected.snapshot.build?.className || selected.snapshot.name}</strong>
      <span>Tree {selected.snapshot.treeVersion} · {selected.snapshot.allocated.length} allocated nodes</span>
      <small className={selected.snapshot.editedSinceImport ? "is-warning" : ""}>{storedSnapshotStatus(selected.snapshot)}</small>
    </div>}
  </article>;
}

function ChangeList({ title, added, removed }: { title: string; added: readonly string[]; removed: readonly string[] }) {
  if (!added.length && !removed.length) return null;
  return <section className="upgrade-change-list">
    <header><strong>{title}</strong><small>{added.length + removed.length} differences</small></header>
    <div>{added.map((entry) => <span className="is-added" key={`add-${entry}`}>+ {entry}</span>)}{removed.map((entry) => <span className="is-removed" key={`remove-${entry}`}>− {entry}</span>)}</div>
  </section>;
}

function ComparisonEvidence({ comparison }: { comparison: PlannerBuildComparison }) {
  const groups = [...new Set(comparison.stats.map((stat) => stat.category))];
  return <div className="upgrade-evidence">
    <div className="upgrade-change-grid">
      <ChangeList title="Equipment" added={comparison.addedItems} removed={comparison.removedItems}/>
      <ChangeList title="Enabled gems" added={comparison.addedGems} removed={comparison.removedGems}/>
      <ChangeList title="Passive nodes" added={comparison.addedNodes.map(String)} removed={comparison.removedNodes.map(String)}/>
    </div>
    <section className="upgrade-stat-evidence">
      <header><strong>PoB numeric output differences</strong><small>{comparison.stats.length} changed outputs · sorted by absolute difference, not quality</small></header>
      {!comparison.stats.length && <p>No numeric output changed between these two calculations.</p>}
      {groups.map((category) => <div key={category} className="upgrade-stat-group">
        <h3>{categoryLabels[category] || category}</h3>
        <div className="upgrade-stat-table" role="table" aria-label={`${categoryLabels[category] || category} output differences`}>
          <div className="upgrade-stat-head" role="row"><span>Output</span><span>Baseline</span><span>Candidate</span><span>Difference</span></div>
          {comparison.stats.filter((stat) => stat.category === category).map((stat) => <div role="row" key={stat.name}>
            <span title={stat.name}>{stat.label}</span>
            <span>{formatPobStatValue({ name: stat.name, value: stat.before, percent: stat.percent })}</span>
            <span>{formatPobStatValue({ name: stat.name, value: stat.after, percent: stat.percent })}</span>
            <span className={stat.delta > 0 ? "is-positive" : "is-negative"}>{formatStatDifference(stat)}</span>
          </div>)}
        </div>
      </div>)}
    </section>
  </div>;
}

function FactEvidence({ changes }: { changes: ReturnType<typeof buildUpgradeFactChanges> }) {
  if (!changes.length) return null;
  return <section className="upgrade-fact-evidence">
    <header><strong>Build settings</strong><small>{changes.length} exact differences</small></header>
    <div>{changes.map((change) => <div key={change.label}><strong>{change.label}</strong><span>{change.before}</span><ArrowRight size={11}/><span>{change.after}</span></div>)}</div>
  </section>;
}

function WarningList({ title, warnings }: { title: string; warnings: string[] }) {
  if (!warnings.length) return null;
  return <section className="upgrade-warnings"><header><AlertTriangle size={13}/><strong>{title}</strong></header><ul>{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></section>;
}

export function BuildUpgradeAssistant({ current, savedBuilds, engineCapability, onOpenBuilds, onImportSnapshot }: BuildUpgradeAssistantProps) {
  const options = useMemo<SnapshotOption[]>(() => [
    ...(isDesktop && current ? [{ key: "current", kind: "current" as const, snapshot: current }] : []),
    ...savedBuilds.map((snapshot) => ({ key: `saved:${snapshot.id}`, kind: "saved" as const, snapshot })),
  ], [current, savedBuilds]);
  const [baselineKey, setBaselineKey] = useState("");
  const [candidateKey, setCandidateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AuthoritativeBuildUpgradeComparison | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const latestFingerprints = useRef(new Map<string, string>());
  latestFingerprints.current = new Map(options.map((option) => [option.key, buildUpgradeSnapshotFingerprint(option.snapshot)]));

  const optionKey = options.map((option) => option.key).join("\u0000");
  useEffect(() => {
    setBaselineKey((value) => options.some((option) => option.key === value)
      ? value
      : [...options].reverse().find((option) => option.kind === "saved")?.key || "");
    setCandidateKey((value) => {
      if (options.some((option) => option.key === value)) return value;
      if (isDesktop && options.some((option) => option.key === "current")) return "current";
      return options.find((option) => option.kind === "saved")?.key || "";
    });
  }, [optionKey]);

  useEffect(() => {
    setResult(null);
    setError("");
  }, [baselineKey, candidateKey]);

  const baselineOption = options.find((option) => option.key === baselineKey) || null;
  const candidateOption = options.find((option) => option.key === candidateKey) || null;
  const sameSelection = Boolean(baselineOption && candidateOption && baselineOption.key === candidateOption.key);
  const snapshotComparison = baselineOption && candidateOption && !sameSelection
    ? comparePlannerBuilds(candidateOption.snapshot, baselineOption.snapshot)
    : null;

  const recalculateBoth = async () => {
    if (!baselineOption || !candidateOption || sameSelection || engineCapability?.ok !== true) return;
    const baseline = baselineOption.snapshot;
    const candidate = candidateOption.snapshot;
    const baselineFingerprint = buildUpgradeSnapshotFingerprint(baseline);
    const candidateFingerprint = buildUpgradeSnapshotFingerprint(candidate);
    const selectionsAreCurrent = () => (
      latestFingerprints.current.get(baselineOption.key) === baselineFingerprint
      && latestFingerprints.current.get(candidateOption.key) === candidateFingerprint
    );
    setBusy(true);
    setError("");
    setResult(null);
    try {
      assertComparableBuildUpgradeSnapshots(baseline, candidate);
      const baselineXml = serializeBuildUpgradeSnapshot(baseline);
      const candidateXml = serializeBuildUpgradeSnapshot(candidate);
      const baselineResult = await bridge.calculatePobBuild({ xml: baselineXml, name: `${baseline.name} · upgrade baseline` });
      if (!selectionsAreCurrent()) throw new Error("A selected build changed while PoB was calculating. No comparison was kept; run it again.");
      if (!baselineResult.ok) {
        throw new Error(`Baseline recalculation failed: ${baselineResult.message}${baselineResult.detail ? ` ${baselineResult.detail}` : ""}`);
      }
      const candidateResult = await bridge.calculatePobBuild({ xml: candidateXml, name: `${candidate.name} · upgrade candidate` });
      if (!selectionsAreCurrent()) throw new Error("A selected build changed while PoB was calculating. No comparison was kept; run it again.");
      setResult(buildAuthoritativeUpgradeComparison(baseline, candidate, baselineResult, candidateResult));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!options.length || (!isDesktop && savedBuilds.length < 2)) {
    return <div className="upgrade-assistant upgrade-empty">
      <Cpu size={30}/><h2>Save two builds to compare</h2>
      <p>{isDesktop ? "Save at least one baseline in Build Library; the current workspace can be the candidate." : "Mobile comparison uses saved snapshots only. Import two GloamCore build snapshots exported from Build Library on Windows."}</p>
      {isDesktop ? <button type="button" onClick={onOpenBuilds}>Open Build Library</button> : onImportSnapshot && <button type="button" onClick={() => setImportOpen((value) => !value)}>Import saved snapshot</button>}
      {importOpen && onImportSnapshot && <section className="upgrade-import">
        <textarea aria-label="Saved GloamCore build snapshot JSON" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste one exported GloamCore build JSON snapshot…"/>
        <button type="button" disabled={!importText.trim()} onClick={() => {
          const imported = onImportSnapshot(importText);
          if (imported.ok) {
            setImportText("");
            setImportOpen(false);
            setError("");
          } else {
            setError(imported.message);
          }
        }}>Add to comparison library</button>
        {error && <p className="upgrade-import-error">{error}</p>}
      </section>}
    </div>;
  }

  const shownComparison = result?.comparison || snapshotComparison;
  const shownFacts = baselineOption && candidateOption && !sameSelection
    ? buildUpgradeFactChanges(result?.baseline || baselineOption.snapshot, result?.candidate || candidateOption.snapshot)
    : [];
  return <div className="upgrade-assistant">
    <header className="upgrade-hero">
      <div><small>Build Lab · deterministic comparison</small><h2>Upgrade Assistant</h2><p>Choose a baseline and candidate. GloamCore reports exact differences; it does not invent a score, rank, or recommendation.</p></div>
      <div className="upgrade-hero-actions">{!isDesktop && onImportSnapshot && <button type="button" onClick={() => setImportOpen((value) => !value)}>Import snapshot</button>}<span className={result ? "is-authoritative" : ""}>{result ? <CheckCircle2 size={14}/> : <Cpu size={14}/>} {result ? "Authoritative result" : isDesktop ? "PoB verification required" : "Snapshot-only mode"}</span></div>
    </header>

    {importOpen && onImportSnapshot && <section className="upgrade-import is-inline"><textarea aria-label="Saved GloamCore build snapshot JSON" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste one exported GloamCore build JSON snapshot…"/><button type="button" disabled={!importText.trim()} onClick={() => { const imported = onImportSnapshot(importText); if (imported.ok) { setImportText(""); setImportOpen(false); setError(""); } else setError(imported.message); }}>Add snapshot</button></section>}

    <section className="upgrade-flow">
      <SnapshotCard title="Baseline" value={baselineKey} options={options} onChange={setBaselineKey}/>
      <ArrowRight className="upgrade-flow-arrow" size={18}/>
      <SnapshotCard title="Candidate" value={candidateKey} options={options} onChange={setCandidateKey}/>
    </section>

    {sameSelection && <div className="upgrade-notice is-error"><AlertTriangle size={14}/> Choose two different builds.</div>}
    {isDesktop ? <section className="upgrade-engine">
      <div className={engineCapability?.ok ? "is-ready" : "is-unavailable"}><span/><strong>{engineCapability?.ok ? `Installed PoB ${engineCapability.engine.number}` : "Authoritative PoB unavailable"}</strong><small>{engineCapability?.ok ? `${engineCapability.engine.branch} · ${engineCapability.engine.platform} · isolated read-only process` : engineCapability?.message || "Checking the local engine…"}</small></div>
      <button type="button" onClick={recalculateBoth} disabled={busy || sameSelection || !baselineOption || !candidateOption || engineCapability?.ok !== true}>{busy ? <LoaderCircle className="is-spinning" size={14}/> : <RefreshCw size={14}/>} {busy ? "Recalculating both…" : "Recalculate both with PoB"}</button>
    </section> : <div className="upgrade-notice is-warning"><AlertTriangle size={14}/><span><strong>Snapshot-only · not authoritative</strong> Mobile cannot run Path of Building. Values below are saved outputs and may be stale; verify the same pair on Windows before making a decision.</span></div>}

    {error && <div className="upgrade-notice is-error"><AlertTriangle size={14}/><span><strong>No comparison was produced.</strong> {error}</span></div>}

    {result && <section className="upgrade-verification">
      <div><CheckCircle2 size={15}/><span><strong>Both sides recalculated successfully</strong><small>{result.engine.name} {result.engine.version} · {result.engine.branch} · {result.engine.platform} {result.engine.runtimeArchitecture}</small></span></div>
      <small>Baseline {(result.baselineDurationMilliseconds / 1000).toFixed(2)}s · Candidate {(result.candidateDurationMilliseconds / 1000).toFixed(2)}s</small>
    </section>}

    {!result && shownComparison && <div className="upgrade-notice is-preview"><AlertTriangle size={14}/><span><strong>Stored snapshot preview · not authoritative.</strong> {isDesktop ? "Run both builds through the installed PoB engine to replace this preview with verified outputs." : "These values are presented only as previously saved evidence."}</span></div>}
    {shownFacts.length > 0 && <div className="upgrade-fact-wrap"><FactEvidence changes={shownFacts}/></div>}
    {shownComparison && <ComparisonEvidence comparison={shownComparison}/>}
    {result && <div className="upgrade-warning-grid"><WarningList title="Baseline PoB warnings" warnings={result.baselineWarnings}/><WarningList title="Candidate PoB warnings" warnings={result.candidateWarnings}/></div>}
  </div>;
}
