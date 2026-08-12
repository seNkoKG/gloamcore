"use strict";

const fs = require("node:fs");
const path = require("node:path");

function sanitizeScalarSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const key of ["alwaysOnTop", "compact", "clickThrough", "startMinimized", "autoCheckUpdates"]) {
    if (typeof value[key] === "boolean") result[key] = value[key];
  }
  if (typeof value.opacity === "number" && Number.isFinite(value.opacity)) {
    result.opacity = Math.max(0.65, Math.min(1, value.opacity));
  }
  return result;
}

function sanitizeWindowBounds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width < 1 || height < 1 || width > 32_768 || height > 32_768) return null;
  const result = { width: Math.round(width), height: Math.round(height) };
  if (Number.isFinite(Number(value.x))) result.x = Math.round(Number(value.x));
  if (Number.isFinite(Number(value.y))) result.y = Math.round(Number(value.y));
  return result;
}

function writeJsonAtomically(target, value, { fsImpl = fs } = {}) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fsImpl.mkdirSync(path.dirname(target), { recursive: true });
    fsImpl.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fsImpl.renameSync(temporary, target);
  } catch (error) {
    try { fsImpl.unlinkSync(temporary); } catch { /* best-effort temp cleanup */ }
    throw error;
  }
}

function createPersistenceRetry({
  write,
  getSnapshot,
  onFailure = () => undefined,
  onRecovered = () => undefined,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  minimumDelay = 1_000,
  maximumDelay = 60_000,
}) {
  let timer = null;
  let delay = minimumDelay;

  const schedule = () => {
    if (timer) return;
    timer = setTimer(() => {
      timer = null;
      try {
        write(getSnapshot());
        delay = minimumDelay;
        onRecovered();
      } catch (error) {
        onFailure(error);
        delay = Math.min(maximumDelay, delay * 2);
        schedule();
      }
    }, delay);
    timer?.unref?.();
  };

  return Object.freeze({
    schedule,
    dispose() {
      if (timer) clearTimer(timer);
      timer = null;
      delay = minimumDelay;
    },
  });
}

module.exports = {
  createPersistenceRetry,
  sanitizeScalarSettings,
  sanitizeWindowBounds,
  writeJsonAtomically,
};
