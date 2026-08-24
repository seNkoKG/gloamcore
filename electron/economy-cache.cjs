"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CACHE_SCHEMA_VERSION = 1;
// Large upstream payloads stay memory-only; disk covers the signed 16 MB mirror routes.
const DEFAULT_MEMORY_MAX_BYTES = 96 * 1024 * 1024;
const DEFAULT_MEMORY_MAX_ENTRIES = 96;
const DEFAULT_DISK_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_DISK_MAX_ENTRIES = 512;
const DEFAULT_MAX_FILE_BYTES = 24 * 1024 * 1024;
const DEFAULT_TEMP_GRACE_MS = 60 * 60 * 1000;
const DEFAULT_SWEEP_YIELD_EVERY = 1;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertCacheKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 4096) {
    throw new TypeError("Economy cache keys must be non-empty strings up to 4096 characters.");
  }
}

function cacheFilename(key) {
  assertCacheKey(key);
  return `v${CACHE_SCHEMA_VERSION}-${sha256(key)}.json`;
}

function legacyCacheFilename(key) {
  assertCacheKey(key);
  return `${key.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}.json`;
}

function isCacheEnvelope(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "data") &&
    value.data !== undefined &&
    Number.isFinite(value.fetchedAt) &&
    value.fetchedAt >= 0 &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt >= 0
  );
}

function normalizeStaleUntil(value) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("Economy cache staleUntil must be a finite timestamp or null.");
  }
  return value;
}

function unsignedRecord(key, envelope, staleUntil) {
  return {
    schema: CACHE_SCHEMA_VERSION,
    key,
    envelope,
    staleUntil,
  };
}

function encodeRecord(key, envelope, staleUntil) {
  assertCacheKey(key);
  if (!isCacheEnvelope(envelope)) {
    throw new TypeError("Economy cache values must be timestamped envelopes.");
  }
  const unsigned = unsignedRecord(key, envelope, normalizeStaleUntil(staleUntil));
  const unsignedText = JSON.stringify(unsigned);
  const checksum = sha256(unsignedText);
  const text = `${unsignedText.slice(0, -1)},"checksum":"${checksum}"}`;
  return { text, bytes: Buffer.byteLength(text, "utf8") };
}

function decodeRecord(text, expectedKey = null) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed).sort();
  if (keys.join("\0") !== "checksum\0envelope\0key\0schema\0staleUntil") return null;
  if (
    parsed.schema !== CACHE_SCHEMA_VERSION ||
    typeof parsed.key !== "string" ||
    (expectedKey !== null && parsed.key !== expectedKey) ||
    !isCacheEnvelope(parsed.envelope) ||
    !(parsed.staleUntil === null ||
      (Number.isFinite(parsed.staleUntil) && parsed.staleUntil >= 0)) ||
    typeof parsed.checksum !== "string" ||
    !/^[a-f0-9]{64}$/.test(parsed.checksum)
  ) return null;
  const checksum = sha256(JSON.stringify(unsignedRecord(
    parsed.key,
    parsed.envelope,
    parsed.staleUntil,
  )));
  if (checksum !== parsed.checksum) return null;
  return {
    key: parsed.key,
    envelope: parsed.envelope,
    staleUntil: parsed.staleUntil,
  };
}

function fileSignature(stat) {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    dev: stat.dev,
    ino: stat.ino,
  };
}

