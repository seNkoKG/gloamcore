import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createRendererCommandQueue } = require(
  "../electron/renderer-command-queue.cjs",
) as {
  createRendererCommandQueue(options?: { channel?: string; maxSize?: number }): {
    markLoading(window: FakeWindow): void;
    markReady(window: FakeWindow): number;
    send(window: FakeWindow, command: unknown): boolean;
    pendingCount(): number;
  };
};

type FakeWindow = {
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>;
    isLoadingMainFrame: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
};

function fakeWindow(loading = false): FakeWindow {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      isLoadingMainFrame: vi.fn(() => loading),
      send: vi.fn(),
    },
  };
}

describe("renderer command queue", () => {
  it("holds startup commands until the renderer has subscribed", () => {
    const queue = createRendererCommandQueue();
    const window = fakeWindow(false);
    const command = { type: "open-price-check-dashboard" };

    expect(queue.send(window, command)).toBe(false);
    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(queue.markReady(window)).toBe(1);
    expect(window.webContents.send).toHaveBeenCalledWith("shortcut", command);
  });

  it("queues commands again across a renderer reload", () => {
    const queue = createRendererCommandQueue();
    const window = fakeWindow(false);
    queue.markReady(window);
    queue.markLoading(window);

    const command = { type: "open-watchlist" };
    expect(queue.send(window, command)).toBe(false);
    expect(queue.markReady(window)).toBe(1);
    expect(window.webContents.send).toHaveBeenCalledWith("shortcut", command);
  });

  it("bounds commands accumulated while the dashboard is unavailable", () => {
    const queue = createRendererCommandQueue({ maxSize: 2 });
    const window = fakeWindow(false);
    queue.send(window, { type: "first" });
    queue.send(window, { type: "second" });
    queue.send(window, { type: "last" });

    expect(queue.pendingCount()).toBe(2);
    queue.markReady(window);
    expect(window.webContents.send.mock.calls.map((call) => call[1])).toEqual([
      { type: "second" },
      { type: "last" },
    ]);
  });

  it("requeues a command when an apparently ready renderer throws", () => {
    const queue = createRendererCommandQueue();
    const window = fakeWindow(false);
    queue.markReady(window);
    window.webContents.send.mockImplementationOnce(() => {
      throw new Error("renderer gone");
    });

    const command = { type: "open-watchlist" };
    expect(queue.send(window, command)).toBe(false);
    expect(queue.pendingCount()).toBe(1);

    expect(queue.markReady(window)).toBe(1);
    expect(window.webContents.send).toHaveBeenLastCalledWith("shortcut", command);
  });

  it("keeps the failed and remaining flush commands in order", () => {
    const queue = createRendererCommandQueue();
    const window = fakeWindow(false);
    const first = { type: "first" };
    const second = { type: "second" };
    queue.send(window, first);
    queue.send(window, second);
    window.webContents.send.mockImplementationOnce(() => {
      throw new Error("renderer gone");
    });

    expect(queue.markReady(window)).toBe(0);
    expect(queue.pendingCount()).toBe(2);
    expect(queue.markReady(window)).toBe(2);
    expect(window.webContents.send.mock.calls.slice(-2).map((call) => call[1])).toEqual([
      first,
      second,
    ]);
  });
});
