export type RegexEntryMode = "avoid" | "want";
export type RegexMatchMode = "any" | "all";

export interface RegexEntry {
  id: string;
  label: string;
  text?: string;
  selected: boolean;
  mode?: RegexEntryMode;
  /** A precomputed pattern proven unique within the entry's data category. */
  optimizedToken?: string;
  /** A precomputed exact pattern, primarily for numeric templates. */
  exactToken?: string;
}

export interface RegexUniverseEntry {
  id?: string;
  label: string;
  text?: string;
}

export interface PoeRegexToken {
  id: string;
  token: string;
  mode: RegexEntryMode;
  optimized: boolean;
}

export interface PoeRegexResult {
  expression: string;
  characterCount: number;
  valid: boolean;
  overflow: boolean;
  unresolved: string[];
  optimizationFallbacks: string[];
  tokens: PoeRegexToken[];
  chunks: string[];
  /** True when running every chunk and combining its results preserves the query. */
  chunksAreLossless: boolean;
  /** Complete quoted terms that cannot fit without changing their regex. */
  oversizedTerms: string[];
}

export interface BuildPoeRegexOptions {
  exact?: boolean;
  limit?: number;
  wantMatch?: RegexMatchMode;
  /** Positive clauses, such as map properties, that must all match. */
  requiredPatterns?: string[];
  /** The complete category, not merely the currently visible or unchecked rows. */
  universe?: readonly (string | RegexUniverseEntry)[];
  minimumTokenLength?: number;
}

export const POE_REGEX_LIMIT = 250;