function sameFile(left, right) {
  if (!left || !right) return false;
  if (left.size !== right.size || left.mtimeMs !== right.mtimeMs) return false;
  if (left.dev && right.dev && left.dev !== right.dev) return false;
  if (left.ino && right.ino && left.ino !== right.ino) return false;
  return true;
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isTransientFileError(error) {
  return ["EACCES", "EBUSY", "ENOENT", "EPERM"].includes(error?.code);
}

function createEconomyCache({
  directory,
  fsImpl = fs.promises,
  now = Date.now,
  randomId = crypto.randomUUID,
  memoryMaxBytes = DEFAULT_MEMORY_MAX_BYTES,
  memoryMaxEntries = DEFAULT_MEMORY_MAX_ENTRIES,
  diskMaxBytes = DEFAULT_DISK_MAX_BYTES,
  diskMaxEntries = DEFAULT_DISK_MAX_ENTRIES,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  tempGraceMs = DEFAULT_TEMP_GRACE_MS,
  sweepYieldEvery = DEFAULT_SWEEP_YIELD_EVERY,
  yieldControl = () => new Promise((resolve) => setImmediate(resolve)),
  obsoletePatterns = [],
} = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new TypeError("Economy cache directory must be an absolute path.");
  }
  const root = path.resolve(directory);
  if (root === path.parse(root).root) {
    throw new TypeError("Economy cache directory cannot be a filesystem root.");
  }
  for (const [name, value] of Object.entries({
    memoryMaxBytes,
    memoryMaxEntries,
    diskMaxBytes,
    diskMaxEntries,
    maxFileBytes,
    tempGraceMs,
    sweepYieldEvery,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`Economy cache ${name} must be a non-negative finite number.`);
    }
  }

  const memory = new Map();
  const activePaths = new Set();
  const mutations = new Map();
  const diskOrderHints = new Map();
  let diskOperations = Promise.resolve();
  let memoryBytes = 0;

  const pathToken = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };

  function childPath(name) {
    if (typeof name !== "string" || path.basename(name) !== name || name === "." || name === "..") {
      throw new TypeError("Economy cache child names must be plain filenames.");
    }
    const target = path.join(root, name);
    if (pathToken(path.dirname(target)) !== pathToken(root)) {
      throw new Error("Economy cache path escaped its configured directory.");
    }
    return target;
  }

  async function ensureSafeRoot(create = false) {
    if (create) await fsImpl.mkdir(root, { recursive: true });
    let stat;
    try {
      stat = await fsImpl.lstat(root);
    } catch (error) {
      if (error?.code === "ENOENT" && !create) return false;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Economy cache directory is not a safe regular directory.");
    }
    return true;
  }

  function forget(key) {
    const entry = memory.get(key);
    if (!entry) return;
    memory.delete(key);
    memoryBytes -= entry.bytes;
  }

  function remember(key, envelope, staleUntil, bytes) {
    forget(key);
    if (
      memoryMaxEntries < 1 ||
      bytes > memoryMaxBytes
    ) return;
    memory.set(key, { envelope, staleUntil, bytes });
    memoryBytes += bytes;
    while (memory.size > memoryMaxEntries || memoryBytes > memoryMaxBytes) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      forget(oldest);
    }
  }

  function touch(key, entry) {
    memory.delete(key);
    memory.set(key, entry);
  }

  async function withMutation(target, action) {
    const token = pathToken(target);
    const previous = mutations.get(token);
    const operation = Promise.resolve(previous)
      .catch(() => undefined)
      .then(async () => {
        activePaths.add(token);
        try {
          return await action();
        } finally {
          activePaths.delete(token);
        }
      });
    mutations.set(token, operation);
    try {
      return await operation;
    } finally {
      if (mutations.get(token) === operation) mutations.delete(token);
    }
  }

  async function withDiskOperation(action) {
    const previous = diskOperations;
    const operation = Promise.resolve(previous)
      .catch(() => undefined)
      .then(action);
    diskOperations = operation;
    try {
      return await operation;
    } finally {
      if (diskOperations === operation) diskOperations = Promise.resolve();
    }
  }

  async function readRegularFile(target) {
    const token = pathToken(target);
    const pending = mutations.get(token);
    if (pending) await pending.catch(() => undefined);
    if (!(await ensureSafeRoot(false))) return null;
    let before;
    try {
      before = await fsImpl.lstat(target);
    } catch (error) {
      if (isTransientFileError(error)) return null;
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink()) return null;
    const signature = fileSignature(before);
    if (!Number.isFinite(before.size) || before.size < 0 || before.size > maxFileBytes) {
      return { oversized: true, signature };
    }
    let bytes;
    try {
      bytes = await fsImpl.readFile(target);
    } catch (error) {
      if (isTransientFileError(error)) return null;
      throw error;
    }
    const byteLength = typeof bytes === "string"
      ? Buffer.byteLength(bytes, "utf8")
      : bytes.byteLength;
    if (byteLength > maxFileBytes) return { oversized: true, signature };
    let after;
    try {
      after = await fsImpl.lstat(target);
    } catch (error) {
      if (isTransientFileError(error)) return null;
      throw error;
    }
    if (!after.isFile() || after.isSymbolicLink() || !sameFile(signature, fileSignature(after))) {
      return null;
    }
    return {
      text: Buffer.from(bytes).toString("utf8"),
      bytes: byteLength,
      signature: fileSignature(after),
    };
  }

  async function removeFile(target, expectedSignature) {
    return withMutation(target, async () => {
      if (!(await ensureSafeRoot(false))) return false;
      let stat;
      try {
        stat = await fsImpl.lstat(target);
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) return false;
      if (expectedSignature && !sameFile(expectedSignature, fileSignature(stat))) return false;
      try {
        await fsImpl.unlink(target);
        diskOrderHints.delete(path.basename(target));
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    });
  }

  async function removeBestEffort(target, signature) {
    try {
      return await removeFile(target, signature);
    } catch {
      return false;
    }
  }

  async function writeEncoded(key, envelope, staleUntil, encoded) {
    const target = childPath(cacheFilename(key));
    await withMutation(target, async () => {
      await ensureSafeRoot(true);
      const temporary = childPath(
        `${cacheFilename(key)}.${process.pid}.${randomId()}.tmp`,
      );
      const temporaryToken = pathToken(temporary);
      activePaths.add(temporaryToken);
      try {
        await fsImpl.writeFile(temporary, encoded.text, { encoding: "utf8", flag: "wx" });
        await ensureSafeRoot(false);
        await fsImpl.rename(temporary, target);
        diskOrderHints.set(path.basename(target), envelope.fetchedAt);
      } finally {
        await fsImpl.unlink(temporary).catch(() => undefined);
        activePaths.delete(temporaryToken);
      }
    });
    return { envelope, staleUntil };
  }

  async function enforceDiskQuota() {
    const removed = new Set();
    if (!(await ensureSafeRoot(false))) return removed;
    const entries = await fsImpl.readdir(root, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      const target = childPath(entry.name);
      if (activePaths.has(pathToken(target))) continue;
      let stat;
      try {
        stat = await fsImpl.lstat(target);
      } catch (error) {
        if (isTransientFileError(error)) continue;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      candidates.push({
        name: entry.name,
        target,
        signature: fileSignature(stat),
        bytes: stat.size,
        order: diskOrderHints.get(entry.name) ?? stat.mtimeMs,
      });
    }

    let keptFiles = candidates.length;
    let keptBytes = candidates.reduce((total, candidate) => total + candidate.bytes, 0);
    candidates.sort((left, right) =>
      left.order - right.order || compareNames(left.name, right.name),
    );
    for (const candidate of candidates) {
      if (keptFiles <= diskMaxEntries && keptBytes <= diskMaxBytes) break;
      if (!(await removeBestEffort(candidate.target, candidate.signature))) continue;
      keptFiles -= 1;
      keptBytes -= candidate.bytes;
      removed.add(candidate.name);
    }
    return removed;
  }

  async function persistEncoded(key, envelope, staleUntil, encoded, legacy = null) {
    return withDiskOperation(async () => {
      await writeEncoded(key, envelope, staleUntil, encoded);
      if (legacy) await removeBestEffort(legacy.target, legacy.signature);
      const removed = await enforceDiskQuota();
      return {
        envelope,
        staleUntil,
        persisted: !removed.has(cacheFilename(key)),
      };
    });
  }

  async function set(key, envelope, { staleUntil = null, sizeHint = null } = {}) {
    const normalizedStaleUntil = normalizeStaleUntil(staleUntil);
    if (sizeHint !== null && (!Number.isFinite(sizeHint) || sizeHint < 0)) {
      throw new TypeError("Economy cache sizeHint must be a non-negative finite number or null.");
    }
    if (sizeHint !== null && sizeHint >= maxFileBytes) {
      assertCacheKey(key);
      if (!isCacheEnvelope(envelope)) {
        throw new TypeError("Economy cache values must be timestamped envelopes.");
      }
      remember(key, envelope, normalizedStaleUntil, sizeHint);
      const target = childPath(cacheFilename(key));
      await withDiskOperation(() => removeFile(target));
      return { envelope, staleUntil: normalizedStaleUntil, persisted: false };
    }
    const encoded = encodeRecord(key, envelope, normalizedStaleUntil);
    remember(key, envelope, normalizedStaleUntil, encoded.bytes);
    if (encoded.bytes > maxFileBytes) {
      const target = childPath(cacheFilename(key));
      await withDiskOperation(() => removeFile(target));
      return { envelope, staleUntil: normalizedStaleUntil, persisted: false };
    }
    return persistEncoded(key, envelope, normalizedStaleUntil, encoded);
  }

  function accepted(validate, envelope) {
    if (typeof validate !== "function") return true;
    try {
      return Boolean(validate(envelope));
    } catch {
      return false;
    }
  }

  function legacyStaleValue(value, envelope) {
    const candidate = typeof value === "function" ? value(envelope) : value;
    return normalizeStaleUntil(candidate);
  }

  async function get(key, {
    validate,
    legacyStaleUntil = null,
    allowUnsafeLegacyMigration = false,
  } = {}) {
    assertCacheKey(key);
    const remembered = memory.get(key);
    if (remembered) {
      if (accepted(validate, remembered.envelope)) {
        touch(key, remembered);
        return remembered.envelope;
      }
      forget(key);
      const target = childPath(cacheFilename(key));
      const file = await readRegularFile(target).catch(() => null);
      if (file?.signature) await removeBestEffort(target, file.signature);
    }

    const target = childPath(cacheFilename(key));
    const file = await readRegularFile(target);
    if (file) {
      const decoded = file.text ? decodeRecord(file.text, key) : null;
      if (decoded && accepted(validate, decoded.envelope)) {
        remember(key, decoded.envelope, decoded.staleUntil, file.bytes);
        return decoded.envelope;
      }
      await removeBestEffort(target, file.signature);
    }

    if (!/^[a-z0-9_-]+$/.test(key) && allowUnsafeLegacyMigration !== true) return null;

    const legacyTarget = childPath(legacyCacheFilename(key));
    if (legacyTarget === target) return null;
    const legacy = await readRegularFile(legacyTarget);
    if (!legacy?.text) {
      if (legacy?.signature) await removeBestEffort(legacyTarget, legacy.signature);
      return null;
    }
    let envelope;
    try {
      envelope = JSON.parse(legacy.text);
    } catch {
      await removeBestEffort(legacyTarget, legacy.signature);
      return null;
    }
    if (!isCacheEnvelope(envelope)) {
      await removeBestEffort(legacyTarget, legacy.signature);
      return null;
    }
    if (!accepted(validate, envelope)) return null;

    const staleUntil = legacyStaleValue(legacyStaleUntil, envelope);
    const encoded = encodeRecord(key, envelope, staleUntil);
    remember(key, envelope, staleUntil, encoded.bytes);
    try {
      if (encoded.bytes <= maxFileBytes) {
        await persistEncoded(key, envelope, staleUntil, encoded, {
          target: legacyTarget,
          signature: legacy.signature,
        });
      } else {
        await withDiskOperation(() => removeFile(legacyTarget, legacy.signature));
      }
    } catch {
      // A readable legacy entry remains usable when migration cannot be persisted.
    }
    return envelope;
  }

  function isObsolete(name) {
    return obsoletePatterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(name);
    });
  }

  async function sweepFiles() {
    const summary = {
      scanned: 0,
      removedInvalid: 0,
      removedExpired: 0,
      removedObsolete: 0,
      removedTemporary: 0,
      removedQuota: 0,
      keptFiles: 0,
      keptBytes: 0,
    };
    if (!(await ensureSafeRoot(false))) return summary;
    const entries = await fsImpl.readdir(root, { withFileTypes: true });
    entries.sort((left, right) => compareNames(left.name, right.name));
    const candidates = [];
    const sweepNow = now();

    for (const entry of entries) {
      summary.scanned += 1;
      if (sweepYieldEvery > 0 && summary.scanned % sweepYieldEvery === 0) {
        await yieldControl();
      }
      const target = childPath(entry.name);
      if (activePaths.has(pathToken(target))) continue;
      let stat;
      try {
        stat = await fsImpl.lstat(target);
      } catch (error) {
        if (isTransientFileError(error)) continue;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const signature = fileSignature(stat);

      if (isObsolete(entry.name)) {
        if (await removeBestEffort(target, signature)) summary.removedObsolete += 1;
        continue;
      }
      if (entry.name.endsWith(".tmp")) {
        if (
          Number.isFinite(stat.mtimeMs) &&
          sweepNow >= stat.mtimeMs &&
          sweepNow - stat.mtimeMs >= tempGraceMs &&
          await removeBestEffort(target, signature)
        ) summary.removedTemporary += 1;
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;

      const file = await readRegularFile(target);
      if (!file?.text) {
        if (file?.signature && await removeBestEffort(target, file.signature)) {
          summary.removedInvalid += 1;
        }
        continue;
      }

      let envelope;
      let staleUntil = null;
      const match = /^v1-([a-f0-9]{64})\.json$/.exec(entry.name);
      if (match) {
        const decoded = decodeRecord(file.text);
        if (!decoded || cacheFilename(decoded.key) !== entry.name) {
          if (await removeBestEffort(target, file.signature)) summary.removedInvalid += 1;
          continue;
        }
        envelope = decoded.envelope;
        staleUntil = decoded.staleUntil;
      } else {
        try {
          envelope = JSON.parse(file.text);
        } catch {
          envelope = null;
        }
        if (!isCacheEnvelope(envelope)) {
          if (await removeBestEffort(target, file.signature)) summary.removedInvalid += 1;
          continue;
        }
      }

      if (staleUntil !== null && staleUntil < sweepNow) {
        if (await removeBestEffort(target, file.signature)) summary.removedExpired += 1;
        continue;
      }
      candidates.push({
        name: entry.name,
        target,
        signature: file.signature,
        bytes: file.bytes,
        order: envelope.fetchedAt,
      });
    }

    let keptBytes = candidates.reduce((total, candidate) => total + candidate.bytes, 0);
    let keptFiles = candidates.length;
    candidates.sort((left, right) =>
      left.order - right.order || compareNames(left.name, right.name),
    );
    for (const candidate of candidates) {
      if (keptFiles <= diskMaxEntries && keptBytes <= diskMaxBytes) break;
      if (!(await removeBestEffort(candidate.target, candidate.signature))) continue;
      keptFiles -= 1;
      keptBytes -= candidate.bytes;
      summary.removedQuota += 1;
    }
    summary.keptFiles = keptFiles;
    summary.keptBytes = keptBytes;
    return summary;
  }

  async function sweep() {
    return withDiskOperation(sweepFiles);
  }

  return Object.freeze({
    deleteMemory: forget,
    get,
    memoryStats: () => ({ entries: memory.size, bytes: memoryBytes }),
    set,
    sweep,
  });
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  DEFAULT_DISK_MAX_BYTES,
  DEFAULT_DISK_MAX_ENTRIES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MEMORY_MAX_BYTES,
  DEFAULT_MEMORY_MAX_ENTRIES,
  DEFAULT_SWEEP_YIELD_EVERY,
  cacheFilename,
  createEconomyCache,
  legacyCacheFilename,
};
