import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MobileEconomyList } from "./MobileEconomyList";

describe("MobileEconomyList", () => {
  it("renders an actionable status when filters produce no rows", () => {
    const markup = renderToStaticMarkup(
      <MobileEconomyList
        source="stash-item"
        rows={[]}
        visibleRows={[]}
        display="adaptive"
        density="compact"
        sort={{ key: "value", direction: "desc" }}
        watchKeys={new Set()}
        onSort={() => undefined}
        onSelect={() => undefined}
        onWatch={() => undefined}
        onTrade={() => undefined}
        onClearFilters={() => undefined}
        onShowMore={() => undefined}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("No matching prices");
    expect(markup).toContain("Clear filters");
    expect(markup).toContain('aria-pressed="true"');
  });
});
