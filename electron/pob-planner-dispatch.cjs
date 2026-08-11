"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { describePassiveTree } = require("./pob-planner.cjs");

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESULT_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 2;

function dispatchError(code, message, detail = "") {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = String(detail).slice(0, 4000);
  return error;
}

function normalizeRequest(request) {
  const source = request && typeof request === "object" ? request : {};
  const requestedVersion = typeof source.treeVersion === "string"
    ? source.treeVersion
    : typeof source.version === "string"
      ? source.version
      : "";
  return Object.freeze({
    game: source.game === "poe2" ? "poe2" : "poe1",
    treeVersion: requestedVersion.replace(/\0/g, "").slice(0, 40),
    ruthless: Boolean(source.ruthless),
    alternate: Boolean(source.alternate),
  });
}

function freezeTree(root) {
  const pending = [root];
  const seen = new WeakSet();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") pending.push(child);
    }
    Object.freeze(value);
  }
  return root;
}

function validateDescriptor(value) {
  return Boolean(
    value
    && typeof value === "object"
    && typeof value.cacheKey === "string"
    && value.cacheKey.length > 0
    && value.cacheKey.length <= 16_384
    && (value.game === "poe1" || value.game === "poe2")
    && typeof value.version === "string"
    && value.version.length > 0
    && value.version.length <= 80
    && typeof value.sourcePath === "string"
    && value.sourcePath.length > 0
    && value.sourcePath.length <= 32_768
  );
}

function validateResult(result, expected) {
  const data = result?.data;
  return Boolean(
    result
    && typeof result === "object"
    && result.ok === true
    && result.cacheKey === expected.cacheKey
    && result.game === expected.game
    && result.version === expected.version
    && result.sourcePath === expected.sourcePath
    && Number.isSafeInteger(result.serializedBytes)
    && result.serializedBytes > 0
    && result.serializedBytes <= MAX_RESULT_BYTES
    && data
    && typeof data === "object"
    && !Array.isArray(data)
    && data.game === expected.game
    && data.version === expected.version
    && data.sourcePath === expected.sourcePath
    && Array.isArray(data.nodes)
    && data.nodes.length <= 20_000
    && Array.isArray(data.groups)
    && data.groups.length <= 20_000
    && Array.isArray(data.classes)
    && data.classes.length <= 64
    && (data.assets == null || (typeof data.assets === "object" && !Array.isArray(data.assets)))
    && (data.cluster == null || (typeof data.cluster === "object" && !Array.isArray(data.cluster)))
  );
}

function requestCacheKey(request, descriptor) {
  return JSON.stringify({ request, source: descriptor.cacheKey });
}

function createPobPlannerDispatcher({
  WorkerClass = Worker,
  workerPath = path.join(__dirname, "pob-planner-dispatch-worker.cjs"),
  describeTree = describePassiveTree,
  timeoutMilliseconds = DEFAULT_TIMEOUT_MS,
} = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  let active = null;
  let closed = false;

  const disposedError = () => dispatchError(
    "POB_TREE_DISPATCH_DISPOSED",
    "The passive-tree background worker is shutting down.",
  );

  function describe(request) {
    const value = describeTree(request);
    if (!validateDescriptor(value)) {
      throw dispatchError(
        "POB_TREE_DESCRIPTOR_INVALID",
        "The installed Path of Building tree identity is invalid.",
      );
    }
    return value;
  }

  function cached(cacheKey) {
    const value = cache.get(cacheKey);
    if (!value) return null;
    cache.delete(cacheKey);
    cache.set(cacheKey, value);
    return value;
  }

  function remember(cacheKey, data) {
    cache.set(cacheKey, data);
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  }

  function runWorker(request, expected) {
    if (closed) return Promise.reject(disposedError());
    return new Promise((resolve, reject) => {
      let worker = null;
      let settled = false;
      let timer = null;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker?.removeAllListeners?.();
        if (active?.finish === finish) active = null;
        void worker?.terminate?.();
        if (error) reject(error);
        else resolve(result);
      };

      try {
        worker = new WorkerClass(workerPath, { name: "gloamcore-pob-tree" });
        active = { worker, finish };
        worker.once("message", (message) => {
          const result = message?.result;
          if (result?.ok === false) {
            finish(dispatchError(
              typeof result.code === "string" ? result.code.slice(0, 80) : "POB_TREE_WORKER_FAILED",
              typeof result.message === "string"
                ? result.message.slice(0, 4000)
                : "The passive-tree background worker failed.",
            ));
            return;
          }
          if (!validateResult(result, expected)) {
            finish(dispatchError(
              "POB_TREE_PROTOCOL_ERROR",
              "The passive-tree background worker returned an invalid result.",
            ));
            return;
          }
          finish(null, result);
        });
        worker.once("error", (error) => finish(dispatchError(
          "POB_TREE_WORKER_FAILED",
          "The passive-tree background worker could not run.",
          error?.message,
        )));
        worker.once("exit", (code) => finish(dispatchError(
          code === 0 ? "POB_TREE_PROTOCOL_ERROR" : "POB_TREE_WORKER_EXITED",
          code === 0
            ? "The passive-tree background worker exited without a result."
            : "The passive-tree background worker exited unexpectedly.",
          `exit ${code}`,
        )));
        timer = setTimeout(() => finish(dispatchError(
          "POB_TREE_WORKER_TIMEOUT",
          "The passive-tree background worker stopped responding.",
        )), Math.max(1_000, Math.min(60_000, Number(timeoutMilliseconds) || DEFAULT_TIMEOUT_MS)));
        timer.unref?.();
        worker.postMessage({ operation: "load", request });
      } catch (error) {
        finish(dispatchError(
          "POB_TREE_WORKER_START_FAILED",
          "The passive-tree background worker could not start.",
          error?.message,
        ));
      }
    });
  }

  async function coldLoad(request, changeRetry = 0) {
    if (closed) throw disposedError();
    const before = describe(request);
    const beforeCacheKey = requestCacheKey(request, before);
    const hit = cached(beforeCacheKey);
    if (hit) return hit;
    const result = await runWorker(request, before);
    if (closed) throw disposedError();
    const after = describe(request);
    if (after.cacheKey !== before.cacheKey) {
      if (changeRetry < 1) return coldLoad(request, changeRetry + 1);
      throw dispatchError(
        "POB_TREE_CHANGED",
        "Path of Building passive-tree files changed while they were loading. Retry after its update finishes.",
      );
    }
    const data = freezeTree(result.data);
    remember(requestCacheKey(request, after), data);
    return data;
  }

  function load(request) {
    if (closed) return Promise.reject(disposedError());
    const normalized = normalizeRequest(request);
    let descriptor;
    try {
      descriptor = describe(normalized);
    } catch (error) {
      return Promise.reject(error);
    }
    const hit = cached(requestCacheKey(normalized, descriptor));
    if (hit) return Promise.resolve(hit);
    const task = queue.then(() => coldLoad(normalized));
    queue = task.catch(() => undefined);
    return task;
  }

  return Object.freeze({
    load,
    dispose: () => {
      if (closed) return;
      closed = true;
      cache.clear();
      active?.finish?.(disposedError());
    },
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_RESULT_BYTES,
  createPobPlannerDispatcher,
  dispatchError,
  freezeTree,
  normalizeRequest,
  validateResult,
};
