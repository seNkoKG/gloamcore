const ALLOWED_SURFACE_SOURCES = new Set([
  "exchange",
  "faustus",
  "stash-item",
  "stash-currency",
]);

function isAllowedSurfaceSource(value) {
  return ALLOWED_SURFACE_SOURCES.has(value);
}

function limitedString(value, maxLength = 160) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function sanitizeSurfaceIdentity(value, fallbackLeague = "") {
  if (!value || typeof value !== "object") return null;
  const key = limitedString(value.key);
  const name = limitedString(value.name);
  const categoryId = limitedString(value.categoryId, 100);
  const source = isAllowedSurfaceSource(value.source) ? value.source : "";
  if (!key || !name || !categoryId || !source) return null;
  return {
    key,
    name,
    icon:
      typeof value.icon === "string" && /^https:\/\//i.test(value.icon)
        ? value.icon.slice(0, 1000)
        : undefined,
    categoryId,
    source,
    league: limitedString(value.league || fallbackLeague, 100),
  };
}

function sanitizeSurfaceAlert(value, fallbackLeague = "") {
  const identity = sanitizeSurfaceIdentity(value, fallbackLeague);
  if (!identity || (value.unit !== "chaos" && value.unit !== "divine")) {
    return null;
  }
  const current = Number(value.current);
  const target = Number(value.target);
  if (
    !Number.isFinite(current) ||
    current <= 0 ||
    !Number.isFinite(target) ||
    target <= 0
  ) {
    return null;
  }
  return {
    ...identity,
    current,
    target,
    unit: value.unit,
  };
}

function sanitizeSurfaceAlerts(value, fallbackLeague = "") {
  return (Array.isArray(value) ? value : [])
    .slice(0, 20)
    .map((alert) => sanitizeSurfaceAlert(alert, fallbackLeague))
    .filter(Boolean);
}

module.exports = {
  isAllowedSurfaceSource,
  sanitizeSurfaceAlert,
  sanitizeSurfaceAlerts,
  sanitizeSurfaceIdentity,
};
