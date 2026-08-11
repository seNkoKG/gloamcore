import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { assertTrustedRemoteUrl, fetchTrustedLimited } = require(
  "../electron/bounded-remote-fetch.cjs",
) as {
  assertTrustedRemoteUrl(value: string, kind: "json" | "image"): string;
  fetchTrustedLimited(
    url: string,
    options: Record<string, unknown>,
  ): Promise<{ body: Buffer; response: Response }>;
};

function response(
  chunks: Uint8Array[],
  { url = "https://poe.ninja/poe1/api/economy/leagues", status = 200 } = {},
) {
  let index = 0;
  return {
    url,
    status,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: vi.fn(async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined }),
        cancel: vi.fn(async () => undefined),
        releaseLock: vi.fn(),
      }),
    },
  } as unknown as Response;
}

describe("bounded remote fetch", () => {
  it("allows only the exact market/wiki routes used by the app", () => {
    expect(
      assertTrustedRemoteUrl(
        "https://poe.ninja/poe1/api/economy/leagues",
        "json",
      ),
    ).toContain("poe.ninja");
    expect(
      assertTrustedRemoteUrl(
        "https://web.poecdn.com/api/currency-exchange/1786474800",
        "json",
      ),
    ).toContain("web.poecdn.com/api/currency-exchange/1786474800");
    expect(() =>
      assertTrustedRemoteUrl("https://127.0.0.1/poe1/api/economy/leagues", "json"),
    ).toThrow(/untrusted/i);
    expect(() =>
      assertTrustedRemoteUrl("https://www.poewiki.net/w/api.php", "image"),
    ).toThrow(/untrusted/i);
    expect(() =>
      assertTrustedRemoteUrl(
        "https://web.poecdn.com/api/currency-exchange/latest",
        "json",
      ),
    ).toThrow(/untrusted/i);
    expect(() =>
      assertTrustedRemoteUrl(
        "https://web.poecdn.com/api/currency-exchange/1786474800?redirect=https://example.com",
        "json",
      ),
    ).toThrow(/untrusted/i);
  });

  it("rejects a final URL outside the allowlist and disables redirects", async () => {
    const fetchImpl = vi.fn(async (_url, options: RequestInit) => {
      expect(options.redirect).toBe("error");
      return response([], { url: "https://127.0.0.1/private" });
    });
    await expect(
      fetchTrustedLimited("https://poe.ninja/poe1/api/economy/leagues", {
        kind: "json",
        label: "poe.ninja",
        maximumBytes: 64,
        timeoutMs: 1000,
        fetchImpl,
      }),
    ).rejects.toThrow(/untrusted/i);
  });

  it("stops a streamed response at the byte ceiling", async () => {
    const fetchImpl = vi.fn(async () =>
      response([new Uint8Array(5), new Uint8Array(5)]),
    );
    await expect(
      fetchTrustedLimited("https://poe.ninja/poe1/api/economy/leagues", {
        kind: "json",
        label: "poe.ninja",
        maximumBytes: 8,
        timeoutMs: 1000,
        fetchImpl,
      }),
    ).rejects.toThrow(/large/i);
  });

  it("keeps the deadline active while waiting for response headers", async () => {
    const fetchImpl = vi.fn(async (_url, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(options.signal?.reason);
        });
      }),
    );
    await expect(
      fetchTrustedLimited("https://poe.ninja/poe1/api/economy/leagues", {
        kind: "json",
        label: "poe.ninja",
        maximumBytes: 64,
        timeoutMs: 100,
        fetchImpl,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
