import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CAPACITOR_SPM_PATHS,
  normalizeCapacitorSpmManifest,
} from "./normalize-capacitor-spm.mjs";

const generated = `// swift-tools-version: 5.9\r
// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands\r
let dependencies = [\r
${Object.keys(CAPACITOR_SPM_PATHS).map((name) =>
  `  .package(name: "${name}", path: "..\\..\\..\\node_modules\\.pnpm\\${name}\\node_modules\\${name}")`,
).join(",\r\n")}\r
]\r
`;

describe("Capacitor Swift package normalization", () => {
  it("keeps the checked-in manifest normalized and every local package resolvable", () => {
    const manifestPath = join(process.cwd(), "ios", "App", "CapApp-SPM", "Package.swift");
    const manifest = readFileSync(manifestPath, "utf8");
    expect(normalizeCapacitorSpmManifest(manifest)).toBe(manifest.replace(/\r\n?/g, "\n"));
    for (const path of Object.values(CAPACITOR_SPM_PATHS)) {
      expect(existsSync(resolve(dirname(manifestPath), path, "Package.swift")), path).toBe(true);
    }
  });

  it("replaces generated Windows/pnpm paths with stable POSIX workspace paths", () => {
    const normalized = normalizeCapacitorSpmManifest(generated);
    for (const [name, path] of Object.entries(CAPACITOR_SPM_PATHS)) {
      expect(normalized).toContain(`.package(name: "${name}", path: "${path}")`);
    }
    expect(normalized).not.toContain("\\");
    expect(normalizeCapacitorSpmManifest(normalized)).toBe(normalized);
  });

  it("fails closed when Capacitor changes the generated dependency set", () => {
    expect(() => normalizeCapacitorSpmManifest(generated.replace(/.*CapacitorStatusBar.*\r?\n/, "")))
      .toThrow(/CapacitorStatusBar/);
  });

  it("rejects an additional machine-specific local package", () => {
    const unsafe = generated.replace("]\r\n", `,\r\n  .package(name: "Other", path: "C:\\tmp\\other")\r\n]\r\n`);
    expect(() => normalizeCapacitorSpmManifest(unsafe)).toThrow(/machine-specific/);
  });
});
