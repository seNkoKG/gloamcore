import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CompactTradeListings,
  formatTradeListingAge,
  formatTradeListingAmount,
  type CompactTradeListingRow,
} from "./CompactTradeListings";

const NOW = Date.UTC(2026, 7, 2, 18, 0, 0);

function row(index: number, overrides: Partial<CompactTradeListingRow> = {}): CompactTradeListingRow {
  return {
    id: `listing-${index}`,
    amount: index + 1,
    currency: "divine",
    indexedAt: NOW - index * 60_000,
    seller: `Account${index}`,
    character: `Character${index}`,
    itemName: "Mageblood",
    baseType: "Heavy Belt",
    ...overrides,
  };
}

describe("compact trade listing formatting", () => {
  it("formats prices without losing meaningful decimals", () => {
    expect(formatTradeListingAmount(1.25)).toBe("1.25");
    expect(formatTradeListingAmount(" 12.50 ")).toBe("12.5");
    expect(formatTradeListingAmount(1_250)).toBe("1.25k");
    expect(formatTradeListingAmount(1_250_000)).toBe("1.25m");
    expect(formatTradeListingAmount("")).toBe("—");
  });

  it("uses compact deterministic listing ages", () => {
    expect(formatTradeListingAge(NOW, NOW)).toBe("NOW");
    expect(formatTradeListingAge(NOW - 17 * 60_000, NOW)).toBe("17M");
    expect(formatTradeListingAge(NOW - 4 * 60 * 60_000, NOW)).toBe("4H");
    expect(formatTradeListingAge(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3D");
    expect(formatTradeListingAge("not-a-date", NOW)).toBe("—");
  });
});

describe("CompactTradeListings", () => {
  it("renders every adaptively fetched price, seller, and age row", () => {
    const markup = renderToStaticMarkup(
      <CompactTradeListings
        rows={Array.from({ length: 12 }, (_value, index) => row(index))}
        total={37}
        now={NOW}
        onRetry={() => undefined}
        onOpenTrade={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Live seller listings"');
    expect(markup).toContain('aria-label="37 seller listings"');
    expect(markup).toContain(">12/37<");
    expect(markup.match(/<tr title=/g)).toHaveLength(12);
    expect(markup).toContain(">Character0<");
    expect(markup).toContain(">NOW<");
    expect(markup).toContain(">7M<");
    expect(markup).toContain("Character11");
    expect(markup).toContain('aria-label="Retry seller listings"');
    expect(markup).toContain('aria-label="Open official Trade results"');
  });

  it("supports a smaller overlay row budget without changing the true total", () => {
    const markup = renderToStaticMarkup(
      <CompactTradeListings
        rows={Array.from({ length: 8 }, (_value, index) => row(index))}
        total={37}
        limit={3}
        now={NOW}
      />,
    );

    expect(markup.match(/<tr title=/g)).toHaveLength(3);
    expect(markup).toContain(">3/37<");
    expect(markup).not.toContain("Character3");
  });

  it("pads a short explicit overlay budget with noninteractive striped rows", () => {
    const markup = renderToStaticMarkup(
      <CompactTradeListings
        rows={Array.from({ length: 3 }, (_value, index) => row(index))}
        total={37}
        limit={5}
        now={NOW}
      />,
    );

    expect(markup.match(/<tr title=/g)).toHaveLength(3);
    expect(markup.match(/class="ctl-placeholder" aria-hidden="true"/g)).toHaveLength(2);
    expect(markup).toContain(">3/37<");
  });

  it("keeps account context in a title and safely escapes untrusted labels", () => {
    const markup = renderToStaticMarkup(
      <CompactTradeListings
        rows={[row(0, {
          character: "A very long <character>",
          seller: "Account & Co",
          itemName: 'Mageblood "Foil"',
          currency: "divine & chaos",
        })]}
        total={1}
        now={NOW}
      />,
    );

    expect(markup).toContain("A very long &lt;character&gt;");
    expect(markup).toContain("Account &amp; Co");
    expect(markup).toContain("divine &amp; chaos");
    expect(markup).not.toContain("<character>");
    expect(markup).toContain("Mageblood &quot;Foil&quot; — Heavy Belt");
  });

  it("shows seller-collapse counts and exact legacy bulk ratios", () => {
    const grouped = renderToStaticMarkup(
      <CompactTradeListings
        rows={[row(0, { groupedCount: 12, stock: 60 })]}
        total={20}
        now={NOW}
      />,
    );
    const exchange = renderToStaticMarkup(
      <CompactTradeListings
        rows={[row(0, {
          amount: 3,
          currency: "chaos",
          exchange: { haveAmount: 9, itemAmount: 3, stock: 120 },
        })]}
        total={1}
        now={NOW}
      />,
    );

    expect(grouped).toContain("×12");
    expect(grouped).toContain("12 same-seller listings; 60 total stock");
    expect(exchange).toContain(">9/3<");
    expect(exchange).toContain("9 chaos for 3 items; stock 120");
  });

  it("preserves rows while clearly marking stale and error states", () => {
    const staleMarkup = renderToStaticMarkup(
      <CompactTradeListings rows={[row(0)]} total={1} stale now={NOW} />,
    );
    const errorMarkup = renderToStaticMarkup(
      <CompactTradeListings
        rows={[row(0)]}
        total={1}
        error="Trade service unavailable"
        now={NOW}
        onRetry={() => undefined}
      />,
    );

    expect(staleMarkup).toContain('data-state="stale"');
    expect(staleMarkup).toContain(">STALE<");
    expect(staleMarkup).toContain(">Character0<");
    expect(errorMarkup).toContain('data-state="error"');
    expect(errorMarkup).toContain('title="Trade service unavailable"');
    expect(errorMarkup).toContain(">Character0<");
  });

  it("labels cached rows stale when a refresh error accompanies them", () => {
    const markup = renderToStaticMarkup(
      <CompactTradeListings
        rows={[row(0)]}
        total={1}
        stale
        error="Rate limited; showing cached rows"
        now={NOW}
      />,
    );

    expect(markup).toContain('data-state="stale"');
    expect(markup).toContain(">STALE<");
    expect(markup).toContain('title="Rate limited; showing cached rows"');
    expect(markup).toContain(">Character0<");
  });

  it("uses a tiny non-verbose empty state and disables retry while loading", () => {
    const loadingMarkup = renderToStaticMarkup(
      <CompactTradeListings
        rows={[]}
        total={0}
        loading
        onRetry={() => undefined}
      />,
    );
    const emptyMarkup = renderToStaticMarkup(
      <CompactTradeListings rows={[]} total={Number.NaN} />,
    );

    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(loadingMarkup).toContain("disabled");
    expect(loadingMarkup).toContain(">LOADING<");
    expect(emptyMarkup).toContain(">NO RESULTS<");
    expect(emptyMarkup).toContain('aria-label="0 seller listings"');
  });

  it("uses the explicit loading capacity instead of a separate empty block", () => {
    const markup = renderToStaticMarkup(
      <CompactTradeListings rows={[]} total={0} loading limit={4} />,
    );

    expect(markup.match(/class="ctl-placeholder" aria-hidden="true"/g)).toHaveLength(4);
    expect(markup).not.toContain('class="ctl-empty"');
    expect(markup).toContain(">LOADING<");
  });
});
