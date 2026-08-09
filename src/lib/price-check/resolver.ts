import type { EconomyRow } from "../../types";
import type {
  ParsedPoeItem,
  PriceCheckMatch,
  PriceCheckMatchKind,
} from "./types";

export type EconomyRowGroups =
  | readonly EconomyRow[]
  | readonly (readonly EconomyRow[])[]
  | Readonly<Record<string, readonly EconomyRow[]>>;

export interface ResolvePriceCheckOptions {
  limit?: number;
  minimumScore?: number;
}

interface ResolverEvidence {
  copiedMutatedModifiers: ReadonlySet<string>;
}

const KIND_ORDER: Record<PriceCheckMatchKind, number> = {
  exact: 0,
  variant: 1,
  base: 2,
  fuzzy: 3,
};

function normalize(value?: string) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[’‘]/g, "'")
    .toLocaleLowerCase("en-US")
    .replace(/\b(foulborn)\s+/g, "$1 ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenList(value: string) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 1 || /^\d+$/.test(token));
}

function tokens(value: string) {
  return new Set(tokenList(value));
}

function variantWordMatches(itemTokens: ReadonlySet<string>, token: string) {
  if (itemTokens.has(token)) return true;
  if (/^\d+$/.test(token)) return false;
  return itemTokens.has(`${token}s`) ||
    (token.endsWith("s") && itemTokens.has(token.slice(0, -1)));
}

function numericVariantMatches(itemText: string, variantTokens: string[]) {
  const itemTokens = tokenList(itemText);
  const numericTokens = variantTokens.filter((token) => /^\d+$/.test(token));
  const anchors = variantTokens.filter((token) => !/^\d+$/.test(token));
  return numericTokens.every((numericToken) =>
    itemTokens.some((itemToken, index) => {
      if (itemToken !== numericToken) return false;
      if (!anchors.length) return true;
      const nearby = new Set(
        itemTokens.slice(Math.max(0, index - 4), index + 5),
      );
      return anchors.some((anchor) => variantWordMatches(nearby, anchor));
    }),
  );
}

function expandedVariantTokens(value: string) {
  return tokenList(value).flatMap((token) => {
    const links = /^(\d+)l$/.exec(token);
    if (links) return [links[1], "links"];
    const tier = /^t(\d+)$/.exec(token);
    if (tier) return ["tier", tier[1]];
    return [token];
  });
}

function structuredVariantTokens(item: ParsedPoeItem, row: EconomyRow) {
  const matched = new Set<string>();
  const addNumeric = (value: number | undefined, ...labels: string[]) => {
    if (value == null) return;
    matched.add(String(value));
    for (const label of labels) matched.add(label);
  };
  if (row.links != null && effectiveLinks(item) === row.links) {
    addNumeric(row.links, "link", "links", `${row.links}l`);
  }
  if (row.gemLevel != null && item.gemLevel === row.gemLevel) {
    addNumeric(row.gemLevel, "level", "gem");
  }
  if (row.gemQuality != null && item.quality === row.gemQuality) {
    addNumeric(row.gemQuality, "quality");
  }
  if (row.mapTier != null && item.mapTier === row.mapTier) {
    addNumeric(row.mapTier, "tier", `t${row.mapTier}`);
  }
  if (
    row.categoryId === "wombgifts" &&
    row.levelRequired != null &&
    item.itemLevel === row.levelRequired
  ) {
    addNumeric(row.levelRequired, "level");
  }
  return matched;
}

function diceSimilarity(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) {
    if (b.has(token)) common += 1;
  }
  return (2 * common) / (a.size + b.size);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function flattenRows(groups: EconomyRowGroups): EconomyRow[] {
  if (!Array.isArray(groups)) {
    return Object.values(groups).flatMap((rows) => [...rows]);
  }
  if (!groups.length) return [];
  return Array.isArray(groups[0])
    ? (groups as readonly (readonly EconomyRow[])[]).flatMap((rows) => [...rows])
    : [...(groups as readonly EconomyRow[])];
}

