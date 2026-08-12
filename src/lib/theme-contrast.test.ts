import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.join(process.cwd(), "src", "styles.css"), "utf8");

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string) {
  const channels = rgb(hex).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string) {
  const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

function variable(block: string, name: string) {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

describe("native interface theme contrast", () => {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] || "";
  const themeBlock = (theme: string) =>
    new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\}`).exec(css)?.[1] || "";
  const themes = [
    { name: "gloam", palette: root, base: root },
    { name: "azurite", palette: themeBlock("azurite"), base: root },
    { name: "ember", palette: themeBlock("ember"), base: root },
    { name: "wraeclast", palette: themeBlock("wraeclast"), base: themeBlock("wraeclast") },
  ];

  it.each(themes)("keeps $name controls and copy readable", ({ palette, base }) => {
    const backgrounds = [variable(base, "bg-0"), variable(base, "bg-1")];
    const accent = variable(palette, "teal");
    for (const background of backgrounds) {
      expect(contrast(accent, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(variable(base, "text"), backgrounds[0])).toBeGreaterThanOrEqual(7);
    expect(contrast(variable(base, "text-3"), backgrounds[0])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every Path of Exile native surface readable and fully scoped", () => {
    const wraeclast = themeBlock("wraeclast");
    for (const name of ["poe-surface-0", "poe-surface-1", "poe-surface-2", "poe-surface-3", "poe-surface-4"]) {
      const surface = variable(wraeclast, name);
      expect(contrast(variable(wraeclast, "text"), surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(variable(wraeclast, "teal"), surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain(':root[data-theme="wraeclast"] .economy-table tbody tr');
    expect(css).toContain(':root[data-theme="wraeclast"] .planner-commandbar');
    expect(css).not.toContain(':root:not([data-theme="wraeclast"]) .economy-table');
  });
});
