"use strict";

const PRICE_CHECK_CAPTURE_CHANNEL = "price-check:capture";
const MAX_DASHBOARD_FILTERS = 96;
const MAX_MODIFIER_ID_LENGTH = 220;
const MAX_LEAGUE_LENGTH = 100;
const MAX_ITEM_FILTER_STRING_LENGTH = 220;
const MAX_ITEM_FILTER_VALUE = 1_000_000_000;
const DASHBOARD_MODES = new Set([
  "similar",
  "exact",
  "bulk",
  "base",
  "I",
  "II",
  "III",
  "IV",
  "V",
]);
const FILTER_MODES = new Set(["exact", "range", "presence"]);
const QUERY_IDENTITIES = new Set(["exact", "base"]);
const QUERY_STATUSES = new Set([
  "available",
  "securable",
  "online",
  "onlineleague",
  "any",
]);
const NUMERIC_ITEM_FILTERS = new Set([
  "itemLevel",
  "itemLevelMax",
  "quality",
  "gemLevel",
  "links",
  "mapTier",
  "memoryStrands",
  "sentinelCharge",
  "stackSize",
  "areaLevel",
  "areaLevelMax",
  "heistWings",
]);
const BOOLEAN_ITEM_FILTERS = new Set([
  "corrupted",
  "mirrored",
  "split",
  "fractured",
  "synthesised",
  "veiled",
  "foulborn",
  "vestigial",
  "foil",
  "identified",
  "heistPriceless",
  "imbuedGem",
  "influence:shaper",
  "influence:elder",
  "influence:crusader",
  "influence:redeemer",
  "influence:hunter",
  "influence:warlord",
  "influence:searing exarch",
  "influence:eater of worlds",
]);
const HEIST_JOB_ITEM_FILTERS = new Set([
  "heistJob:lockpicking",
  "heistJob:brute force",
  "heistJob:perception",
  "heistJob:demolition",
  "heistJob:counter-thaumaturgy",
  "heistJob:trap disarmament",
  "heistJob:agility",
  "heistJob:deception",
  "heistJob:engineering",
]);
const MAP_BLIGHTED_VALUES = new Set(["Blighted", "Blight-ravaged"]);
const TRADE_CURRENCY_VALUES = new Set(["chaos", "divine", "chaos_divine"]);
const LISTED_VALUES = new Set([
  "1day",
  "3days",
  "1week",
  "2weeks",
  "1month",
  "2months",
]);

function boundedNumber(value, min, max) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : undefined;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function boundedString(value, maximum = MAX_ITEM_FILTER_STRING_LENGTH) {
  if (typeof value !== "string") return undefined;
  const result = value.split("\0", 1)[0].trim().slice(0, maximum);
  return result || undefined;
}

function sanitizeDashboardItemFilters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (NUMERIC_ITEM_FILTERS.has(key)) {
      const number = boundedNumber(
        entry,
        -MAX_ITEM_FILTER_VALUE,
        MAX_ITEM_FILTER_VALUE,
      );
      if (number !== undefined) result[key] = number;
    } else if (HEIST_JOB_ITEM_FILTERS.has(key)) {
      const number = boundedNumber(
        entry,
        -MAX_ITEM_FILTER_VALUE,
        MAX_ITEM_FILTER_VALUE,
      );
      if (number !== undefined) result[key] = number;
    } else if (BOOLEAN_ITEM_FILTERS.has(key) && typeof entry === "boolean") {
      result[key] = entry;
    } else if (key === "mapCompletionReward") {
      const reward = boundedString(entry);
      if (reward !== undefined) result[key] = reward;
    } else if (key === "scryingMapArea") {
      const area = boundedString(entry);
      if (area !== undefined) result[key] = area;
    } else if (key === "mapBlighted" && MAP_BLIGHTED_VALUES.has(entry)) {
      result[key] = entry;
    } else if (key === "rarity" && entry === "magic") {
      result[key] = entry;
    } else if (key === "tradeCurrency" && TRADE_CURRENCY_VALUES.has(entry)) {
      result[key] = entry;
    } else if (key === "listed" && LISTED_VALUES.has(entry)) {
      result[key] = entry;
    }
  }
  return result;
}

