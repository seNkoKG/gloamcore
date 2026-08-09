import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { describePassiveTree } = require("../electron/pob-planner.cjs");
const {
  MAX_RESULT_BYTES,
  createPobPlannerDispatcher,
} = require("../electron/pob-planner-dispatch.cjs");

type Descriptor = {
  cacheKey: string;
  game: "poe1" | "poe2";
  version: string;
  sourcePath: string;
};

function fixtureTree(descriptor: Descriptor, name = "Fixture") {
  return {
    game: descriptor.game,
    version: descriptor.version,
    sourcePath: descriptor.sourcePath,
    classes: [{ id: 0, name: "Scion", ascendancies: [] }],
    groups: [{ id: 1, x: 0, y: 0 }],
    nodes: [{ id: 1, name }],
  };
}

function successfulResult(descriptor: Descriptor, name?: string) {
  return {
    ok: true,
    ...descriptor,
    serializedBytes: 256,
    data: fixtureTree(descriptor, name),
  };
}

describe("passive-tree main-thread dispatch", () => {
  it("caches by authoritative source identity and freezes cached results", async () => {
    let descriptor: Descriptor = {
      cacheKey: "poe1:3_29:first",
      game: "poe1",
      version: "3_29",
      sourcePath: "C:/PoB/TreeData/3_29/tree.lua",
    };
    let workers = 0;
    class ResultWorker extends EventEmitter {
      constructor() {
        super();
        workers += 1;
      }

      postMessage() {
        const response = successfulResult(descriptor, `load-${workers}`);
        queueMicrotask(() => this.emit("message", { result: response }));
      }

      terminate() {
        return Promise.resolve(0);
      }
    }

    const dispatcher = createPobPlannerDispatcher({
      WorkerClass: ResultWorker,
      describeTree: () => descriptor,
    });
    const first = await dispatcher.load({ game: "poe1" });
    const second = await dispatcher.load({ game: "poe1" });

    expect(second).toBe(first);
    expect(workers).toBe(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.nodes[0])).toBe(true);
    expect(() => { first.nodes[0].name = "poisoned"; }).toThrow();

    const distinctRequest = await dispatcher.load({ game: "poe1", ruthless: true });
    expect(distinctRequest).not.toBe(first);
    expect(workers).toBe(2);

    descriptor = { ...descriptor, cacheKey: "poe1:3_29:updated" };
    const updated = await dispatcher.load({ game: "poe1" });
    expect(updated).not.toBe(first);
    expect(updated.nodes[0].name).toBe("load-3");
    expect(workers).toBe(3);
    dispatcher.dispose();
  });

  it("serializes distinct cold loads and deduplicates concurrent identical loads", async () => {
    let active = 0;
    let maximumActive = 0;
    let workers = 0;
    const descriptorFor = (request: { treeVersion?: string }): Descriptor => ({
      cacheKey: `poe1:${request.treeVersion || "latest"}`,
      game: "poe1",
      version: request.treeVersion || "3_29",
      sourcePath: `C:/PoB/${request.treeVersion || "3_29"}/tree.lua`,
    });
    class DelayedWorker extends EventEmitter {
      postMessage(message: { request: { treeVersion?: string } }) {
        workers += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const descriptor = descriptorFor(message.request);
        setTimeout(() => {
          active -= 1;
          this.emit("message", { result: successfulResult(descriptor) });
        }, 10);
      }

      terminate() {
        return Promise.resolve(0);
      }
    }

    const dispatcher = createPobPlannerDispatcher({
      WorkerClass: DelayedWorker,
      describeTree: descriptorFor,
    });
    const [first, duplicate, other] = await Promise.all([
      dispatcher.load({ treeVersion: "3_28" }),
      dispatcher.load({ treeVersion: "3_28" }),
      dispatcher.load({ treeVersion: "3_29" }),
    ]);

    expect(duplicate).toBe(first);
    expect(other.version).toBe("3_29");
    expect(workers).toBe(2);
    expect(maximumActive).toBe(1);
    dispatcher.dispose();
  });

  it("fails closed on stale identities and oversized worker results", async () => {
    const descriptor: Descriptor = {
      cacheKey: "expected",
      game: "poe1",
      version: "3_29",
      sourcePath: "C:/PoB/tree.lua",
    };
    class StaleWorker extends EventEmitter {
      postMessage() {
        queueMicrotask(() => this.emit("message", {
          result: { ...successfulResult(descriptor), cacheKey: "stale" },
        }));
      }

      terminate() {
        return Promise.resolve(0);
      }
    }
    await expect(createPobPlannerDispatcher({
      WorkerClass: StaleWorker,
      describeTree: () => descriptor,
    }).load({})).rejects.toMatchObject({ code: "POB_TREE_PROTOCOL_ERROR" });

    class OversizedWorker extends EventEmitter {
      postMessage() {
        queueMicrotask(() => this.emit("message", {
          result: {
            ...successfulResult(descriptor),
            serializedBytes: MAX_RESULT_BYTES + 1,
          },
        }));
      }

      terminate() {
        return Promise.resolve(0);
      }
    }
    await expect(createPobPlannerDispatcher({
      WorkerClass: OversizedWorker,
      describeTree: () => descriptor,
    }).load({})).rejects.toMatchObject({ code: "POB_TREE_PROTOCOL_ERROR" });
  });

  it("disposes active and queued loads and ignores late worker results", async () => {
    const descriptor: Descriptor = {
      cacheKey: "fixture",
      game: "poe1",
      version: "3_29",
      sourcePath: "C:/PoB/tree.lua",
    };
    const workers: Array<EventEmitter & { terminate: () => Promise<number> }> = [];
    let terminations = 0;
    class HangingWorker extends EventEmitter {
      constructor() {
        super();
        workers.push(this);
      }

      postMessage() {}

      terminate() {
        terminations += 1;
        return Promise.resolve(0);
      }
    }

    const dispatcher = createPobPlannerDispatcher({
      WorkerClass: HangingWorker,
      describeTree: () => descriptor,
    });
    const active = dispatcher.load({});
    const queued = dispatcher.load({});
    await new Promise((resolve) => setImmediate(resolve));
    expect(workers).toHaveLength(1);

    dispatcher.dispose();
    dispatcher.dispose();
    workers[0].emit("message", { result: successfulResult(descriptor) });

    await expect(active).rejects.toMatchObject({ code: "POB_TREE_DISPATCH_DISPOSED" });
    await expect(queued).rejects.toMatchObject({ code: "POB_TREE_DISPATCH_DISPOSED" });
    await expect(dispatcher.load({})).rejects.toMatchObject({ code: "POB_TREE_DISPATCH_DISPOSED" });
    expect(terminations).toBe(1);
  });

  let capability = false;
  try {
    capability = Boolean(describePassiveTree({ game: "poe1" })?.cacheKey);
  } catch {
    capability = false;
  }
  it.runIf(capability)(
    "keeps timers responsive during a real cold passive-tree load",
    async () => {
      const dispatcher = createPobPlannerDispatcher();
      const startedAt = performance.now();
      const timer = new Promise<"timer">((resolve) => setTimeout(() => resolve("timer"), 0));
      const loaded = dispatcher.load({ game: "poe1" });

      expect(await Promise.race([timer, loaded.then(() => "tree" as const)])).toBe("timer");
      const tree = await loaded;
      const elapsed = performance.now() - startedAt;

      expect(tree.nodes.length).toBeGreaterThan(2_000);
      expect(Object.isFrozen(tree)).toBe(true);
      expect(elapsed).toBeGreaterThan(50);
      dispatcher.dispose();
    },
    10_000,
  );
});
