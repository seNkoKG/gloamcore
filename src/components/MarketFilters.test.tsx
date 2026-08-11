import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { categories } from "../config/categories";
import { defaultFiltersForSource, emptyFilters } from "../lib/economy";
import type { DataSource, EconomyRow } from "../types";
import { MarketFilters } from "./MarketFilters";

function render(
  categoryId: string,
  source?: DataSource,
  rows: EconomyRow[] = [],
) {
  const category = categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error(`Missing category fixture: ${categoryId}`);
  return renderToStaticMarkup(
    <MarketFilters
      category={category}
      source={source || (category.source === "item" ? "stash-item" : "exchange")}
      rows={rows}
      filters={source ? defaultFiltersForSource(source) : { ...emptyFilters }}
      display="adaptive"
      resultCount={0}
      onSource={vi.fn()}
      onFilters={vi.fn()}
      onDisplay={vi.fn()}
    />,
  );
}

describe("market source selection", () => {
  it("keeps both supported data sources reachable when Faustus is unavailable", () => {
    const markup = render("currency");
    expect(markup).toContain("Pricing source");
    expect(markup).toContain(">Ninja<");
    expect(markup).toContain(">Stash<");
    expect(markup).not.toContain(">Faustus<");
  });

  it("does not show a meaningless source selector for item-only categories", () => {
    expect(render("unique-jewels")).not.toContain("Pricing source");
  });

  it("shows thin official Faustus markets by default with an explicit guard", () => {
    const row = {
      id: "awakeners-orb",
      key: "currency:faustus:awakeners-orb",
      name: "Awakener's Orb",
      categoryId: "currency",
      categoryLabel: "Currency",
      source: "faustus",
      chaosValue: 100,
      divineValue: 0.5,
      change: null,
      sparkline: [null],
      volume: 2,
      listingCount: null,
      observationCount: null,
      implicitModifiers: [],
      explicitModifiers: [],
      mutatedModifiers: [],
      lowConfidence: true,
      confidenceReason: "Only 2 item units traded in the completed hour",
    } satisfies EconomyRow;

    const markup = render("currency", "faustus", [row]);
    expect(markup).toContain("guarded completed-hour");
    expect(markup).toContain("shown with warnings");
    expect(markup).toContain("excluded from movers and trends");
    expect(markup).not.toContain("estimate hidden");
  });
});
