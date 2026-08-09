import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createPoeCharacterService, validatedRequest } = require("../electron/poe-character-import.cjs");
const { version: appVersion } = require("../package.json");

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

describe("PoE character import service", () => {
  it("validates realms and never accepts newline-bearing credentials", () => {
    expect(() => validatedRequest({ mode: "oauth", realm: "evil", accessToken: "x" })).toThrow("realm");
    expect(() => validatedRequest({ mode: "public", realm: "poe2", accountName: "Account" })).toThrow("only through the official OAuth");
    expect(validatedRequest({ mode: "oauth", realm: "pc", accessToken: "a\nb" }).accessToken).toBe("ab");
  });

  it("uses current official OAuth character endpoints", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.pathofexile.com/character/Hero");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
      expect((init.headers as Record<string, string>)["User-Agent"]).toBe(`Ninja-Lens/${appVersion}`);
      return json({ character: { name: "Hero", passives: { hashes: [1, 2] } } });
    });
    const service = createPoeCharacterService({ fetchImpl });
    await expect(service.getCharacter({ mode: "oauth", realm: "pc", accessToken: "token", character: "Hero" })).resolves.toMatchObject({ name: "Hero" });
  });

  it("never reuses private character data across OAuth tokens", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const token = String((init.headers as Record<string, string>).Authorization || "").replace(/^Bearer /, "");
      return json({ characters: [{ name: `Character-${token}` }] });
    });
    const service = createPoeCharacterService({ fetchImpl });

    await expect(service.listCharacters({ mode: "oauth", realm: "pc", accessToken: "account-a" }))
      .resolves.toEqual([{ name: "Character-account-a" }]);
    await expect(service.listCharacters({ mode: "oauth", realm: "pc", accessToken: "account-b" }))
      .resolves.toEqual([{ name: "Character-account-b" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("joins public profile passive and item responses", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.includes("passive-skills")
      ? json({ hashes: [1], items: [] })
      : json({ character: { class: "Witch", level: 90 }, items: [{ name: "Helm" }] }));
    const service = createPoeCharacterService({ fetchImpl });
    await expect(service.getCharacter({ mode: "public", realm: "pc", accountName: "Account#1234", character: "Hero" })).resolves.toMatchObject({ class: "Witch", level: 90, passives: { hashes: [1] } });
  });
});
