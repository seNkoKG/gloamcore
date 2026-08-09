import { describe, expect, it } from "vitest";
import { PlannerAsyncRevisionGuard } from "./planner-async-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("planner async revision guard", () => {
  it("rejects a delayed PoB result after the build changes", async () => {
    const guard = new PlannerAsyncRevisionGuard();
    const worker = deferred<string>();
    const token = guard.begin("calculation");
    let applied = "current edit";
    const completion = worker.promise.then((result) => {
      if (guard.inspect(token) === "current") applied = result;
    });

    guard.markChanged();
    worker.resolve("stale calculation");
    await completion;

    expect(guard.inspect(token)).toBe("changed");
    expect(applied).toBe("current edit");
  });

  it("lets only the newest of two out-of-order calculations apply", async () => {
    const guard = new PlannerAsyncRevisionGuard();
    const first = deferred<string>();
    const second = deferred<string>();
    const firstToken = guard.begin("calculation");
    const secondToken = guard.begin("calculation");
    const applied: string[] = [];
    const finish = (promise: Promise<string>, token: typeof firstToken) => promise.then((result) => {
      if (guard.inspect(token) === "current") applied.push(result);
    });
    const firstCompletion = finish(first.promise, firstToken);
    const secondCompletion = finish(second.promise, secondToken);

    second.resolve("newest");
    await secondCompletion;
    first.resolve("oldest");
    await firstCompletion;

    expect(guard.inspect(firstToken)).toBe("superseded");
    expect(applied).toEqual(["newest"]);
  });

  it("supersedes a stale import with a rapid spec or game switch", async () => {
    const guard = new PlannerAsyncRevisionGuard();
    const staleImport = deferred<string>();
    const importToken = guard.begin("replacement");
    let workspace = "current";
    const importCompletion = staleImport.promise.then((result) => {
      if (guard.inspect(importToken) === "current") workspace = result;
    });

    const switchToken = guard.begin("replacement");
    expect(guard.inspect(switchToken)).toBe("current");
    staleImport.resolve("stale import");
    await importCompletion;

    expect(guard.inspect(importToken)).toBe("superseded");
    expect(workspace).toBe("current");
  });

  it("invalidates a calculation started while a replacement is still loading when that replacement commits", () => {
    const guard = new PlannerAsyncRevisionGuard();
    guard.markChanged();
    const replacement = guard.begin("replacement");
    const calculation = guard.begin("calculation");

    expect(guard.inspect(replacement)).toBe("current");
    expect(guard.inspect(calculation)).toBe("current");

    guard.markChanged();

    expect(guard.inspect(calculation)).toBe("changed");
  });
});
