import { describe, expect, it } from "vitest";
import {
  moveBaseType,
  findMatchingFilterBlocks,
  parseItemFilter,
  removeBlockAction,
  replayFilterIntents,
  serializeItemFilter,
  setBlockAction,
  setBlockVisibility,
  validateItemFilter,
} from "./item-filter";

const sample = [
  "# name: Test Filter",
  "# tier: Valuable",
  "Show",
  '    Class "Currency"',
  '    BaseType == "Divine Orb" "Mirror of Kalandra"',
  "    SetFontSize 45",
  "",
  "# tier: Supplies",
  "Hide",
  '    Class "Currency"',
  '    BaseType == "Chromatic Orb"',
  "    SetTextColor 120 120 120 255",
  "",
].join("\r\n");

describe("item filter editor", () => {
  it("parses blocks, authored operators, tier comments, and CRLF", () => {
    const document = parseItemFilter(sample);
    expect(document.eol).toBe("\r\n");
    expect(document.blocks.map((block) => block.tier)).toEqual([
      "Valuable",
      "Supplies",
    ]);
    expect(document.blocks[0].statements[1]).toMatchObject({
      key: "BaseType",
      operator: "==",
      values: ["Divine Orb", "Mirror of Kalandra"],
    });
  });

  it("changes visibility and actions without losing valid structure", () => {
    let document = parseItemFilter(sample);
    document = setBlockVisibility(document, document.blocks[1].id, "Show");
    document = setBlockAction(document, document.blocks[1].id, "SetFontSize", ["38"]);
    const output = serializeItemFilter(document);
    expect(output).toContain("# tier: Supplies\r\nShow");
    expect(output).toContain("    SetFontSize 38");
    expect(validateItemFilter(parseItemFilter(output))).toEqual([]);
  });

  it("preserves an authored action's indentation and inline comment when editing it", () => {
    let document = parseItemFilter("Show\n\tSetFontSize 30 # keep this note\n");
    document = setBlockAction(document, document.blocks[0].id, "SetFontSize", ["40"]);
    expect(serializeItemFilter(document)).toContain("\tSetFontSize 40 # keep this note");
  });

  it("removes an authored effect without disturbing neighbouring lines", () => {
    let document = parseItemFilter(sample);
    document = removeBlockAction(document, document.blocks[1].id, "SetTextColor");
    const output = serializeItemFilter(document);
    expect(output).not.toContain("SetTextColor");
    expect(output).toContain('BaseType == "Chromatic Orb"');
  });

  it("moves only the selected base and can replay the intent after refresh", () => {
    const original = parseItemFilter(sample);
    const moved = moveBaseType(
      original,
      original.blocks[0].id,
      "Divine Orb",
      "Supplies",
    );
    const serialized = serializeItemFilter(moved);
    expect(serialized).toContain('BaseType == "Mirror of Kalandra"');
    expect(serialized).toContain('BaseType == "Chromatic Orb" "Divine Orb"');

    const intent = {
      kind: "move-base" as const,
      blockId: original.blocks[0].id,
      tier: "Valuable",
      baseType: "Divine Orb",
      targetTier: "Supplies",
      createdAt: 1,
    };
    const replay = replayFilterIntents(parseItemFilter(sample), [intent]);
    expect(replay.applied).toEqual([intent]);
    expect(replay.skipped).toEqual([]);
  });

  it("does not replay a stale move onto a missing base", () => {
    const document = parseItemFilter(sample.replace(' "Divine Orb"', ""));
    const replay = replayFilterIntents(document, [
      {
        kind: "move-base",
        blockId: "old",
        tier: "Valuable",
        baseType: "Divine Orb",
        targetTier: "Supplies",
        createdAt: 1,
      },
    ]);
    expect(replay.applied).toHaveLength(0);
    expect(replay.skipped[0]?.reason).toContain("no longer");
  });

  it("matches in file order and does not auto-pass unknown conditions", () => {
    const document = parseItemFilter(sample);
    const results = findMatchingFilterBlocks(document, {
      itemClass: "Currency",
      baseType: "Divine Orb",
      rarity: "Currency",
    });
    expect(results[0]).toMatchObject({ matches: true, firstMatch: true });
    expect(results[1]).toMatchObject({ matches: false, firstMatch: false });

    const unknown = parseItemFilter("Show\n    FutureCondition True\n");
    expect(
      findMatchingFilterBlocks(unknown, {
        itemClass: "Currency",
        baseType: "Divine Orb",
        rarity: "Currency",
      })[0],
    ).toMatchObject({ matches: false, hasUnknowns: true });
  });

  it("preserves inline block comments and gives repeated blocks unique identities", () => {
    const text = [
      "Show # $type->currency $tier->high",
      '    BaseType "Divine Orb"',
      "Show # $type->currency $tier->high",
      '    BaseType "Mirror of Kalandra"',
    ].join("\n");
    const document = parseItemFilter(text);
    expect(document.blocks.map((block) => block.tier)).toEqual(["high", "high"]);
    expect(new Set(document.blocks.map((block) => block.id)).size).toBe(2);
    const edited = setBlockVisibility(document, document.blocks[1].id, "Hide");
    expect(serializeItemFilter(edited)).toBe([
      "Show # $type->currency $tier->high",
      '    BaseType "Divine Orb"',
      "Hide # $type->currency $tier->high",
      '    BaseType "Mirror of Kalandra"',
    ].join("\n"));
  });

  it("round-trips authored header spacing and changes only its visibility token", () => {
    const text = '  Show   #$type->currency  $tier->high\r\n    BaseType "Divine Orb"\r\n';
    const document = parseItemFilter(text);
    expect(serializeItemFilter(document)).toBe(text);
    expect(serializeItemFilter(setBlockVisibility(
      document,
      document.blocks[0].id,
      "Hide",
    ))).toBe(text.replace("Show", "Hide"));
  });

  it("keeps semantic block identities stable after an unrelated insertion", () => {
    const original = parseItemFilter(sample);
    const originalId = original.blocks.find((block) => block.tier === "Supplies")?.id;
    const updated = parseItemFilter([
      "# tier: New section",
      "Show",
      '    BaseType "Orb of Chance"',
      sample,
    ].join("\r\n"));
    expect(updated.blocks.find((block) => block.tier === "Supplies")?.id).toBe(originalId);
  });

  it("keeps identity across appearance edits and distinguishes same-base thresholds", () => {
    const original = parseItemFilter([
      "# tier: Same",
      "Show",
      '    BaseType "Ruby Ring"',
      "    ItemLevel >= 80",
      "# tier: Same",
      "Show",
      '    BaseType "Ruby Ring"',
      "    ItemLevel >= 70",
    ].join("\n"));
    const edited = parseItemFilter(serializeItemFilter(setBlockVisibility(
      original,
      original.blocks[0].id,
      "Hide",
    )));
    expect(edited.blocks[0].id).toBe(original.blocks[0].id);

    const updated = parseItemFilter([
      "# tier: Same",
      "Show",
      '    BaseType "Ruby Ring"',
      "    ItemLevel >= 90",
      serializeItemFilter(original),
    ].join("\n"));
    expect(updated.blocks.find((block) => block.statements.some((statement) => statement.key === "ItemLevel" && statement.values[0] === "80"))?.id).toBe(original.blocks[0].id);
    expect(updated.blocks.find((block) => block.statements.some((statement) => statement.key === "ItemLevel" && statement.values[0] === "70"))?.id).toBe(original.blocks[1].id);
  });

  it("refuses to replay an ordinal ID shared by identical block fingerprints", () => {
    const document = parseItemFilter([
      "# tier: Same",
      "Show",
      '    BaseType "Ruby Ring"',
      "# tier: Same",
      "Show",
      '    BaseType "Ruby Ring"',
    ].join("\n"));
    const intent = {
      kind: "visibility" as const,
      blockId: document.blocks[1].id,
      tier: "Same",
      value: "Hide" as const,
      createdAt: 1,
    };
    const replay = replayFilterIntents(document, [intent]);
    expect(replay.applied).toEqual([]);
    expect(replay.skipped[0]?.reason).toContain("ambiguous");
    expect(replay.document.blocks.map((block) => block.visibility)).toEqual(["Show", "Show"]);
  });

  it("skips an ambiguous tier fallback instead of mutating an arbitrary block", () => {
    const document = parseItemFilter([
      "# tier: Same",
      "Show",
      '    BaseType "Divine Orb"',
      "# tier: Same",
      "Hide",
      '    BaseType "Mirror of Kalandra"',
    ].join("\n"));
    const replay = replayFilterIntents(document, [{
      kind: "visibility",
      blockId: "stale-id",
      tier: "Same",
      value: "Minimal",
      createdAt: 1,
    }]);
    expect(replay.applied).toHaveLength(0);
    expect(replay.skipped[0]?.reason).toContain("ambiguous");
    expect(replay.document.blocks.map((block) => block.visibility)).toEqual(["Show", "Hide"]);
  });

  it("parses official negative operators and rarity ordering", () => {
    const document = parseItemFilter([
      "Show",
      '    BaseType != "Scroll of Wisdom"',
      "    Rarity > Magic",
    ].join("\n"));
    expect(document.blocks[0].statements.map((statement) => statement.operator)).toEqual(["!=", ">"]);
    expect(findMatchingFilterBlocks(document, {
      itemClass: "Body Armours",
      baseType: "Vaal Regalia",
      rarity: "rare",
    })[0]).toMatchObject({ matches: true, hasUnknowns: false });
    expect(findMatchingFilterBlocks(document, {
      itemClass: "Currency",
      baseType: "Scroll of Wisdom",
      rarity: "currency",
    })[0]).toMatchObject({ matches: false });
  });

  it("evaluates socket colour and linked-group conditions from copied item facts", () => {
    const document = parseItemFilter([
      "Show",
      "    Sockets >= 6GGG",
      "    SocketGroup >= 5RGB",
    ].join("\n"));
    expect(findMatchingFilterBlocks(document, {
      itemClass: "Body Armours",
      baseType: "Vaal Regalia",
      rarity: "rare",
      sockets: 6,
      socketGroups: [["R", "G", "G", "G", "B"], ["W"]],
    })[0]).toMatchObject({ matches: true, hasUnknowns: false });
  });

  it("removes a source block when moving its final BaseType would broaden it", () => {
    const document = parseItemFilter([
      "# tier: Source",
      "Show",
      '    Class "Currency"',
      '    BaseType "Divine Orb"',
      "# tier: Target",
      "Show",
      '    BaseType "Mirror of Kalandra"',
    ].join("\n"));
    const moved = moveBaseType(
      document,
      document.blocks[0].id,
      "Divine Orb",
      document.blocks[1].id,
    );
    expect(moved.blocks).toHaveLength(1);
    expect(serializeItemFilter(moved)).toContain('BaseType "Mirror of Kalandra" "Divine Orb"');
    expect(serializeItemFilter(moved)).not.toContain('Class "Currency"');
    expect(parseItemFilter(serializeItemFilter(moved)).blocks[0].tier).toBe("Target");
  });

  it("never treats a negative BaseType condition as a movable inclusion", () => {
    const document = parseItemFilter([
      "Show",
      '    BaseType != "Scroll of Wisdom"',
      "Show",
      '    BaseType "Divine Orb"',
    ].join("\n"));
    expect(moveBaseType(
      document,
      document.blocks[0].id,
      "Scroll of Wisdom",
      document.blocks[1].id,
    )).toBe(document);
  });

  it("does not claim a move when another target BaseType conjunct excludes it", () => {
    const document = parseItemFilter([
      "# tier: Source",
      "Show",
      '    BaseType == "Ruby Ring" "Diamond Ring"',
      "# tier: Target",
      "Show",
      '    BaseType "Ring"',
      '    BaseType == "Diamond Ring"',
    ].join("\n"));
    expect(moveBaseType(
      document,
      document.blocks[0].id,
      "Ruby Ring",
      document.blocks[1].id,
    )).toBe(document);

    const intent = {
      kind: "move-base" as const,
      blockId: document.blocks[0].id,
      tier: "Source",
      baseType: "Ruby Ring",
      targetTier: "Target",
      targetBlockId: document.blocks[1].id,
      createdAt: 1,
    };
    const replay = replayFilterIntents(document, [intent]);
    expect(replay.applied).toEqual([]);
    expect(replay.skipped[0]?.reason).toContain("cannot satisfy");
  });

  it("does not move a base into a target negative condition that excludes it", () => {
    const document = parseItemFilter([
      "# tier: Source",
      "Show",
      '    BaseType "Ruby Ring" "Diamond Ring"',
      "# tier: Target",
      "Show",
      '    BaseType "Ring"',
      '    BaseType != "Ruby"',
    ].join("\n"));
    expect(moveBaseType(
      document,
      document.blocks[0].id,
      "Ruby Ring",
      document.blocks[1].id,
    )).toBe(document);
  });

  it("matches all authored equality rarity values and stops after a terminal block", () => {
    const rarity = parseItemFilter('Show\n    Rarity = "Magic" "Rare"\n');
    expect(findMatchingFilterBlocks(rarity, {
      itemClass: "Rings",
      baseType: "Ruby Ring",
      rarity: "rare",
    })[0]).toMatchObject({ matches: true });

    const continued = parseItemFilter([
      "Show",
      '    Class "Rings"',
      "    Continue",
      "Show",
      '    BaseType "Ruby Ring"',
      "Hide",
      '    Class "Rings"',
    ].join("\n"));
    const matches = findMatchingFilterBlocks(continued, {
      itemClass: "Rings",
      baseType: "Ruby Ring",
      rarity: "rare",
    });
    expect(matches.map((entry) => entry.firstMatch)).toEqual([true, false, false]);
    expect(matches.map((entry) => entry.matches)).toEqual([true, true, false]);
  });
});