export function escapePoeRegex(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function normalizePoeSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function candidateTokens(value: string, minimumLength = 3) {
  const clean = normalizePoeSearchText(value);
  const candidates: string[] = [];
  for (let length = Math.max(1, minimumLength); length <= clean.length; length += 1) {
    for (let start = 0; start + length <= clean.length; start += 1) {
      const candidate = clean.slice(start, start + length);
      if (
        candidate.startsWith(" ") ||
        candidate.endsWith(" ") ||
        candidate.includes("#") ||
        !/[\p{L}\p{N}]/u.test(candidate)
      ) continue;
      candidates.push(candidate);
    }
  }
  return candidates;
}

/** Find the shortest literal fragment that selects this line and no other line. */
export function shortestDistinctToken(
  value: string,
  otherValues: string[],
  minimumLength = 3,
) {
  const others = otherValues.map(normalizePoeSearchText);
  return candidateTokens(value, minimumLength).find(
    (candidate) => !others.some((other) => other.includes(candidate)),
  ) || normalizePoeSearchText(value);
}

export function exactPoeRegex(value: string) {
  return `^${escapePoeRegex(normalizePoeSearchText(value))}$`;
}

export function quotePoeRegexTerm(pattern: string, negative = false) {
  const escapedQuotes = pattern.replace(/"/g, '\\"');
  return `"${negative ? "!" : ""}${escapedQuotes}"`;
}

function validPattern(pattern: string) {
  try {
    void new RegExp(pattern, "iu");
    return true;
  } catch {
    return false;
  }
}

function universeValues(universe: BuildPoeRegexOptions["universe"]) {
  return (universe || []).map((entry) =>
    typeof entry === "string" ? entry : entry.text || entry.label
  );
}

function isUniquePattern(pattern: string, value: string, universe: string[]) {
  if (!validPattern(pattern)) return false;
  const expression = new RegExp(pattern, "iu");
  const own = normalizePoeSearchText(value);
  if (!expression.test(own)) return false;
  return !universe.some((candidate) => {
    const normalized = normalizePoeSearchText(candidate);
    return normalized !== own && expression.test(normalized);
  });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function joinTerms(terms: string[]) {
  return terms.filter(Boolean).join(" ");
}

function greedyChunks(terms: string[], limit: number) {
  const chunks: string[] = [];
  const oversized: string[] = [];
  let current = "";
  for (const term of terms) {
    if (term.length > limit) {
      if (current) chunks.push(current);
      current = "";
      oversized.push(term);
      continue;
    }
    const candidate = joinTerms([current, term]);
    if (!current || candidate.length <= limit) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    current = term;
  }
  if (current) chunks.push(current);
  return { chunks, oversized };
}

export interface PoeRegexChunkInput {
  avoidPatterns: string[];
  requiredPatterns?: string[];
  wantPatterns: string[];
  wantMatch: RegexMatchMode;
  limit?: number;
}

/**
 * Split only at complete quoted terms. WANT/Any can be split into independent
 * searches whose union is the original query; other overflows are advisory.
 */
export function chunkPoeRegexQuery({
  avoidPatterns,
  requiredPatterns = [],
  wantPatterns,
  wantMatch,
  limit = POE_REGEX_LIMIT,
}: PoeRegexChunkInput) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("PoE regex chunk limit must be a positive integer.");
  }
  const avoids = avoidPatterns.map((pattern) => quotePoeRegexTerm(pattern, true));
  const required = requiredPatterns.map((pattern) => quotePoeRegexTerm(pattern));
  const wants = wantPatterns.map((pattern) => quotePoeRegexTerm(pattern));
  const expression = joinTerms([
    ...avoids,
    ...required,
    ...(wantMatch === "any" && wantPatterns.length
      ? [quotePoeRegexTerm(wantPatterns.join("|"))]
      : wants),
  ]);
  if (expression.length <= limit) {
    return { chunks: expression ? [expression] : [], lossless: true, oversized: [] };
  }

  const requiredExpression = joinTerms([...avoids, ...required]);
  if (wantMatch === "any" && wantPatterns.length && requiredExpression.length <= limit) {
    const chunks: string[] = [];
    let group: string[] = [];
    for (const pattern of wantPatterns) {
      const next = [...group, pattern];
      const candidate = joinTerms([
        requiredExpression,
        quotePoeRegexTerm(next.join("|")),
      ]);
      if (!group.length || candidate.length <= limit) {
        group = next;
        continue;
      }
      chunks.push(joinTerms([
        requiredExpression,
        quotePoeRegexTerm(group.join("|")),
      ]));
      group = [pattern];
    }
    if (group.length) {
      chunks.push(joinTerms([
        requiredExpression,
        quotePoeRegexTerm(group.join("|")),
      ]));
    }
    if (chunks.every((chunk) => chunk.length <= limit)) {
      return { chunks, lossless: true, oversized: [] };
    }
  }

  const atomicTerms = [
    ...avoids,
    ...required,
    ...(wantMatch === "any" && wantPatterns.length
      ? [quotePoeRegexTerm(wantPatterns.join("|"))]
      : wants),
  ];
  const chunked = greedyChunks(atomicTerms, limit);
  return {
    chunks: chunked.chunks,
    lossless: false,
    oversized: chunked.oversized,
  };
}

/** Build a PoE search query with negated AVOID terms and positive WANT terms. */
export function buildPoeRegex(
  entries: RegexEntry[],
  options: BuildPoeRegexOptions = {},
): PoeRegexResult {
  const selected = entries.filter((entry) => entry.selected && entry.label.trim());
  const universe = universeValues(options.universe);
  const optimizationFallbacks: string[] = [];
  const unresolved: string[] = [];
  const tokens: PoeRegexToken[] = [];

  for (const entry of selected) {
    const value = entry.text || entry.label;
    const normalized = normalizePoeSearchText(value);
    if (!normalized) {
      unresolved.push(entry.id);
      continue;
    }
    const exact = entry.exactToken || exactPoeRegex(value);
    let token = exact;
    let optimized = false;
    if (!options.exact) {
      if (entry.optimizedToken) {
        if (!universe.length || isUniquePattern(entry.optimizedToken, value, universe)) {
          token = entry.optimizedToken;
          optimized = token !== exact;
        } else {
          optimizationFallbacks.push(entry.id);
        }
      } else if (universe.length) {
        const others = universe.filter(
          (candidate) => normalizePoeSearchText(candidate) !== normalized,
        );
        const candidate = shortestDistinctToken(
          value,
          others,
          options.minimumTokenLength,
        );
        const pattern = escapePoeRegex(candidate);
        if (isUniquePattern(pattern, value, universe)) {
          token = pattern;
          optimized = token !== exact;
        } else {
          optimizationFallbacks.push(entry.id);
        }
      } else {
        optimizationFallbacks.push(entry.id);
      }
    }
    tokens.push({
      id: entry.id,
      token,
      mode: entry.mode || "want",
      optimized,
    });
  }

  const avoidPatterns = unique(
    tokens.filter((entry) => entry.mode === "avoid").map((entry) => entry.token),
  );
  const wantPatterns = unique(
    tokens.filter((entry) => entry.mode === "want").map((entry) => entry.token),
  );
  const requiredPatterns = unique(options.requiredPatterns || []);
  const wantMatch = options.wantMatch || "any";
  const limit = options.limit ?? POE_REGEX_LIMIT;
  const chunked = chunkPoeRegexQuery({
    avoidPatterns,
    requiredPatterns,
    wantPatterns,
    wantMatch,
    limit,
  });
  const expression = joinTerms([
    ...avoidPatterns.map((pattern) => quotePoeRegexTerm(pattern, true)),
    ...requiredPatterns.map((pattern) => quotePoeRegexTerm(pattern)),
    ...(wantMatch === "any" && wantPatterns.length
      ? [quotePoeRegexTerm(wantPatterns.join("|"))]
      : wantPatterns.map((pattern) => quotePoeRegexTerm(pattern))),
  ]);
  return {
    expression,
    characterCount: expression.length,
    valid: unresolved.length === 0 &&
      tokens.every((entry) => validPattern(entry.token)) &&
      requiredPatterns.every(validPattern),
    overflow: expression.length > limit,
    unresolved,
    optimizationFallbacks,
    tokens,
    chunks: chunked.chunks,
    chunksAreLossless: chunked.lossless,
    oversizedTerms: chunked.oversized,
  };
}

export interface RegexGroup {
  id: string;
  label: string;
  enabled: boolean;
  entries: RegexEntry[];
}

/** Groups are OR-ed internally and AND-ed through positive lookaheads. */
export function buildGroupedPoeRegex(groups: RegexGroup[]) {
  const active = groups.filter((group) => group.enabled);
  const parts: string[] = [];
  const unresolved: string[] = [];
  for (const group of active) {
    const selected = group.entries.filter((entry) => entry.selected && entry.label.trim());
    const patterns = selected.map((entry) => exactPoeRegex(entry.text || entry.label));
    unresolved.push(...selected.filter((entry) => !normalizePoeSearchText(
      entry.text || entry.label,
    )).map((entry) => entry.id));
    if (patterns.length) parts.push(`(?=.*(?:${patterns.join("|")}))`);
  }
  const expression = parts.join("");
  return {
    expression,
    characterCount: expression.length,
    valid: unresolved.length === 0 && (active.length === 0 || parts.length === active.length),
    overflow: expression.length > POE_REGEX_LIMIT,
    unresolved,
  };
}

export interface SavedRegexPreset {
  id: string;
  name: string;
  category: "maps" | "map-names" | "waystones" | "tablets" | "flasks" | "vendor" | "items" | "gems" | "boat" | "expedition" | "heist" | "beasts" | "tattoos" | "runegrafts" | "scarabs" | "jewels" | "relics" | "custom";
  game?: "poe1" | "poe2";
  expression: string;
  tags: string[];
  hotkey?: string;
  tokenMode?: "exact" | "optimized";
  wantMatch?: RegexMatchMode;
  categoryUniverseSha256?: string;
  updatedAt: number;
}

export function isMacroPreset(preset: SavedRegexPreset) {
  return preset.tags.some((tag) => tag.toLowerCase().includes("macro"));
}
