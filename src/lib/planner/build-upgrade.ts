import type {
  PobEngineCalculationResult,
  PobEngineCalculationSuccess,
  PobEngineScalar,
  PobEngineSkillGroup,
} from "../../types";
import {
  pobStatCategory,
  pobStatLabel,
  pobStatPercent,
  serializePobXml,
  type ImportedPobBuild,
} from "./pob-build";
import {
  comparePlannerBuilds,
  type PlannerBuildComparison,
  type PlannerWorkspaceSnapshot,
} from "./planner-workspace";

export interface AuthoritativeBuildUpgradeComparison {
  baseline: PlannerWorkspaceSnapshot;
  candidate: PlannerWorkspaceSnapshot;
  comparison: PlannerBuildComparison;
  engine: PobEngineCalculationSuccess["engine"];
  baselineWarnings: string[];
  candidateWarnings: string[];
  baselineDurationMilliseconds: number;
  candidateDurationMilliseconds: number;
}

export interface BuildUpgradeFactChange {
  label: string;
  before: string;
  after: string;
}

function normalizedTreeVersion(value: string) {
  return value.trim().replace(/_/g, ".");
}

export function assertComparableBuildUpgradeSnapshots(
  baseline: PlannerWorkspaceSnapshot,
  candidate: PlannerWorkspaceSnapshot,
) {
  if (!baseline.build || !candidate.build) {
    throw new Error("Both sides must contain a complete Path of Building build.");
  }
  if (!baseline.specs.length || !candidate.specs.length) {
    throw new Error("Both sides must contain an exact passive-tree specification.");
  }
  if (normalizedTreeVersion(baseline.treeVersion) !== normalizedTreeVersion(candidate.treeVersion)) {
    throw new Error("The baseline and candidate use different passive-tree versions. Migrate and review them before comparing.");
  }
}

export function buildUpgradeSnapshotFingerprint(snapshot: PlannerWorkspaceSnapshot) {
  return JSON.stringify({
    treeVersion: normalizedTreeVersion(snapshot.treeVersion),
    build: snapshot.build,
    specs: snapshot.specs,
    activeSpecId: snapshot.activeSpecId,
    classId: snapshot.classId,
    ascendancyId: snapshot.ascendancyId,
    allocated: snapshot.allocated,
    editedSinceImport: snapshot.editedSinceImport,
  });
}

