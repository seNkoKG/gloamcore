import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("renderer startup recovery", () => {
  it("renders a retry UI when bootstrap imports fail", () => {
    const source = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
    expect(source).toContain("void bootstrap().catch(renderBootstrapFailure)");
    expect(source).toContain("<BootstrapFailure />");
    expect(source).toContain("<RuntimeErrorBoundary");
  });

  it("contains lazy workspace failures without losing the whole shell", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const boundary = readFileSync(
      new URL("./components/RuntimeErrorBoundary.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/<RuntimeErrorBoundary[\s\S]*?resetKey=\{mode\}[\s\S]*?<Suspense/);
    expect(boundary).toContain("Reload application");
  });

  it("waits for authoritative compact state before expanded-only navigation", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const guard = /const ensureExpandedForMode[\s\S]*?\n  \);/.exec(source)?.[0];
    expect(guard).toContain("desktopSettingsReadyRef.current");
    expect(guard).toContain("await bridge.getSettings()");
    expect(guard).toContain("await bridge.windowAction(\"compact\", false)");
  });
});
