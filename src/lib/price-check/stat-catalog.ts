import type {
  ParsedPoeItem,
  ParsedPoeModifier,
  PoeModifierKind,
  TradeStatValueTransform,
} from "./types";
import { resolveMagicBaseType } from "./magic-base-type";
import { isOfficialTradeStatId } from "./trade-stat-id";

export interface TradeStatValueSemantics {
  tokenCount: number;
  indices: number[];
  literals?: Array<[index: number, value: number]>;
  negate?: true;
  constant?: number;
}

export interface TradeStatCatalogCandidate {
  id: string;
  kind: string;
  ref: string;
  /** Exact upstream matcher.string/advanced grammar chosen for this copied line. */
  matcherText: string;
  /** Canonical matcher.string APT renders when advanced grammar matched. */
  displayText?: string;
  /** All resolved-stat display variants, reselected after roll aggregation. */
  displayMatchers?: TradeStatDisplayMatcher[];
  semantics: TradeStatValueSemantics;
  better: -1 | 0 | 1;
  dp?: true;
  inverted?: true;
  option?: true;
  anointments?: Array<{ roll: number; oils: string }>;
  /** Source StatGroup membership; grouped candidates are resolved as a unit. */
  groupId?: number;
  statIndex?: number;
  /** APT applies this only to this ID when serializing a merged OR filter. */
  valueTransform?: TradeStatValueTransform;
}

export interface TradeStatCatalogEntry {
  pattern: string;
  candidates: TradeStatCatalogCandidate[];
  groupIds?: number[];
}

export interface TradeStatCatalogGroupMatcher {
  text: string;
  displayText?: string;
  pattern: string;
  semantics: TradeStatValueSemantics;
}

export interface TradeStatDisplayMatcher {
  text: string;
  negate?: true;
  value?: number;
}

export interface TradeStatCatalogGroupStat {
  ref: string;
  matchers: TradeStatCatalogGroupMatcher[];
  displayMatchers?: TradeStatDisplayMatcher[];
  better: -1 | 0 | 1;
  dp?: true;
  trade: {
    ids: Record<string, string[]>;
    inverted?: true;
    option?: true;
  };
  anointments?: Array<{ roll: number; oils: string }>;
}

export type TradeStatCatalogGroupResolver =
  | { strat: "select"; test: Array<string | null> }
  | { strat: "trivial-merge" }
  | { strat: "percent-merge"; kind: Array<"percent" | "value"> }
  | { strat: "flag-merge"; kind: Array<"flag" | "value"> };

export interface TradeStatCatalogGroup {
  id: number;
  sourceIndex: number;
  resolve: TradeStatCatalogGroupResolver;
  stats: TradeStatCatalogGroupStat[];
}

export interface TradeStatCatalogPack {
  schema: number;
  source: {
    project: string;
    repository: string;
    commit: string;
    dataUpdatedAt: string;
    inputSha256: string;
    resolverGroupsSha256: string;
  };
  generatedAt: string;
  coverage: {
    resolverGroups: number;
    resolverStrategies: Record<string, number>;
  };
  groups: TradeStatCatalogGroup[];
  entries: TradeStatCatalogEntry[];
}

const EXPECTED_SCHEMA = 8;
const EXPECTED_COMMIT = "adb6c287bd978a70701e2b65d744dd677c52fb65";
export const EXPECTED_PACK_SHA256 = "42a6c5722c0a49a65d76155a2d01005e6dc36aa3db6f95a356a7316596bc304c";
const EXPECTED_RESOLVER_GROUPS = 95;
const EXPECTED_RESOLVER_STRATEGIES = {
  "flag-merge": 5,
  "percent-merge": 11,
  select: 41,
  "trivial-merge": 38,
} as const;
const MAX_CATALOG_ENTRIES = 20_000;
let catalogPromise: Promise<TradeStatCatalogPack | null> | null = null;
let catalogDiagnostic = "idle";
const catalogIndexes = new WeakMap<
  TradeStatCatalogPack,
  ReadonlyMap<string, TradeStatCatalogEntry>
>();
const catalogGroupIndexes = new WeakMap<
  TradeStatCatalogPack,
  ReadonlyMap<number, TradeStatCatalogGroup>
>();

async function sha256Hex(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .replace(/<<[^>]+>>/g, "")
    .replace(/[−–—]/g, "-")
    // Advanced descriptions render the copied roll followed by its possible
    // range (for example 12476(10000-18000)). A multi-line stat is rebuilt
    // from raw display text before catalog lookup, so strip that range before
    // replacing numeric tokens or the result becomes the invalid `#(#-#)`.
    .replace(
      /([-+]?\d[\d,]*(?:\.\d+)?)\s*\(\s*[-+]?\d[\d,]*(?:\.\d+)?\s*[\u002d\u2013\u2014\u2212]\s*[-+]?\d[\d,]*(?:\.\d+)?\s*\)/g,
      "$1",
    )
    .replace(/[-+]?\d[\d,]*(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function validSemantics(value: unknown): value is TradeStatValueSemantics {
  if (!value || typeof value !== "object") return false;
  const semantics = value as Partial<TradeStatValueSemantics>;
  return (
    Number.isInteger(semantics.tokenCount) &&
    (semantics.tokenCount as number) >= 0 &&
    (semantics.tokenCount as number) <= 32 &&
    Array.isArray(semantics.indices) &&
    semantics.indices.every(
      (index) =>
        Number.isInteger(index) &&
        index >= 0 &&
        index < (semantics.tokenCount as number),
    ) &&
    (semantics.literals == null ||
      (Array.isArray(semantics.literals) &&
        semantics.literals.every(
          (literal) =>
            Array.isArray(literal) &&
            literal.length === 2 &&
            Number.isInteger(literal[0]) &&
            literal[0] >= 0 &&
            literal[0] < (semantics.tokenCount as number) &&
            Number.isFinite(literal[1]),
        ))) &&
    (semantics.negate == null || semantics.negate === true) &&
    (semantics.constant == null || Number.isFinite(semantics.constant))
  );
}

function validDisplayMatcher(value: unknown): value is TradeStatDisplayMatcher {
  if (!value || typeof value !== "object") return false;
  const matcher = value as Partial<TradeStatDisplayMatcher>;
  return typeof matcher.text === "string" &&
    matcher.text.length > 0 && matcher.text.length <= 2_000 &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(matcher.text) &&
    (matcher.negate == null || matcher.negate === true) &&
    (matcher.value == null || Number.isFinite(matcher.value));
}

function validCandidate(value: unknown): value is TradeStatCatalogCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TradeStatCatalogCandidate>;
  return (
    isOfficialTradeStatId(candidate.id) &&
    typeof candidate.kind === "string" &&
    /^[a-z][a-z0-9_-]{0,31}$/i.test(candidate.kind) &&
    typeof candidate.ref === "string" &&
    candidate.ref.length > 0 &&
    candidate.ref.length <= 512 &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(candidate.ref) &&
    typeof candidate.matcherText === "string" &&
    candidate.matcherText.length > 0 &&
    candidate.matcherText.length <= 2_000 &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(candidate.matcherText) &&
    (candidate.displayText == null || (
      typeof candidate.displayText === "string" &&
      candidate.displayText.length > 0 &&
      candidate.displayText.length <= 2_000 &&
      !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(candidate.displayText)
    )) &&
    (candidate.displayMatchers == null || (
      Array.isArray(candidate.displayMatchers) &&
      candidate.displayMatchers.length > 0 &&
      candidate.displayMatchers.length <= 16 &&
      candidate.displayMatchers.every(validDisplayMatcher)
    )) &&
    validSemantics(candidate.semantics) &&
    (candidate.better === -1 || candidate.better === 0 || candidate.better === 1) &&
    (candidate.dp == null || candidate.dp === true) &&
    (candidate.inverted == null || candidate.inverted === true) &&
    (candidate.option == null || candidate.option === true) &&
    (candidate.valueTransform == null || [
      "empty", "empty-if-100", "div-by-100",
    ].includes(candidate.valueTransform)) &&
    ((candidate.groupId == null && candidate.statIndex == null) || (
      Number.isInteger(candidate.groupId) &&
      (candidate.groupId as number) >= 0 &&
      Number.isInteger(candidate.statIndex) &&
      (candidate.statIndex as number) >= 0
    )) &&
    (candidate.anointments == null || (
      Array.isArray(candidate.anointments) &&
      candidate.anointments.length <= 16 &&
      candidate.anointments.every((entry) =>
        Number.isFinite(entry?.roll) &&
        typeof entry?.oils === "string" &&
        /^\d{1,2}(?:,\d{1,2}){1,2}$/.test(entry.oils)
      )
    ))
  );
}

function validGroupMatcher(value: unknown): value is TradeStatCatalogGroupMatcher {
  if (!value || typeof value !== "object") return false;
  const matcher = value as Partial<TradeStatCatalogGroupMatcher>;
  return (
    typeof matcher.text === "string" &&
    matcher.text.length > 0 &&
    matcher.text.length <= 2_000 &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(matcher.text) &&
    (matcher.displayText == null || (
      typeof matcher.displayText === "string" &&
      matcher.displayText.length > 0 &&
      matcher.displayText.length <= 2_000 &&
      !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(matcher.displayText)
    )) &&
    typeof matcher.pattern === "string" &&
    matcher.pattern.length > 0 &&
    matcher.pattern.length <= 2_000 &&
    validSemantics(matcher.semantics)
  );
}

function validGroupResolver(
  value: unknown,
  statCount: number,
): value is TradeStatCatalogGroupResolver {
  if (!value || typeof value !== "object") return false;
  const resolver = value as Partial<TradeStatCatalogGroupResolver> & {
    test?: unknown[];
    kind?: unknown[];
  };
  if (resolver.strat === "trivial-merge") return true;
  if (resolver.strat === "select") {
    return Array.isArray(resolver.test) &&
      resolver.test.length === statCount &&
      resolver.test.every((entry) => entry === null || (
        typeof entry === "string" && entry.length > 0 && entry.length <= 64
      ));
  }
  if (resolver.strat === "percent-merge") {
    return Array.isArray(resolver.kind) &&
      resolver.kind.length === statCount &&
      resolver.kind.filter((entry) => entry === "percent").length === 1 &&
      resolver.kind.filter((entry) => entry === "value").length === 1;
  }
  if (resolver.strat === "flag-merge") {
    return Array.isArray(resolver.kind) &&
      resolver.kind.length === statCount &&
      resolver.kind.filter((entry) => entry === "flag").length === 1 &&
      resolver.kind.filter((entry) => entry === "value").length === 1;
  }
  return false;
}

function validGroupStat(value: unknown): value is TradeStatCatalogGroupStat {
  if (!value || typeof value !== "object") return false;
  const stat = value as Partial<TradeStatCatalogGroupStat>;
  const ids = stat.trade?.ids;
  return (
    typeof stat.ref === "string" &&
    stat.ref.length > 0 &&
    stat.ref.length <= 512 &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(stat.ref) &&
    Array.isArray(stat.matchers) &&
    stat.matchers.length > 0 &&
    stat.matchers.every(validGroupMatcher) &&
    (stat.displayMatchers == null || (
      Array.isArray(stat.displayMatchers) &&
      stat.displayMatchers.length > 0 &&
      stat.displayMatchers.length <= 16 &&
      stat.displayMatchers.every(validDisplayMatcher)
    )) &&
    (stat.better === -1 || stat.better === 0 || stat.better === 1) &&
    (stat.dp == null || stat.dp === true) &&
    ids != null && typeof ids === "object" &&
    Object.entries(ids).length > 0 &&
    Object.entries(ids).every(([kind, values]) =>
      /^[a-z][a-z0-9_-]{0,31}$/i.test(kind) &&
      Array.isArray(values) &&
      values.length > 0 &&
      values.every(isOfficialTradeStatId)
    ) &&
    (stat.trade?.inverted == null || stat.trade.inverted === true) &&
    (stat.trade?.option == null || stat.trade.option === true) &&
    (stat.anointments == null || (
      Array.isArray(stat.anointments) &&
      stat.anointments.length <= 16 &&
      stat.anointments.every((entry) =>
        Number.isFinite(entry?.roll) &&
        typeof entry?.oils === "string" &&
        /^\d{1,2}(?:,\d{1,2}){1,2}$/.test(entry.oils)
      )
    ))
  );
}

function validGroup(value: unknown): value is TradeStatCatalogGroup {
  if (!value || typeof value !== "object") return false;
  const group = value as Partial<TradeStatCatalogGroup>;
  return (
    Number.isInteger(group.id) && (group.id as number) >= 0 &&
    Number.isInteger(group.sourceIndex) && (group.sourceIndex as number) >= 0 &&
    Array.isArray(group.stats) &&
    group.stats.length >= 2 &&
    group.stats.length <= 16 &&
    group.stats.every(validGroupStat) &&
    validGroupResolver(group.resolve, group.stats.length)
  );
}

export function isValidTradeStatCatalogPack(value: unknown): value is TradeStatCatalogPack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Partial<TradeStatCatalogPack>;
  return (
    pack.schema === EXPECTED_SCHEMA &&
    pack.source?.commit === EXPECTED_COMMIT &&
    typeof pack.source?.inputSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(pack.source.inputSha256) &&
    typeof pack.source?.resolverGroupsSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(pack.source.resolverGroupsSha256) &&
    Array.isArray(pack.groups) &&
    pack.groups.length === EXPECTED_RESOLVER_GROUPS &&
    pack.groups.every((group, index) => validGroup(group) && group.id === index) &&
    pack.coverage?.resolverGroups === EXPECTED_RESOLVER_GROUPS &&
    Object.entries(EXPECTED_RESOLVER_STRATEGIES).every(
      ([strategy, count]) => pack.coverage?.resolverStrategies?.[strategy] === count,
    ) &&
    Array.isArray(pack.entries) &&
    pack.entries.length > 1_000 &&
    pack.entries.length <= MAX_CATALOG_ENTRIES &&
    pack.entries.every(
      (entry) =>
        typeof entry?.pattern === "string" &&
        entry.pattern.length > 0 &&
        entry.pattern.length <= 2_000 &&
        Array.isArray(entry.candidates) &&
        (entry.candidates.length > 0 || (entry.groupIds?.length || 0) > 0) &&
        entry.candidates.every((candidate) =>
          validCandidate(candidate) &&
          (candidate.groupId == null || (
            candidate.groupId < (pack.groups?.length || 0) &&
            candidate.statIndex! < pack.groups![candidate.groupId].stats.length
          ))
        ) &&
        (entry.groupIds == null || (
          Array.isArray(entry.groupIds) &&
          entry.groupIds.length > 0 &&
          new Set(entry.groupIds).size === entry.groupIds.length &&
          entry.groupIds.every((id) =>
            Number.isInteger(id) && id >= 0 && id < (pack.groups?.length || 0)
          )
        )),
    )
  );
}

function isTrustedDesktopTradeStatCatalogPack(
  value: unknown,
): value is TradeStatCatalogPack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Partial<TradeStatCatalogPack>;
  return (
    pack.schema === EXPECTED_SCHEMA &&
    pack.source?.commit === EXPECTED_COMMIT &&
    Array.isArray(pack.groups) &&
    pack.groups.length === EXPECTED_RESOLVER_GROUPS &&
    Array.isArray(pack.entries) &&
    pack.entries.length > 1_000 &&
    pack.entries.length <= MAX_CATALOG_ENTRIES
  );
}