function factValue(value: string | number | boolean | null | undefined) {
  if (value === undefined || value === null || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  return String(value);
}

function mainSkillName(build: ImportedPobBuild) {
  const group = build.skillGroups[Math.max(0, (build.mainSocketGroup || 1) - 1)];
  if (!group) return "Not set";
  const selected = group.activeSkills?.find((skill) => skill.index === (group.mainActiveSkill || 1));
  return selected?.name || group.gems.find((gem) => gem.enabled && !gem.support)?.name || group.label || group.slot || "Not set";
}

export function buildUpgradeFactChanges(
  baseline: PlannerWorkspaceSnapshot,
  candidate: PlannerWorkspaceSnapshot,
) {
  const changes: BuildUpgradeFactChange[] = [];
  const add = (label: string, before: string | number | boolean | null | undefined, after: string | number | boolean | null | undefined) => {
    const normalizedBefore = factValue(before);
    const normalizedAfter = factValue(after);
    if (normalizedBefore !== normalizedAfter) changes.push({ label, before: normalizedBefore, after: normalizedAfter });
  };
  add("Passive tree", baseline.treeVersion, candidate.treeVersion);
  add("Class", baseline.build?.className, candidate.build?.className);
  add("Ascendancy", baseline.build?.ascendancyName, candidate.build?.ascendancyName);
  add("Character level", baseline.build?.level, candidate.build?.level);
  add("Bandit choice", baseline.build?.bandit, candidate.build?.bandit);
  if (baseline.build && candidate.build) {
    add("Selected main skill", mainSkillName(baseline.build), mainSkillName(candidate.build));
    add("Active item set", baseline.build.activeItemSet, candidate.build.activeItemSet);
    add("Active skill set", baseline.build.activeSkillSet, candidate.build.activeSkillSet);
    const configKeys = [...new Set([...Object.keys(baseline.build.config), ...Object.keys(candidate.build.config)])].sort();
    for (const key of configKeys) add(`Config · ${key}`, baseline.build.config[key], candidate.build.config[key]);
  }
  return changes;
}

export function serializeBuildUpgradeSnapshot(snapshot: PlannerWorkspaceSnapshot) {
  if (!snapshot.build) {
    throw new Error(`${snapshot.name} does not contain a complete Path of Building build.`);
  }
  if (!snapshot.specs.length) {
    throw new Error(`${snapshot.name} does not contain a passive-tree specification.`);
  }
  const activeSpecId = snapshot.specs.some((spec) => spec.id === snapshot.activeSpecId)
    ? snapshot.activeSpecId
    : snapshot.specs[0].id;
  return serializePobXml(snapshot.build, snapshot.specs, activeSpecId);
}

export function playerStatsFromEngine(stats: Record<string, PobEngineScalar>) {
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

export function buildWithEngineCalculation(
  build: ImportedPobBuild,
  calculation: {
    stats: Record<string, PobEngineScalar>;
    mainSocketGroup: number | null;
    skillGroups: PobEngineSkillGroup[];
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
    mainSocketGroup: calculation.mainSocketGroup ?? build.mainSocketGroup,
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

function engineFingerprint(engine: PobEngineCalculationSuccess["engine"]) {
  return [
    engine.name,
    engine.version,
    engine.branch,
    engine.platform,
    engine.runtimeArchitecture,
    engine.root,
    engine.manifestFingerprint,
    engine.sourceFingerprint,
    engine.hostFingerprint,
    engine.bridgeFingerprint,
  ].join("\u0000");
}

function requireSuccessfulCalculation(
  side: "baseline" | "candidate",
  result: PobEngineCalculationResult,
): PobEngineCalculationSuccess {
  if (!result.ok) {
    throw new Error(`${side === "baseline" ? "Baseline" : "Candidate"} recalculation failed: ${result.message}${result.detail ? ` ${result.detail}` : ""}`);
  }
  if (!result.authoritative) {
    throw new Error(`${side === "baseline" ? "Baseline" : "Candidate"} was not returned as an authoritative PoB calculation.`);
  }
  if (typeof result.engine.root !== "string" || result.engine.root.length < 3 || [
    result.engine.manifestFingerprint,
    result.engine.sourceFingerprint,
    result.engine.hostFingerprint,
    result.engine.bridgeFingerprint,
  ].some((value) => typeof value !== "string" || value.length < 32)) {
    throw new Error(`${side === "baseline" ? "Baseline" : "Candidate"} returned an incomplete verified PoB engine identity.`);
  }
  if (!playerStatsFromEngine(result.calculation.stats).length) {
    throw new Error(`${side === "baseline" ? "Baseline" : "Candidate"} recalculation returned no finite numeric PoB outputs.`);
  }
  return result;
}

function calculatedSnapshot(
  snapshot: PlannerWorkspaceSnapshot,
  result: PobEngineCalculationSuccess,
) {
  const xml = serializeBuildUpgradeSnapshot(snapshot);
  return {
    ...snapshot,
    build: {
      ...buildWithEngineCalculation(snapshot.build!, result.calculation),
      xml,
      specs: snapshot.specs,
    },
    editedSinceImport: false,
  };
}

export function buildAuthoritativeUpgradeComparison(
  baseline: PlannerWorkspaceSnapshot,
  candidate: PlannerWorkspaceSnapshot,
  baselineResult: PobEngineCalculationResult,
  candidateResult: PobEngineCalculationResult,
): AuthoritativeBuildUpgradeComparison {
  assertComparableBuildUpgradeSnapshots(baseline, candidate);
  const verifiedBaseline = requireSuccessfulCalculation("baseline", baselineResult);
  const verifiedCandidate = requireSuccessfulCalculation("candidate", candidateResult);
  if (engineFingerprint(verifiedBaseline.engine) !== engineFingerprint(verifiedCandidate.engine)) {
    throw new Error("The installed Path of Building engine changed between calculations. Recalculate both sides again.");
  }
  const calculatedBaseline = calculatedSnapshot(baseline, verifiedBaseline);
  const calculatedCandidate = calculatedSnapshot(candidate, verifiedCandidate);
  return {
    baseline: calculatedBaseline,
    candidate: calculatedCandidate,
    comparison: comparePlannerBuilds(calculatedCandidate, calculatedBaseline),
    engine: verifiedBaseline.engine,
    baselineWarnings: [...verifiedBaseline.calculation.warnings],
    candidateWarnings: [...verifiedCandidate.calculation.warnings],
    baselineDurationMilliseconds: verifiedBaseline.durationMilliseconds,
    candidateDurationMilliseconds: verifiedCandidate.durationMilliseconds,
  };
}
