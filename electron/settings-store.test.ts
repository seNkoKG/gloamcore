import { describe, expect, it, vi } from "vitest";
import store from "./settings-store.cjs";

describe("settings persistence", () => {
  it("rejects coercible scalar settings and invalid window geometry", () => {
    expect(store.sanitizeScalarSettings({
      alwaysOnTop: "false",
      compact: 1,
      clickThrough: false,
      opacity: Number.NaN,
    })).toEqual({ clickThrough: false });
    expect(store.sanitizeScalarSettings({ alwaysOnTop: true, opacity: 0.1 }))
      .toEqual({ alwaysOnTop: true, opacity: 0.65 });
    expect(store.sanitizeWindowBounds({ width: -1, height: 900 })).toBeNull();
    expect(store.sanitizeWindowBounds({ x: 1.4, y: 2.6, width: 800.2, height: 600.8 }))
      .toEqual({ x: 1, y: 3, width: 800, height: 601 });
  });

  it("cleans the temporary file and preserves the destination when rename fails", () => {
    const calls: string[] = [];
    const fsImpl = {
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn((name: string) => calls.push(`write:${name}`)),
      renameSync: vi.fn(() => { throw new Error("disk full"); }),
      unlinkSync: vi.fn((name: string) => calls.push(`unlink:${name}`)),
    };
    expect(() => store.writeJsonAtomically("C:\\state\\settings.json", { safe: true }, { fsImpl }))
      .toThrow("disk full");
    expect(fsImpl.unlinkSync).toHaveBeenCalledOnce();
    expect(calls[0].replace(/^write:/, "")).toBe(calls[1].replace(/^unlink:/, ""));
  });

  it("retries the current committed snapshot and recovers after transient I/O errors", () => {
    const queued: Array<() => void> = [];
    const snapshots = [{ revision: 1 }, { revision: 2 }];
    let attempt = 0;
    const recovered = vi.fn();
    const failed = vi.fn();
    const retry = store.createPersistenceRetry({
      write: vi.fn((snapshot) => {
        attempt += 1;
        if (attempt < 3) throw new Error("locked");
        expect(snapshot).toBe(snapshots[1]);
      }),
      getSnapshot: () => snapshots[1],
      onFailure: failed,
      onRecovered: recovered,
      setTimer: (callback: () => void) => { queued.push(callback); return { unref() {} }; },
      clearTimer: vi.fn(),
      minimumDelay: 1,
      maximumDelay: 4,
    });
    retry.schedule();
    retry.schedule();
    expect(queued).toHaveLength(1);
    queued.shift()?.();
    queued.shift()?.();
    queued.shift()?.();
    expect(failed).toHaveBeenCalledTimes(2);
    expect(recovered).toHaveBeenCalledOnce();
  });
});
