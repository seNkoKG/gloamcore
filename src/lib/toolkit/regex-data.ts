import type { RegexEntry, RegexEntryMode } from "./poe-regex";
import { normalizePoeSearchText } from "./poe-regex";

export type RegexDataCategoryKind =
  | "modifier"
  | "item"
  | "map-name"
  | "gem"
  | "mechanic";

export interface RegexDataSource {
  id: string;
  label: string;
  kind: "bundled-pack" | "path-of-building" | "wiki-cargo";
  inputSha256: string;
  url?: string;
  repository?: string;
  version?: string;
  retrievedAt?: string;
  upstream?: Record<string, string | number | boolean>;
}

export interface RegexDataEntry {
  id: string;
  label: string;
  searchText: string;
  exact: string;
  sourceIds: string[];
  sourceRefs?: string[];
  tags?: string[];
  metadata?: Record<string, string[]>;
}

export interface RegexDataCategoryEntry {
  entryId: string;
  optimized: string;
}

export type RegexDataOptimization = {
  /** Legacy data: fragments were checked only against their own category. */
  algorithm: "shortest-unique-literal-v1";
  universeSha256: string;
  verified: boolean;
  exactFallbacks: number;
} | {
  /** Safe data: fragments were checked against rendered full-tooltip lines. */
  algorithm: "shortest-full-tooltip-literal-v2";
  corpusSha256: string;
  corpusLines: number;
  verified: boolean;
  exactFallbacks: number;
};

export interface RegexDataCategory {
  id: string;
  label: string;
  kind: RegexDataCategoryKind;
  section: "core" | "bundled-items" | "bundled-stats" | "mechanic";
  description: string;
  sourceIds: string[];
  search: {
    placeholder: string;
    aliases: string[];
    defaultMode: RegexEntryMode;
    supportsWant: boolean;
    supportsAvoid: boolean;
    supportsMatchAny: boolean;
    supportsMatchAll: boolean;
    supportsExact: boolean;
    supportsOptimized: boolean;
  };
  optimization: RegexDataOptimization;
  entries: RegexDataCategoryEntry[];
}

export interface RegexDataPack {
  schema: 1;
  game: "poe1";
  generatedAt: string;
  update: {
    command: string;
    sourceUpdatedAt: string;
  };
  coverage: {
    mapModifiers: {
      positiveSpawnWeightRows: number;
      matchedPages: number;
      matchedModifierRows: number;
      searchableEffectLines: number;
      discardedRewardOnlyRows: number;
      spawnTagCounts: Record<string, number>;
      pobCorroboratedLines?: number;
    };
    bundledSources: {
      baseTypes: number;
      itemProfiles: number;
      uniqueProfiles: number;
      gemProfiles: number;
      statPatterns: number;
    };
  };
  sources: RegexDataSource[];
  limitations: string[];
  entries: RegexDataEntry[];
  categories: RegexDataCategory[];
}

const MAX_ENTRIES = 30_000;
const MAX_CATEGORIES = 100;
const MAX_CATEGORY_ENTRIES = 30_000;
export const EXPECTED_REGEX_PACK_SHA256 = "758707fb396138c3aca8ac8246192103e0ac1ecce3ebaae8ecf9bcd14d01f8e0";
let packPromise: Promise<RegexDataPack | null> | null = null;
let packDiagnostic = "idle";
const packIndexes = new WeakMap<RegexDataPack, ReadonlyMap<string, RegexDataEntry>>();

function validId(value: unknown) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9:._-]{0,127}$/.test(value);
}

