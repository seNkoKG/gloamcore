import { normalizeImportedPassiveSpecs, normalizeImportedPobBuild, type ImportedPassiveSpec, type ImportedPobBuild, type ImportedPobStat, type PobStatCategory } from "./pob-build";

export const SAVED_PLANNER_BUILDS_KEY = "ninja-lens:saved-planner-builds:v1";
export const MAX_SAVED_PLANNER_BUILDS = 40;
export const MAX_SAVED_PLANNER_LIBRARY_BYTES = 4 * 1024 * 1024;

export type SavedPlannerLibraryErrorCode =
  | "INVALID_JSON"
  | "INVALID_LIBRARY"
  | "INVALID_BUILD"
  | "LIBRARY_TOO_LARGE";

export class SavedPlannerLibraryError extends Error {
  readonly code: SavedPlannerLibraryErrorCode;

  constructor(code: SavedPlannerLibraryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SavedPlannerLibraryError";
    this.code = code;
  }
}

export interface PlannerWorkspaceSnapshot {
  format: "ninja-lens-build";
  version: 2;
  id: string;
  name: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  game: "poe1" | "poe2";
  treeVersion: string;
  build: ImportedPobBuild | null;
  specs: ImportedPassiveSpec[];
  activeSpecId: string;
  classId: number;
  ascendancyId: number;
  allocated: number[];
  editedSinceImport: boolean;
}

export interface PlannerBuildComparison {
  addedNodes: number[];
  removedNodes: number[];
  addedItems: string[];
  removedItems: string[];
  addedGems: string[];
  removedGems: string[];
  stats: Array<{
    name: string;
    label: string;
    before: number;
    after: number;
    delta: number;
    percent: boolean;
    category: PobStatCategory;
  }>;
}

function text(value: unknown, maximum = 120) {
  return String(value || "").replace(/[\0\r\n]+/g, " ").trim().slice(0, maximum);
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ids(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((entry) => Number.isSafeInteger(entry) && entry >= 0))];
}

function tags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry, 32)).filter(Boolean))].slice(0, 12);
}

function snapshotName(build: ImportedPobBuild | null, fallback: string) {
  if (build) return `${build.ascendancyName || build.className} · Level ${build.level}`;
  return fallback || "Untitled build";
}

export function createPlannerSnapshot(input: {
  id?: string;
  name?: string;
  tags?: string[];
  game: "poe1" | "poe2";
  treeVersion: string;
  build: ImportedPobBuild | null;
  specs: ImportedPassiveSpec[];
  activeSpecId: string;
  classId: number;
  ascendancyId: number;
  allocated: Iterable<number>;
  editedSinceImport: boolean;
  createdAt?: number;
  now?: number;
}): PlannerWorkspaceSnapshot {
  const now = input.now ?? Date.now();
  return {
    format: "ninja-lens-build",
    version: 2,
    id: input.id || crypto.randomUUID(),
    name: text(input.name, 120) || snapshotName(input.build, "Untitled build"),
    tags: tags(input.tags),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    game: input.game,
    treeVersion: text(input.treeVersion, 24),
    build: input.build,
    specs: input.specs,
    activeSpecId: text(input.activeSpecId, 160),
    classId: finite(input.classId),
    ascendancyId: finite(input.ascendancyId),
    allocated: ids([...input.allocated]),
    editedSinceImport: Boolean(input.editedSinceImport),
  };
}

export function sanitizePlannerSnapshot(value: unknown): PlannerWorkspaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PlannerWorkspaceSnapshot> & { version?: number };
  if (candidate.format !== "ninja-lens-build" || !Array.isArray(candidate.allocated)) return null;
  const now = Date.now();
  const build = normalizeImportedPobBuild(candidate.build || null);
  const specs = normalizeImportedPassiveSpecs(candidate.specs);
  const requestedSpecId = text(candidate.activeSpecId, 160);
  const activeSpecId = specs.some((spec) => spec.id === requestedSpecId) ? requestedSpecId : specs[0]?.id || "";
  const activeSpec = specs.find((spec) => spec.id === activeSpecId);
  return {
    format: "ninja-lens-build",
    version: 2,
    id: text(candidate.id, 160) || crypto.randomUUID(),
    name: text(candidate.name, 120) || snapshotName(build, "Imported workspace"),
    tags: tags(candidate.tags),
    createdAt: finite(candidate.createdAt, now),
    updatedAt: finite(candidate.updatedAt, now),
    game: candidate.game === "poe2" || /^0_/.test(text(candidate.treeVersion, 24)) ? "poe2" : "poe1",
    treeVersion: text(candidate.treeVersion, 24),
    build,
    specs,
    activeSpecId,
    classId: finite(candidate.classId, activeSpec?.classId || 0),
    ascendancyId: finite(candidate.ascendancyId, activeSpec?.ascendClassId || 0),
    allocated: ids(candidate.allocated),
    editedSinceImport: Boolean(candidate.editedSinceImport),
  };
}

function savedPlannerLibraryBytes(raw: string) {
  return new TextEncoder().encode(raw).byteLength;
}

function assertSavedPlannerLibrarySize(raw: string) {
  const bytes = savedPlannerLibraryBytes(raw);
  if (bytes > MAX_SAVED_PLANNER_LIBRARY_BYTES) {
    const size = (bytes / (1024 * 1024)).toFixed(1);
    const limit = MAX_SAVED_PLANNER_LIBRARY_BYTES / (1024 * 1024);
    throw new SavedPlannerLibraryError(
      "LIBRARY_TOO_LARGE",
      `The saved build library is ${size} MB; the safe limit is ${limit} MB.`,
    );
  }
}

