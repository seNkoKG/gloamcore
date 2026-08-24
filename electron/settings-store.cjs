"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_SETTINGS_BYTES = 1024 * 1024;

function errorDetail(error) {
  return String(error?.message || error || "unknown error").replace(/[\0\r\n]/g, " ").slice(0, 180);
}

function settingsQuarantinePath(target, { now = () => new Date(), randomId = () => crypto.randomUUID() } = {}) {
  const timestamp = now().toISOString().replace(/[:.]/g, "-");
  return `${target}.invalid-${timestamp}-${randomId()}.bak`;
}

function blockedSettingsResult(reason) {
  return {
    status: "blocked",
    warning: `Settings storage is locked: ${reason} The existing file was not changed.`,
  };
}

function loadSettingsFile(target, {
  fsImpl = fs,
  maxBytes = MAX_SETTINGS_BYTES,
  now,
  randomId,
} = {}) {
  let stat;
  try {
    stat = fsImpl.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    return blockedSettingsResult(`the file could not be inspected (${errorDetail(error)}).`);
  }

  if (!stat.isFile() || stat.isSymbolicLink()) {
    return blockedSettingsResult("the settings path is not a regular file.");
  }

  let invalidReason = "";
  if (!Number.isFinite(stat.size) || stat.size < 0 || stat.size > maxBytes) {
    invalidReason = `the file exceeds the ${Math.floor(maxBytes / 1024)} KB safety limit`;
  } else {
    let bytes;
    try {
      bytes = fsImpl.readFileSync(target);
    } catch (error) {
      if (error?.code === "ENOENT") return { status: "missing" };
      return blockedSettingsResult(`the file could not be read (${errorDetail(error)}).`);
    }
    const size = typeof bytes === "string"
      ? Buffer.byteLength(bytes, "utf8")
      : Number(bytes?.byteLength ?? bytes?.length);
    if (!Number.isFinite(size) || size > maxBytes) {
      invalidReason = `the file exceeds the ${Math.floor(maxBytes / 1024)} KB safety limit`;
    } else {
      try {
        const parsed = JSON.parse(typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          invalidReason = "the JSON root is not an object";
        } else {
          return { status: "loaded", value: parsed };
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          return blockedSettingsResult(`the file could not be decoded (${errorDetail(error)}).`);
        }
        invalidReason = "the JSON is invalid";
      }
    }
  }

  const backupPath = settingsQuarantinePath(target, { now, randomId });
  try {
    fsImpl.renameSync(target, backupPath);
  } catch (error) {
    return blockedSettingsResult(
      `${invalidReason}, and it could not be archived safely (${errorDetail(error)}).`,
    );
  }
  return {
    status: "quarantined",
    backupName: path.basename(backupPath),
    backupPath,
    warning: `Settings were invalid and archived as ${path.basename(backupPath)}. Safe defaults are active.`,
  };
}

function sanitizeScalarSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const key of ["alwaysOnTop", "compact", "clickThrough", "startMinimized", "autoCheckUpdates"]) {
    if (typeof value[key] === "boolean") result[key] = value[key];
  }
  if (value.updateChannel === "stable" || value.updateChannel === "preview") {
    result.updateChannel = value.updateChannel;
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
  MAX_SETTINGS_BYTES,
  createPersistenceRetry,
  loadSettingsFile,
  sanitizeScalarSettings,
  sanitizeWindowBounds,
  settingsQuarantinePath,
  writeJsonAtomically,
};
