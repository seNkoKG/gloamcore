import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_COMMIT = "adb6c287bd978a70701e2b65d744dd677c52fb65";
const SOURCE_DATA_UPDATE = "2026-08-08";
const SAFE_TRADE_STAT_ID =
  /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{1,126}(?:\|\d{1,10}){0,2}$/;
const input = process.argv[2];
const output = process.argv[3] || path.resolve("public/data/price-check/stats-v1.json");

if (!input) {
  throw new Error(
    "Usage: node scripts/build-price-check-stat-pack.mjs <Awakened stats.ndjson> [output]",
  );
}

function normalizePattern(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/<<[^>]+>>/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/[-+]?\d[\d,]*(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function validTradeId(value) {
  return (
    typeof value === "string" &&
    value.length <= 160 &&
    SAFE_TRADE_STAT_ID.test(value)
  );
}

function valueSemantics(rawPattern, matcher) {
  const indices = [];
  const literals = [];
  let tokenIndex = 0;
  for (const match of String(rawPattern || "").matchAll(
    /#|[-+]?\d[\d,]*(?:\.\d+)?/g,
  )) {
    if (match[0] === "#") {
      indices.push(tokenIndex);
    } else {
      const value = Number(match[0].replace(/,/g, ""));
      if (Number.isFinite(value)) literals.push([tokenIndex, value]);
    }
    tokenIndex += 1;
  }
  return {
    tokenCount: tokenIndex,
    indices,
    ...(literals.length ? { literals } : {}),
    ...(matcher?.negate ? { negate: true } : {}),
    ...(Number.isFinite(matcher?.value) ? { constant: matcher.value } : {}),
  };
}

function candidateKey(value) {
  return JSON.stringify(value);
}

function safeMatcherText(value) {
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  return text && text.length <= 2_000 &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)
    ? text
    : undefined;
}

function safeCanonicalRef(value) {
  if (typeof value !== "string") return undefined;
  // Keep Awakened's intentional multiline stat.ref labels byte-semantic. The
  // renderer decides whether to preserve or collapse those line breaks; the
  // generated catalog must not silently turn a compound stat into prose.
  const ref = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  return ref && ref.length <= 512 && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(ref)
    ? ref
    : undefined;
}

function safeDisplayMatchers(value) {
  if (!Array.isArray(value) || value.length > 16) return [];
  const variants = value.flatMap((matcher) => {
    const text = safeMatcherText(matcher?.string) ||
      safeMatcherText(matcher?.advanced);
    if (!text) return [];
    return [{
      text,
      ...(matcher?.negate ? { negate: true } : {}),
      ...(Number.isFinite(matcher?.value) ? { value: matcher.value } : {}),
    }];
  });
  return [...new Map(variants.map((variant) => [
    JSON.stringify(variant),
    variant,
  ])).values()];
}

function safeAnointments(value) {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const entries = value.flatMap((entry) => {
    if (
      !entry ||
      !Number.isFinite(entry.roll) ||
      typeof entry.oils !== "string" ||
      !/^\d{1,2}(?:,\d{1,2}){1,2}$/.test(entry.oils)
    ) return [];
    return [{ roll: entry.roll, oils: entry.oils }];
  });
  return entries.length ? entries : undefined;
}


function safeTradeIds(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).flatMap(([kind, ids]) => {
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(kind) || !Array.isArray(ids)) return [];
    const safe = ids.filter(validTradeId);
    return safe.length ? [[kind, safe]] : [];
  }));
}

function safeResolver(value, statCount) {
  if (!value || typeof value !== "object") return undefined;
  if (value.strat === "trivial-merge") return { strat: "trivial-merge" };
  if (
    value.strat === "select" &&
    Array.isArray(value.test) &&
    value.test.length === statCount &&
    value.test.every((entry) => entry === null || (
      typeof entry === "string" && entry.length > 0 && entry.length <= 64
    ))
  ) {
    return { strat: "select", test: value.test };
  }
  if (
    value.strat === "percent-merge" &&
    Array.isArray(value.kind) &&
    value.kind.length === statCount &&
    value.kind.every((entry) => entry === "percent" || entry === "value") &&
    value.kind.filter((entry) => entry === "percent").length === 1 &&
    value.kind.filter((entry) => entry === "value").length === 1
  ) {
    return { strat: "percent-merge", kind: value.kind };
  }
  if (
    value.strat === "flag-merge" &&
    Array.isArray(value.kind) &&
    value.kind.length === statCount &&
    value.kind.every((entry) => entry === "flag" || entry === "value") &&
    value.kind.filter((entry) => entry === "flag").length === 1 &&
    value.kind.filter((entry) => entry === "value").length === 1
  ) {
    return { strat: "flag-merge", kind: value.kind };
  }
  return undefined;
}

function generatedGroupStat(stat) {
  const ref = safeCanonicalRef(stat?.ref);
  if (!ref) return undefined;
  const sourceMatchers = Array.isArray(stat.matchers) ? stat.matchers : [];
  const displayMatchers = safeDisplayMatchers(sourceMatchers);
  const matchers = sourceMatchers.flatMap(
    (matcher) => {
      const displayText = safeMatcherText(matcher?.string) ||
        safeMatcherText(matcher?.advanced);
      return ["string", "advanced"].flatMap((field) => {
        const text = safeMatcherText(matcher?.[field]);
        return text
          ? [{
              text,
              ...(displayText && displayText !== text ? { displayText } : {}),
              pattern: normalizePattern(text),
              semantics: valueSemantics(text, matcher),
            }]
          : [];
      });
    },
  );
  const ids = safeTradeIds(stat?.trade?.ids);
  if (!matchers.length || !Object.keys(ids).length) return undefined;
  return {
    ref,
    matchers,
    ...(displayMatchers.length ? { displayMatchers } : {}),
    better: [-1, 0, 1].includes(stat?.better) ? stat.better : 0,
    ...(stat?.dp === true ? { dp: true } : {}),
    trade: {
      ids,
      ...(stat?.trade?.inverted ? { inverted: true } : {}),
      ...(stat?.trade?.option ? { option: true } : {}),
    },
    ...(safeAnointments(stat?.anointments)
      ? { anointments: safeAnointments(stat.anointments) }
      : {}),
  };
}

