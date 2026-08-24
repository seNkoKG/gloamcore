import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { categories } from "../config/categories";
import {
  MobileBottomNav,
  MobileCategorySheet,
  MobileMoreSheet,
  MobileTopbar,
} from "./MobileNavigation";

describe("mobile navigation accessibility", () => {
  it("uses truthful planner copy without rendering a no-op brand button", () => {
    const markup = renderToStaticMarkup(
      <MobileTopbar
        category={categories[0]}
        league="Standard"
        loading={false}
        mode="planner"
        categoryOpen={false}
        onCategories={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(markup).toContain("BUILD SNAPSHOTS");
    expect(markup).toContain("Build Upgrade");
    expect(markup).toContain("Snapshot comparison");
    expect(markup).toContain('class="mobile-brand mobile-brand--static"');
    expect(markup).not.toContain("Choose economy category");
  });

  it("marks the active workspace and exposes More as a dialog trigger", () => {
    const markup = renderToStaticMarkup(
      <MobileBottomNav
        mode="toolkit"
        watchCount={2}
        alertCount={0}
        moreOpen={false}
        settingsOpen={false}
        onMarket={() => undefined}
        onPriceCheck={() => undefined}
        onKnowledge={() => undefined}
        onCommand={() => undefined}
        onWatchlist={() => undefined}
        onMore={() => undefined}
      />,
    );

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-controls="mobile-more-dialog"');
    expect(markup).toContain("More");
    expect(markup).not.toContain(">Settings</span>");
  });

  it("renders labelled modal sheets and an accessible category search", () => {
    const categoryMarkup = renderToStaticMarkup(
      <MobileCategorySheet
        open
        selectedId={categories[0].id}
        recentIds={[]}
        onClose={() => undefined}
        onSelect={() => undefined}
      />,
    );
    const moreMarkup = renderToStaticMarkup(
      <MobileMoreSheet
        open
        mode="market"
        onClose={() => undefined}
        onMode={() => undefined}
        onSettings={() => undefined}
      />,
    );

    expect(categoryMarkup).toContain('id="mobile-category-dialog"');
    expect(categoryMarkup).toContain('role="dialog"');
    expect(categoryMarkup).toContain('aria-modal="true"');
    expect(categoryMarkup).toContain('aria-label="Search economy categories"');
    expect(categoryMarkup).toContain('aria-current="true"');
    expect(moreMarkup).toContain('id="mobile-more-dialog"');
    expect(moreMarkup).toContain("Build Upgrade");
    expect(moreMarkup).toContain("Player Toolkit");
    expect(moreMarkup).toContain("Settings");
  });
});
