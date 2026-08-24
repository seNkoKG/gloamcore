import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import store from "./settings-store.cjs";

describe("settings persistence", () => {
  const regularFile = (size: number) => ({
    size,
    isFile: () => true,
    isSymbolicLink: () => false,
  });

  it("rejects coercible scalar settings and invalid window geometry", () => {
    expect(store.sanitizeScalarSettings({
      alwaysOnTop: "false",
      compact: 1,
      clickThrough: false,
      opacity: Number.NaN,
    })).toEqual({ clickThrough: false });
    expect(store.sanitizeScalarSettings({ alwaysOnTop: true, opacity: 0.1 }))
      .toEqual({ alwaysOnTop: true, opacity: 0.65 });
    expect(store.sanitizeScalarSettings({ updateChannel: "preview" }))
      .toEqual({ updateChannel: "preview" });
    expect(store.sanitizeScalarSettings({ updateChannel: "nightly" }))
      .toEqual({});
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

  it("distinguishes a missing settings file from a valid loaded object", () => {
    const target = path.join("state", "settings.json");
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    expect(store.loadSettingsFile(target, {
      fsImpl: { lstatSync: vi.fn(() => { throw missing; }) },
    })).toEqual({ status: "missing" });

    expect(store.loadSettingsFile(target, {
      fsImpl: {
        lstatSync: vi.fn(() => regularFile(20)),
        readFileSync: vi.fn(() => Buffer.from('{"compact":true}', "utf8")),
      },
    })).toEqual({ status: "loaded", value: { compact: true } });
  });

  it("quarantines invalid and oversized regular settings before defaults can be saved", () => {
    const target = path.join("state", "settings.json");
    const renamed: Array<[string, string]> = [];
    const invalid = store.loadSettingsFile(target, {
      fsImpl: {
        lstatSync: vi.fn(() => regularFile(7)),
        readFileSync: vi.fn(() => Buffer.from("{broken", "utf8")),
        renameSync: vi.fn((from: string, to: string) => renamed.push([from, to])),
      },
      now: () => new Date("2026-08-23T10:00:00.000Z"),
      randomId: () => "test-id",
    });
    expect(invalid).toMatchObject({
      status: "quarantined",
      backupName: "settings.json.invalid-2026-08-23T10-00-00-000Z-test-id.bak",
    });
    expect(renamed[0]).toEqual([
      target,
      `${target}.invalid-2026-08-23T10-00-00-000Z-test-id.bak`,
    ]);

    const readFileSync = vi.fn();
    const renameSync = vi.fn();
    expect(store.loadSettingsFile(target, {
      fsImpl: {
        lstatSync: vi.fn(() => regularFile(store.MAX_SETTINGS_BYTES + 1)),
        readFileSync,
        renameSync,
      },
      randomId: () => "oversized",
    })).toMatchObject({ status: "quarantined" });
    expect(readFileSync).not.toHaveBeenCalled();
    expect(renameSync).toHaveBeenCalledOnce();
  });

  it("blocks persistence when the path is unsafe or invalid settings cannot be quarantined", () => {
    const target = path.join("state", "settings.json");
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    expect(store.loadSettingsFile(target, {
      fsImpl: { lstatSync: vi.fn(() => { throw denied; }) },
    })).toMatchObject({ status: "blocked" });

    const renameSync = vi.fn();
    const unsafe = store.loadSettingsFile(target, {
      fsImpl: {
        lstatSync: vi.fn(() => ({
          size: 10,
          isFile: () => false,
          isSymbolicLink: () => true,
        })),
        renameSync,
      },
    });
    expect(unsafe).toMatchObject({ status: "blocked" });
    expect(unsafe.warning).toMatch(/not a regular file/i);
    expect(renameSync).not.toHaveBeenCalled();

    const locked = store.loadSettingsFile(target, {
      fsImpl: {
        lstatSync: vi.fn(() => regularFile(7)),
        readFileSync: vi.fn(() => Buffer.from("{broken", "utf8")),
        renameSync: vi.fn(() => { throw new Error("locked"); }),
      },
      randomId: () => "blocked",
    });
    expect(locked).toMatchObject({ status: "blocked" });
    expect(locked.warning).toMatch(/could not be archived safely/i);
  });
});
