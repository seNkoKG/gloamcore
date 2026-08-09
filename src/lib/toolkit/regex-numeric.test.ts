import { describe, expect, it } from "vitest";
import { minimumNumberRegex } from "./regex-numeric";

function matches(minimum: number, value: string | number) {
  return new RegExp(`^(?:${minimumNumberRegex(minimum)})$`).test(String(value));
}

describe("minimumNumberRegex", () => {
  it(
    "matches every canonical integer on the correct side of exhaustive boundaries",
    () => {
      for (let minimum = 0; minimum <= 500; minimum += 1) {
        for (let value = 0; value <= 1_000; value += 1) {
          expect(matches(minimum, value), `${value} >= ${minimum}`).toBe(
            value >= minimum,
          );
        }
      }
    },
    15_000,
  );

  it("handles digit-boundary and large safe-integer thresholds", () => {
    for (const minimum of [9, 10, 11, 99, 100, 101, 999, 1_000, 9_999, 10_000, 9_007_199_254_740_000]) {
      expect(matches(minimum, minimum - 1)).toBe(false);
      expect(matches(minimum, minimum)).toBe(true);
      expect(matches(minimum, minimum + 1)).toBe(true);
    }
  });

  it("accepts only canonical non-negative integer text", () => {
    for (const value of ["", "-1", "+1", "01", "1.0", "1e3", " 1"] ) {
      expect(matches(0, value)).toBe(false);
    }
    expect(matches(0, 0)).toBe(true);
    expect(matches(1, 0)).toBe(false);
  });

  it("rejects thresholds that cannot describe the supported integer domain", () => {
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => minimumNumberRegex(value)).toThrow(RangeError);
    }
  });
});