export function parseSavedPlannerBuilds(raw: string | null) {
  if (raw === null) return [] as PlannerWorkspaceSnapshot[];
  assertSavedPlannerLibrarySize(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SavedPlannerLibraryError(
      "INVALID_JSON",
      "The saved build library contains invalid JSON.",
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new SavedPlannerLibraryError(
      "INVALID_LIBRARY",
      "The saved build library is not a supported build list.",
    );
  }
  const builds = parsed.map((value, index) => {
    const snapshot = sanitizePlannerSnapshot(value);
    if (!snapshot) {
      throw new SavedPlannerLibraryError(
        "INVALID_BUILD",
        `Saved build ${index + 1} is not a supported Ninja Lens workspace.`,
      );
    }
    return snapshot;
  });
  return builds
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SAVED_PLANNER_BUILDS);
}

export function serializeSavedPlannerBuilds(builds: readonly PlannerWorkspaceSnapshot[]) {
  const serialized = JSON.stringify(builds);
  assertSavedPlannerLibrarySize(serialized);
  return serialized;
}

export async function recoverSavedPlannerLibrary(input: {
  storage: Pick<Storage, "getItem" | "removeItem">;
  saveRecoveryCopy: (original: string) => Promise<{ name: string } | null>;
}) {
  const original = input.storage.getItem(SAVED_PLANNER_BUILDS_KEY);
  if (original === null) return { status: "missing" as const };
  const saved = await input.saveRecoveryCopy(original);
  if (!saved) return { status: "cancelled" as const };
  input.storage.removeItem(SAVED_PLANNER_BUILDS_KEY);
  if (input.storage.getItem(SAVED_PLANNER_BUILDS_KEY) !== null) {
    throw new Error("The browser storage entry could not be removed.");
  }
  return { status: "recovered" as const, backupName: saved.name };
}

export function upsertSavedPlannerBuild(
  builds: readonly PlannerWorkspaceSnapshot[],
  snapshot: PlannerWorkspaceSnapshot,
) {
  return [snapshot, ...builds.filter((entry) => entry.id !== snapshot.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SAVED_PLANNER_BUILDS);
}

function itemKeys(build: ImportedPobBuild | null) {
  return new Set((build?.items || []).filter((item) => item.equipped).map((item) => `${item.slot}: ${item.name || item.baseType}`));
}

function gemKeys(build: ImportedPobBuild | null) {
  return new Set((build?.skillGroups || []).filter((group) => group.enabled).flatMap((group) => group.gems.filter((gem) => gem.enabled).map((gem) => `${group.slot}: ${gem.name} ${gem.level}/${gem.quality}`)));
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return [...left].filter((entry) => !right.has(entry)).sort();
}

function statMap(build: ImportedPobBuild | null) {
  return new Map((build?.playerStats || []).map((stat) => [stat.name, stat]));
}

export function comparePlannerBuilds(
  current: Pick<PlannerWorkspaceSnapshot, "build" | "allocated">,
  baseline: Pick<PlannerWorkspaceSnapshot, "build" | "allocated">,
): PlannerBuildComparison {
  const currentNodes = new Set(current.allocated);
  const baselineNodes = new Set(baseline.allocated);
  const currentItems = itemKeys(current.build);
  const baselineItems = itemKeys(baseline.build);
  const currentGems = gemKeys(current.build);
  const baselineGems = gemKeys(baseline.build);
  const currentStats = statMap(current.build);
  const baselineStats = statMap(baseline.build);
  const statNames = new Set([...currentStats.keys(), ...baselineStats.keys()]);
  const stats = [...statNames].map((name) => {
    const after = currentStats.get(name);
    const before = baselineStats.get(name);
    return {
      name,
      label: after?.label || before?.label || name,
      before: before?.value || 0,
      after: after?.value || 0,
      delta: (after?.value || 0) - (before?.value || 0),
      percent: after?.percent ?? before?.percent ?? false,
      category: after?.category || before?.category || "other",
    };
  }).filter((entry) => entry.delta !== 0).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  return {
    addedNodes: [...currentNodes].filter((id) => !baselineNodes.has(id)).sort((a, b) => a - b),
    removedNodes: [...baselineNodes].filter((id) => !currentNodes.has(id)).sort((a, b) => a - b),
    addedItems: difference(currentItems, baselineItems),
    removedItems: difference(baselineItems, currentItems),
    addedGems: difference(currentGems, baselineGems),
    removedGems: difference(baselineGems, currentGems),
    stats,
  };
}

export function groupPobStats(stats: readonly ImportedPobStat[]) {
  const grouped = new Map<PobStatCategory, ImportedPobStat[]>();
  for (const stat of stats) grouped.set(stat.category, [...(grouped.get(stat.category) || []), stat]);
  return grouped;
}

export function formatPobStatValue(stat: Pick<ImportedPobStat, "value" | "percent" | "name">) {
  const value = stat.value;
  if (!Number.isFinite(value)) return "—";
  if (stat.name === "CritMultiplier") return `${Number((value * 100).toFixed(1))}%`;
  if (stat.name === "EffectiveMovementSpeedMod") return `${Number((value * 100).toFixed(1))}%`;
  const absolute = Math.abs(value);
  const formatted = absolute >= 1_000_000
    ? `${Number((value / 1_000_000).toFixed(2))}m`
    : absolute >= 10_000
      ? `${Number((value / 1_000).toFixed(1))}k`
      : Number(value.toFixed(2)).toLocaleString("en-US");
  return `${formatted}${stat.percent ? "%" : ""}`;
}
