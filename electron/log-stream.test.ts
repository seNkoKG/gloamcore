import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { protectLogStream } = require("./log-stream.cjs") as {
  protectLogStream: (stream: unknown) => boolean;
};

describe("main-process log streams", () => {
  it("consumes a detached pipe error without duplicating listeners", () => {
    const stream = new EventEmitter();

    expect(protectLogStream(stream)).toBe(true);
    expect(protectLogStream(stream)).toBe(false);
    expect(stream.listenerCount("error")).toBe(1);
    expect(() => {
      stream.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
    }).not.toThrow();
  });

  it("ignores unavailable streams", () => {
    expect(protectLogStream(undefined)).toBe(false);
    expect(protectLogStream({})).toBe(false);
  });
});
