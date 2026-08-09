import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Trade stat-pack generator", () => {
  it("retains data-driven official ID families and drops unsafe shapes", () => {
    const accepted = [
      "explicit.stat_123",
      "crucible.mod_10038",
      "explicit.indexable_skill_1",
      "explicit.indexable_support_1",
      "mercenary.skill_10235",
      "mercenary.support_10482",
      "sanctum.sanctum_effect_11449",
      "sanctum.stat_1019656601",
      "delve.delve_abyss_socket",
      "ultimatum.umod_10506",
      "pseudo.lake_10363",
      "enchant.delirium_reward_abyss",
      "veiled.mod_11536",
      "future_family.new_stat_123",
      "explicit.stat_2460506030|38999",
    ];
    const rejected = [
      "Explicit.stat_123",
      "explicit.stat-123",
      "explicit.stat_123.extra",
      "explicit.stat_123|choice",
      "explicit.stat_123|1|2|3",
      `explicit.${"x".repeat(128)}`,
    ];
    const temporary = mkdtempSync(resolve(tmpdir(), "poe-stat-pack-"));
    const input = resolve(temporary, "stats.ndjson");
    const output = resolve(temporary, "stats.json");
    try {
      const ids = [...accepted, ...rejected];
      const lines = ids.map((id, index) => JSON.stringify({
        ref: `Fixture ${index} #`,
        better: 1,
        ...(index === 0 ? { dp: true } : {}),
        matchers: [{
          string: index === 0
            ? `Fixture ${index} #\ncontinued safely`
            : `Fixture ${index} #`,
          ...(index === 0
            ? { advanced: "unsafe\u0001matcher" }
            : index === 1
              ? { advanced: `Advanced fixture ${index} #` }
              : {}),
        }],
        trade: { ids: { explicit: [id] } },
      }));
      writeFileSync(input, `${lines.join("\n")}\n`, "utf8");
      execFileSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/build-price-check-stat-pack.mjs"), input, output],
        { stdio: "pipe" },
      );
      const pack = JSON.parse(readFileSync(output, "utf8")) as {
        schema: number;
        entries: Array<{
            candidates: Array<{
              id: string;
              dp?: true;
              matcherText: string;
              displayText?: string;
              displayMatchers?: Array<{
                text: string;
                negate?: true;
                value?: number;
              }>;
            }>;
        }>;
      };
      const generatedIds = pack.entries.flatMap((entry) =>
        entry.candidates.map((candidate) => candidate.id)
      );

      expect(pack.schema).toBe(8);
      expect(new Set(generatedIds)).toEqual(new Set(accepted));
      expect(rejected.every((id) => !generatedIds.includes(id))).toBe(true);
      expect(pack.entries.flatMap((entry) => entry.candidates)
        .find((candidate) => candidate.id === accepted[0])?.dp).toBe(true);
      expect(pack.entries.flatMap((entry) => entry.candidates)
        .find((candidate) => candidate.id === accepted[0])?.matcherText)
        .toBe("Fixture 0 #\ncontinued safely");
      expect(pack.entries.flatMap((entry) => entry.candidates)
        .some((candidate) => candidate.matcherText.includes("\u0001")))
        .toBe(false);
      expect(pack.entries.find((entry) =>
        entry.pattern === "advanced fixture # #"
      )?.candidates[0]).toMatchObject({
        matcherText: "Advanced fixture 1 #",
        displayText: "Fixture 1 #",
        displayMatchers: [{ text: "Fixture 1 #" }],
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("preserves every StatGroup resolver strategy and candidate membership", () => {
    const temporary = mkdtempSync(resolve(tmpdir(), "poe-stat-groups-"));
    const input = resolve(temporary, "stats.ndjson");
    const output = resolve(temporary, "stats.json");
    const stat = (ref: string, id: string, matcher = ref, dp = false) => ({
      ref,
      better: 1,
      ...(dp ? { dp: true } : {}),
      matchers: [{ string: matcher }],
      trade: { ids: { explicit: [id] } },
    });
    const sourceGroups = [
      {
        resolve: { strat: "select", test: [null, "WEAPON"] },
        stats: [
          stat("+# to Fixture One", "explicit.stat_101"),
          stat("+# to Fixture One", "explicit.stat_102", "+# to Fixture One", true),
        ],
      },
      {
        resolve: { strat: "trivial-merge" },
        stats: [
          stat("+# to Fixture Two", "explicit.stat_201"),
          stat("+# to Fixture Two", "explicit.stat_202"),
        ],
      },
      {
        resolve: { strat: "percent-merge", kind: ["percent", "value"] },
        stats: [
          stat("#% chance for Fixture Three", "explicit.stat_301", "Fixture Three"),
          stat("Fixture Three", "explicit.stat_302"),
        ],
      },
      {
        resolve: { strat: "flag-merge", kind: ["value", "flag"] },
        stats: [
          stat("Fixture Four at #", "explicit.stat_401"),
          stat("Fixture Four at 20", "explicit.stat_402"),
        ],
      },
    ];
    try {
      writeFileSync(
        input,
        `${sourceGroups.map((group) => JSON.stringify(group)).join("\n")}\n`,
        "utf8",
      );
      execFileSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/build-price-check-stat-pack.mjs"), input, output],
        { stdio: "pipe" },
      );
      const pack = JSON.parse(readFileSync(output, "utf8")) as {
        groups: Array<{
          id: number;
          sourceIndex: number;
          resolve: unknown;
          stats: Array<{ ref: string; dp?: true }>;
        }>;
        entries: Array<{
          groupIds?: number[];
          candidates: Array<{
            groupId?: number;
            statIndex?: number;
            matcherText: string;
          }>;
        }>;
        coverage: {
          resolverGroups: number;
          resolverStrategies: Record<string, number>;
        };
        source: { resolverGroupsSha256: string };
      };

      expect(pack.groups.map(({ id, sourceIndex, resolve, stats }) => ({
        id,
        sourceIndex,
        resolve,
        refs: stats.map((entry) => entry.ref),
      }))).toEqual(sourceGroups.map((group, index) => ({
        id: index,
        sourceIndex: index,
        resolve: group.resolve,
        refs: group.stats.map((entry) => entry.ref),
      })));
      expect(pack.coverage).toEqual({
        resolverGroups: 4,
        resolverStrategies: {
          "flag-merge": 1,
          "percent-merge": 1,
          select: 1,
          "trivial-merge": 1,
        },
      });
      expect(pack.groups[0].stats[1].dp).toBe(true);
      expect(pack.source.resolverGroupsSha256).toBe(
        createHash("sha256").update(JSON.stringify(pack.groups)).digest("hex"),
      );
      for (const group of pack.groups) {
        expect(pack.entries.some((entry) =>
          entry.groupIds?.includes(group.id) &&
          entry.candidates.some((candidate) => candidate.groupId === group.id)
        )).toBe(true);
      }
      expect(pack.entries.flatMap((entry) => entry.candidates)
        .every((candidate) => candidate.matcherText.length > 0)).toBe(true);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
