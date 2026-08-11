"use strict";

const DEFAULT_MAX_TEXT_LENGTH = 65_536;
const COPY_ACCELERATOR_MODIFIERS = new Set([
  "commandorcontrol",
  "cmdorctrl",
  "control",
  "ctrl",
]);

function normalizeClipboardText(value, maxTextLength = DEFAULT_MAX_TEXT_LENGTH) {
  return String(value ?? "")
    .replace(/\0/g, "")
    .slice(0, maxTextLength);
}

function isCompletePoeItemText(value) {
  const text = String(value ?? "");
  return /^Item Class:\s*.+$/m.test(text);
}

function isCopyAccelerator(value) {
  const tokens = String(value ?? "")
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  return (
    tokens.length === 2 &&
    tokens.includes("c") &&
    tokens.some((token) => COPY_ACCELERATOR_MODIFIERS.has(token))
  );
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
  return value;
}

/**
 * Serializes capture attempts while retaining one trailing request. When a
 * newer hotkey press arrives during focus handoff or native copy, the older
 * result is discarded and the current hover is copied once more. This keeps
 * repeated key presses latest-wins without ever injecting concurrent Ctrl+C.
 */
function createLatestItemCaptureQueue({
  prepareCapture = () => true,
  capture,
  present,
} = {}) {
  const prepare = requireFunction(prepareCapture, "prepareCapture");
  const runCapture = requireFunction(capture, "capture");
  const show = requireFunction(present, "present");
  let requestedVersion = 0;
  let latestRequest;
  let running = null;

  async function drain() {
    let latestResult = null;
    while (true) {
      const attemptVersion = requestedVersion;
      const requestContext = latestRequest;
      let prepared = prepare(requestContext);
      if (prepared && typeof prepared.then === "function") {
        prepared = await prepared;
      }
      if (!prepared) {
        if (attemptVersion === requestedVersion) return latestResult;
        continue;
      }
      if (attemptVersion !== requestedVersion) continue;

      const result = await runCapture(requestContext);
      if (attemptVersion !== requestedVersion) continue;
      if (result != null) {
        latestResult = result;
        if (requestContext === undefined) await show(result);
        else await show(result, requestContext);
      }
      if (attemptVersion === requestedVersion) return latestResult;
    }
  }

  function request(context) {
    requestedVersion += 1;
    latestRequest = context;
    if (!running) {
      running = drain().finally(() => {
        running = null;
      });
    }
    return running;
  }

  return {
    request,
    isRunning: () => Boolean(running),
  };
}

function createOneKeyItemCapture({
  readClipboardText,
  injectCopy,
  releaseShortcutKeys = () => undefined,
  isCaptureAvailable = () => true,
  isTargetFocused = () => true,
  getCaptureAccelerator = () => "",
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelSchedule = (handle) => clearTimeout(handle),
  now = Date.now,
  timeoutMs = 600,
  abortGraceMs = 100,
  maxTextLength = DEFAULT_MAX_TEXT_LENGTH,
} = {}) {
  const readText = requireFunction(readClipboardText, "readClipboardText");
  const copy = requireFunction(injectCopy, "injectCopy");
  const releaseKeys = requireFunction(releaseShortcutKeys, "releaseShortcutKeys");
  const captureAvailable = requireFunction(isCaptureAvailable, "isCaptureAvailable");
  const targetFocused = requireFunction(isTargetFocused, "isTargetFocused");
  const captureAccelerator = requireFunction(
    getCaptureAccelerator,
    "getCaptureAccelerator",
  );
  const setTimer = requireFunction(schedule, "schedule");
  const clearTimer = requireFunction(cancelSchedule, "cancelSchedule");
  const clock = requireFunction(now, "now");
  const getTimeout = typeof timeoutMs === "function"
    ? timeoutMs
    : () => timeoutMs;
  const abortGrace = Math.max(0, Number(abortGraceMs) || 0);
  const textLimit = Math.max(1, Number(maxTextLength) || DEFAULT_MAX_TEXT_LENGTH);
  let pending = false;

  function failedCapture() {
    return {
      text: "",
      capturedAt: clock(),
      validPrefix: false,
    };
  }

  function after(delayMs) {
    return new Promise((resolve) => {
      setTimer(resolve, delayMs);
    });
  }

  async function capture(context) {
    if (
      pending ||
      !captureAvailable() ||
      !targetFocused() ||
      isCopyAccelerator(captureAccelerator(context))
    ) return null;

    pending = true;
    try {
      const timeout = Math.max(0, Number(getTimeout(context)) || 0);
      const startedAt = clock();
      const deadline = startedAt + timeout;
      const abortController = new AbortController();
      let timeoutHandle;
      const copyOutcome = Promise.resolve()
        .then(() => {
          releaseKeys(context);
          return copy({
            deadline,
            timeoutMs: timeout,
            signal: abortController.signal,
            context,
          });
        })
        .then(
          (value) => ({ status: "complete", value }),
          (error) => ({ status: "error", error }),
        );
      const timedOutcome = new Promise((resolve) => {
        timeoutHandle = setTimer(
          () => resolve({ status: "timeout" }),
          timeout,
        );
      });
      const outcome = await Promise.race([copyOutcome, timedOutcome]);
      clearTimer(timeoutHandle);

      if (outcome.status === "timeout") {
        abortController.abort();
        // Give the native runner a short, bounded window to terminate and reap
        // its child process. The helper also receives the absolute deadline, so
        // it cannot inject after this capture expires even if process startup
        // was delayed by Windows.
        await Promise.race([copyOutcome, after(abortGrace)]);
        return failedCapture();
      }
      if (
        outcome.status === "error" ||
        outcome.value === false ||
        outcome.value?.clipboardChanged === false ||
        clock() >= deadline ||
        (
          !targetFocused() &&
          outcome.value?.targetIdentityVerified !== true
        )
      ) return failedCapture();

      try {
        const text = normalizeClipboardText(readText(), textLimit);
        if (!isCompletePoeItemText(text)) return failedCapture();
        const captured = {
          text,
          capturedAt: clock(),
          validPrefix: true,
        };
        if (outcome.value?.targetIdentityVerified === true) {
          captured.targetIdentityVerified = true;
        }
        return captured;
      } catch {
        return failedCapture();
      }
    } finally {
      pending = false;
    }
  }

  return {
    capture,
    isPending: () => pending,
  };
}

module.exports = {
  createLatestItemCaptureQueue,
  createOneKeyItemCapture,
  isCompletePoeItemText,
  isCopyAccelerator,
  normalizeClipboardText,
};