function isGem(item: ParsedPoeItem) {
  return item.rarity === "gem" || /\bgem\b/i.test(item.itemClass);
}

function isMap(item: ParsedPoeItem) {
  return item.mapTier != null || /\bmap\b/i.test(item.itemClass);
}

function categoryAdjustment(item: ParsedPoeItem, row: EconomyRow) {
  if (isGem(item)) {
    return row.categoryId === "skill-gems" || row.categoryId === "imbued-gems"
      ? 8
      : -45;
  }
  if (item.rarity === "divination-card") {
    return row.categoryId === "divination-cards" ? 8 : -45;
  }
  if (isMap(item)) {
    return /maps|invitations|memories|temples/.test(row.categoryId) ? 7 : -25;
  }
  if (item.rarity === "rare" || item.rarity === "magic") {
    if (row.categoryId === "cluster-jewels") return 9;
    return row.categoryId === "base-types" ? 9 : -18;
  }
  if (item.rarity === "unique") {
    return row.categoryId.startsWith("unique-") || row.categoryId === "forbidden-jewels"
      ? 7
      : -10;
  }
  return 0;
}

function rawItemVariantText(item: ParsedPoeItem) {
  return normalize(
    [
      item.rawText,
      item.name,
      item.baseType,
      ...item.influences,
      item.replica ? "replica" : "",
      item.synthesised ? "synthesised" : "",
      item.fractured ? "fractured" : "",
      item.scourged ? "scourged" : "",
      item.foil ? "foil" : "",
      item.foulborn ? "foulborn" : "",
    ].join(" "),
  );
}

const MODIFIER_RANGE_TOKEN = "wildcardnumbertoken";

function modifierIdentity(value?: string) {
  return normalize(value);
}

function modifierMatchesItem(rawItemText: string, modifierText?: string) {
  if (!modifierText?.trim()) return true;
  const withRanges = modifierText.normalize("NFKC").replace(
    /\(\s*[-+]?\d+(?:\.\d+)?\s*[-–—]\s*[-+]?\d+(?:\.\d+)?\s*\)/g,
    ` ${MODIFIER_RANGE_TOKEN} `,
  );
  const normalizedPattern = normalize(withRanges);
  if (!normalizedPattern) return true;
  const escaped = normalizedPattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(MODIFIER_RANGE_TOKEN, "[0-9]+(?: [0-9]+)?");
  return new RegExp(`(?:^| )${escaped}(?: |$)`, "i").test(
    normalize(rawItemText),
  );
}

function copiedMutatedModifierEvidence(
  item: ParsedPoeItem,
  rows: readonly EconomyRow[],
) {
  const copied = new Set<string>();
  for (const row of rows) {
    if (!sameMutationMarketIdentity(item, row)) continue;
    for (const modifier of row.mutatedModifiers || []) {
      const identity = modifierIdentity(modifier.text);
      if (identity && modifierMatchesItem(item.rawText, modifier.text)) {
        copied.add(identity);
      }
    }
  }
  return copied;
}

function sameMutationMarketIdentity(item: ParsedPoeItem, row: EconomyRow) {
  const itemName = normalize(item.name);
  const rowName = normalize(row.name);
  if (!itemName || !rowName) return false;
  const expectedName = item.foulborn && !itemName.startsWith("foulborn ")
    ? `foulborn ${itemName}`
    : itemName;
  if (rowName !== expectedName) return false;

  const itemBase = normalize(item.baseType);
  const rowBase = normalize(row.baseType);
  return !itemBase || !rowBase || itemBase === rowBase;
}

