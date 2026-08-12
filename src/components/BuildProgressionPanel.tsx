import { ArrowRight, GitBranch, Package, ShoppingCart, Swords } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { bridge } from "../lib/bridge";
import {
  activePobGear,
  derivePobBuildProgression,
  pobGearTradeHandoff,
  type PobAuthoredStage,
} from "../lib/planner/build-progression";
import type { ImportedPobBuild } from "../lib/planner/pob-build";

function Timeline({ title, stages, icon }: {
  title: string;
  stages: PobAuthoredStage[];
  icon: ReactNode;
}) {
  return (
    <section className="progression-timeline">
      <header>{icon}<span><strong>{title}</strong><small>{stages.length} PoB-authored stage{stages.length === 1 ? "" : "s"}</small></span></header>
      {stages.length ? stages.map((stage, index) => (
        <article key={stage.id}>
          <i>{index + 1}</i>
          <div>
            <strong>{stage.title}</strong>
            <small>{stage.count} entries · +{stage.added.length} / −{stage.removed.length}</small>
            {(stage.added.length > 0 || stage.removed.length > 0) && (
              <details>
                <summary>Exact changes</summary>
                {stage.added.slice(0, 24).map((entry, index) => <p className="is-added" key={`add:${index}:${entry}`}>+ {entry}</p>)}
                {stage.removed.slice(0, 24).map((entry, index) => <p className="is-removed" key={`remove:${index}:${entry}`}>− {entry}</p>)}
              </details>
            )}
          </div>
        </article>
      )) : <p className="progression-empty">This PoB has no authored {title.toLocaleLowerCase()} stages.</p>}
    </section>
  );
}

export function BuildProgressionPanel({ build, league }: {
  build: ImportedPobBuild | null;
  league: string;
}) {
  const progression = useMemo(() => build ? derivePobBuildProgression(build) : null, [build]);
  const gear = useMemo(() => build ? activePobGear(build) : [], [build]);
  if (!build || !progression) {
    return <div className="progression-empty-shell"><GitBranch size={28}/><h2>Import a Path of Building build</h2><p>Progression is shown only from the build’s authored tree, skill and item sets. GloamCore never invents act or level milestones.</p></div>;
  }
  return (
    <div className="build-progression">
      <header className="progression-hero">
        <div><small>DETERMINISTIC POB PROGRESSION</small><h2>{build.ascendancyName || build.className}</h2><p>Stage names and changes come directly from this Path of Building file. No campaign milestones are inferred.</p></div>
        <span>{league || "Choose a league"}</span>
      </header>
      <div className="progression-grid">
        <Timeline title="Passive specs" stages={progression.passive} icon={<GitBranch size={16}/>}/>
        <Timeline title="Skill sets" stages={progression.skills} icon={<Swords size={16}/>}/>
        <Timeline title="Item sets" stages={progression.items} icon={<Package size={16}/>}/>
      </div>
      <section className="progression-shopping">
        <header><ShoppingCart size={17}/><span><strong>Official Trade gear handoffs</strong><small>User-clicked browser searches only · no listings are fetched</small></span></header>
        <div>
          {gear.map(({ slot, item }) => {
            const handoff = pobGearTradeHandoff(item, league);
            return (
              <article key={`${slot}:${item.id}`}>
                <span><small>{slot}</small><strong>{item.name || item.baseType}</strong><em>{handoff?.label || "Trade unavailable"}</em></span>
                <p>{handoff?.warning || "Select an active league before opening Official Trade."}</p>
                <button type="button" disabled={!handoff} onClick={() => handoff && void bridge.openExternal(handoff.url)}>Open Official Trade <ArrowRight size={13}/></button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
