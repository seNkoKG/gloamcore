import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { diagnosePobEngine } = require("../electron/pob-engine-bridge.cjs");
const { createPobEngineDispatcher } = require("../electron/pob-engine-dispatch.cjs");

describe("Path of Building main-thread dispatch", () => {
  it("serializes engine operations and preserves their result objects", async () => {
    const started: string[] = [];
    let active = 0;
    let maximumActive = 0;
    class FakeWorker extends EventEmitter {
      postMessage(message: { operation: string }) {
        started.push(message.operation);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        setTimeout(() => {
          active -= 1;
          this.emit("message", {
            result: {
              ok: false,
              authoritative: false,
              contractVersion: 1,
              code: `TEST_${message.operation}`,
            },
          });
        }, 10);
      }

      terminate() {
        return Promise.resolve(0);
      }
    }

    const dispatcher = createPobEngineDispatcher({ WorkerClass: FakeWorker });
    const results = await Promise.all([
      dispatcher.diagnose(),
      dispatcher.calculate({ xml: "invalid fixture" }),
      dispatcher.importCharacter({ character: null }),
    ]);

    expect(started).toEqual(["diagnose", "calculate", "import-character"]);
    expect(maximumActive).toBe(1);
    expect(results.map((result: { code: string }) => result.code)).toEqual([
      "TEST_diagnose",
      "TEST_calculate",
      "TEST_import-character",
    ]);
  });

  it("fails closed when a worker returns an invalid envelope", async () => {
    class InvalidWorker extends EventEmitter {
      postMessage() {
        queueMicrotask(() => this.emit("message", {}));
      }

      terminate() {
        return Promise.resolve(0);
      }
    }

    await expect(
      createPobEngineDispatcher({ WorkerClass: InvalidWorker }).diagnose(),
    ).resolves.toMatchObject({
      ok: false,
      authoritative: false,
      code: "POB_DISPATCH_PROTOCOL_ERROR",
    });

    class WrongContractWorker extends EventEmitter {
      postMessage() {
        queueMicrotask(() => this.emit("message", {
          result: { ok: true, authoritative: true, contractVersion: 999 },
        }));
      }

      terminate() {
        return Promise.resolve(0);
      }
    }

    await expect(
      createPobEngineDispatcher({ WorkerClass: WrongContractWorker }).diagnose(),
    ).resolves.toMatchObject({ code: "POB_DISPATCH_PROTOCOL_ERROR" });
  });

  it("disposes the active worker and resolves active and queued work fail-closed", async () => {
    const workers: Array<EventEmitter & {
      terminate: () => Promise<number>;
      postMessage: (message: unknown) => void;
    }> = [];
    const posted: unknown[] = [];
    let terminateCount = 0;
    class HangingWorker extends EventEmitter {
      constructor() {
        super();
        workers.push(this);
      }

      postMessage(message: unknown) {
        posted.push(message);
      }

      terminate() {
        terminateCount += 1;
        return Promise.resolve(0);
      }
    }

    const dispatcher = createPobEngineDispatcher({ WorkerClass: HangingWorker });
    const active = dispatcher.calculate({ xml: "fixture" });
    const queued = dispatcher.diagnose();
    await new Promise((resolve) => setImmediate(resolve));
    expect(workers).toHaveLength(1);

    dispatcher.dispose();
    dispatcher.dispose();
    workers[0].emit("message", {
      result: { ok: true, authoritative: true, contractVersion: 1 },
    });

    await expect(active).resolves.toMatchObject({
      ok: false,
      authoritative: false,
      code: "POB_DISPATCH_DISPOSED",
    });
    await expect(queued).resolves.toMatchObject({ code: "POB_DISPATCH_DISPOSED" });
    await expect(dispatcher.diagnose()).resolves.toMatchObject({
      code: "POB_DISPATCH_DISPOSED",
    });
    await new Promise((resolve) => setTimeout(resolve, 125));
    expect(posted).toContainEqual({ operation: "cancel" });
    expect(workers).toHaveLength(1);
    expect(terminateCount).toBe(1);
  });

  it("cancels a timed-out worker before bounded hard termination", async () => {
    const posted: unknown[] = [];
    let terminateCount = 0;
    class HangingWorker extends EventEmitter {
      postMessage(message: unknown) {
        posted.push(message);
      }

      terminate() {
        terminateCount += 1;
        return Promise.resolve(0);
      }
    }

    const dispatcher = createPobEngineDispatcher({
      WorkerClass: HangingWorker,
      timeoutMilliseconds: 1_000,
      disposeGraceMilliseconds: 10,
    });
    await expect(dispatcher.calculate({ xml: "fixture" })).resolves.toMatchObject({
      code: "POB_DISPATCH_TIMEOUT",
      authoritative: false,
    });
    expect(posted).toContainEqual({ operation: "cancel" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminateCount).toBe(1);
  });

  const capability = diagnosePobEngine();
  it.runIf(capability.available)(
    "keeps the caller event loop responsive during full installation verification",
    async () => {
      const dispatcher = createPobEngineDispatcher();
      const startedAt = performance.now();
      const timer = new Promise<"timer">((resolve) => setTimeout(() => resolve("timer"), 0));
      const diagnosis = dispatcher.diagnose();

      expect(await Promise.race([timer, diagnosis.then(() => "diagnosis" as const)])).toBe(
        "timer",
      );
      const result = await diagnosis;
      const elapsed = performance.now() - startedAt;

      expect(result).toMatchObject({
        ok: true,
        authoritative: true,
        available: true,
        engine: { number: "2.66.1" },
      });
      expect(elapsed).toBeGreaterThan(100);
    },
    10_000,
  );
});