const source = await fs.readFile(path.resolve(input), "utf8");
const byPattern = new Map();
const groups = [];

for (const [sourceIndex, line] of source.split(/\r?\n/).entries()) {
  if (!line.trim()) continue;
  const root = JSON.parse(line);
  let group;
  if (Array.isArray(root.stats)) {
    const stats = root.stats.map(generatedGroupStat);
    const resolve = safeResolver(root.resolve, stats.length);
    if (!resolve || stats.some((stat) => !stat)) {
      throw new Error(`Invalid Awakened StatGroup at source line ${sourceIndex + 1}.`);
    }
    group = {
      id: groups.length,
      sourceIndex,
      resolve,
      stats,
    };
    groups.push(group);
    for (const stat of stats) {
      for (const matcher of stat.matchers) {
        if (!matcher.pattern) continue;
        const entry = byPattern.get(matcher.pattern) || {
          pattern: matcher.pattern,
          candidates: new Map(),
          groupIds: new Set(),
        };
        entry.groupIds.add(group.id);
        byPattern.set(matcher.pattern, entry);
      }
    }
  }
  const stats = Array.isArray(root.stats) ? root.stats : [root];
  for (const [statIndex, stat] of stats.entries()) {
    const ref = safeCanonicalRef(stat?.ref);
    if (!ref) continue;
    const tradeIds = stat?.trade?.ids;
    if (!tradeIds || typeof tradeIds !== "object") continue;
    const matchers = Array.isArray(stat.matchers) ? stat.matchers : [];
    const displayMatchers = safeDisplayMatchers(matchers);
    for (const matcher of matchers) {
      const displayText = safeMatcherText(matcher?.string) ||
        safeMatcherText(matcher?.advanced);
      for (const rawPattern of [matcher?.string, matcher?.advanced]) {
        const pattern = normalizePattern(rawPattern);
        if (!pattern) continue;
        const entry = byPattern.get(pattern) || {
          pattern,
          candidates: new Map(),
          groupIds: new Set(),
        };
        const semantics = valueSemantics(rawPattern, matcher);
        const matcherText = safeMatcherText(rawPattern);
        if (!matcherText) continue;
        for (const [kind, values] of Object.entries(tradeIds)) {
          if (!Array.isArray(values)) continue;
          for (const id of values) {
            if (!validTradeId(id)) continue;
            const candidate = {
              id,
              kind,
              ref,
              matcherText,
              ...(displayText && displayText !== matcherText
                ? { displayText }
                : {}),
              ...(displayMatchers.length > 1 ||
                  displayMatchers[0]?.text !== matcherText
                ? { displayMatchers }
                : {}),
              semantics,
              better: [-1, 0, 1].includes(stat?.better) ? stat.better : 0,
              ...(stat?.dp === true ? { dp: true } : {}),
              ...(safeAnointments(stat?.anointments)
                ? { anointments: safeAnointments(stat.anointments) }
                : {}),
              ...(stat?.trade?.inverted ? { inverted: true } : {}),
              ...(stat?.trade?.option ? { option: true } : {}),
              ...(group ? { groupId: group.id, statIndex } : {}),
            };
            entry.candidates.set(candidateKey(candidate), candidate);
          }
        }
        byPattern.set(pattern, entry);
      }
    }
  }
}

const entries = [...byPattern.values()]
  .filter((entry) => entry.candidates.size || entry.groupIds.size)
  .map((entry) => ({
    pattern: entry.pattern,
    candidates: [...entry.candidates.values()].sort((left, right) =>
      candidateKey(left).localeCompare(candidateKey(right)),
    ),
    ...(entry.groupIds.size
      ? { groupIds: [...entry.groupIds].sort((left, right) => left - right) }
      : {}),
  }))
  .sort((left, right) => left.pattern.localeCompare(right.pattern));
const resolverGroupsSha256 = crypto.createHash("sha256")
  .update(JSON.stringify(groups))
  .digest("hex");
const resolverStrategies = Object.fromEntries(
  [...new Set(groups.map((group) => group.resolve.strat))]
    .sort()
    .map((strategy) => [
      strategy,
      groups.filter((group) => group.resolve.strat === strategy).length,
    ]),
);
const payload = {
  schema: 8,
  source: {
    project: "Awakened PoE Trade",
    repository: "https://github.com/SnosMe/awakened-poe-trade",
    commit: SOURCE_COMMIT,
    dataUpdatedAt: SOURCE_DATA_UPDATE,
    inputSha256: crypto.createHash("sha256").update(source).digest("hex"),
    resolverGroupsSha256,
  },
  generatedAt: new Date().toISOString(),
  coverage: {
    resolverGroups: groups.length,
    resolverStrategies,
  },
  groups,
  entries,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(payload)}\n`, "utf8");
console.log(
  JSON.stringify({
    output,
    entries: entries.length,
    resolverGroups: groups.length,
    resolverStrategies,
    resolverGroupsSha256,
    bytes: Buffer.byteLength(JSON.stringify(payload)),
  }),
);
