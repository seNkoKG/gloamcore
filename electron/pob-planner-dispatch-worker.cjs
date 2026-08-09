"use strict";

const v8 = require("node:v8");
const { parentPort } = require("node:worker_threads");
const { loadPassiveTreeSnapshot } = require("./pob-planner.cjs");

const MAX_RESULT_BYTES = 64 * 1024 * 1024;

if (!parentPort) throw new Error("The passive-tree worker requires a parent port.");

function boundedError(error) {
  return {
    ok: false,
    code: String(error?.code || "POB_TREE_WORKER_FAILED").slice(0, 80),
    message: String(error?.message || error || "The passive-tree worker failed.").slice(0, 4000),
  };
}

function loadSnapshot(request) {
  try {
    return loadPassiveTreeSnapshot(request);
  } catch (error) {
    if (error?.code !== "POB_TREE_CHANGED") throw error;
    return loadPassiveTreeSnapshot(request);
  }
}

parentPort.once("message", (message) => {
  if (message?.operation !== "load") {
    parentPort.postMessage({
      result: {
        ok: false,
        code: "POB_TREE_WORKER_INVALID",
        message: "The passive-tree worker received an unknown operation.",
      },
    });
    return;
  }

  try {
    const snapshot = loadSnapshot(message.request);
    const serializedBytes = v8.serialize(snapshot.data).byteLength;
    if (serializedBytes <= 0 || serializedBytes > MAX_RESULT_BYTES) {
      const error = new Error("The passive-tree result is invalid or too large.");
      error.code = "POB_TREE_RESULT_TOO_LARGE";
      throw error;
    }
    parentPort.postMessage({
      result: {
        ok: true,
        cacheKey: snapshot.cacheKey,
        game: snapshot.game,
        version: snapshot.version,
        sourcePath: snapshot.sourcePath,
        serializedBytes,
        data: snapshot.data,
      },
    });
  } catch (error) {
    parentPort.postMessage({ result: boundedError(error) });
  }
});

module.exports = {
  MAX_RESULT_BYTES,
};