export async function loadTradeStatCatalog() {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    try {
      catalogDiagnostic = "loading";
      const desktopText = await window.poeWidget?.getTradeStatCatalog?.();
      let pack: unknown;
      let integrityVerifiedByDesktop = false;
      if (typeof desktopText === "string") {
        integrityVerifiedByDesktop = true;
        // The sandboxed file:// renderer does not expose SubtleCrypto on all
        // supported Electron/Windows combinations. The main process reads the
        // exact bundled path and verifies this same SHA-256 before IPC.
        pack = JSON.parse(desktopText) as unknown;
      } else {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/price-check/stats-v1.json?schema=8&sha=${EXPECTED_PACK_SHA256}`,
          { cache: "force-cache" },
        );
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        if (await sha256Hex(bytes) !== EXPECTED_PACK_SHA256) {
          catalogDiagnostic = "web-integrity-failed";
          return null;
        }
        pack = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      }
      const validPack = integrityVerifiedByDesktop
        ? isTrustedDesktopTradeStatCatalogPack(pack)
        : isValidTradeStatCatalogPack(pack);
      if (!validPack) {
        catalogDiagnostic = "invalid-pack";
        return null;
      }
      catalogDiagnostic = integrityVerifiedByDesktop ? "ready-desktop" : "ready-web";
      return pack as TradeStatCatalogPack;
    } catch (error) {
      catalogDiagnostic = `error:${error instanceof Error ? error.message : String(error)}`;
      return null;
    }
  })();
  return catalogPromise;
}

export function tradeStatCatalogDiagnostic() {
  return catalogDiagnostic;
}

const kindFallbacks: Record<PoeModifierKind, string[]> = {
  implicit: ["implicit"],
  explicit: ["explicit"],
  crafted: ["crafted", "explicit"],
  fractured: ["fractured", "explicit"],
  enchant: ["enchant"],
  scourge: ["scourge", "explicit"],
  crucible: ["crucible", "explicit"],
  rune: ["rune", "explicit"],
  imbued: ["imbued"],
  veiled: ["veiled"],
  pseudo: ["pseudo"],
  unknown: ["explicit", "implicit", "imbued"],
};

interface MatchedCatalogCandidate {
  candidate: TradeStatCatalogCandidate;
  values: number[];
  bounds?: { min: number; max: number };
  tradeOption?: string | number;
  direction: -1 | 0 | 1;
  inverted: boolean;
  decimalPrecision: boolean;
  anointmentOils?: string[];
}

const PLACEHOLDER_MAP: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> = [
  [[]],
  [[0], []],
  [[0, 1], [0], [1], []],
  [[0, 1, 2], [1, 2], [0, 2], [0, 1], [2], [1], [0]],
  [
    [0, 1, 2, 3], [1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2],
    [2, 3], [1, 3], [1, 2], [0, 3], [0, 2], [0, 1],
  ],
];

interface StatPlaceholderCombination {
  matchStr: string;
  values: number[];
}

/** Exact ordering of APT's `_statPlaceholderGenerator`. */
function statPlaceholderCombinations(text: string): StatPlaceholderCombination[] {
  const matches: Array<{ roll: number; rollStr: string }> = [];
  const withPlaceholders = text
    .replace(/\(\)/gm, "")
    .replace(
      /(?<value>(?<!\d|\))[+-]?\d[\d,]*(?:\.\d+)?)(?:\((?<min>.[^)-]*)(?:-(?<max>[^)]+))?\))?/gm,
      (...args) => {
        const groups = args.at(-1) as Record<string, string | undefined>;
        const rollStr = groups.value!;
        let min = groups.min;
        let max = groups.max;
        if (min != null && max == null) max = min;
        matches.push({
          roll: Number(rollStr.replace(/,/g, "")),
          rollStr,
        });
        const bounds = min == null
          ? undefined
          : {
              min: Number(min.replace(/,/g, "")),
              max: Number(max!.replace(/,/g, "")),
            };
        return bounds && (!Number.isFinite(bounds.min) || !Number.isFinite(bounds.max))
          ? `#(${min}-${max})`
          : "#";
      },
    );
  const combinations: StatPlaceholderCombination[] = [];
  if (matches.length < PLACEHOLDER_MAP.length) {
    for (const replacements of PLACEHOLDER_MAP[matches.length]) {
      let index = -1;
      combinations.push({
        matchStr: withPlaceholders.replace(/#/gm, () => {
          index += 1;
          return replacements.includes(index) ? matches[index].rollStr : "#";
        }),
        values: matches
          .filter((_match, index) => !replacements.includes(index))
          .map((match) => match.roll),
      });
    }
  }
  combinations.push({ matchStr: text, values: [] });
  return combinations;
}

function itemCategoryMatches(item: ParsedPoeItem, expected: string) {
  const itemClass = item.itemClass.trim().toLowerCase().replace(/\s+/g, " ");
  if (expected === "WEAPON") {
    return /^(?:claws?|bows?|sceptres?|wands?|fishing rods?|staves|warstaves|daggers|rune daggers|one hand(?:ed)? axes|two hand(?:ed)? axes|one hand(?:ed)? maces|two hand(?:ed)? maces|one hand(?:ed)? swords|two hand(?:ed)? swords)$/.test(itemClass);
  }
  if (expected === "ARMOUR") {
    return /^(?:body armours?|boots|gloves|helmets?|shields?)$/.test(itemClass);
  }
  if (expected === "HEIST_EQUIPMENT") {
    return /^heist (?:tools?|brooches|gear|cloaks?)$/.test(itemClass);
  }
  if (expected === "Sanctum Relic") {
    return /^(?:sanctum )?relics?$/.test(itemClass);
  }
  const actual = itemClass.endsWith("s") ? itemClass.slice(0, -1) : itemClass;
  return actual === expected.toLowerCase();
}

function isArmourItem(item: ParsedPoeItem) {
  return itemCategoryMatches(item, "ARMOUR");
}

