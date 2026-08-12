"use strict";

const { parentPort } = require("node:worker_threads");
const {
  analyzePobNodes,
  calculatePobBuild,
  diagnosePobEngine,
  huntPobTimeless,
  previewPobTimeless,
} = require("./pob-engine-bridge.cjs");

if (!parentPort) throw new Error("The PoB engine worker requires a parent port.");

let started = false;
let controller = null;
parentPort.on("message", async (message) => {
  if (message?.operation === "cancel") {
    controller?.abort();
    return;
  }
  if (started) return;
  started = true;
  controller = new AbortController();
  try {
    const options = {
      ...(message?.options && typeof message.options === "object" ? message.options : {}),
      signal: controller.signal,
    };
    const result = message?.operation === "diagnose"
      ? diagnosePobEngine(options)
      : message?.operation === "analyze-nodes"
        ? await analyzePobNodes(message.request, options)
      : message?.operation === "preview-timeless"
        ? await previewPobTimeless(message.request, options)
      : message?.operation === "hunt-timeless"
        ? await huntPobTimeless(message.request, options)
      : message?.operation === "calculate"
        ? await calculatePobBuild(message.request, options)
        : {
              ok: false,
              authoritative: false,
              contractVersion: 1,
              code: "POB_DISPATCH_INVALID",
              message: "The Path of Building worker received an unknown operation.",
              recoverable: false,
          };
    parentPort.postMessage({ result });
  } catch (error) {
    parentPort.postMessage({
      result: {
        ok: false,
        authoritative: false,
        contractVersion: 1,
        code: "POB_DISPATCH_FAILED",
        message: "The Path of Building background worker failed unexpectedly.",
        recoverable: true,
        detail: String(error?.message || error || "Unknown error").slice(0, 4000),
      },
    });
  }
});
