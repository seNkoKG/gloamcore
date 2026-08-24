import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EconomyRow, KnowledgeEntry } from "../types";
import { DetailsDrawer } from "./DetailsDrawer";
import { KnowledgeDrawer } from "./KnowledgeDrawer";

vi.mock("../lib/bridge", () => ({ bridge: {} }));

const row: EconomyRow = {
  key: "currency:exchange:divine",
  id: "divine",
  name: "Divine Orb",
  categoryId: "currency",
  categoryLabel: "Currency",
  source: "exchange",
  chaosValue: 200,
  divineValue: 1,
  change: 2,
  sparkline: [0, 1, 2],
  volume: 100,
  listingCount: null,
  observationCount: null,
  implicitModifiers: [],
  explicitModifiers: [],
  mutatedModifiers: [],
  lowConfidence: false,
};

const knowledge: KnowledgeEntry = {
  key: "item:divine",
  kind: "item",
  name: "Divine Orb",
  dropAreas: [],
  dropMonsters: [],
  acquisitionTags: [],
  modifierGroups: [],
  tags: [],
  source: "poewiki",
};

describe("drawer dialog semantics", () => {
  it("marks mobile/compact market details as modal and names its close action", () => {
    const markup = renderToStaticMarkup(
      <DetailsDrawer
        row={row}
        league="Standard"
        modal
        onClose={() => undefined}
        onToggleWatch={() => undefined}
        onSaveWatch={() => undefined}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="market-details-dialog-title"');
    expect(markup).toContain('aria-label="Close details"');
  });

  it("uses the same conditional dialog contract for knowledge details", () => {
    const markup = renderToStaticMarkup(
      <KnowledgeDrawer
        entry={knowledge}
        modal
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="knowledge-details-dialog-title"');
  });
});
