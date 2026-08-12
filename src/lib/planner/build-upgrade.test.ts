import { describe, expect, it } from "vitest";
import type { PobEngineCalculationResult, PobEngineCalculationSuccess } from "../../types";
import {
  buildAuthoritativeUpgradeComparison,
  buildUpgradeFactChanges,
  buildUpgradeSnapshotFingerprint,
  serializeBuildUpgradeSnapshot,
} from "./build-upgrade";
import { emptyPobBuild, type ImportedPassiveSpec } from "./pob-build";
import { createPlannerSnapshot, type PlannerWorkspaceSnapshot } from "./planner-workspace";

const spec: ImportedPassiveSpec = {
  id: "spec-1",
  title: "Main",
  treeVersion: "3_29",
  classId: 0,
  ascendClassId: 0,
  secondaryAscendClassId: 0,
  clusterHashFormatVersion: 2,
  nodes: [1, 2],
  masteryEffects: {},
};

function snapshot(name: string, dps: number, nodeIds = [1, 2]): PlannerWorkspaceSnapshot {
  const build = {
    ...emptyPobBuild("Scion"),
    level: 90,
    playerStats: [{ name: "TotalDPS", label: "Total DPS", value: dps, category: "offence" as const, percent: false }],
    statSource: "pob-engine" as const,
    specs: [{ ...spec, nodes: nodeIds }],
  };
  return createPlannerSnapshot({
    id: name.toLowerCase(),
    name,
    treeVersion: "3_29",
    build,
    specs: build.specs,
    activeSpecId: spec.id,
    classId: 0,
    ascendancyId: 0,
    allocated: nodeIds,
    editedSinceImport: false,
    now: 100,
  });
}

function success(stats: Record<string, number>, version = "2.60.3"): PobEngineCalculationSuccess {
  return {
    ok: true,
    authoritative: true,
    engine: {
      name: "Path of Building Community",
      version,
      branch: "dev",
      platform: "win32",
      runtimeArchitecture: "x64",
      root: "C:\\Path of Building Community",
      manifestFingerprint: version.padEnd(64, "a"),
      sourceFingerprint: "b".repeat(64),
      hostFingerprint: "c".repeat(64),
      bridgeFingerprint: "d".repeat(64),
    },
    calculation: {
      scalarCount: Object.keys(stats).length,
      stats,
      warnings: [],
      mainSocketGroup: 1,
      mainSkillName: null,
      skillGroups: [],
      items: [],
      gemCatalog: [],
      configCatalog: [],
      className: "Scion",
      ascendancyName: "None",
      targetVersion: "3_0",
      engineMilliseconds: 10,
    },
    durationMilliseconds: 20,
    isolation: { freshProcess: true, installedPobReadOnly: true, noGuiLaunch: true },
  };
}

describe("deterministic build upgrade comparison", () => {
  it("serializes the exact selected tree, configuration, skills, and items for PoB", () => {
    const value = snapshot("Candidate", 100, [1, 2, 7]);
    value.build!.notes = "candidate evidence";
    value.build!.config = { conditionBoss: true };
    const xml = serializeBuildUpgradeSnapshot(value);
    expect(xml).toContain('nodes="1,2,7"');
    expect(xml).toContain("candidate evidence");
    expect(xml).toContain('name="conditionBoss" boolean="true"');
  });

  it("uses only fresh outputs from the same authoritative PoB engine", () => {
    const baseline = snapshot("Baseline", 1);
    const candidate = snapshot("Candidate", 9, [1, 2, 7]);
    const result = buildAuthoritativeUpgradeComparison(
      baseline,
      candidate,
      success({ TotalDPS: 100, Life: 4000 }),
      success({ TotalDPS: 125, Life: 3900 }),
    );
    expect(result.comparison.addedNodes).toEqual([7]);
    expect(result.comparison.stats.find((entry) => entry.name === "TotalDPS")).toMatchObject({ before: 100, after: 125, delta: 25 });
    expect(result.comparison.stats.find((entry) => entry.name === "Life")).toMatchObject({ before: 4000, after: 3900, delta: -100 });
    expect(result.baseline.build?.statSource).toBe("pob-engine");
    expect(result.candidate.build?.statSource).toBe("pob-engine");
  });

  it("reports exact build-setting changes without interpreting whether they are better", () => {
    const baseline = snapshot("Baseline", 1);
    const candidate = snapshot("Candidate", 2);
    baseline.build!.bandit = "Alira";
    candidate.build!.bandit = "None";
    baseline.build!.config = { conditionBoss: false, multiplierWitheredStackCount: 5 };
    candidate.build!.config = { conditionBoss: true, multiplierWitheredStackCount: 10 };
    expect(buildUpgradeFactChanges(baseline, candidate)).toEqual(expect.arrayContaining([
      { label: "Bandit choice", before: "Alira", after: "None" },
      { label: "Config · conditionBoss", before: "Disabled", after: "Enabled" },
      { label: "Config · multiplierWitheredStackCount", before: "5", after: "10" },
    ]));
  });

  it("fails closed on one failed calculation and never produces a partial comparison", () => {
    const failure: PobEngineCalculationResult = { ok: false, authoritative: false, code: "POB_FAILED", message: "PoB rejected the build" };
    expect(() => buildAuthoritativeUpgradeComparison(snapshot("Baseline", 1), snapshot("Candidate", 2), success({ TotalDPS: 100 }), failure))
      .toThrow("Candidate recalculation failed");
  });

  it("fails closed when the engine changes between sides", () => {
    expect(() => buildAuthoritativeUpgradeComparison(
      snapshot("Baseline", 1),
      snapshot("Candidate", 2),
      success({ TotalDPS: 100 }, "2.60.3"),
      success({ TotalDPS: 101 }, "2.60.4"),
    )).toThrow("engine changed");
  });

  it("rejects an incomplete verified-engine identity", () => {
    const incomplete = success({ TotalDPS: 100 });
    incomplete.engine.hostFingerprint = "";
    expect(() => buildAuthoritativeUpgradeComparison(
      snapshot("Baseline", 1),
      snapshot("Candidate", 2),
      incomplete,
      success({ TotalDPS: 101 }),
    )).toThrow("incomplete verified PoB engine identity");
  });

  it("rejects cross-tree-version comparisons before treating them as evidence", () => {
    const candidate = { ...snapshot("Candidate", 2), treeVersion: "3_30" };
    expect(() => buildAuthoritativeUpgradeComparison(snapshot("Baseline", 1), candidate, success({ TotalDPS: 100 }), success({ TotalDPS: 101 })))
      .toThrow("different passive-tree versions");
  });

  it("ignores names and timestamps but invalidates calculations when build content changes", () => {
    const original = snapshot("Candidate", 2);
    const renamed = { ...original, name: "Renamed", updatedAt: 999 };
    const edited = { ...renamed, allocated: [...renamed.allocated, 8] };
    expect(buildUpgradeSnapshotFingerprint(renamed)).toBe(buildUpgradeSnapshotFingerprint(original));
    expect(buildUpgradeSnapshotFingerprint(edited)).not.toBe(buildUpgradeSnapshotFingerprint(original));
  });
});