function scoreStructuredModifiers(
  item: ParsedPoeItem,
  row: EconomyRow,
  reasons: string[],
  evidence?: ResolverEvidence,
) {
  let adjustment = 0;
  let mismatch = false;
  const explicit = (row.explicitModifiers || []).filter((entry) => entry.text?.trim());
  const mutated = (row.mutatedModifiers || []).filter((entry) => entry.text?.trim());

  for (const modifier of explicit) {
    if (modifierMatchesItem(item.rawText, modifier.text)) {
      adjustment += 2;
    } else if (!modifier.optional) {
      adjustment -= 100;
      mismatch = true;
      reasons.push(`required modifier differs: ${modifier.text}`);
    }
  }

  const rowMutations = new Set(mutated.map((entry) => modifierIdentity(entry.text)));
  if (evidence && (rowMutations.size || evidence.copiedMutatedModifiers.size)) {
    const exactMutationSet =
      rowMutations.size === evidence.copiedMutatedModifiers.size &&
      [...rowMutations].every((entry) => evidence.copiedMutatedModifiers.has(entry));
    if (!exactMutationSet) {
      adjustment -= 100;
      mismatch = true;
      reasons.push("Foulborn mutation set differs");
    } else if (rowMutations.size) {
      adjustment += Math.min(16, rowMutations.size * 8);
      reasons.push(`${rowMutations.size} Foulborn mutations match`);
    }
  } else {
    for (const modifier of mutated) {
      if (modifierMatchesItem(item.rawText, modifier.text)) {
        adjustment += 8;
      } else if (!modifier.optional) {
        adjustment -= 100;
        mismatch = true;
        reasons.push(`Foulborn mutation differs: ${modifier.text}`);
      }
    }
  }

  return {
    adjustment,
    mismatch,
    authoritative: explicit.length > 0 || mutated.length > 0,
  };
}

function scoreVariant(
  item: ParsedPoeItem,
  row: EconomyRow,
  reasons: string[],
  evidence?: ResolverEvidence,
) {
  let adjustment = 0;
  let mismatch = false;
  const rowVariant = normalize(row.variant);
  const itemVariantText = rawItemVariantText(item);
  const rowIdentity = normalize(`${row.name} ${row.baseType || ""} ${row.variant || ""}`);

  const flagVariants = [
    ["replica", item.replica],
    ["synthesised", item.synthesised],
    ["fractured", item.fractured],
    ["scourged", item.scourged],
    ["foulborn", item.foulborn],
  ] as const;

  for (const [label, enabled] of flagVariants) {
    const rowHasFlag = rowIdentity.includes(label);
    if (enabled && !rowHasFlag) {
      adjustment -= label === "foulborn" ? 100 : 48;
      mismatch = true;
      reasons.push(`${label} state does not match`);
    } else if (!enabled && rowHasFlag) {
      adjustment -= 48;
      mismatch = true;
      reasons.push(`market row is ${label}, copied item is not`);
    } else if (enabled) {
      adjustment += 5;
      reasons.push(`${label} variant matches`);
    }
  }

  const structured = scoreStructuredModifiers(item, row, reasons, evidence);
  adjustment += structured.adjustment;
  mismatch ||= structured.mismatch;

  if (rowVariant && !structured.authoritative) {
    const variantTokens = expandedVariantTokens(rowVariant);
    const usefulTokens = variantTokens.filter(
      (token) => !["normal", "default", "none", "legacy"].includes(token),
    );
    const itemVariantTokens = tokens(itemVariantText);
    const structuredTokens = structuredVariantTokens(item, row);
    const numericTokens = usefulTokens.filter((token) => /^\d+$/.test(token));
    const numericMismatch =
      numericTokens.some((token) => !structuredTokens.has(token)) &&
      !numericVariantMatches(
        itemVariantText,
        usefulTokens.filter((token) => !structuredTokens.has(token)),
      );
    const matchesText =
      usefulTokens.length === 0 ||
      usefulTokens.every(
        (token) =>
          structuredTokens.has(token) ||
          variantWordMatches(itemVariantTokens, token),
      );
    if (numericMismatch) {
      adjustment -= 100;
      mismatch = true;
      reasons.push(`different numeric variant: ${row.variant}`);
    } else if (matchesText) {
      adjustment += 7;
      reasons.push(`variant matches: ${row.variant}`);
    } else {
      adjustment -= 42;
      mismatch = true;
      reasons.push(`different variant: ${row.variant}`);
    }
  }

  return { adjustment, mismatch };
}

