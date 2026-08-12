/// <reference types="node" />

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);
const COMMIT = "b".repeat(40);

function bundledSource(id: string) {
  return {
    id,
    label: id,
    kind: "bundled-pack",
    inputSha256: HASH,
    upstream: {
      project: "Awakened PoE Trade",
      repository: "https://github.com/SnosMe/awakened-poe-trade",
      commit: COMMIT,
      dataUpdatedAt: "2026-08-08",
    },
  };
}

describe("regex data builder", () => {
  it("rejects an exact fallback that collides with another tooltip family", () => {
    const directory = mkdtempSync(join(tmpdir(), "gloamcore-regex-verifier-"));
    const input = join(directory, "collision.json");
    const output = join(directory, "output.json");
    const pack = {
      schema: 1,
      game: "poe1",
      generatedAt: "2026-08-09T00:00:00.000Z",
      update: {
        command: "fixture",
        sourceUpdatedAt: "2026-08-08T00:00:00.000Z",
      },
      coverage: { bundledSources: {} },
      sources: [
        bundledSource("price-check-base-types"),
        bundledSource("price-check-stats"),
      ],
      limitations: ["Fixture."],
      entries: [
        {
          id: "entry:alpha-number",
          label: "Alpha number",
          searchText: "Alpha #",
          exact: "^alpha.*$",
          sourceIds: ["price-check-stats"],
        },
        {
          id: "entry:alphabet",
          label: "Alphabet",
          searchText: "Alphabet",
          exact: "^alphabet$",
          sourceIds: ["price-check-base-types"],
        },
      ],
      categories: [{
        id: "fixture",
        entries: [
          { entryId: "entry:alpha-number", optimized: "^alpha.*$" },
          { entryId: "entry:alphabet", optimized: "^alphabet$" },
        ],
      }],
    };

    try {
      writeFileSync(input, `${JSON.stringify(pack)}\n`, "utf8");
      const result = spawnSync(process.execPath, [
        resolve(process.cwd(), "scripts/build-regex-data.mjs"),
        "--reoptimize-existing",
        input,
        "--output",
        output,
      ], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "Exact pattern collision in full tooltip corpus: Alpha number / alphabet",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