interface ResolvedGroupStat {
  stat: TradeStatCatalogGroupStat;
  matcher: TradeStatCatalogGroupMatcher;
  ids: Array<{ id: string; valueTransform?: TradeStatValueTransform }>;
}

function mergeGroupIds(
  destination: string[],
  source: string[] | undefined,
  valueTransform?: TradeStatValueTransform,
) {
  const ids: Array<{ id: string; valueTransform?: TradeStatValueTransform }> =
    destination.map((id) => ({ id }));
  const sourceId = source?.[0];
  if (sourceId) {
    const key = `${valueTransform || "plain"}:${sourceId}`;
    if (!ids.some((entry) => `${entry.valueTransform || "plain"}:${entry.id}` === key)) {
      ids.push({ id: sourceId, ...(valueTransform ? { valueTransform } : {}) });
    }
  }
  return ids;
}

/** Pure port of APT v3.29.104 `_resolveTranslation` for one modifier kind. */
function resolveGroupStat(
  item: ParsedPoeItem,
  group: TradeStatCatalogGroup,
  matchStr: string,
  kind: string,
  roll: number | undefined,
): ResolvedGroupStat | null {
  const { resolve, stats } = group;
  let selected: TradeStatCatalogGroupStat | undefined;
  let ids: ResolvedGroupStat["ids"] | undefined;

  if (resolve.strat === "select") {
    let index = resolve.test.findIndex(
      (expected) => expected !== null && itemCategoryMatches(item, expected),
    );
    if (index === -1) index = resolve.test.indexOf(null);
    selected = index === -1 ? undefined : stats[index];
  } else {
    const onTradeStats = stats.filter((stat) => kind in stat.trade.ids);
    if (onTradeStats.length === 1) {
      selected = onTradeStats[0];
    } else if (resolve.strat === "trivial-merge") {
      const withMatchStr = matchStr.length
        ? onTradeStats.filter((stat) =>
            stat.matchers.some((matcher) => matcher.text === matchStr)
          )
        : onTradeStats;
      selected = withMatchStr[0];
      if (selected) {
        ids = [...selected.trade.ids[kind]].map((id) => ({ id }));
        for (const stat of withMatchStr.slice(1)) {
          ids = mergeGroupIds(
            ids.map((entry) => entry.id),
            stat.trade.ids[kind],
          );
        }
      }
    } else if (resolve.strat === "percent-merge") {
      const percent = stats[resolve.kind.indexOf("percent")];
      const matcher = percent.matchers.find((matcher) => matcher.text === matchStr);
      if (matcher?.semantics.constant === 100) {
        const value = stats[resolve.kind.indexOf("value")];
        const flag = value.matchers.length === 1 &&
          !value.matchers[0].text.includes("#");
        selected = percent;
        ids = mergeGroupIds(
          percent.trade.ids[kind] || [],
          value.trade.ids[kind],
          flag ? "empty-if-100" : "div-by-100",
        );
      } else {
        selected = stats.find((stat) =>
          stat.matchers.some((candidate) => candidate.text === matchStr)
        );
      }
    } else if (resolve.strat === "flag-merge") {
      if (roll == null) return null;
      const value = stats[resolve.kind.indexOf("value")];
      const flag = stats[resolve.kind.indexOf("flag")];
      const flagRoll = flag.matchers[0].semantics.constant;
      selected = value;
      if (roll === flagRoll) {
        ids = mergeGroupIds(
          value.trade.ids[kind] || [],
          flag.trade.ids[kind],
          "empty",
        );
      }
    }
  }

  if (!selected || !(kind in selected.trade.ids)) return null;
  const matcher = selected.matchers.find((candidate) => candidate.text === matchStr);
  if (!matcher) return null;
  return {
    stat: selected,
    matcher,
    ids: ids || selected.trade.ids[kind].map((id) => ({ id })),
  };
}

function candidateFromGroup(
  resolved: ResolvedGroupStat,
  kind: string,
  id: string,
  valueTransform?: TradeStatValueTransform,
): TradeStatCatalogCandidate {
  return {
    id,
    kind,
    ref: resolved.stat.ref,
    matcherText: resolved.matcher.text,
    ...(resolved.matcher.displayText
      ? { displayText: resolved.matcher.displayText }
      : {}),
    ...(resolved.stat.displayMatchers
      ? { displayMatchers: resolved.stat.displayMatchers }
      : {}),
    semantics: resolved.matcher.semantics,
    better: resolved.stat.better,
    ...(resolved.stat.dp ? { dp: true } : {}),
    ...(resolved.stat.trade.inverted ? { inverted: true } : {}),
    ...(resolved.stat.trade.option ? { option: true } : {}),
    ...(resolved.stat.anointments ? { anointments: resolved.stat.anointments } : {}),
    ...(valueTransform ? { valueTransform } : {}),
  };
}

function groupCandidatesFor(
  item: ParsedPoeItem,
  modifier: ParsedPoeModifier,
  entry: TradeStatCatalogEntry,
  groups: ReadonlyMap<number, TradeStatCatalogGroup>,
  kind: string,
) {
  const matches: TradeStatCatalogCandidate[] = [];
  for (const groupId of entry.groupIds || []) {
    const group = groups.get(groupId);
    if (!group) continue;
    for (const combination of statPlaceholderCombinations(modifier.text)) {
      if (!group.stats.some((stat) =>
        stat.matchers.some((matcher) => matcher.text === combination.matchStr)
      )) continue;
      const resolved = resolveGroupStat(
        item,
        group,
        combination.matchStr,
        kind,
        combination.values.length === 1 ? combination.values[0] : undefined,
      );
      if (!resolved) continue;
      matches.push(...resolved.ids.map(({ id, valueTransform }) =>
        candidateFromGroup(resolved, kind, id, valueTransform)
      ));
      break;
    }
  }
  return matches;
}

const ANOINTMENT_OILS = [
  "Prismatic Oil", "Clear Oil", "Sepia Oil", "Amber Oil", "Verdant Oil",
  "Teal Oil", "Azure Oil", "Indigo Oil", "Violet Oil", "Crimson Oil",
  "Black Oil", "Opalescent Oil", "Silver Oil", "Golden Oil",
];

function decodedAnointmentOils(
  candidate: TradeStatCatalogCandidate,
  sourceValues: readonly number[],
) {
  const recipes = candidate.anointments;
  if (!recipes?.length) return undefined;
  const encoded = recipes.length === 1
    ? recipes[0].oils
    : recipes.find((recipe) => recipe.roll === sourceValues[0])?.oils;
  if (!encoded) return undefined;
  const oils = encoded.split(",")
    .map(Number)
    .sort((left, right) => right - left)
    .map((index) => ANOINTMENT_OILS[index]);
  return oils.every(Boolean) ? oils : undefined;
}

interface SourceRollBound {
  min: number;
  max: number;
  ranged: boolean;
}

function semanticRollBounds(
  text: string,
  values: readonly number[],
  semantics: TradeStatValueSemantics,
) {
  if (semantics.tokenCount !== values.length || !semantics.indices.length) {
    return undefined;
  }
  const tokens: SourceRollBound[] = [];
  const tokenPattern = /([-+]?\d[\d,]*(?:\.\d+)?)(?:\s*\(\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*[\u002d\u2013\u2014\u2212]\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*\))?/g;
  for (const match of text.matchAll(tokenPattern)) {
    const current = Number(match[1].replace(/,/g, ""));
    const left = match[2] == null
      ? current
      : Number(match[2].replace(/,/g, ""));
    const right = match[3] == null
      ? current
      : Number(match[3].replace(/,/g, ""));
    if (![current, left, right].every(Number.isFinite)) return undefined;
    tokens.push({
      min: Math.min(left, right),
      max: Math.max(left, right),
      ranged: match[2] != null && match[3] != null,
    });
  }
  if (tokens.length !== values.length) {
    return undefined;
  }
  // APT keeps the Advanced range for legacy rolls and expands it to include
  // the copied value instead of discarding the range as inconsistent.
  const selected = semantics.indices.map((index) => ({
    ...tokens[index],
    min: Math.min(tokens[index].min, values[index]),
    max: Math.max(tokens[index].max, values[index]),
  }));
  if (!selected.some((bound) => bound.ranged)) return undefined;
  const transformed = selected.map((bound) =>
    semantics.negate
      ? { min: -bound.max, max: -bound.min }
      : { min: bound.min, max: bound.max },
  );
  if (transformed.length === 2) {
    return {
      min: (transformed[0].min + transformed[1].min) / 2,
      max: (transformed[0].max + transformed[1].max) / 2,
    };
  }
  return transformed[0];
}

function semanticRollHasDecimal(
  text: string,
  values: readonly number[],
  semantics: TradeStatValueSemantics,
) {
  if (semantics.tokenCount !== values.length || !semantics.indices.length) {
    return false;
  }
  const decimals = [...text.matchAll(
    /([-+]?\d[\d,]*(?:\.\d+)?)(?:\s*\(\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*[\u002d\u2013\u2014\u2212]\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*\))?/g,
  )].map((match) => [match[1], match[2], match[3]].some(
    (token) => token?.includes("."),
  ));
  return decimals.length === values.length &&
    semantics.indices.some((index) => decimals[index]);
}

function candidatesFor(
  item: ParsedPoeItem,
  modifier: ParsedPoeModifier,
  entry: TradeStatCatalogEntry,
  groups: ReadonlyMap<number, TradeStatCatalogGroup>,
): MatchedCatalogCandidate[] {
  const sourceValues = modifier.sourceValues || modifier.values;
  for (const kind of kindFallbacks[modifier.kind]) {
    const candidates = [
      ...entry.candidates.filter((candidate) => candidate.groupId == null),
      ...groupCandidatesFor(item, modifier, entry, groups, kind),
    ];
    const matching = candidates
      .filter(
        (candidate) =>
          candidate.kind === kind &&
          isOfficialTradeStatId(candidate.id) &&
          (!candidate.option || modifier.roomState === 1 || modifier.roomState === 2),
      )
      .map((candidate) => ({
        candidate,
        values: semanticRoll(sourceValues, candidate.semantics),
        decimalPrecision: Boolean(candidate.dp) || semanticRollHasDecimal(
          modifier.text,
          sourceValues,
          candidate.semantics,
        ),
        bounds: semanticRollBounds(
          modifier.text,
          sourceValues,
          candidate.semantics,
        ),
      }))
      .filter(
        (match): match is {
          candidate: TradeStatCatalogCandidate;
          values: number[];
          decimalPrecision: boolean;
          bounds: { min: number; max: number } | undefined;
        } => match.values !== null,
      );
    if (!matching.length) continue;

    const specificity = Math.max(
      ...matching.map(
        ({ candidate }) => candidate.semantics.literals?.length || 0,
      ),
    );
    return matching
      .filter(
        ({ candidate }) =>
          (candidate.semantics.literals?.length || 0) === specificity,
      )
      .map(({ candidate, values, decimalPrecision, bounds }) => {
        const applySourceIncrease = (value: number) => {
          if (!modifier.rollIncr || modifier.unscalable) return value;
          const increased = value + value * modifier.rollIncr / 100;
          const factor = decimalPrecision ? 100 : 1;
          return Math.trunc((increased + Number.EPSILON) * factor) / factor;
        };
        const adjustedValues = values.map(applySourceIncrease);
        const adjustedBounds = bounds
          ? {
              min: applySourceIncrease(bounds.min),
              max: applySourceIncrease(bounds.max),
            }
          : undefined;
        const matcherNegated = Boolean(candidate.semantics.negate);
        return {
          candidate,
          values: adjustedValues,
          ...(adjustedBounds ? { bounds: adjustedBounds } : {}),
          ...(candidate.option ? { tradeOption: modifier.roomState! } : {}),
          direction: matcherNegated
            ? ((-candidate.better) as -1 | 0 | 1)
            : candidate.better,
          inverted: Boolean(candidate.inverted) !== matcherNegated,
          decimalPrecision,
          ...(decodedAnointmentOils(candidate, sourceValues)
            ? { anointmentOils: decodedAnointmentOils(candidate, sourceValues) }
            : {}),
        };
      });
  }
  return [];
}