function compareNumericState(
  label: string,
  itemValue: number | undefined,
  rowValue: number | undefined,
  penaltyPerUnit: number,
  maximumPenalty: number,
  reasons: string[],
) {
  if (itemValue == null || rowValue == null) {
    return { adjustment: 0, mismatch: false };
  }
  const difference = Math.abs(itemValue - rowValue);
  if (!difference) {
    reasons.push(`${label} ${itemValue} matches`);
    return { adjustment: 5, mismatch: false };
  }
  reasons.push(`${label} differs (${itemValue} vs ${rowValue})`);
  return {
    adjustment: -Math.min(maximumPenalty, difference * penaltyPerUnit),
    mismatch: true,
  };
}

function effectiveLinks(item: ParsedPoeItem) {
  if (item.links != null) return item.links;
  if (!item.sockets.length) return undefined;
  return Math.max(...item.sockets.map((group) => group.links), 0) || undefined;
}

function identityScore(item: ParsedPoeItem, row: EconomyRow, reasons: string[]) {
  const itemName = normalize(item.name);
  const itemBase = normalize(item.baseType);
  const rowName = normalize(row.name);
  const rowBase = normalize(row.baseType);
  const exactName = Boolean(itemName && rowName && itemName === rowName);
  const exactUniqueName = Boolean(
    exactName ||
    (item.foulborn && itemName && rowName === `foulborn ${itemName}`),
  );
  const exactBase = Boolean(
    itemBase && (itemBase === rowName || (rowBase && itemBase === rowBase)),
  );
  const specialized = new Set([
    "forbidden-jewels",
    "cluster-jewels",
    "temples",
  ]).has(row.categoryId);

  if (specialized) {
    const copiedIdentity = rawItemVariantText(item);
    if (rowName && (exactName || copiedIdentity.includes(rowName))) {
      reasons.push("specialized market identity appears in copied item text");
      return {
        score: exactBase ? 84 : 78,
        kind: "exact" as const,
        exactName: true,
        exactBase,
      };
    }
    return null;
  }

  // An identified unique's base can have many unrelated unique outcomes.
  // Showing those rows beside the named item looks like a price comparison but
  // is not one; only the exact named unique (including its Foulborn prefix)
  // is a valid aggregate market reference.
  if (item.rarity === "unique" && itemName && !exactUniqueName) return null;

  if (item.rarity === "rare" || item.rarity === "magic") {
    if (exactBase) {
      reasons.push("base type matches");
      return { score: 64, kind: "base" as const, exactName: false, exactBase: true };
    }
    const similarity = Math.max(diceSimilarity(item.baseType, row.name), diceSimilarity(item.baseType, row.baseType || ""));
    if (similarity >= 0.68) {
      reasons.push(`similar base type (${Math.round(similarity * 100)}%)`);
      return { score: 28 + similarity * 28, kind: "fuzzy" as const, exactName: false, exactBase: false };
    }
    return null;
  }

  if (exactUniqueName) {
    reasons.push("item name matches exactly");
    return {
      score: exactBase ? 78 : 72,
      kind: "exact" as const,
      exactName: true,
      exactBase,
    };
  }
  if (exactBase) {
    reasons.push("base type matches");
    return { score: 58, kind: "base" as const, exactName, exactBase };
  }

  const nameSimilarity = diceSimilarity(item.name, row.name);
  const baseSimilarity = Math.max(
    diceSimilarity(item.baseType, row.name),
    diceSimilarity(item.baseType, row.baseType || ""),
  );
  const similarity = Math.max(nameSimilarity, baseSimilarity * 0.92);
  if (similarity < 0.58) return null;
  reasons.push(`similar item identity (${Math.round(similarity * 100)}%)`);
  return {
    score: 25 + similarity * 35,
    kind: "fuzzy" as const,
    exactName,
    exactBase,
  };
}

/**
 * Scores one poe.ninja economy row against a parsed clipboard item. The score
 * represents identity/state compatibility only; price reliability is handled by
 * the estimator so a perfectly identified one-listing item can still be rejected.
 */
