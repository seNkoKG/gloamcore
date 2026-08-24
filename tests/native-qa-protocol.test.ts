import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { nativeQaAckMatches } = require("../electron/native-qa-protocol.cjs") as {
  nativeQaAckMatches(
    ack: unknown,
    phase: string,
    expected?: Record<string, unknown>,
  ): boolean;
};

describe("native QA acknowledgement protocol", () => {
  it("correlates both the phase and nonce", () => {
    const ack = {
      phase: "target-focused-after-close",
      nonce: "a".repeat(32),
      hwnd: "1234",
    };
    expect(nativeQaAckMatches(ack, ack.phase, { nonce: ack.nonce })).toBe(true);
    expect(nativeQaAckMatches(ack, "target-focused", { nonce: ack.nonce })).toBe(false);
    expect(nativeQaAckMatches(ack, ack.phase, { nonce: "b".repeat(32) })).toBe(false);
    expect(nativeQaAckMatches(null, ack.phase, { nonce: ack.nonce })).toBe(false);
  });
});
