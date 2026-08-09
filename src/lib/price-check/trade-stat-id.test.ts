import { describe, expect, it } from "vitest";
import {
  hasNumericPriceCheckSemantics,
  isOfficialTradeStatId,
  isPresenceOnlyPriceCheckFilter,
  isSelectorTradeStatId,
  sanitizePresenceOnlyPriceCheckFilter,
} from "./trade-stat-id";
import type {
  ParsedPoeModifier,
  PriceCheckModifierFilter,
} from "./types";

describe("official Trade stat IDs", () => {
  it("accepts plain and selector-qualified legacy families", () => {
    expect(isOfficialTradeStatId("explicit.stat_123")).toBe(true);
    expect(isOfficialTradeStatId("explicit.stat_2460506030|38999")).toBe(true);
    expect(isOfficialTradeStatId("imbued.stat_4089743927|1|126")).toBe(true);
    expect(isOfficialTradeStatId("imbued.pseudo_built_in_support|1826945816")).toBe(true);
    expect(isSelectorTradeStatId("explicit.stat_3642528642|5")).toBe(true);
  });

  it("accepts every key family that the current official schema added", () => {
    const liveIds = [
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
    ];
    expect(liveIds.every(isOfficialTradeStatId)).toBe(true);
  });

  it("allows future safe families without another namespace allowlist", () => {
    expect(isOfficialTradeStatId("future_family.new_stat_123")).toBe(true);
  });

  it("enforces ASCII wire shape and bounded component lengths", () => {
    expect(isOfficialTradeStatId(`${"n".repeat(32)}.${"b".repeat(127)}`)).toBe(true);
    expect(isOfficialTradeStatId(`${"n".repeat(33)}.stat_1`)).toBe(false);
    expect(isOfficialTradeStatId(`explicit.${"b".repeat(128)}`)).toBe(false);
    expect(isOfficialTradeStatId("Explicit.stat_123")).toBe(false);
    expect(isOfficialTradeStatId("explicit.stat-123")).toBe(false);
    expect(isOfficialTradeStatId("explicit.stat_123.extra")).toBe(false);
    expect(isOfficialTradeStatId("explicit/stat_123")).toBe(false);
    expect(isOfficialTradeStatId(" explicit.stat_123")).toBe(false);
    expect(isOfficialTradeStatId("explicit.stat_123\n")).toBe(false);
  });

  it("rejects malformed or unbounded selector suffixes", () => {
    expect(isOfficialTradeStatId("explicit.stat_123|1234567890")).toBe(true);
    expect(isOfficialTradeStatId("explicit.stat_123|")).toBe(false);
    expect(isOfficialTradeStatId("explicit.stat_123|choice")).toBe(false);
    expect(isOfficialTradeStatId("explicit.stat_123|12345678901")).toBe(false);
    expect(isOfficialTradeStatId("explicit.stat_123|1|2|3")).toBe(false);
    expect(isOfficialTradeStatId("javascript:alert(1)")).toBe(false);
    expect(isSelectorTradeStatId("explicit.stat_123|choice")).toBe(false);
  });

  it("derives numeric editability only from trusted copied or bounded semantics", () => {
    const notable: ParsedPoeModifier = {
      id: "megalomaniac-notable",
      kind: "explicit",
      text: "1 Added Passive Skill is Blanketed Snow",
      normalizedText: "# added passive skill is blanketed snow",
      values: [],
      selectedByDefault: true,
      tags: [],
      advanced: false,
    };
    const fabricated: PriceCheckModifierFilter = {
      modifierId: notable.id,
      tradeId: "explicit.stat_1085167979",
      enabled: true,
      mode: "exact",
      min: 999,
      max: 999,
      importance: "key",
      explanation: "Value-less notable",
    };

    expect(hasNumericPriceCheckSemantics(fabricated, notable)).toBe(false);
    expect(isPresenceOnlyPriceCheckFilter(fabricated, notable)).toBe(true);
    const sanitized = sanitizePresenceOnlyPriceCheckFilter(fabricated, notable);
    expect(sanitized.mode).toBe("presence");
    expect(sanitized).not.toHaveProperty("min");
    expect(sanitized).not.toHaveProperty("max");

    expect(isPresenceOnlyPriceCheckFilter(
      { ...fabricated, bounds: { min: 1, max: 2 } },
      notable,
    )).toBe(false);
    expect(isPresenceOnlyPriceCheckFilter(
      fabricated,
      { ...notable, values: [40] },
    )).toBe(false);
    expect(isPresenceOnlyPriceCheckFilter(
      { ...fabricated, tradeOption: 1 },
      { ...notable, values: [1] },
    )).toBe(true);
  });
});