function sanitizeDashboardModifierFilters(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const entry of value.slice(0, MAX_DASHBOARD_FILTERS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const modifierId =
      typeof entry.modifierId === "string"
        ? entry.modifierId.split("\0", 1)[0].slice(0, MAX_MODIFIER_ID_LENGTH)
        : "";
    if (
      !modifierId ||
      seen.has(modifierId) ||
      !FILTER_MODES.has(entry.mode) ||
      typeof entry.enabled !== "boolean"
    ) {
      continue;
    }
    seen.add(modifierId);
    const filter = {
      modifierId,
      enabled: entry.enabled,
      mode: entry.mode,
    };
    if (entry.mode !== "presence") {
      const min = boundedNumber(
        entry.min,
        -MAX_ITEM_FILTER_VALUE,
        MAX_ITEM_FILTER_VALUE,
      );
      const max = boundedNumber(
        entry.max,
        -MAX_ITEM_FILTER_VALUE,
        MAX_ITEM_FILTER_VALUE,
      );
      if (min !== undefined) filter.min = min;
      if (max !== undefined) filter.max = max;
      if (
        filter.min !== undefined &&
        filter.max !== undefined &&
        filter.min > filter.max
      ) {
        [filter.min, filter.max] = [filter.max, filter.min];
      }
    }
    result.push(filter);
  }
  return result;
}

function sanitizePriceCheckDashboardSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const captureId = safeInteger(value.captureId);
  const capturedAt = safeInteger(value.capturedAt);
  const league =
    typeof value.league === "string"
      ? value.league.split("\0", 1)[0].trim().slice(0, MAX_LEAGUE_LENGTH)
      : "";
  if (
    captureId === undefined ||
    capturedAt === undefined ||
    !league ||
    !DASHBOARD_MODES.has(value.mode) ||
    !QUERY_IDENTITIES.has(value.identity) ||
    !QUERY_STATUSES.has(value.status)
  ) {
    return null;
  }
  return {
    captureId,
    capturedAt,
    league,
    mode: value.mode,
    identity: value.identity,
    status: value.status,
    rollTolerance: boundedNumber(value.rollTolerance, 0, 50) ?? 0,
    filters: sanitizeDashboardModifierFilters(value.filters),
    itemFilters: sanitizeDashboardItemFilters(value.itemFilters),
  };
}

function createDashboardCapture(capture, snapshot, handoffId) {
  if (!capture || typeof capture !== "object") return capture;
  const sanitized = sanitizePriceCheckDashboardSnapshot(snapshot);
  if (
    !sanitized ||
    sanitized.captureId !== capture.captureId ||
    sanitized.capturedAt !== capture.capturedAt
  ) {
    return capture;
  }
  return {
    ...capture,
    dashboardSnapshot: {
      ...sanitized,
      handoffId: safeInteger(handoffId) ?? 0,
    },
  };
}

function assignCaptureIdentity(capture, captureId) {
  const safeCaptureId = safeInteger(captureId);
  if (!capture || typeof capture !== "object" || safeCaptureId === undefined) {
    return capture;
  }
  return { ...capture, captureId: safeCaptureId };
}

function activeWebContents(window) {
  if (!window || window.isDestroyed?.()) return null;
  const webContents = window.webContents;
  if (!webContents || webContents.isDestroyed?.()) return null;
  return webContents;
}

function canReadPriceCheckCapture(
  sender,
  { mainWindow, priceCheckWindow } = {},
) {
  if (!sender) return false;
  return (
    sender === activeWebContents(mainWindow) ||
    sender === activeWebContents(priceCheckWindow)
  );
}

function sendPriceCheckCaptureToWindow(window, capture) {
  const webContents = activeWebContents(window);
  if (!webContents || !capture) return false;

  const send = () => {
    if (activeWebContents(window) === webContents) {
      try {
        webContents.send(PRICE_CHECK_CAPTURE_CHANNEL, capture);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  if (webContents.isLoadingMainFrame?.()) {
    webContents.once("did-finish-load", send);
  } else {
    return send();
  }
  return true;
}

module.exports = {
  assignCaptureIdentity,
  canReadPriceCheckCapture,
  createDashboardCapture,
  sanitizePriceCheckDashboardSnapshot,
  sendPriceCheckCaptureToWindow,
};
