import { describe, expect, it, vi } from "vitest";
import { fetchBoundedToolkitText } from "./bounded-text-fetch";

describe("bounded toolkit text fetch", () => {
  it("uses a no-redirect, credential-free request and returns streamed UTF-8", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init).toMatchObject({ redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
      return new Response(new TextEncoder().encode("hello"), { status: 200 });
    });
    await expect(fetchBoundedToolkitText("https://pobb.in/example", { fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toBe("hello");
  });

  it("rejects oversized chunked bodies even without Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body));
    await expect(fetchBoundedToolkitText("https://pobb.in/example", {
      fetchImpl: fetchImpl as typeof fetch,
      maximumBytes: 4,
    })).rejects.toThrow(/safety limit/);
  });

  it("rejects a changed final URL", async () => {
    const response = new Response("redirected");
    Object.defineProperty(response, "url", { value: "https://pobb.in/other" });
    const fetchImpl = vi.fn(async () => response);
    await expect(fetchBoundedToolkitText("https://pobb.in/example", { fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toThrow(/redirects/);
  });
});
