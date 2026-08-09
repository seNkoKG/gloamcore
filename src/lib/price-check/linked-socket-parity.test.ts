import { describe, expect, it } from "vitest";
import {
  fiveLinkedSocketsFixture,
  fourLinkedSocketsFixture,
  sixLinkedSocketsFixture,
  threeLinkedSocketsFixture,
} from "./fixtures/parser-fixtures";
import { parsePoeItem } from "./parser";
import {
  buildPriceCheckQueryPlan,
  defaultPriceCheckItemFilters,
  priceCheckItemFilterControls,
} from "./query-plan";

describe("Awakened linked-socket Trade parity", () => {
  it.each([
    [3, threeLinkedSocketsFixture, false],
    [4, fourLinkedSocketsFixture, false],
    [5, fiveLinkedSocketsFixture, true],
    [6, sixLinkedSocketsFixture, true],
  ] as const)(
    "preserves a %i-link socket group but exposes a Trade filter only for 5/6",
    (links, fixture, searchable) => {
      const item = parsePoeItem(fixture);
      const defaults = defaultPriceCheckItemFilters(item);
      const controls = priceCheckItemFilterControls(item, { exact: true });
      const plan = buildPriceCheckQueryPlan(item, "Allflame", { mode: "exact" });
      const socketFilters = (plan.tradeQuery.query as any).filters.socket_filters;

      expect(item.links).toBe(links);
      expect(item.sockets).toEqual([expect.objectContaining({ links })]);
      expect(Object.hasOwn(defaults, "links")).toBe(searchable);
      expect(controls.some((control) => control.key === "links")).toBe(searchable);
      expect(Object.hasOwn(plan.itemFilters, "links")).toBe(searchable);
      if (searchable) {
        expect(socketFilters.filters.links).toEqual({ min: links });
      } else {
        expect(socketFilters).toBeUndefined();
      }
    },
  );
});
