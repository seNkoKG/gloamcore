import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const generator = resolve(
  projectRoot,
  "node_modules/@capacitor/assets/bin/capacitor-assets",
);
const colors = [
  "--iconBackgroundColor",
  "#071014",
  "--iconBackgroundColorDark",
  "#071014",
  "--splashBackgroundColor",
  "#071014",
  "--splashBackgroundColorDark",
  "#071014",
];

for (const platform of ["android", "ios"]) {
  const result = spawnSync(
    process.execPath,
    [generator, "generate", `--${platform}`, ...colors],
    { cwd: projectRoot, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// @capacitor/assets does not preserve Android 13's optional themed icon layer.
// Restore the app's monochrome mark after every deterministic regeneration.
for (const filename of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  const path = resolve(
    projectRoot,
    "android/app/src/main/res/mipmap-anydpi-v26",
    filename,
  );
  const source = readFileSync(path, "utf8");
  const withMonochrome = source.includes("<monochrome ")
    ? source
    : source.replace(
        /\s*<\/adaptive-icon>\s*$/,
        '\n    <monochrome android:drawable="@drawable/ic_stat_ninja_lens" />\n</adaptive-icon>\n',
      );
  writeFileSync(path, withMonochrome, "utf8");
}
