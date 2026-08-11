import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { categories } from "../config/categories";
import { MarketHeader } from "./MarketHeader";

describe("Faustus market freshness", () => {
  it("communicates frequent checks without claiming sub-hour source prices", () => {
    const markup = renderToStaticMarkup(
      <MarketHeader
        category={categories[0]}
        source="faustus"
        league="Allflame"
        leagues={[{ id: "Allflame", name: "Allflame" }]}
        fetchedAt={Date.parse("2026-08-11T19:00:00Z")}
        expiresAt={Date.parse("2026-08-11T21:02:00Z")}
        stale={false}
        loading={false}
        rowCount={102}
        alertCount={0}
        onLeague={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(markup).toContain("checks every 5m");
    expect(markup).toContain("Official completed-hour snapshots");
    expect(markup).toContain("1m catch-up");
    expect(markup).not.toContain("automatic hourly refresh");
  });
});