export function scorePriceCheckMatch(
  item: ParsedPoeItem,
  row: EconomyRow,
  evidence?: ResolverEvidence,
): PriceCheckMatch | null {
  if (!item.valid || (!item.name && !item.baseType)) return null;
  if (item.rarity === "unique" && !item.identified) return null;
  // poe.ninja has no aggregate identity for these unique-only states. A clean
  // row is not a price reference for the copied variant.
  if (item.rarity === "unique" && (item.vestigial || item.foil)) return null;

  const reasons: string[] = [];
  const identity = identityScore(item, row, reasons);
  if (!identity) return null;

  let score = identity.score + categoryAdjustment(item, row);
  let stateMismatch = false;
  const variant = scoreVariant(item, row, reasons, evidence);
  score += variant.adjustment;
  stateMismatch ||= variant.mismatch;

  const comparisons = [
    isGem(item)
      ? compareNumericState("gem level", item.gemLevel, row.gemLevel, 28, 62, reasons)
      : null,
    isGem(item)
      ? compareNumericState("quality", item.quality, row.gemQuality, 2.2, 48, reasons)
      : null,
    compareNumericState("links", effectiveLinks(item), row.links, 18, 56, reasons),
    row.categoryId === "wombgifts"
      ? compareNumericState(
          "item level",
          item.itemLevel,
          row.levelRequired,
          12,
          70,
          reasons,
        )
      : null,
    isMap(item)
      ? compareNumericState("map tier", item.mapTier, row.mapTier, 24, 65, reasons)
      : null,
  ];
  for (const comparison of comparisons) {
    if (!comparison) continue;
    score += comparison.adjustment;
    stateMismatch ||= comparison.mismatch;
  }

  if (row.corrupted != null) {
    if (row.corrupted === item.corrupted) {
      score += 6;
      reasons.push(item.corrupted ? "corruption matches" : "uncorrupted state matches");
    } else {
      score -= 44;
      stateMismatch = true;
      reasons.push("corruption state differs");
    }
  }

  const itemInfluences = new Set(item.influences.map(normalize));
  const rowVariant = normalize(row.variant);
  const knownInfluences = ["shaper", "elder", "crusader", "redeemer", "hunter", "warlord"];
  for (const influence of knownInfluences) {
    if (!rowVariant.includes(influence)) continue;
    if (itemInfluences.has(influence)) {
      score += 5;
      reasons.push(`${influence} influence matches`);
    } else {
      score -= 38;
      stateMismatch = true;
      reasons.push(`${influence} influence differs`);
    }
  }

  if (row.lowConfidence) score -= 2;
  const finalScore = clampScore(score);
  if (finalScore <= 0) return null;

  let kind: PriceCheckMatchKind = identity.kind;
  if (identity.exactName && stateMismatch) kind = "variant";
  if (identity.exactName && !stateMismatch) kind = "exact";

  return { row, kind, score: finalScore, reasons };
}

/** Resolves and deterministically ranks matches across one or many category arrays. */
export function resolvePriceCheckMatches(
  item: ParsedPoeItem,
  groups: EconomyRowGroups,
  options: ResolvePriceCheckOptions = {},
) {
  const minimumScore = Math.max(0, Math.min(100, options.minimumScore ?? 28));
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 12)));
  const bestByKey = new Map<string, PriceCheckMatch>();
  const rows = flattenRows(groups);
  const evidence: ResolverEvidence = {
    copiedMutatedModifiers: copiedMutatedModifierEvidence(item, rows),
  };

  for (const row of rows) {
    const match = scorePriceCheckMatch(item, row, evidence);
    if (!match || match.score < minimumScore) continue;
    const existing = bestByKey.get(row.key);
    if (!existing || match.score > existing.score) bestByKey.set(row.key, match);
  }

  return [...bestByKey.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
        left.row.name.localeCompare(right.row.name) ||
        left.row.key.localeCompare(right.row.key),
    )
    .slice(0, limit);
}

export const resolveEconomyMatches = resolvePriceCheckMatches;
