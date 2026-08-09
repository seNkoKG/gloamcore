"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

const CONTRACT_VERSION = 1;
const DEFAULT_DISPATCH_TIMEOUT_MS = 150_000;

function dispatchFailure(code, message, detail = "") {
  return {
    ok: false,
    authoritative: false,
    contractVersion: CONTRACT_VERSION,
    code,
    message,
    recoverable: true,
    ...(detail ? { detail: String(detail).slice(0, 4000) } : {}),
  };
}

function isDispatchResult(result) {
  return Boolean(
    result
    && typeof result === "object"
    && typeof result.ok === "boolean"
    && typeof result.authoritative === "boolean"
    && result.contractVersion === CONTRACT_VERSION
    && (result.ok || (typeof result.code === "string" && result.code.length > 0)),
  );
}

function createPobEngineDispatcher({
  WorkerClass = Worker,
  workerPath = path.join(__dirname, "pob-engine-dispatch-worker.cjs"),
  timeoutMilliseconds = DEFAULT_DISPATCH_TIMEOUT_MS,
  engineOptions = {},
  disposeGraceMilliseconds = 100,
} = {}) {
  let queue = Promise.resolve();
  let closed = false;
  let cancelActive = null;

  const disposed = () => dispatchFailure(
    "POB_DISPATCH_DISPOSED",
    "The Path of Building background worker is shutting down.",
  );

  function dispatch(operation, request) {
    if (closed) return Promise.resolve(disposed());
    return new Promise((resolve) => {
      let settled = false;
      let worker;
      let cancel;
      const finish = (result, graceful = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancelActive === cancel) cancelActive = null;
        worker?.removeAllListeners?.();
        if (graceful && worker) {
          try { worker.postMessage({ operation: "cancel" }); } catch { /* worker already exited */ }
          const termination = setTimeout(
            () => void worker.terminate?.(),
            Math.max(0, Math.min(1_000, Number(disposeGraceMilliseconds) || 0)),
          );
          termination.unref?.();
        } else {
          void worker?.terminate?.();
        }
        resolve(result);
      };
      cancel = () => finish(disposed(), true);
      cancelActive = cancel;
      const timer = setTimeout(() => finish(dispatchFailure(
        "POB_DISPATCH_TIMEOUT",
        "The Path of Building background worker stopped responding.",
      ), true), Math.max(1_000, Math.min(300_000, Number(timeoutMilliseconds) || DEFAULT_DISPATCH_TIMEOUT_MS)));

      try {
        worker = new WorkerClass(workerPath, { name: "ninja-lens-pob-engine" });
        worker.once("message", (message) => {
          const result = message?.result;
          if (!isDispatchResult(result)) {
            finish(dispatchFailure(
              "POB_DISPATCH_PROTOCOL_ERROR",
              "The Path of Building background worker returned an invalid result.",
            ));
            return;
          }
          finish(result);
        });
        worker.once("error", (error) => finish(dispatchFailure(
          "POB_DISPATCH_START_FAILED",
          "The Path of Building background worker could not run.",
          error?.message,
        )));
        worker.once("exit", (code) => {
          finish(dispatchFailure(
            code === 0 ? "POB_DISPATCH_PROTOCOL_ERROR" : "POB_DISPATCH_EXITED",
            code === 0
              ? "The Path of Building background worker exited without a result."
              : "The Path of Building background worker exited unexpectedly.",
            `exit ${code}`,
          ));
        });
        worker.postMessage({ operation, request, options: engineOptions });
      } catch (error) {
        finish(dispatchFailure(
          "POB_DISPATCH_START_FAILED",
          "The Path of Building background worker could not start.",
          error?.message,
        ));
      }
    });
  }

  function enqueue(operation, request) {
    if (closed) return Promise.resolve(disposed());
    const task = queue.then(() => (closed ? disposed() : dispatch(operation, request)));
    queue = task.catch(() => undefined);
    return task.catch((error) => dispatchFailure(
      "POB_DISPATCH_FAILED",
      "The Path of Building background worker failed unexpectedly.",
      error?.message,
    ));
  }

  return Object.freeze({
    diagnose: () => enqueue("diagnose"),
    calculate: (request) => enqueue("calculate", request),
    importCharacter: (request) => enqueue("import-character", request),
    dispose: () => {
      if (closed) return;
      closed = true;
      cancelActive?.();
    },
  });
}

module.exports = {
  CONTRACT_VERSION,
  DEFAULT_DISPATCH_TIMEOUT_MS,
  createPobEngineDispatcher,
  dispatchFailure,
};
