import type { EconomyRow } from "../../types";
import { getPriceCheckHistoryTrend } from "./history";
import type {
  ParsedPoeItem,
  PriceCheckConfidence,
  PriceCheckEstimate,
  PriceCheckEvidence,
  PriceCheckHistoryEntry,
  PriceCheckMatch,
} from "./types";

export interface EstimatePriceCheckOptions {
  now?: number;
  league?: string;
  sourceFetchedAt?: number;
  sourceAgeMs?: number;
  sourceStale?: boolean;
  history?: readonly PriceCheckHistoryEntry[];
  selectedMatchKey?: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundPrice(value: number) {
  if (value >= 100) return Math.round(value);
  if (value >= 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function sampleCount(row: EconomyRow) {
  const counts = [row.observationCount, row.listingCount].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  if (counts.length) return Math.min(...counts);
  return typeof row.volume === "number" &&
    Number.isFinite(row.volume) &&
    row.volume >= 0
    ? row.volume
    : null;
}

function sampleScore(count: number | null) {
  if (count == null) return 4;
  if (count < 2) return 0;
  if (count < 5) return 5;
  if (count < 10) return 11;
  if (count < 25) return 18;
  if (count < 100) return 23;
  return 27;
}

function sourceAge(options: EstimatePriceCheckOptions, now: number) {
  if (
    typeof options.sourceAgeMs === "number" &&
    Number.isFinite(options.sourceAgeMs)
  ) {
    return options.sourceAgeMs >= 0 ? options.sourceAgeMs : null;
  }
  if (
    typeof options.sourceFetchedAt === "number" &&
    Number.isFinite(options.sourceFetchedAt)
  ) {
    const age = now - options.sourceFetchedAt;
    return Number.isFinite(age) && age >= 0 ? age : null;
  }
  return null;
}

function ageScore(ageMs: number | null) {
  if (ageMs == null) return 7;
  if (ageMs <= 30 * MINUTE) return 18;
  if (ageMs <= HOUR) return 14;
  if (ageMs <= 2 * HOUR) return 8;
  if (ageMs <= 6 * HOUR) return 2;
  return 0;
}

function ageDescription(ageMs: number | null) {
  if (ageMs == null) return "source age is unavailable";
  if (ageMs < MINUTE) return "source is less than a minute old";
  if (ageMs < HOUR) return `source is ${Math.floor(ageMs / MINUTE)} minutes old`;
  return `source is ${Math.floor(ageMs / HOUR)} hours old`;
}

function confidenceFromScore(score: number): PriceCheckConfidence {
  if (score >= 78) return "high";
  if (score >= 55) return "medium";
  if (score >= 1) return "low";
  return "none";
}

function confidenceRank(confidence: PriceCheckConfidence) {
  return { none: 0, low: 1, medium: 2, high: 3 }[confidence];
}

function lowerConfidence(
  current: PriceCheckConfidence,
  maximum: PriceCheckConfidence,
) {
  return confidenceRank(current) > confidenceRank(maximum) ? maximum : current;
}

function faustusTimestamp(hour: number) {
  if (!Number.isFinite(hour) || hour <= 0) return null;
  if (hour > 10_000_000_000) return hour;
  if (hour > 1_000_000_000) return hour * 1_000;
  return hour * HOUR;
}

function reliabilityRank(match: PriceCheckMatch) {
  const count = sampleCount(match.row);
  const sampleBonus = count == null ? 0 : Math.min(10, Math.log2(count + 1) * 2);
  return match.score + sampleBonus - (match.row.lowConfidence ? 12 : 0);
}

function bestUsableMatch(matches: readonly PriceCheckMatch[]) {
  const valid = matches.filter((match) => validPrice(match.row.chaosValue));
  if (!valid.length) return null;
  const identityCeiling = Math.max(...valid.map((match) => match.score));
  return [...valid]
    .filter((match) => match.score >= identityCeiling - 8)
    .sort(
      (left, right) =>
        reliabilityRank(right) - reliabilityRank(left) ||
        right.score - left.score ||
        left.row.key.localeCompare(right.row.key),
    )[0];
}

function comparablePrices(matches: readonly PriceCheckMatch[], best: PriceCheckMatch) {
  const reliable = matches.filter(
    (match) =>
      validPrice(match.row.chaosValue) &&
      match.kind === best.kind &&
      match.score >= best.score - 5 &&
      !match.row.lowConfidence,
  );
  const candidates = reliable.length
    ? reliable
    : matches.filter(
        (match) =>
          validPrice(match.row.chaosValue) &&
          match.kind === best.kind &&
          match.score >= best.score - 5,
      );
  return candidates
    .map((match) => match.row.chaosValue)
    .sort((left, right) => left - right);
}

function median(values: readonly number[]) {
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

function noEstimate(
  reasons: string[],
  warnings: string[],
  evidence: PriceCheckEvidence[] = [],
): PriceCheckEstimate {
  return {
    chaosValue: null,
    divineValue: null,
    lowChaos: null,
    highChaos: null,
    confidence: "none",
    confidenceScore: 0,
    label: "no reliable estimate",
    reasons,
    warnings,
    evidence,
  };
}

/**
 * Produces a conservative estimate from market matches. It intentionally does
 * not value a rare item from its base price: modifier-aware live comparables are
 * required before a rare can receive a final estimate.
 */
export function estimatePriceCheck(
  item: ParsedPoeItem,
  matches: readonly PriceCheckMatch[],
  options: EstimatePriceCheckOptions = {},
): PriceCheckEstimate {
  const reasons: string[] = [];
  const warnings: string[] = [
    "Market values are asking-price estimates, not verified completed sales.",
  ];
  const evidence: PriceCheckEvidence[] = [];
  const now = options.now ?? Date.now();
  const ageMs = sourceAge(options, now);
  const sourceStale = options.sourceStale === true;
  if (!item.valid) {
    warnings.push("The clipboard item did not parse cleanly.");
    return noEstimate(["A valid parsed item is required before pricing."], warnings);
  }
  if (item.rarity === "unique" && !item.identified) {
    warnings.push("An unidentified unique cannot be matched to a specific market row safely.");
    return noEstimate(["Identify the unique before using an aggregate estimate."], warnings);
  }
  if (
    item.foulborn &&
    !matches.some((match) => /^foulborn\s/i.test(match.row.name))
  ) {
    warnings.push("No explicit Foulborn market row matched this item.");
    return noEstimate(["A clean unique price cannot value a Foulborn mutation."], warnings);
  }
  const selected = options.selectedMatchKey
    ? matches.find(
        (match) =>
          match.row.key === options.selectedMatchKey &&
          validPrice(match.row.chaosValue),
      )
    : undefined;
  const best = selected || bestUsableMatch(matches);

  if (!best) {
    warnings.push("No valid positive market price matched this item.");
    return noEstimate(["No usable economy match was found."], warnings);
  }

  const bestSamples = sampleCount(best.row);
  const baseEvidence: PriceCheckEvidence = {
    source: best.row.source === "faustus" ? "faustus" : "poe-ninja",
    label: `${best.row.name} (${best.kind} match)`,
    chaosValue: validPrice(best.row.chaosValue) ? best.row.chaosValue : null,
    divineValue: validPrice(best.row.divineValue) ? best.row.divineValue : null,
    sampleCount: bestSamples,
    ageMs,
    stale: sourceStale,
    confidence: "low",
    detail: `${best.score}/100 identity score; ${ageDescription(ageMs)}`,
  };
  evidence.push(baseEvidence);

  if (item.rarity === "rare" || item.rarity === "magic") {
    reasons.push("Only the base type can be valued from the economy dataset.");
    warnings.push(
      "Rare and magic modifiers can change value dramatically; apply the visible filter plan on official Trade for comparable items.",
    );
    baseEvidence.detail = `Base-only reference: ${best.row.chaosValue} chaos; not an item estimate.`;
    return noEstimate(reasons, warnings, evidence);
  }

  let score = Math.round(best.score * 0.35) + sampleScore(bestSamples) + ageScore(ageMs) + 10;
  score += best.kind === "exact" ? 5 : best.kind === "variant" ? 2 : 0;
  reasons.push(`${best.kind} market identity scored ${best.score}/100.`);
  reasons.push(
    bestSamples == null
      ? "The source did not publish an observation count."
      : best.row.observationCount == null && best.row.listingCount == null
        ? `${bestSamples.toLocaleString()} units of reported market volume support the price.`
        : `${bestSamples.toLocaleString()} market observation${bestSamples === 1 ? "" : "s"} support the price.`,
  );
  reasons.push(`${ageDescription(ageMs)}.`);

  let confidence = confidenceFromScore(score);
  if (bestSamples != null && bestSamples < 5) {
    confidence = lowerConfidence(confidence, "low");
    score = Math.min(score, 44);
    warnings.push(
      `${bestSamples} observation${bestSamples === 1 ? "" : "s"} is too thin for a reliable price and can be manipulated.`,
    );
  }
  if (best.row.lowConfidence) {
    confidence = lowerConfidence(confidence, "low");
    score = Math.min(score, 44);
    warnings.push(best.row.confidenceReason || "The market source marked this estimate low-confidence.");
  }
  if (best.kind === "fuzzy" || best.score < 55) {
    confidence = lowerConfidence(confidence, "low");
    score = Math.min(score, 44);
    warnings.push("The item identity is only a fuzzy match.");
  } else if (best.kind === "base") {
    confidence = lowerConfidence(confidence, "medium");
    score = Math.min(score, 69);
    warnings.push("The estimate matches a base type rather than an exact named item.");
  }
  if (ageMs == null) {
    confidence = lowerConfidence(confidence, "medium");
    score = Math.min(score, 69);
    warnings.push("Source age is unknown, so freshness cannot be verified.");
  }
  if (sourceStale || (ageMs != null && ageMs > 2 * HOUR)) {
    confidence = lowerConfidence(confidence, "low");
    score = Math.min(score, 29);
    warnings.push("Market data is stale; refresh before acting on this value.");
  }

  const prices = comparablePrices(matches, best);
  let center = selected
    ? best.row.chaosValue
    : median(prices) ?? best.row.chaosValue;
  const historyTrend = getPriceCheckHistoryTrend(options.history || [], item, {
    league: options.league,
    selectedMatchKey: options.selectedMatchKey ?? best.row.key,
    now,
    limit: 20,
  });

  if (historyTrend.sampleCount) {
    evidence.push({
      source: "local-history",
      label: `${historyTrend.sampleCount} previous check${historyTrend.sampleCount === 1 ? "" : "s"}`,
      chaosValue: historyTrend.medianChaos,
      divineValue: null,
      sampleCount: historyTrend.sampleCount,
      ageMs: historyTrend.ageMs,
      stale: historyTrend.ageMs != null && historyTrend.ageMs > 14 * DAY,
      confidence: historyTrend.stable ? "medium" : "low",
      detail:
        historyTrend.direction === "unknown"
          ? "Not enough local checks for a direction."
          : `Local checks are ${historyTrend.direction}${historyTrend.changePercent == null ? "" : ` (${Math.round(historyTrend.changePercent)}%)`}.`,
    });

    if (
      historyTrend.medianChaos != null &&
      historyTrend.medianChaos > 0 &&
      historyTrend.ageMs != null &&
      historyTrend.ageMs <= 14 * DAY
    ) {
      const divergence = Math.abs(center - historyTrend.medianChaos) / historyTrend.medianChaos;
      if (historyTrend.stable && divergence <= 0.2) {
        score = Math.min(100, score + 5);
        confidence = confidenceFromScore(score);
        reasons.push("Recent local history agrees with the current estimate.");
      } else if (divergence > 0.6) {
        score = Math.min(score, 49);
        confidence = lowerConfidence(confidence, "low");
        warnings.push("The current price differs sharply from recent local history.");
      }
    }
  }

  const faustus =
    best.row.faustus ||
    matches
      .filter(
        (match) =>
          match.row.faustus &&
          match.kind === best.kind &&
          match.score >= best.score - 5,
      )
      .sort(
        (left, right) =>
          (right.row.faustus?.traded || 0) -
          (left.row.faustus?.traded || 0),
      )[0]?.row.faustus;
  if (
    faustus &&
    validPrice(faustus.minimumChaos) &&
    validPrice(faustus.maximumChaos)
  ) {
    const faustusCenter = (faustus.minimumChaos + faustus.maximumChaos) / 2;
    const timestamp = faustusTimestamp(faustus.hour);
    const faustusAge = timestamp == null || timestamp > now ? null : now - timestamp;
    const faustusConfidence: PriceCheckConfidence =
      faustusAge == null
        ? "low"
        : faustus.traded >= 20 && faustusAge <= 2 * HOUR
          ? "high"
          : faustus.traded >= 5
            ? "medium"
            : "low";
    evidence.push({
      source: "faustus",
      label: "Currency Exchange completed-hour range",
      chaosValue: faustusCenter,
      divineValue: null,
      sampleCount: faustus.traded,
      ageMs: faustusAge,
      stale: faustusAge == null || faustusAge > 2 * HOUR,
      confidence: faustusConfidence,
      detail: `${faustus.traded} units traded between ${faustus.minimumChaos} and ${faustus.maximumChaos} chaos.`,
    });
    const divergence = Math.abs(center - faustusCenter) / Math.max(faustusCenter, 1);
    if (faustusConfidence !== "low" && divergence <= 0.2) {
      center = (center * 2 + faustusCenter) / 3;
      score = Math.min(100, score + 5);
      confidence = confidenceFromScore(score);
      reasons.push("Faustus completed-hour evidence agrees with the listing estimate.");
    } else if (divergence > 0.5) {
      score = Math.min(score, 49);
      confidence = lowerConfidence(confidence, "low");
      warnings.push("Faustus evidence and the listing estimate disagree materially.");
    }
  }

  baseEvidence.confidence = confidence;
  const baseSpread =
    confidence === "high" ? 0.1 : confidence === "medium" ? 0.2 : 0.4;
  const sampleSpread = bestSamples != null && bestSamples < 5 ? 0.55 : baseSpread;
  let low = center * (1 - sampleSpread);
  let high = center * (1 + sampleSpread);
  if (prices.length >= 3) {
    low = Math.min(low, prices[Math.floor((prices.length - 1) * 0.25)]);
    high = Math.max(high, prices[Math.ceil((prices.length - 1) * 0.75)]);
  }
  if (historyTrend.stable && historyTrend.ageMs != null && historyTrend.ageMs <= 14 * DAY) {
    if (historyTrend.lowChaos != null) low = Math.min(low, historyTrend.lowChaos);
    if (historyTrend.highChaos != null) high = Math.max(high, historyTrend.highChaos);
  }

  const divineRatio =
    validPrice(best.row.divineValue) && best.row.divineValue > 0
      ? best.row.chaosValue / best.row.divineValue
      : null;

  return {
    chaosValue: roundPrice(center),
    divineValue: divineRatio ? roundPrice(center / divineRatio) : null,
    lowChaos: roundPrice(Math.max(0.01, low)),
    highChaos: roundPrice(high),
    confidence,
    confidenceScore: Math.max(0, Math.min(100, Math.round(score))),
    label:
      confidence === "high" || confidence === "medium"
        ? "market estimate"
        : "rough estimate",
    reasons,
    warnings: [...new Set(warnings)],
    evidence,
  };
}

export const estimateMarketPrice = estimatePriceCheck;