function validHash(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validPattern(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 2_000) return false;
  try {
    void new RegExp(value, "iu");
    return true;
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueIds(values: unknown[]): values is Array<{ id: string }> {
  return values.every((entry) => record(entry) && typeof entry.id === "string") &&
    new Set(values.map((entry) => (entry as { id: string }).id)).size === values.length;
}

function validCoverage(value: unknown) {
  if (!record(value) || !record(value.mapModifiers) || !record(value.bundledSources)) {
    return false;
  }
  const maps = value.mapModifiers;
  const bundled = value.bundledSources;
  const counts = [
    maps.positiveSpawnWeightRows,
    maps.matchedPages,
    maps.matchedModifierRows,
    maps.searchableEffectLines,
    maps.discardedRewardOnlyRows,
    ...(maps.pobCorroboratedLines == null ? [] : [maps.pobCorroboratedLines]),
    bundled.baseTypes,
    bundled.itemProfiles,
    bundled.uniqueProfiles,
    bundled.gemProfiles,
    bundled.statPatterns,
  ];
  return counts.every((entry) => Number.isInteger(entry) && (entry as number) >= 0) &&
    record(maps.spawnTagCounts) &&
    Object.values(maps.spawnTagCounts).every((entry) =>
      Number.isInteger(entry) && (entry as number) >= 0
    );
}

export function isValidRegexDataPack(value: unknown): value is RegexDataPack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Partial<RegexDataPack>;
  if (
    pack.schema !== 1 ||
    pack.game !== "poe1" ||
    !validDate(pack.generatedAt) ||
    !validDate(pack.update?.sourceUpdatedAt) ||
    typeof pack.update?.command !== "string" ||
    !validCoverage(pack.coverage) ||
    !Array.isArray(pack.limitations) ||
    !pack.limitations.every((entry) => typeof entry === "string" && entry.length > 0) ||
    !Array.isArray(pack.sources) ||
    !Array.isArray(pack.entries) ||
    !Array.isArray(pack.categories) ||
    pack.entries.length > MAX_ENTRIES ||
    pack.categories.length > MAX_CATEGORIES
  ) return false;

  const sources = pack.sources as RegexDataSource[];
  if (!uniqueIds(sources) || !sources.every((source) =>
    record(source) &&
    validId(source.id) &&
    typeof source.label === "string" &&
    ["bundled-pack", "path-of-building", "wiki-cargo"].includes(source.kind) &&
    validHash(source.inputSha256) &&
    (source.retrievedAt == null || validDate(source.retrievedAt))
  )) return false;
  const sourceIds = new Set(sources.map((source) => source.id));

  const entries = pack.entries as RegexDataEntry[];
  if (!uniqueIds(entries) || !entries.every((entry) =>
    record(entry) &&
    validId(entry.id) &&
    typeof entry.label === "string" &&
    entry.label.length > 0 &&
    entry.label.length <= 1_000 &&
    typeof entry.searchText === "string" &&
    entry.searchText.length > 0 &&
    entry.searchText.length <= 1_000 &&
    validPattern(entry.exact) &&
    Array.isArray(entry.sourceIds) &&
    entry.sourceIds.length > 0 &&
    entry.sourceIds.every((id) => sourceIds.has(id)) &&
    (entry.sourceRefs == null || (Array.isArray(entry.sourceRefs) && entry.sourceRefs.every((ref) =>
      typeof ref === "string" && ref.length <= 500
    ))) &&
    (entry.tags == null || (Array.isArray(entry.tags) && entry.tags.every((tag) =>
      typeof tag === "string" && tag.length <= 100
    ))) &&
    (entry.metadata == null || (
      typeof entry.metadata === "object" &&
      Object.entries(entry.metadata).every(([key, values]) =>
        validId(key) &&
        Array.isArray(values) &&
        values.every((item) => typeof item === "string" && item.length <= 500)
      )
    ))
  )) return false;
  const entryIds = new Set(entries.map((entry) => entry.id));

  const categories = pack.categories as RegexDataCategory[];
  return uniqueIds(categories) && categories.every((category) =>
    record(category) &&
    validId(category.id) &&
    typeof category.label === "string" &&
    category.label.length > 0 &&
    ["modifier", "item", "map-name", "gem", "mechanic"].includes(category.kind) &&
    ["core", "bundled-items", "bundled-stats", "mechanic"].includes(category.section) &&
    typeof category.description === "string" &&
    Array.isArray(category.sourceIds) &&
    category.sourceIds.length > 0 &&
    category.sourceIds.every((id) => sourceIds.has(id)) &&
    typeof category.search?.placeholder === "string" &&
    Array.isArray(category.search?.aliases) &&
    category.search.aliases.every((alias) => typeof alias === "string") &&
    ["want", "avoid"].includes(category.search?.defaultMode) &&
    [
      category.search?.supportsWant,
      category.search?.supportsAvoid,
      category.search?.supportsMatchAny,
      category.search?.supportsMatchAll,
      category.search?.supportsExact,
      category.search?.supportsOptimized,
    ].every((flag) => typeof flag === "boolean") &&
    (category.search.defaultMode === "want"
      ? category.search.supportsWant
      : category.search.supportsAvoid) &&
    (category.search.supportsExact || category.search.supportsOptimized) &&
    (!category.search.supportsWant || category.search.supportsMatchAny || category.search.supportsMatchAll) &&
    (category.optimization?.algorithm === "shortest-unique-literal-v1"
      ? validHash(category.optimization.universeSha256)
      : category.optimization?.algorithm === "shortest-full-tooltip-literal-v2" &&
        validHash(category.optimization.corpusSha256) &&
        Number.isInteger(category.optimization.corpusLines) &&
        category.optimization.corpusLines > 0) &&
    category.optimization.verified === true &&
    Number.isInteger(category.optimization.exactFallbacks) &&
    category.optimization.exactFallbacks >= 0 &&
    Array.isArray(category.entries) &&
    category.entries.length <= MAX_CATEGORY_ENTRIES &&
    category.entries.every((entry) => record(entry)) &&
    new Set(category.entries.map((entry) => entry.entryId)).size === category.entries.length &&
    category.entries.every((entry) =>
      entryIds.has(entry.entryId) && validPattern(entry.optimized)
    )
  );
}

export async function loadRegexDataPack() {
  if (packPromise) return packPromise;
  const current = (async () => {
    try {
      packDiagnostic = "loading";
      const desktopText = await window.poeWidget?.getRegexDataPack?.();
      let text: string;
      if (typeof desktopText === "string") {
        text = desktopText;
      } else {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/toolkit/regex-v1.json?schema=1&sha=${EXPECTED_REGEX_PACK_SHA256}`,
          { cache: "force-cache" },
        );
        if (!response.ok) {
          packDiagnostic = `http:${response.status}`;
          return null;
        }
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== EXPECTED_REGEX_PACK_SHA256) {
          packDiagnostic = "web-integrity-failed";
          return null;
        }
        text = new TextDecoder().decode(bytes);
      }
      const value = JSON.parse(text) as unknown;
      if (!isValidRegexDataPack(value)) {
        packDiagnostic = "invalid-pack";
        return null;
      }
      packDiagnostic = "ready";
      return value;
    } catch (error) {
      packDiagnostic = `error:${error instanceof Error ? error.message : String(error)}`;
      return null;
    }
  })();
  packPromise = current;
  void current.then((value) => {
    if (!value && packPromise === current) packPromise = null;
  });
  return current;
}

/** Clear the successful cache only when the user explicitly requests a reload. */
export function resetRegexDataPackCache() {
  packPromise = null;
  packDiagnostic = "idle";
}

export function regexDataDiagnostic() {
  return packDiagnostic;
}

function packIndex(pack: RegexDataPack) {
  let index = packIndexes.get(pack);
  if (!index) {
    index = new Map(pack.entries.map((entry) => [entry.id, entry]));
    packIndexes.set(pack, index);
  }
  return index;
}

export function regexCategoryEntries(
  pack: RegexDataPack,
  categoryId: string,
  selectedIds: ReadonlySet<string> = new Set(),
  mode?: RegexEntryMode,
): RegexEntry[] {
  const category = pack.categories.find((entry) => entry.id === categoryId);
  if (!category) return [];
  const byId = packIndex(pack);
  const fullTooltipVerified = category.optimization.algorithm === "shortest-full-tooltip-literal-v2";
  return category.entries.flatMap(({ entryId, optimized }) => {
    const entry = byId.get(entryId);
    if (!entry) return [];
    return [{
      id: entry.id,
      label: entry.label,
      text: entry.searchText,
      exactToken: entry.exact,
      ...(fullTooltipVerified
        ? { optimizedToken: optimized }
        : { compactToken: optimized }),
      selected: selectedIds.has(entry.id),
      mode: mode || category.search.defaultMode,
    }];
  });
}

export function searchRegexCategory(
  pack: RegexDataPack,
  categoryId: string,
  query: string,
  limit = 100,
) {
  const category = pack.categories.find((entry) => entry.id === categoryId);
  if (!category || limit <= 0) return [];
  const needle = normalizePoeSearchText(query);
  const byId = packIndex(pack);
  return category.entries.flatMap(({ entryId, optimized }) => {
    const entry = byId.get(entryId);
    if (!entry) return [];
    const haystack = normalizePoeSearchText([
      entry.label,
      entry.searchText,
      ...(entry.tags || []),
    ].join(" "));
    return !needle || haystack.includes(needle) ? [{ ...entry, optimized }] : [];
  }).slice(0, Math.min(1_000, Math.floor(limit)));
}
