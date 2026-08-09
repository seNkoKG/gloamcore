import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Trade stat catalog desktop loader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("parses the main-process verified string without a UTF-8 round trip", async () => {
    const text = readFileSync(
      resolve(process.cwd(), "public/data/price-check/stats-v1.json"),
      "utf8",
    );
    const getTradeStatCatalog = vi.fn().mockResolvedValue(text);
    vi.stubGlobal("window", { poeWidget: { getTradeStatCatalog } });
    vi.stubGlobal("TextDecoder", class ForbiddenDesktopDecode {
      constructor() {
        throw new Error("desktop catalog must not be decoded twice");
      }
    });

    const catalog = await import("./stat-catalog");
    const pack = await catalog.loadTradeStatCatalog();

    expect(pack).toMatchObject({
      schema: 8,
      source: {
        commit: "adb6c287bd978a70701e2b65d744dd677c52fb65",
      },
    });
    expect(getTradeStatCatalog).toHaveBeenCalledOnce();
    expect(catalog.tradeStatCatalogDiagnostic()).toBe("ready-desktop");
  });
});
