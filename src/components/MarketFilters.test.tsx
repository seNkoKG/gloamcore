import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { categories } from "../config/categories";
import { emptyFilters } from "../lib/economy";
import { MarketFilters } from "./MarketFilters";

function render(categoryId: string) {
  const category = categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error(`Missing category fixture: ${categoryId}`);
  return renderToStaticMarkup(
    <MarketFilters
      category={category}
      source={category.source === "item" ? "stash-item" : "exchange"}
      rows={[]}
      filters={{ ...emptyFilters }}
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
});
