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
  const backgrounds = [variable(root, "bg-0"), variable(root, "bg-1")];
  const accents = [
    variable(root, "teal"),
    variable(/:root\[data-theme="azurite"\]\s*\{([\s\S]*?)\}/.exec(css)?.[1] || "", "teal"),
    variable(/:root\[data-theme="ember"\]\s*\{([\s\S]*?)\}/.exec(css)?.[1] || "", "teal"),
  ];

  it.each(accents)("keeps accent %s readable on every native base surface", (accent) => {
    for (const background of backgrounds) expect(contrast(accent, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps primary and muted copy readable on the darkest surface", () => {
    expect(contrast(variable(root, "text"), backgrounds[0])).toBeGreaterThanOrEqual(7);
    expect(contrast(variable(root, "text-3"), backgrounds[0])).toBeGreaterThanOrEqual(4.5);
  });
});
