import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createLatestItemCaptureQueue,
  createOneKeyItemCapture,
  isCopyAccelerator,
} = require("../electron/one-key-capture.cjs") as {
  createLatestItemCaptureQueue<T, C = undefined>(options: {
    prepareCapture?: (context: C) => boolean | Promise<boolean>;
    capture: (context: C) => T | null | Promise<T | null>;
    present: (result: T, context: C) => void | Promise<void>;
  }): {
    request(context?: C): Promise<T | null>;
    isRunning(): boolean;
  };
  createOneKeyItemCapture(options: Record<string, unknown>): {
    capture(context?: unknown): Promise<CaptureResult | null>;
    isPending(): boolean;
  };
  isCopyAccelerator(value: unknown): boolean;
};

type CaptureResult = {
  text: string;
  capturedAt: number;
  validPrefix: boolean;
  targetIdentityVerified?: boolean;
};

const COMPLETE_ITEM = [
  "Item Class: Rings",
  "Rarity: Rare",
  "Gale Circle",
  "Amethyst Ring",
  "--------",
  "+12% to Chaos Resistance",
].join("\n");
const INCOMPLETE_ITEM = "Item Class: Rings\nGale Circle\nAmethyst Ring";

describe("one-key item capture", () => {
  it("coalesces rapid requests and presents only the latest captured item", async () => {
    let finishFirst: ((result: CaptureResult) => void) | undefined;
    const secondItem = COMPLETE_ITEM.replace("Gale Circle", "Storm Loop");
    const firstResult = new Promise<CaptureResult>((resolve) => {
      finishFirst = resolve;
    });
    const capture = vi
      .fn<() => Promise<CaptureResult>>()
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce({
        text: secondItem,
        capturedAt: 2_000,
        validPrefix: true,
      });
    const present = vi.fn();
    const queue = createLatestItemCaptureQueue({ capture, present });

    const running = queue.request();
    expect(queue.isRunning()).toBe(true);
    const coalesced = queue.request();
    queue.request();
    finishFirst?.({
      text: COMPLETE_ITEM,
      capturedAt: 1_000,
      validPrefix: true,
    });

    await expect(running).resolves.toMatchObject({ text: secondItem });
    await expect(coalesced).resolves.toMatchObject({ text: secondItem });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(present).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledWith(expect.objectContaining({ text: secondItem }));
    expect(queue.isRunning()).toBe(false);
  });

  it("rechecks preparation for the coalesced trailing capture", async () => {
    let finishPreparation: ((ready: boolean) => void) | undefined;
    const firstPreparation = new Promise<boolean>((resolve) => {
      finishPreparation = resolve;
    });
    const prepareCapture = vi
      .fn<() => boolean | Promise<boolean>>()
      .mockReturnValueOnce(firstPreparation)
      .mockReturnValueOnce(true);
    const capture = vi.fn(async () => ({
      text: COMPLETE_ITEM,
      capturedAt: 2_000,
      validPrefix: true,
    }));
    const present = vi.fn();
    const queue = createLatestItemCaptureQueue({
      prepareCapture,
      capture,
      present,
    });

    const running = queue.request();
    queue.request();
    finishPreparation?.(true);
    await running;

    expect(prepareCapture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest request context with its serialized capture", async () => {
    let finishFirst: ((result: CaptureResult) => void) | undefined;
    const firstResult = new Promise<CaptureResult>((resolve) => {
      finishFirst = resolve;
    });
    const capture = vi
      .fn<(context: { mode: string }) => Promise<CaptureResult>>()
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce({
        text: COMPLETE_ITEM,
        capturedAt: 2_000,
        validPrefix: true,
      });
    const prepareCapture = vi.fn(() => true);
    const present = vi.fn();
    const queue = createLatestItemCaptureQueue<CaptureResult, { mode: string }>({
      prepareCapture,
      capture,
      present,
    });

    const running = queue.request({ mode: "passive" });
    queue.request({ mode: "locked" });
    finishFirst?.({
      text: COMPLETE_ITEM,
      capturedAt: 1_000,
      validPrefix: true,
    });
    await running;

    expect(prepareCapture).toHaveBeenLastCalledWith({ mode: "locked" });
    expect(capture).toHaveBeenLastCalledWith({ mode: "locked" });
    expect(present).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({ capturedAt: 2_000 }),
      { mode: "locked" },
    );
  });

  it("preserves text, image, bookmark, and custom clipboard formats on failure", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const custom = Buffer.from("custom payload", "utf8");
    const clipboardState = {
      text: "clipboard before capture",
      bookmark: { title: "Build guide", url: "https://example.invalid/build" },
      image,
      formats: new Map<string, Buffer>([["application/x-poe-test", custom]]),
    };
    const legacyWrite = vi.fn();
    const capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardState.text,
      // Deliberately supplied as a regression sentinel: the capture module no
      // longer primes or restores the clipboard through any write callback.
      writeClipboardText: legacyWrite,
      injectCopy: () => ({ clipboardChanged: false }),
      now: () => 1_000,
    });

    await expect(capture.capture()).resolves.toEqual({
      text: "",
      capturedAt: 1_000,
      validPrefix: false,
    });
    expect(legacyWrite).not.toHaveBeenCalled();
    expect(clipboardState).toEqual({
      text: "clipboard before capture",
      bookmark: { title: "Build guide", url: "https://example.invalid/build" },
      image,
      formats: new Map<string, Buffer>([["application/x-poe-test", custom]]),
    });
  });

  it("never overwrites an unrelated clipboard update that wins the capture race", async () => {
    const clipboardState = {
      text: "before",
      image: Buffer.from("old-image"),
      custom: Buffer.from("old-custom"),
    };
    const legacyWrite = vi.fn();
    const capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardState.text,
      writeClipboardText: legacyWrite,
      injectCopy: () => {
        clipboardState.text = "the user's newer copy";
        clipboardState.image = Buffer.from("new-image");
        clipboardState.custom = Buffer.from("new-custom");
        return { clipboardChanged: false };
      },
      now: () => 1_000,
    });

    await expect(capture.capture()).resolves.toMatchObject({
      text: "",
      validPrefix: false,
    });
    expect(legacyWrite).not.toHaveBeenCalled();
    expect(clipboardState).toEqual({
      text: "the user's newer copy",
      image: Buffer.from("new-image"),
      custom: Buffer.from("new-custom"),
    });
  });

  it("accepts item text when only the leading Item Class line has landed", async () => {
    let clipboardText = "clipboard before capture";
    const capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardText,
      injectCopy: () => {
        clipboardText = INCOMPLETE_ITEM;
        return { clipboardChanged: true };
      },
      now: () => 1_000,
    });

    await expect(capture.capture()).resolves.toEqual({
      text: INCOMPLETE_ITEM,
      capturedAt: 1_000,
      validPrefix: true,
    });
    expect(clipboardText).toBe(INCOMPLETE_ITEM);
  });

  it("captures the same item text that was already on the clipboard", async () => {
    let clipboardText = COMPLETE_ITEM;
    const injectCopy = vi.fn(() => ({ clipboardChanged: true }));
    const capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardText,
      injectCopy,
      now: () => 1_000,
    });

    await expect(capture.capture()).resolves.toEqual({
      text: COMPLETE_ITEM,
      capturedAt: 1_000,
      validPrefix: true,
    });
    expect(injectCopy).toHaveBeenCalledWith(expect.objectContaining({
      deadline: 1_600,
      timeoutMs: 600,
      signal: expect.any(AbortSignal),
    }));
    expect(clipboardText).toBe(COMPLETE_ITEM);
  });

  it("allows a wider first-capture deadline without slowing warmed captures", async () => {
    let clipboardText = COMPLETE_ITEM;
    const deadlines: number[] = [];
    const capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardText,
      injectCopy: ({ deadline }: { deadline: number }) => {
        deadlines.push(deadline);
        return { clipboardChanged: true };
      },
      now: () => 1_000,
      timeoutMs: (context: { cold: boolean }) => context.cold ? 1_200 : 600,
    });

    await expect(capture.capture({ cold: true })).resolves.toMatchObject({
      text: COMPLETE_ITEM,
      validPrefix: true,
    });
    clipboardText = COMPLETE_ITEM.replace("Gale Circle", "Storm Loop");
    await expect(capture.capture({ cold: false })).resolves.toMatchObject({
      text: clipboardText,
      validPrefix: true,
    });
    expect(deadlines).toEqual([2_200, 1_600]);
  });

  it("aborts a hung helper at the bounded capture deadline", async () => {
    let fireTimeout: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const capture = createOneKeyItemCapture({
      readClipboardText: vi.fn(() => "clipboard before capture"),
      injectCopy: ({ signal }: { signal: AbortSignal }) => new Promise((resolve) => {
        observedSignal = signal;
        signal.addEventListener(
          "abort",
          () => resolve({ clipboardChanged: false }),
          { once: true },
        );
      }),
      schedule: (callback: () => void) => {
        fireTimeout = callback;
        return 1;
      },
      cancelSchedule: vi.fn(),
      now: () => 1_000,
      timeoutMs: 600,
    });

    const result = capture.capture();
    await Promise.resolve();
    fireTimeout?.();
    await expect(result).resolves.toMatchObject({ text: "", validPrefix: false });
    expect(observedSignal?.aborted).toBe(true);
    expect(capture.isPending()).toBe(false);
  });

  it("returns a failed capture when native injection throws", async () => {
    const readClipboardText = vi.fn(() => "clipboard before capture");
    const capture = createOneKeyItemCapture({
      readClipboardText,
      injectCopy: () => {
        throw new Error("native injection failed");
      },
      now: () => 1_000,
    });

    await expect(capture.capture()).resolves.toEqual({
      text: "",
      capturedAt: 1_000,
      validPrefix: false,
    });
    expect(readClipboardText).not.toHaveBeenCalled();
    expect(capture.isPending()).toBe(false);
  });

  it("ignores a concurrent capture while the first helper is pending", async () => {
    let clipboardText = "clipboard before capture";
    let releaseCopy: (() => void) | undefined;
    const injectCopy = vi.fn(() => new Promise<{ clipboardChanged: boolean }>((resolve) => {
      releaseCopy = () => {
        clipboardText = COMPLETE_ITEM;
        resolve({ clipboardChanged: true });
      };
    }));
    const capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardText,
      injectCopy,
      timeoutMs: 10_000,
    });

    const firstCapture = capture.capture();
    expect(capture.isPending()).toBe(true);
    await expect(capture.capture()).resolves.toBeNull();
    expect(injectCopy).toHaveBeenCalledTimes(1);

    releaseCopy?.();
    await expect(firstCapture).resolves.toMatchObject({
      text: COMPLETE_ITEM,
      validPrefix: true,
    });
    expect(capture.isPending()).toBe(false);
  });

  it("fails closed if the target loses focus before helper completion", async () => {
    let focused = true;
    let clipboardText = "clipboard before capture";
    const capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardText,
      injectCopy: () => {
        clipboardText = COMPLETE_ITEM;
        focused = false;
        return { clipboardChanged: true };
      },
      isTargetFocused: () => focused,
      now: () => 1_000,
    });

    await expect(capture.capture()).resolves.toMatchObject({
      text: "",
      validPrefix: false,
    });
  });

  it("accepts a native foreground identity verified after the clipboard changed", async () => {
    let focused = true;
    let clipboardText = "clipboard before capture";
    const capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardText,
      injectCopy: () => {
        clipboardText = COMPLETE_ITEM;
        focused = false;
        return { clipboardChanged: true, targetIdentityVerified: true };
      },
      isTargetFocused: () => focused,
      now: () => 1_000,
    });

    await expect(capture.capture()).resolves.toMatchObject({
      text: COMPLETE_ITEM,
      validPrefix: true,
      targetIdentityVerified: true,
    });
  });

  it("does nothing when the target game is not focused", async () => {
    const readClipboardText = vi.fn(() => "clipboard before capture");
    const injectCopy = vi.fn();
    const capture = createOneKeyItemCapture({
      readClipboardText,
      injectCopy,
      isTargetFocused: () => false,
    });

    await expect(capture.capture()).resolves.toBeNull();
    expect(readClipboardText).not.toHaveBeenCalled();
    expect(injectCopy).not.toHaveBeenCalled();
  });

  it("rejects Ctrl+C capture accelerators before injecting Ctrl+C", async () => {
    const readClipboardText = vi.fn(() => "clipboard before capture");
    const injectCopy = vi.fn();
    const capture = createOneKeyItemCapture({
      readClipboardText,
      injectCopy,
      getCaptureAccelerator: () => "CommandOrControl+C",
    });

    expect(isCopyAccelerator("Ctrl+C")).toBe(true);
    expect(isCopyAccelerator("Control+C")).toBe(true);
    expect(isCopyAccelerator("CommandOrControl+C")).toBe(true);
    expect(isCopyAccelerator("Ctrl+Shift+C")).toBe(false);
    await expect(capture.capture()).resolves.toBeNull();
    expect(readClipboardText).not.toHaveBeenCalled();
    expect(injectCopy).not.toHaveBeenCalled();
  });

  it("keeps a synchronous synthetic-copy callback from recursing", async () => {
    let clipboardText = "clipboard before capture";
    let recursiveCapture: Promise<CaptureResult | null> | undefined;
    let capture: ReturnType<typeof createOneKeyItemCapture>;
    const injectCopy = vi.fn(() => {
      recursiveCapture = capture.capture();
      clipboardText = COMPLETE_ITEM;
      return { clipboardChanged: true };
    });
    capture = createOneKeyItemCapture({
      readClipboardText: () => clipboardText,
      injectCopy,
      getCaptureAccelerator: () => "Ctrl+D",
      now: () => 1_000,
    });

    await expect(capture.capture()).resolves.toMatchObject({
      text: COMPLETE_ITEM,
      validPrefix: true,
    });
    await expect(recursiveCapture).resolves.toBeNull();
    expect(injectCopy).toHaveBeenCalledTimes(1);
  });
});
