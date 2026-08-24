const DEFAULT_MAX_GROUPS = 12;
const DEFAULT_MAX_ROWS_PER_GROUP = 30_000;
const DEFAULT_MAX_ROWS = 60_000;
const MAX_QUERY_LENGTH = 160;
const MAX_RESULT_LIMIT = 60;

function limitedString(value, maximum = MAX_QUERY_LENGTH) {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function searchableText(row) {
  return [row.name, row.variant, row.baseType, row.categoryLabel, row.league]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function rowScore(entry, normalized, terms) {
  const row = entry.row;
  if (!normalized) {
    return Math.log10(entry.liquidity + 1) - Number(row.lowConfidence) * 3;
  }
  if (!terms.every((term) => entry.searchable.includes(term))) return null;

  let score = 0;
  if (entry.name === normalized) score += 500;
  if (entry.name.startsWith(normalized)) score += 260;
  if (entry.name.includes(normalized)) score += 140;
  if (entry.variant.startsWith(normalized)) score += 90;
  if (entry.categoryLabel.includes(normalized)) score += 35;
  for (const term of terms) {
    if (entry.name.startsWith(term)) score += 55;
    if (entry.words.some((word) => word.startsWith(term))) score += 30;
  }
  score += Math.min(24, Math.log10(entry.liquidity + 1) * 4);
  if (row.lowConfidence) score -= 18;
  return score;
}

function compareRanked(left, right) {
  return (
    right.score - left.score ||
    right.entry.row.chaosValue - left.entry.row.chaosValue ||
    left.entry.row.name.localeCompare(right.entry.row.name)
  );
}

function insertTop(ranked, candidate, limit) {
  if (limit <= 0) return;
  let low = 0;
  let high = ranked.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareRanked(candidate, ranked[middle]) < 0) high = middle;
    else low = middle + 1;
  }
  if (low >= limit) return;
  ranked.splice(low, 0, candidate);
  if (ranked.length > limit) ranked.pop();
}

function preparedRow(row) {
  const name = row.name.toLocaleLowerCase();
  return {
    row,
    identity: `${row.league}:${row.categoryId}:${row.source}:${row.key}`,
    searchable: searchableText(row),
    name,
    variant: row.variant?.toLocaleLowerCase() || "",
    categoryLabel: row.categoryLabel.toLocaleLowerCase(),
    words: name.split(/\s+/),
    liquidity: Math.max(0, row.volume ?? row.listingCount ?? 0),
  };
}