function sameNumber(left: number, right: number) {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

function semanticRoll(
  values: readonly number[],
  semantics: TradeStatValueSemantics,
): number[] | null {
  if (semantics.tokenCount !== values.length) return null;
  if (
    !values.every(Number.isFinite) ||
    !(semantics.literals || []).every(
      ([index, expected]) =>
        index >= 0 && index < values.length && sameNumber(values[index], expected),
    )
  ) {
    return null;
  }

  // APT's parser only injects matcher.value when it is truthy. A matcher with
  // value=0 is therefore a presence row with no numeric roll.
  if (semantics.constant) {
    const constant = semantics.constant as number;
    return [semantics.negate ? -constant : constant];
  }

  const selected = semantics.indices.map((index) => values[index]);
  if (!selected.every(Number.isFinite)) return null;
  if (!selected.length) return [];
  const roll =
    selected.length === 2 ? (selected[0] + selected[1]) / 2 : selected[0];
  return [semantics.negate ? -roll : roll];
}

function applyValueSemantics(
  modifier: ParsedPoeModifier,
  values: readonly number[],
) {
  const sourceValues = modifier.sourceValues || modifier.values;
  if (
    values.length === modifier.values.length &&
    values.every((value, index) => sameNumber(value, modifier.values[index]))
  ) {
    return modifier;
  }
  return {
    ...modifier,
    sourceValues: [...sourceValues],
    values: [...values],
  };
}

function combineModifierWindow(
  modifiers: readonly ParsedPoeModifier[],
): ParsedPoeModifier {
  if (modifiers.length === 1) return modifiers[0];
  const first = modifiers[0];
  const {
    tradeId: _tradeId,
    tradeIds: _tradeIds,
    tradeIdTransforms: _tradeIdTransforms,
    tradeIdCandidates: _tradeIdCandidates,
    tradeDirection: _tradeDirection,
    tradeInverted: _tradeInverted,
    tradeDecimalPrecision: _tradeDecimalPrecision,
    tradeBounds: _tradeBounds,
    tradeStatRef: _tradeStatRef,
    tradeLabel: _tradeLabel,
    tradeDisplayText: _tradeDisplayText,
    sourceValues: _sourceValues,
    rollIncr: _rollIncr,
    unscalable: _unscalable,
    ...base
  } = first;
  const commonKind = modifiers.every((modifier) => modifier.kind === first.kind)
    ? first.kind
    : "unknown";
  const commonSource = modifiers.every(
    (modifier) => modifier.source === first.source,
  )
    ? first.source
    : undefined;
  const commonTier = modifiers.every((modifier) => modifier.tier === first.tier)
    ? first.tier
    : undefined;
  const rollIncrements = [...new Set(modifiers.flatMap((modifier) =>
    modifier.rollIncr == null ? [] : [modifier.rollIncr]
  ))];
  const text = modifiers.map((modifier) => modifier.text).join("\n");
  return {
    ...base,
    id: modifiers.map((modifier) => modifier.id).join("+"),
    kind: commonKind,
    text,
    normalizedText: normalized(text),
    values: modifiers.flatMap(
      (modifier) => modifier.sourceValues || modifier.values,
    ),
    selectedByDefault: modifiers.some(
      (modifier) => modifier.selectedByDefault,
    ),
    ...(commonSource ? { source: commonSource } : {}),
    ...(commonTier ? { tier: commonTier } : {}),
    ...(rollIncrements.length === 1 ? { rollIncr: rollIncrements[0] } : {}),
    ...(modifiers.some((modifier) => modifier.unscalable)
      ? { unscalable: true }
      : {}),
    tags: [...new Set(modifiers.flatMap((modifier) => modifier.tags))],
    advanced: modifiers.some((modifier) => modifier.advanced),
  };
}

function sharedCatalogSourceGroup(
  modifiers: readonly ParsedPoeModifier[],
) {
  const sourceGroupId = modifiers[0]?.sourceGroupId;
  return Boolean(sourceGroupId) && modifiers.every(
    (modifier) => modifier.sourceGroupId === sourceGroupId,
  );
}

function catalogWindowLimit(
  modifiers: readonly ParsedPoeModifier[],
  index: number,
) {
  const sourceGroupId = modifiers[index]?.sourceGroupId;
  if (!sourceGroupId) return 1;
  let width = 1;
  while (
    width < 7 &&
    index + width < modifiers.length &&
    modifiers[index + width].sourceGroupId === sourceGroupId
  ) {
    width += 1;
  }
  return width;
}

const TIMELESS_TRADE_FAMILIES: ReadonlyArray<{
  pattern: RegExp;
  leaders: ReadonlySet<string>;
}> = [
  {
    pattern: /^bathed in the blood of # sacrificed in the name of ([a-z]+)(?:\([^)]*\))? passives in radius are conquered by the vaal$/,
    leaders: new Set(["ahuana", "doryani", "xibaqua", "zerphi"]),
  },
  {
    pattern: /^commissioned # coins to commemorate ([a-z]+)(?:\([^)]*\))? passives in radius are conquered by the eternal empire$/,
    leaders: new Set(["cadiro", "caspiro", "chitus", "victario"]),
  },
  {
    pattern: /^commanded leadership over # warriors under ([a-z]+)(?:\([^)]*\))? passives in radius are conquered by the karui$/,
    leaders: new Set(["akoya", "kaom", "kiloava", "rakiata"]),
  },
  {
    pattern: /^carved to glorify # new faithful converted by high templar ([a-z]+)(?:\([^)]*\))? passives in radius are conquered by the templars$/,
    leaders: new Set(["avarius", "dominus", "maxarius", "venarius"]),
  },
  {
    pattern: /^denoted service of # dekhara in the akhara of ([a-z]+)(?:\([^)]*\))? passives in radius are conquered by the maraketh$/,
    leaders: new Set(["asenath", "balbala", "deshret", "nasima"]),
  },
  {
    pattern: /^remembrancing # songworthy deeds by the line of ([a-z]+)(?:\([^)]*\))? passives in radius are conquered by the kalguur$/,
    leaders: new Set(["medved", "uhtred", "vorana"]),
  },
  {
    pattern: /^subjugating # souls in the thrall of ([a-z]+) passives affected are conquered by the abyssal$/,
    leaders: new Set(["amanamu", "kurgal", "tecrod", "ulaman"]),
  },
  {
    pattern: /^binding # souls to phylacteries to sustain ([a-z]+) passives affected are conquered by the abyssal$/,
    leaders: new Set(["zorath"]),
  },
];

function resolveTimelessTradeModifier(
  modifier: ParsedPoeModifier,
): ParsedPoeModifier | null {
  const text = normalized(modifier.text);
  for (const family of TIMELESS_TRADE_FAMILIES) {
    const match = family.pattern.exec(text);
    const leader = match?.[1];
    if (!leader || !family.leaders.has(leader)) continue;
    const seed = (modifier.sourceValues || modifier.values).find(Number.isFinite);
    if (seed == null) return null;
    const tradeId = `explicit.pseudo_timeless_jewel_${leader}`;
    return {
      ...modifier,
      kind: "explicit",
      values: [seed],
      selectedByDefault: true,
      tags: [...new Set([...modifier.tags, "timeless-jewel", "seed"])],
      tradeId,
      tradeIds: [tradeId],
      tradeIdCandidates: [tradeId],
      tradeDirection: 0,
      tradeInverted: false,
    };
  }
  return null;
}

/**
 * Timeless-style seed stats span two displayed lines. Resolve the complete
 * currently tradable leader set independently of catalog freshness, including
 * legacy leaders and the 3.29 Kalguur/Abyssal alternate-tree families.
 */
function withTimelessTradeStats(modifiers: readonly ParsedPoeModifier[]) {
  const resolved: ParsedPoeModifier[] = [];
  let foundSeed = false;
  for (let index = 0; index < modifiers.length;) {
    let match: ParsedPoeModifier | null = null;
    let consumed = 0;
    for (const width of [2, 1]) {
      if (index + width > modifiers.length) continue;
      const window = modifiers.slice(index, index + width);
      if (width > 1 && !sharedCatalogSourceGroup(window)) continue;
      const candidate = combineModifierWindow(window);
      match = resolveTimelessTradeModifier(candidate);
      if (match) {
        consumed = width;
        break;
      }
    }
    if (match) {
      resolved.push(match);
      foundSeed = true;
      index += consumed;
    } else {
      resolved.push(modifiers[index]);
      index += 1;
    }
  }
  return foundSeed
    ? resolved.filter((modifier) => normalized(modifier.text) !== "historic")
    : resolved;
}

function matchKey(match: MatchedCatalogCandidate) {
  return JSON.stringify([
    match.candidate.id,
    match.candidate.valueTransform,
    match.values,
    match.direction,
    match.inverted,
    match.decimalPrecision,
    match.tradeOption,
    match.bounds,
    match.anointmentOils,
  ]);
}

function valueTransformsFor(matches: readonly MatchedCatalogCandidate[]) {
  const transforms = Object.fromEntries(matches.flatMap(({ candidate }) =>
    candidate.valueTransform
      ? [[candidate.id, candidate.valueTransform] as const]
      : []
  ));
  return Object.keys(transforms).length ? transforms : undefined;
}

function compatibleMatchKey(match: MatchedCatalogCandidate) {
  return JSON.stringify([
    match.values,
    match.direction,
    match.inverted,
    match.decimalPrecision,
    match.tradeOption,
    match.bounds,
  ]);
}

function elementalResistanceWeight(modifier: ParsedPoeModifier) {
  const pattern = modifier.normalizedText
    .trim()
    .toLowerCase()
    .replace(/^\+/, "");
  if (/^#% to (?:fire|cold|lightning) resistance$/.test(pattern)) return 1;
  if (/^#% to (?:fire|cold|lightning) and chaos resistances$/.test(pattern)) {
    return 1;
  }
  if (
    /^#% to (?:fire and cold|fire and lightning|cold and lightning) resistances$/.test(
      pattern,
    )
  ) {
    return 2;
  }
  if (/^#% to (?:all elemental|all) resistances$/.test(pattern)) return 3;
  return 0;
}

/**
 * GGG's pseudo total-resistance stat compares the sum contributed across
 * Fire, Cold and Lightning. Awakened exposes that single comparable instead
 * of three separate resistance rows. Build the same source-backed pseudo from
 * unconditional copied resistance lines before resolving the pinned catalog.
 */
function withTotalElementalResistancePseudo(
  item: ParsedPoeItem,
  byPattern: ReadonlyMap<string, TradeStatCatalogEntry>,
) {
  // Unique-item pricing depends on the item's own roll lines and fixed-stat
  // metadata; keep those explicit instead of replacing them with a rare-item
  // convenience pseudo.
  if (item.rarity === "unique") return item.modifiers;
  const pseudoPattern = "+#% total elemental resistance";
  const pseudoEntry = byPattern.get(pseudoPattern);
  if (
    !pseudoEntry?.candidates.some(
      (candidate) =>
        candidate.kind === "pseudo" &&
        candidate.id === "pseudo.pseudo_total_elemental_resistance",
    )
  ) {
    return item.modifiers;
  }

  const contributions = new Map<ParsedPoeModifier, number>();
  let total = 0;
  for (const modifier of item.modifiers) {
    const weight = elementalResistanceWeight(modifier);
    const value = modifier.values.find(Number.isFinite);
    if (!weight || value == null) continue;
    contributions.set(modifier, weight * value);
    total += weight * value;
  }
  if (!contributions.size || !Number.isFinite(total)) return item.modifiers;

  const pseudo: ParsedPoeModifier = {
    id: "pseudo-total-elemental-resistance",
    kind: "pseudo",
    text: `${total >= 0 ? "+" : ""}${total}% total Elemental Resistance`,
    normalizedText: pseudoPattern,
    values: [total],
    selectedByDefault: true,
    tags: ["derived", "resistance"],
    advanced: [...contributions.keys()].some((modifier) => modifier.advanced),
  };
  const result: ParsedPoeModifier[] = [];
  let inserted = false;
  for (const modifier of item.modifiers) {
    if (!contributions.has(modifier)) {
      result.push(modifier);
      continue;
    }
    if (!inserted) {
      result.push(pseudo);
      inserted = true;
    }
  }
  return result;
}

/**
 * Awakened presents flat Life regeneration as one pseudo comparable even when
 * the copied item spells the source modifier as `Regenerate # Life per
 * second`. Folding every unconditional flat source into that pseudo keeps the
 * visible row useful and also handles items with more than one flat source.
 */
function withTotalLifeRegenerationPseudos(
  item: ParsedPoeItem,
  modifiers: readonly ParsedPoeModifier[],
  byPattern: ReadonlyMap<string, TradeStatCatalogEntry>,
) {
  if (item.rarity === "unique") return [...modifiers];
  const collapse = (
    source: readonly ParsedPoeModifier[],
    config: {
      id: string;
      tradeId: string;
      sourcePattern: string;
      pseudoPattern: string;
      text: (total: number) => string;
      tags: string[];
    },
  ) => {
    const pseudoEntry = byPattern.get(config.pseudoPattern);
    if (!pseudoEntry?.candidates.some(
      (candidate) =>
        candidate.kind === "pseudo" && candidate.id === config.tradeId,
    )) return [...source];

    const contributions = new Map<ParsedPoeModifier, number>();
    let total = 0;
    for (const modifier of source) {
      const pattern = normalized(modifier.normalizedText);
      if (
        pattern !== config.sourcePattern &&
        pattern !== config.pseudoPattern
      ) continue;
      const value = modifier.values.find(Number.isFinite);
      if (value == null) continue;
      contributions.set(modifier, value);
      total += value;
    }
    if (!contributions.size || !Number.isFinite(total)) return [...source];

    const pseudo: ParsedPoeModifier = {
      id: config.id,
      kind: "pseudo",
      text: config.text(total),
      normalizedText: config.pseudoPattern,
      values: [total],
      selectedByDefault: false,
      tags: ["derived", "life", "regeneration", ...config.tags],
      advanced: [...contributions.keys()].some((modifier) => modifier.advanced),
    };
    const result: ParsedPoeModifier[] = [];
    let inserted = false;
    for (const modifier of source) {
      if (!contributions.has(modifier)) {
        result.push(modifier);
        continue;
      }
      if (!inserted) {
        result.push(pseudo);
        inserted = true;
      }
    }
    return result;
  };

  const withFlat = collapse(modifiers, {
    id: "pseudo-total-life-regen",
    tradeId: "pseudo.pseudo_total_life_regen",
    sourcePattern: "regenerate # life per second",
    pseudoPattern: "# life regenerated per second",
    text: (total) => `${total} Life Regenerated per second`,
    tags: ["flat"],
  });
  return collapse(withFlat, {
    id: "pseudo-percent-life-regen",
    tradeId: "pseudo.pseudo_percent_life_regen",
    sourcePattern: "regenerate #% of life per second",
    pseudoPattern: "#% of life regenerated per second",
    text: (total) => `${total}% of Life Regenerated per second`,
    tags: ["percent"],
  });
}

interface AwakenedPseudoRule {
  id: string;
  target: string;
  display: string;
  sources: Array<{
    pattern: string;
    multiplier?: number;
    required?: boolean;
  }>;
  selected?: boolean;
  group?: string;
  replaces?: string;
  craftedOnlyHidden?: boolean;
}

const RESISTANCE_SOURCES: Array<{
  pattern: string;
  elements: number;
  chaos?: boolean;
  fire?: boolean;
  cold?: boolean;
  lightning?: boolean;
}> = [
  { pattern: "#% to all resistances", elements: 3, chaos: true },
  { pattern: "#% to all elemental resistances", elements: 3 },
  { pattern: "#% to fire resistance", elements: 1, fire: true },
  { pattern: "#% to cold resistance", elements: 1, cold: true },
  { pattern: "#% to lightning resistance", elements: 1, lightning: true },
  { pattern: "#% to fire and lightning resistances", elements: 2, fire: true, lightning: true },
  { pattern: "#% to fire and cold resistances", elements: 2, fire: true, cold: true },
  { pattern: "#% to cold and lightning resistances", elements: 2, cold: true, lightning: true },
  { pattern: "#% to chaos resistance", elements: 0, chaos: true },
  { pattern: "#% to fire and chaos resistances", elements: 1, fire: true, chaos: true },
  { pattern: "#% to cold and chaos resistances", elements: 1, cold: true, chaos: true },
  { pattern: "#% to lightning and chaos resistances", elements: 1, lightning: true, chaos: true },
];

const ATTRIBUTE_SOURCES: Array<{
  pattern: string;
  attributes: string[];
}> = [
  { pattern: "# to all attributes", attributes: ["str", "dex", "int"] },
  { pattern: "# to strength", attributes: ["str"] },
  { pattern: "# to dexterity", attributes: ["dex"] },
  { pattern: "# to intelligence", attributes: ["int"] },
  { pattern: "# to strength and intelligence", attributes: ["str", "int"] },
  { pattern: "# to strength and dexterity", attributes: ["str", "dex"] },
  { pattern: "# to dexterity and intelligence", attributes: ["dex", "int"] },
];

const AWAKENED_PSEUDO_RULES: AwakenedPseudoRule[] = [
  {
    id: "pseudo-total-elemental-resistance",
    target: "+#% total elemental resistance",
    display: "+#% total Elemental Resistance",
    selected: true,
    sources: RESISTANCE_SOURCES.filter((source) => source.elements > 0)
      .map((source) => ({ pattern: source.pattern, multiplier: source.elements })),
  },
  ...(["fire", "cold", "lightning"] as const).map((element) => ({
    id: `pseudo-total-${element}-resistance`,
    target: `+#% total to ${element} resistance`,
    display: `+#% total to ${element[0].toUpperCase()}${element.slice(1)} Resistance`,
    group: "to_x_ele_res",
    sources: RESISTANCE_SOURCES.filter((source) => source[element] === true)
      .map((source) => ({ pattern: source.pattern })),
  })),
  {
    id: "pseudo-total-chaos-resistance",
    target: "+#% total to chaos resistance",
    display: "+#% total to Chaos Resistance",
    selected: true,
    craftedOnlyHidden: true,
    sources: RESISTANCE_SOURCES.filter((source) => source.chaos === true)
      .map((source) => ({ pattern: source.pattern })),
  },
  {
    id: "pseudo-total-all-attributes",
    target: "+# total to all attributes",
    display: "+# total to all Attributes",
    group: "to_all_attrs",
    sources: [{ pattern: "# to all attributes" }],
  },
  ...(["strength", "dexterity", "intelligence"] as const).map((attribute) => {
    const short = attribute === "strength" ? "str" : attribute === "dexterity" ? "dex" : "int";
    return {
      id: `pseudo-total-${attribute}`,
      target: `+# total to ${attribute}`,
      display: `+# total to ${attribute[0].toUpperCase()}${attribute.slice(1)}`,
      group: "to_x_attr",
      sources: ATTRIBUTE_SOURCES.filter((source) => source.attributes.includes(short))
        .map((source) => ({ pattern: source.pattern })),
    };
  }),
  {
    id: "pseudo-total-maximum-life",
    target: "+# total maximum life",
    display: "+# total maximum Life",
    selected: true,
    sources: [
      { pattern: "# to maximum life", required: true },
      ...ATTRIBUTE_SOURCES.filter((source) => source.attributes.includes("str"))
        .map((source) => ({ pattern: source.pattern, multiplier: 0.5 })),
    ],
  },
  {
    id: "pseudo-total-maximum-mana",
    target: "+# total maximum mana",
    display: "+# total maximum Mana",
    sources: [
      { pattern: "# to maximum mana", required: true },
      ...ATTRIBUTE_SOURCES.filter((source) => source.attributes.includes("int"))
        .map((source) => ({ pattern: source.pattern, multiplier: 0.5 })),
    ],
  },
  { id: "pseudo-increased-es", target: "#% total increased maximum energy shield", display: "#% total increased maximum Energy Shield", sources: [{ pattern: "#% increased maximum energy shield" }] },
  { id: "pseudo-flat-es", target: "+# total maximum energy shield", display: "+# total maximum Energy Shield", sources: [{ pattern: "# to maximum energy shield" }] },
  { id: "pseudo-attack-speed", target: "+#% total attack speed", display: "+#% total Attack Speed", sources: [{ pattern: "#% increased attack speed" }] },
  { id: "pseudo-cast-speed", target: "+#% total cast speed", display: "+#% total Cast Speed", sources: [{ pattern: "#% increased cast speed" }] },
  { id: "pseudo-movement-speed", target: "#% increased movement speed", display: "#% increased Movement Speed", sources: [{ pattern: "#% increased movement speed" }] },
  { id: "pseudo-global-physical", target: "#% total increased physical damage", display: "#% total increased Physical Damage", sources: [{ pattern: "#% increased global physical damage" }] },
  { id: "pseudo-global-crit", target: "+#% global critical strike chance", display: "+#% Global Critical Strike Chance", group: "global_crit_chance", sources: [{ pattern: "#% increased global critical strike chance" }] },
  { id: "pseudo-spell-crit", target: "+#% total critical strike chance for spells", display: "+#% total Critical Strike Chance for Spells", replaces: "global_crit_chance", sources: [{ pattern: "#% increased spell critical strike chance", required: true }, { pattern: "#% increased global critical strike chance" }] },
  { id: "pseudo-global-crit-multi", target: "+#% global critical strike multiplier", display: "+#% Global Critical Strike Multiplier", sources: [{ pattern: "#% to global critical strike multiplier" }] },
  { id: "pseudo-elemental-damage", target: "#% increased elemental damage", display: "#% increased Elemental Damage", group: "incr_ele_dmg", sources: [{ pattern: "#% increased elemental damage" }] },
  ...(["lightning", "cold", "fire"] as const).map((element) => ({
    id: `pseudo-${element}-damage`, target: `#% increased ${element} damage`, display: `#% increased ${element[0].toUpperCase()}${element.slice(1)} Damage`, group: element === "fire" ? "incr_fire_dmg" : undefined, replaces: "incr_ele_dmg", sources: [{ pattern: `#% increased ${element} damage`, required: true }, { pattern: "#% increased elemental damage" }],
  })),
  { id: "pseudo-spell-damage", target: "#% increased spell damage", display: "#% increased Spell Damage", group: "incr_spell_dmg", sources: [{ pattern: "#% increased spell damage" }] },
  ...(["lightning", "cold", "fire"] as const).map((element) => ({
    id: `pseudo-${element}-spell-damage`, target: `#% increased ${element} spell damage`, display: `#% increased ${element[0].toUpperCase()}${element.slice(1)} Spell Damage`, replaces: "incr_spell_dmg", sources: [{ pattern: `#% increased ${element} spell damage`, required: true }, { pattern: "#% increased spell damage" }],
  })),
  { id: "pseudo-elemental-attack", target: "#% increased elemental damage with attack skills", display: "#% increased Elemental Damage with Attack Skills", replaces: "incr_ele_dmg", sources: [{ pattern: "#% increased elemental damage with attack skills", required: true }, { pattern: "#% increased elemental damage" }] },
  { id: "pseudo-burning", target: "#% increased burning damage", display: "#% increased Burning Damage", replaces: "incr_fire_dmg", sources: [{ pattern: "#% increased burning damage", required: true }, { pattern: "#% increased fire damage" }, { pattern: "#% increased elemental damage" }] },
  { id: "pseudo-total-life-regen", target: "# life regenerated per second", display: "# Life Regenerated per second", sources: [{ pattern: "regenerate # life per second" }] },
  { id: "pseudo-percent-life-regen", target: "#% of life regenerated per second", display: "#% of Life Regenerated per second", sources: [{ pattern: "regenerate #% of life per second" }] },
  { id: "pseudo-physical-life-leech", target: "#% of physical attack damage leeched as life", display: "#% of Physical Attack Damage Leeched as Life", sources: [{ pattern: "#% of physical attack damage leeched as life" }] },
  { id: "pseudo-physical-mana-leech", target: "#% of physical attack damage leeched as mana", display: "#% of Physical Attack Damage Leeched as Mana", sources: [{ pattern: "#% of physical attack damage leeched as mana" }] },
  { id: "pseudo-mana-regen", target: "#% increased mana regeneration rate", display: "#% increased Mana Regeneration Rate", sources: [{ pattern: "#% increased mana regeneration rate" }] },
];

function isEquipmentPropertySource(item: ParsedPoeItem, pattern: string) {
  const hasProperty = (label: string) => Object.keys(item.properties).some(
    (key) => key.trim().toLowerCase() === label.toLowerCase(),
  );
  if (isArmourItem(item)) {
    const properties = [
      ["armour", hasProperty("Armour")],
      ["evasion", hasProperty("Evasion Rating")],
      ["energy shield", hasProperty("Energy Shield")],
      ["ward", hasProperty("Ward")],
    ] as const;
    return properties.some(([defence, present]) => present && (
      pattern === `# to ${defence === "evasion" ? "evasion rating" : defence === "energy shield" ? "maximum energy shield" : defence}` ||
      pattern === `#% increased ${defence}` ||
      pattern.startsWith("#% increased ") && pattern.includes(defence)
    ));
  }
  if (/\b(?:weapons?|bows?|claws?|daggers?|axes?|maces?|sceptres?|staves?|warstaves?|swords?|wands?|fishing rods?)\b/i.test(item.itemClass)) {
    if (
      hasProperty("Physical Damage") &&
      /^(?:adds # to # physical damage|#% increased physical damage(?: and accuracy rating)?)$/.test(pattern)
    ) return true;
    if (
      hasProperty("Elemental Damage") &&
      /^adds # to # (?:fire|cold|lightning) damage$/.test(pattern)
    ) return true;
    if (hasProperty("Attacks per Second") && pattern === "#% increased attack speed") {
      return true;
    }
    if (
      hasProperty("Critical Strike Chance") &&
      pattern === "#% increased critical strike chance"
    ) return true;
  }
  return false;
}

function formatPseudoNumber(value: number) {
  return String(Math.round(value * 10_000) / 10_000);
}

function renderPseudoText(template: string, value: number) {
  const number = formatPseudoNumber(value);
  return template.includes("+#")
    ? template.replace("+#", value >= 0 ? `+${number}` : number)
    : template.replace("#", number);
}

function inlineSingleRollBounds(modifier: ParsedPoeModifier) {
  if (modifier.values.length !== 1) return undefined;
  const matches = [...modifier.text.matchAll(
    /[-+]?\d[\d,]*(?:\.\d+)?\s*\(\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*[\u002d\u2013\u2014\u2212]\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*\)/g,
  )];
  if (matches.length !== 1) return undefined;
  const left = Number(matches[0][1].replace(/,/g, ""));
  const right = Number(matches[0][2].replace(/,/g, ""));
  const copied = modifier.values[0];
  return Number.isFinite(left) && Number.isFinite(right) && Number.isFinite(copied)
    ? {
        // APT marks an out-of-range copied roll as legacy and expands the
        // source domain before pseudo aggregation.
        min: Math.min(left, right, copied),
        max: Math.max(left, right, copied),
      }
    : undefined;
}

function pseudoSourceContribution(modifier: ParsedPoeModifier) {
  const rawValue = modifier.values.find(Number.isFinite);
  if (rawValue == null) return undefined;
  const rawBounds = modifier.tradeBounds || inlineSingleRollBounds(modifier);
  const decimalPrecision = Boolean(modifier.tradeDecimalPrecision) ||
    (modifier.sourceValues || modifier.values).some((value) =>
      Number.isFinite(value) && !Number.isInteger(value)
    );
  const applyMagnitude = (value: number) => {
    // A catalog-resolved modifier already carries the increased semantic roll.
    if (!modifier.rollIncr || modifier.unscalable || modifier.tradeStatRef) {
      return value;
    }
    const increased = value + value * modifier.rollIncr / 100;
    const factor = decimalPrecision ? 100 : 1;
    return Math.trunc((increased + Number.EPSILON) * factor) / factor;
  };
  const value = applyMagnitude(rawValue);
  const bounds = rawBounds
    ? {
        min: Math.min(
          applyMagnitude(rawBounds.min),
          applyMagnitude(rawBounds.max),
          value,
        ),
        max: Math.max(
          applyMagnitude(rawBounds.min),
          applyMagnitude(rawBounds.max),
          value,
        ),
      }
    : undefined;
  return { value, bounds };
}

/** Ports Awakened's complete pseudo aggregation pass over copied stats. */
function withAwakenedPseudos(
  item: ParsedPoeItem,
  byPattern: ReadonlyMap<string, TradeStatCatalogEntry>,
) {
  // Awakened deliberately preserves Split Personality's two attribute rolls
  // instead of replacing them with generic total-attribute pseudos.
  if (/^split personality$/i.test(item.name.trim())) return item.modifiers;
  type Generated = {
    modifier: ParsedPoeModifier;
    group?: string;
    sources: ParsedPoeModifier[];
  };
  let generated: Generated[] = [];
  const consumed = new Set<ParsedPoeModifier>();

  for (const rule of AWAKENED_PSEUDO_RULES) {
    const target = byPattern.get(rule.target);
    if (!target?.candidates.some((candidate) => candidate.kind === "pseudo")) continue;
    const sources = item.modifiers.flatMap((modifier) => {
      const pattern = normalized(modifier.normalizedText);
      if (isEquipmentPropertySource(item, pattern)) return [];
      const source = rule.sources.find((candidate) => candidate.pattern === pattern);
      if (!source) return [];
      const contribution = pseudoSourceContribution(modifier);
      const multiplier = source.multiplier ?? 1;
      return contribution == null
        ? []
        : [{
            modifier,
            value: contribution.value * multiplier,
            multiplier,
            pattern,
            bounds: contribution.bounds,
          }];
    });
    if (!sources.length) continue;
    if (rule.sources.some((source) =>
      source.required && !sources.some((candidate) => candidate.pattern === source.pattern)
    )) continue;
    const value = sources.reduce((total, source) => total + source.value, 0);
    if (!Number.isFinite(value)) continue;
    const bounded = sources.every((source) => source.bounds != null);
    const tradeBounds = bounded
      ? sources.reduce((total, source) => {
          const bounds = source.bounds!;
          const first = bounds.min * source.multiplier;
          const second = bounds.max * source.multiplier;
          return {
            min: total.min + Math.min(first, second),
            max: total.max + Math.max(first, second),
          };
        }, { min: 0, max: 0 })
      : undefined;
    const craftedOnly = sources.length === 1 && sources[0].modifier.kind === "crafted";
    const modifier: ParsedPoeModifier = {
      id: rule.id,
      kind: "pseudo",
      text: renderPseudoText(rule.display, value),
      normalizedText: rule.target,
      values: [value],
      ...(tradeBounds ? { tradeBounds } : {}),
      selectedByDefault: Boolean(rule.selected) && !(rule.craftedOnlyHidden && craftedOnly),
      tags: [
        "derived",
        "pseudo",
        ...(sources.some((source) => source.modifier.kind === "fractured")
          ? ["derived-from-fractured"]
          : []),
        ...(rule.craftedOnlyHidden && craftedOnly ? ["upstream-hidden"] : []),
      ],
      advanced: sources.some((source) => source.modifier.advanced),
    };
    if (rule.replaces) {
      generated = generated.filter((candidate) => candidate.group !== rule.replaces);
    }
    generated.push({ modifier, group: rule.group, sources: sources.map((source) => source.modifier) });
    for (const source of sources) consumed.add(source.modifier);
  }

  const elemental = generated.filter((candidate) => candidate.group === "to_x_ele_res");
  if (elemental.length) {
    elemental.sort((left, right) => right.modifier.values[0] - left.modifier.values[0]);
    const keep = elemental[0]?.modifier.values[0] === elemental[1]?.modifier.values[0]
      ? undefined
      : elemental[0];
    generated = generated.filter((candidate) =>
      candidate.group !== "to_x_ele_res" || candidate === keep
    );
    // Awakened retains the uniquely strongest single-resistance pseudo in the
    // serialized editor, but hides it from the ordinary modifier list. Keep
    // that distinction as metadata instead of deleting the real Trade row.
    if (keep) keep.modifier.tags.push("upstream-hidden");
  }

  const attributes = generated.filter((candidate) => candidate.group === "to_x_attr")
    .sort((left, right) => right.modifier.values[0] - left.modifier.values[0]);
  const allAttributes = generated.filter((candidate) => candidate.group === "to_all_attrs");
  if (attributes.length === 3) {
    if (
      allAttributes.length &&
      attributes.every((candidate) => candidate.modifier.values[0] === attributes[0].modifier.values[0])
    ) {
      generated = generated.filter((candidate) => candidate.group !== "to_x_attr");
    } else {
      generated = generated.filter((candidate) => candidate.group !== "to_all_attrs");
      if (attributes[0].modifier.values[0] && attributes[2].modifier.values[0] / attributes[0].modifier.values[0] < 0.3) {
        const hidden = attributes[1].modifier.values[0] === attributes[2].modifier.values[0]
          ? new Set([attributes[1], attributes[2]])
          : new Set([attributes[2]]);
        // These weak attribute pseudos remain in Awakened's full Trade payload
        // and are only hidden in its ordinary editor. Preserve them for the
        // serializer and let presentation apply the upstream-hidden tag.
        for (const candidate of hidden) {
          candidate.modifier.tags.push("upstream-hidden");
        }
      }
    }
  }

  if (!generated.length) return item.modifiers;
  return [
    ...generated.map((candidate) => candidate.modifier),
    ...item.modifiers.flatMap((modifier) => {
      if (!consumed.has(modifier)) return [modifier];
      // APT consumes the Explicit-comparable clone into the generated pseudo,
      // then re-appends the original Fractured crafting row. Preserve that
      // provenance so the planner can hide the real Fractured row without
      // inventing a second Explicit comparable.
      if (modifier.kind === "fractured") {
        return [{
          ...modifier,
          tags: [...new Set([...modifier.tags, "pseudo-consumed-source"])],
        }];
      }
      return [];
    }),
  ];
}

function canonicalTradeLabel(
  ref: string | undefined,
  values: readonly number[],
) {
  if (typeof ref !== "string" || !ref) return undefined;
  let valueIndex = 0;
  let complete = true;
  const label = ref.replace(/([+-]?)#/g, (_token, sign: string) => {
    const value = values[valueIndex++];
    if (!Number.isFinite(value)) {
      complete = false;
      return "#";
    }
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    if (sign === "+") return rounded >= 0 ? `+${rounded}` : String(rounded);
    if (sign === "-") return rounded >= 0 ? `-${rounded}` : String(-rounded);
    return String(rounded);
  });
  return complete && valueIndex === values.length && label.length <= 512
    ? label
    : undefined;
}

function renderedMatcherLabel(
  candidate: TradeStatCatalogCandidate,
  values: readonly number[],
  bounds?: { min: number; max: number },
  decimalPrecision = false,
) {
  const roll = values.length ? values[0] : undefined;
  const displayMatchers = candidate.option
    ? [{ text: candidate.displayText || candidate.matcherText }]
    : candidate.displayMatchers?.length
    ? candidate.displayMatchers
    : [{
        text: candidate.displayText || candidate.matcherText,
        ...(candidate.semantics.negate ? { negate: true as const } : {}),
        ...(Number.isFinite(candidate.semantics.constant)
          ? { value: candidate.semantics.constant }
          : {}),
      }];
  let translation: TradeStatDisplayMatcher | undefined;
  if (roll == null) {
    translation = displayMatchers.find((matcher) => matcher.value == null) ||
      displayMatchers[0];
  } else {
    translation = displayMatchers.find((matcher) => matcher.value === roll);
    if (!translation) {
      const sameSign = bounds == null ||
        Math.sign(bounds.min) === Math.sign(bounds.max);
      translation = sameSign
        ? displayMatchers.find((matcher) =>
            matcher.value == null && Boolean(matcher.negate) === (roll < 0)
          )
        : displayMatchers.find((matcher) =>
            matcher.value == null && !matcher.negate
          );
    }
    translation ||= displayMatchers.find((matcher) => matcher.value == null);
  }
  translation ||= { text: `BUG_STAT_ID: ${candidate.ref}` };
  if (roll == null) return translation.text;
  const displayRoll = translation.negate ? -roll : roll;
  const decimalPlaces = !decimalPrecision || Math.abs(displayRoll) >= 10
    ? 0
    : Math.abs(displayRoll) < 2.3
      ? 2
      : 1;
  const rounding = 10 ** decimalPlaces;
  const rounded = Math.trunc(displayRoll * rounding) / rounding;
  const rendered = translation.text.replace(
    /(?<!#)[+-]?#/g,
    String(rounded),
  );
  return rendered.length <= 2_000 ? rendered : undefined;
}

interface ResolvedCatalogPresentation {
  candidate: TradeStatCatalogCandidate;
  values: number[];
  bounds?: { min: number; max: number };
  decimalPrecision: boolean;
}

interface ResolvedCatalogEntry {
  modifier: ParsedPoeModifier;
  ambiguous: boolean;
  presentation?: ResolvedCatalogPresentation;
}

function resolvedCatalogBounds(
  match: MatchedCatalogCandidate,
  modifier: ParsedPoeModifier,
) {
  if (match.bounds) return match.bounds;
  if (modifier.tradeBounds) return modifier.tradeBounds;
  const value = match.values.length === 1 ? match.values[0] : undefined;
  return Number.isFinite(value) ? { min: value!, max: value! } : undefined;
}

function resolveCatalogEntry(
  item: ParsedPoeItem,
  modifier: ParsedPoeModifier,
  entry: TradeStatCatalogEntry,
  groups: ReadonlyMap<number, TradeStatCatalogGroup>,
): ResolvedCatalogEntry | null {
  const semanticMatches = [
    ...new Map(
      candidatesFor(item, modifier, entry, groups).map((match) => [matchKey(match), match]),
    ).values(),
  ];
  const matches = semanticMatches;
  if (!matches.length) return null;

  const explicitCounterpartIds = modifier.kind === "fractured"
    ? candidatesFor(
        item,
        { ...modifier, kind: "explicit" },
        entry,
        groups,
      ).flatMap((candidate) =>
        matches.some((selected) =>
          candidate.candidate.ref === selected.candidate.ref &&
          compatibleMatchKey(candidate) === compatibleMatchKey(selected)
        )
          ? [candidate.candidate.id]
          : []
      )
    : [];

  const selectedTradeIds = [
    ...new Set(matches.map(({ candidate }) => candidate.id)),
  ];
  const tradeIdCandidates = [
    ...new Set([
      ...selectedTradeIds,
      ...explicitCounterpartIds,
    ]),
  ];
  if (matches.length === 1) {
    const match = matches[0];
    const resolvedBounds = resolvedCatalogBounds(match, modifier);
    const withValueSemantics = match.candidate.option
      ? modifier
      : applyValueSemantics(modifier, match.values);
    return {
      ambiguous: false,
      presentation: {
        candidate: match.candidate,
        values: match.values,
        ...(resolvedBounds ? { bounds: resolvedBounds } : {}),
        decimalPrecision: match.decimalPrecision,
      },
      modifier: {
        ...withValueSemantics,
        tradeId: match.candidate.id,
        tradeIds: [match.candidate.id],
        ...(valueTransformsFor([match])
          ? { tradeIdTransforms: valueTransformsFor([match]) }
          : {}),
        tradeIdCandidates,
        tradeDirection: match.direction,
        tradeInverted: match.inverted,
        tradeDecimalPrecision: match.decimalPrecision,
        tradeStatRef: match.candidate.ref,
        ...(renderedMatcherLabel(
          match.candidate,
          match.values,
          resolvedBounds,
          match.decimalPrecision,
        )
          ? { tradeDisplayText: renderedMatcherLabel(
              match.candidate,
              match.values,
              resolvedBounds,
              match.decimalPrecision,
            ) }
          : {}),
        ...(canonicalTradeLabel(match.candidate.ref, match.values)
          ? { tradeLabel: canonicalTradeLabel(match.candidate.ref, match.values) }
          : {}),
        ...(match.tradeOption != null ? { tradeOption: match.tradeOption } : {}),
        ...(match.anointmentOils ? { anointmentOils: match.anointmentOils } : {}),
        ...(resolvedBounds ? { tradeBounds: resolvedBounds } : {}),
      },
    };
  }


  // Awakened keeps multiple compatible IDs on one filter and submits them as
  // a count/min=1 group. They are alternatives, not an ambiguity to discard.
  if (new Set(matches.map(compatibleMatchKey)).size === 1) {
    const match = matches[0];
    const resolvedBounds = resolvedCatalogBounds(match, modifier);
    const sharedRef = matches.every(
      (candidate) => candidate.candidate.ref === match.candidate.ref,
    );
    const withValueSemantics = match.candidate.option
      ? modifier
      : applyValueSemantics(modifier, match.values);
    return {
      ambiguous: false,
      presentation: {
        candidate: match.candidate,
        values: match.values,
        ...(resolvedBounds ? { bounds: resolvedBounds } : {}),
        decimalPrecision: match.decimalPrecision,
      },
      modifier: {
        ...withValueSemantics,
        tradeId: selectedTradeIds[0],
        tradeIds: selectedTradeIds,
        ...(valueTransformsFor(matches)
          ? { tradeIdTransforms: valueTransformsFor(matches) }
          : {}),
        tradeIdCandidates,
        tradeDirection: match.direction,
        tradeInverted: match.inverted,
        tradeDecimalPrecision: match.decimalPrecision,
        ...(sharedRef ? { tradeStatRef: match.candidate.ref } : {}),
        ...(renderedMatcherLabel(
          match.candidate,
          match.values,
          resolvedBounds,
          match.decimalPrecision,
        )
          ? { tradeDisplayText: renderedMatcherLabel(
              match.candidate,
              match.values,
              resolvedBounds,
              match.decimalPrecision,
            ) }
          : {}),
        ...(sharedRef && canonicalTradeLabel(match.candidate.ref, match.values)
          ? { tradeLabel: canonicalTradeLabel(match.candidate.ref, match.values) }
          : {}),
        ...(match.tradeOption != null ? { tradeOption: match.tradeOption } : {}),
        ...(match.anointmentOils ? { anointmentOils: match.anointmentOils } : {}),
        ...(resolvedBounds ? { tradeBounds: resolvedBounds } : {}),
      },
    };
  }

  const rolls = [
    ...new Map(
      matches.map(({ values }) => [JSON.stringify(values), values]),
    ).values(),
  ];
  const withSharedRoll = rolls.length === 1
    ? applyValueSemantics(modifier, rolls[0])
    : modifier;
  const {
    tradeId: _tradeId,
    tradeIds: _tradeIds,
    tradeIdTransforms: _tradeIdTransforms,
    tradeDirection: _tradeDirection,
    tradeInverted: _tradeInverted,
    tradeDecimalPrecision: _tradeDecimalPrecision,
    tradeBounds: _tradeBounds,
    tradeOption: _tradeOption,
    tradeStatRef: _tradeStatRef,
    tradeLabel: _tradeLabel,
    tradeDisplayText: _tradeDisplayText,
    ...withoutGuessedTradeMetadata
  } = withSharedRoll;
  return {
    ambiguous: true,
    modifier: {
      ...withoutGuessedTradeMetadata,
      tradeIdCandidates,
    },
  };
}

function aggregateResolvedCatalogEntries(
  item: ParsedPoeItem,
  entries: readonly ResolvedCatalogEntry[],
) {
  const grouped = new Map<string, ResolvedCatalogEntry[]>();
  const ordered: Array<ResolvedCatalogEntry | { groupKey: string }> = [];
  for (const entry of entries) {
    const modifier = entry.modifier;
    const groupable = !entry.ambiguous &&
      entry.presentation != null &&
      typeof modifier.tradeStatRef === "string" &&
      modifier.tradeStatRef.length > 0 &&
      isOfficialTradeStatId(modifier.tradeId || "");
    if (!groupable) {
      ordered.push(entry);
      continue;
    }
    const groupKey = `${modifier.kind}\u0000${modifier.tradeStatRef}`;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.push(entry);
      continue;
    }
    grouped.set(groupKey, [entry]);
    ordered.push({ groupKey });
  }

  const tabletMaximum = /^mirrored tablet$/i.test(
    (item.name || item.baseType).trim(),
  );
  const aggregate = (values: readonly number[]) => values.reduce(
    tabletMaximum
      ? (maximum, value) => Math.max(maximum, value)
      : (sum, value) => sum + value,
    0,
  );
  const results = ordered.map((entry) => {
    if (!("groupKey" in entry)) return entry.modifier;
    const sources = grouped.get(entry.groupKey)!;
    const first = sources[0];
    if (sources.length === 1) return first.modifier;
    if (first.modifier.tradeOption != null) {
      return {
        ...first.modifier,
        id: sources.map(({ modifier }) => modifier.id).join("+"),
        tags: [...new Set(sources.flatMap(({ modifier }) => modifier.tags))],
        selectedByDefault: sources.some(
          ({ modifier }) => modifier.selectedByDefault,
        ),
        advanced: sources.some(({ modifier }) => modifier.advanced),
      };
    }
    const contributions = sources.map(({ modifier }) => {
      const value = modifier.values[0];
      if (!Number.isFinite(value)) return { value: 1, min: 1, max: 1 };
      const bounds = modifier.tradeBounds || { min: value, max: value };
      return { value, min: bounds.min, max: bounds.max };
    });
    const value = aggregate(contributions.map((roll) => roll.value));
    const bounds = {
      min: aggregate(contributions.map((roll) => roll.min)),
      max: aggregate(contributions.map((roll) => roll.max)),
    };
    const decimalPrecision = sources.some(
      ({ presentation, modifier }) =>
        presentation?.decimalPrecision || modifier.tradeDecimalPrecision,
    );
    const sourceValues = sources.flatMap(({ modifier }) =>
      modifier.sourceValues || modifier.values
    );
    const label = renderedMatcherLabel(
      first.presentation!.candidate,
      [value],
      bounds,
      decimalPrecision,
    );
    const canonical = canonicalTradeLabel(
      first.modifier.tradeStatRef!,
      [value],
    );
    const {
      tradeDisplayText: _firstTradeDisplayText,
      tradeLabel: _firstTradeLabel,
      ...firstWithoutPresentation
    } = first.modifier;
    return {
      ...firstWithoutPresentation,
      id: sources.map(({ modifier }) => modifier.id).join("+"),
      values: [value],
      sourceValues,
      tradeBounds: bounds,
      tradeDecimalPrecision: decimalPrecision,
      tags: [...new Set(sources.flatMap(({ modifier }) => modifier.tags))],
      selectedByDefault: sources.some(
        ({ modifier }) => modifier.selectedByDefault,
      ),
      advanced: sources.some(({ modifier }) => modifier.advanced),
      ...(label ? { tradeDisplayText: label } : {}),
      ...(canonical ? { tradeLabel: canonical } : {}),
    };
  });
  return results;
}

/** Resolves copied modifier text locally; ambiguous IDs are exposed, never guessed. */
export function applyTradeStatCatalog(
  item: ParsedPoeItem,
  pack: TradeStatCatalogPack | null,
): ParsedPoeItem {
  const timelessItem = {
    ...item,
    modifiers: withTimelessTradeStats(item.modifiers),
  };
  if (!pack) {
    return {
      ...timelessItem,
      warnings: [
        ...timelessItem.warnings,
        "The bundled Trade modifier catalog is unavailable; modifier filters require manual review.",
      ],
    };
  }
  let byPattern = catalogIndexes.get(pack);
  if (!byPattern) {
    byPattern = new Map(pack.entries.map((entry) => [entry.pattern, entry]));
    catalogIndexes.set(pack, byPattern);
  }
  let groups = catalogGroupIndexes.get(pack);
  if (!groups) {
    groups = new Map(pack.groups.map((group) => [group.id, group]));
    catalogGroupIndexes.set(pack, groups);
  }
  const sourceModifiers = withAwakenedPseudos(timelessItem, byPattern);
  // Dedicated current-version resolvers (notably Timeless variants newer than
  // the pinned Awakened pack) are already safe official mappings. Count them
  // so a correct fallback does not also emit the contradictory "no match"
  // warning merely because the bundled catalog has not learned that leader.
  let resolved = sourceModifiers.filter((modifier) =>
    isOfficialTradeStatId(modifier.tradeId || "")
  ).length;
  let ambiguous = 0;
  const catalogEntries: ResolvedCatalogEntry[] = [];
  for (let index = 0; index < sourceModifiers.length;) {
    let matched = false;
    const maxWidth = catalogWindowLimit(sourceModifiers, index);
    // APT's linesToStatStrings resolves the shortest prefix inside one copied
    // modifier group. Never fuse adjacent Advanced affixes or plain sections.
    for (let width = 1; width <= maxWidth; width += 1) {
      const combined = combineModifierWindow(
        sourceModifiers.slice(index, index + width),
      );
      const entry = byPattern.get(normalized(combined.normalizedText));
      if (!entry) continue;
      const result = resolveCatalogEntry(timelessItem, combined, entry, groups);
      if (!result) continue;
      catalogEntries.push(result);
      if (result.ambiguous) ambiguous += 1;
      else resolved += 1;
      index += width;
      matched = true;
      break;
    }
    if (!matched) {
      catalogEntries.push({
        modifier: sourceModifiers[index],
        ambiguous: false,
      });
      index += 1;
    }
  }
  const warnings = [...timelessItem.warnings];
  if (ambiguous) {
    warnings.push(
      `${ambiguous} modifier${ambiguous === 1 ? " has" : "s have"} multiple possible Trade IDs and will not be selected automatically.`,
    );
  }
  if (sourceModifiers.length && resolved === 0) {
    warnings.push(
      "No copied modifiers matched this pinned Trade catalog; review filters manually after a game patch.",
    );
  }
  return {
    ...timelessItem,
    modifiers: aggregateResolvedCatalogEntries(timelessItem, catalogEntries),
    warnings,
  };
}

export async function hydrateTradeStatIds(item: ParsedPoeItem) {
  let hydrated = item;
  if (
    item.rarity === "magic" &&
    (!item.baseType || item.baseType === item.name)
  ) {
    const baseType = resolveMagicBaseType(item.name);
    hydrated = baseType
      ? { ...item, baseType }
      : {
          ...item,
          warnings: [
            ...item.warnings,
            "The affixed magic name did not match the pinned base-type catalog; the Trade search will avoid guessing a false base.",
          ],
        };
  }
  if (!hydrated.modifiers.length && !hydrated.logbookAreas?.length) return hydrated;
  const pack = await loadTradeStatCatalog();
  const standard = hydrated.modifiers.length
    ? applyTradeStatCatalog(hydrated, pack)
    : hydrated;
  if (!hydrated.logbookAreas?.length) return standard;

  const areaWarnings: string[] = [];
  const logbookAreas = hydrated.logbookAreas.map((area, index) => {
    const areaResult = applyTradeStatCatalog(
      { ...hydrated, modifiers: area, warnings: [] },
      pack,
    );
    areaWarnings.push(...areaResult.warnings.map(
      (warning) => `Logbook area ${index + 1}: ${warning}`,
    ));
    return areaResult.modifiers;
  });
  return {
    ...standard,
    logbookAreas,
    warnings: [...standard.warnings, ...areaWarnings],
  };
}