function createQuickSearchIndex({
  sanitizeRow,
  maxGroups = DEFAULT_MAX_GROUPS,
  maxRowsPerGroup = DEFAULT_MAX_ROWS_PER_GROUP,
  maxRows = DEFAULT_MAX_ROWS,
  now = () => Date.now(),
} = {}) {
  if (typeof sanitizeRow !== "function") {
    throw new TypeError("Quick-search index requires a row sanitizer.");
  }

  const groups = new Map();
  const evictedLeagues = new Set();
  let publisherId = "";
  let revision = 0;

  function reset(nextPublisherId, nextRevision) {
    groups.clear();
    evictedLeagues.clear();
    publisherId = nextPublisherId;
    revision = nextRevision;
  }

  function removeOldestGroup() {
    const oldest = groups.keys().next().value;
    if (!oldest) return false;
    const group = groups.get(oldest);
    if (group?.league) evictedLeagues.add(group.league);
    groups.delete(oldest);
    return true;
  }

  function rowCount() {
    let count = 0;
    for (const group of groups.values()) count += group.rows.length;
    return count;
  }

  function enforceLimits() {
    while (groups.size > maxGroups) removeOldestGroup();
    while (rowCount() > maxRows) {
      if (!removeOldestGroup()) break;
    }
  }

  function apply(rawUpdate) {
    if (!rawUpdate || typeof rawUpdate !== "object") {
      throw new Error("Invalid quick-search index update.");
    }
    const nextPublisherId = limitedString(rawUpdate.publisherId, 100);
    const nextRevision = Number(rawUpdate.revision);
    if (!nextPublisherId || !Number.isSafeInteger(nextRevision) || nextRevision < 1) {
      throw new Error("Invalid quick-search index revision.");
    }
    if (nextPublisherId !== publisherId) reset(nextPublisherId, 0);
    if (nextRevision <= revision) return snapshot();
    if (!rawUpdate.reset && nextRevision !== revision + 1) {
      throw new Error("Quick-search index revision gap requires a full reset.");
    }
    if (rawUpdate.reset) reset(nextPublisherId, 0);

    for (const rawId of Array.isArray(rawUpdate.remove) ? rawUpdate.remove.slice(0, 20) : []) {
      const id = limitedString(rawId, 200);
      if (id) groups.delete(id);
    }

    for (const rawGroup of Array.isArray(rawUpdate.replace) ? rawUpdate.replace.slice(0, 20) : []) {
      if (!rawGroup || typeof rawGroup !== "object") continue;
      const id = limitedString(rawGroup.id, 200);
      const league = limitedString(rawGroup.league, 100);
      const fetchedAt = Number(rawGroup.fetchedAt);
      if (!id || !league || !Number.isFinite(fetchedAt) || fetchedAt <= 0) continue;
      const inputRows = Array.isArray(rawGroup.rows) ? rawGroup.rows : [];
      const rows = inputRows
        .slice(0, maxRowsPerGroup)
        .map((row) => sanitizeRow(row, league))
        .filter(Boolean)
        .map(preparedRow);
      groups.delete(id);
      groups.set(id, {
        id,
        league,
        fetchedAt,
        rows,
        truncated: inputRows.length > rows.length,
      });
    }

    revision = nextRevision;
    enforceLimits();
    return snapshot();
  }

  function pruneExpired(maximumAgeMs) {
    const cutoff = now() - maximumAgeMs;
    for (const [id, group] of groups) {
      if (group.fetchedAt < cutoff) groups.delete(id);
    }
  }

  function search(rawQuery, rawLimit, league, maximumAgeMs) {
    pruneExpired(maximumAgeMs);
    const query = limitedString(rawQuery).trim().toLocaleLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const limit = Math.min(
      MAX_RESULT_LIMIT,
      Math.max(0, Number.isFinite(Number(rawLimit)) ? Math.floor(Number(rawLimit)) : 50),
    );
    const currentLeague = limitedString(league, 100);
    const ranked = [];
    const categories = new Set();
    const seen = new Set();
    let indexedTotal = 0;
    let total = 0;
    let indexTruncated = evictedLeagues.has(currentLeague);

    for (const group of [...groups.values()].reverse()) {
      if (group.league !== currentLeague) continue;
      if (group.truncated) indexTruncated = true;
      for (const entry of group.rows) {
        if (seen.has(entry.identity)) continue;
        seen.add(entry.identity);
        indexedTotal += 1;
        categories.add(entry.row.categoryId);
        const score = rowScore(entry, query, terms);
        if (score == null) continue;
        total += 1;
        insertTop(ranked, { entry, score }, limit);
      }
    }

    return {
      rows: ranked.map((candidate) => candidate.entry.row),
      total,
      truncated: total > ranked.length,
      indexedTotal,
      indexTruncated,
      marketCount: categories.size,
      league: currentLeague,
      revision,
    };
  }

  function snapshot() {
    return {
      publisherId,
      revision,
      groups: groups.size,
      rows: rowCount(),
    };
  }

  return { apply, search, snapshot };
}

module.exports = {
  createQuickSearchIndex,
  DEFAULT_MAX_GROUPS,
  DEFAULT_MAX_ROWS,
  DEFAULT_MAX_ROWS_PER_GROUP,
  MAX_QUERY_LENGTH,
  MAX_RESULT_LIMIT,
};
