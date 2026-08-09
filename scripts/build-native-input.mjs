import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "native", "NinjaLensInput.cs");
const outputDir = path.join(root, "build", "native-input");
const output = path.join(outputDir, "NinjaLensInput.exe");
const compilerCandidates = [
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
];
const compiler = compilerCandidates.find(existsSync);

if (!compiler) {
  throw new Error("Windows C# compiler was not found; cannot build NinjaLensInput.exe.");
}
mkdirSync(outputDir, { recursive: true });
const result = spawnSync(compiler, [
  "/nologo",
  "/optimize+",
  // The helper has no UI. A console-subsystem process can briefly participate
  // in foreground-window transitions on repeated launches even with
  // windowsHide, which makes the overlay controller report a false PoE blur.
  "/target:winexe",
  `/out:${output}`,
  source,
], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});

if (result.status !== 0 || !existsSync(output)) {
  const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  throw new Error(`Could not build NinjaLensInput.exe.${detail ? `\n${detail}` : ""}`);
}

const selfTest = spawnSync(output, ["self-test"], {
  cwd: root,
  windowsHide: true,
});
if (selfTest.status !== 0) {
  throw new Error("NinjaLensInput.exe failed its native input self-test.");
}

console.log(`Built ${output}`);

const pobSource = path.join(root, "electron", "pob-engine-host.cs");
if (existsSync(pobSource)) {
  const pobOutputDir = path.join(root, "build", "pob-engine");
  const pobOutput = path.join(pobOutputDir, "NinjaLensPobHost-x64.exe");
  mkdirSync(pobOutputDir, { recursive: true });
  const pobResult = spawnSync(compiler, [
    "/nologo",
    "/optimize+",
    "/target:exe",
    "/platform:x64",
    `/out:${pobOutput}`,
    pobSource,
  ], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (pobResult.status !== 0 || !existsSync(pobOutput)) {
    const detail = `${pobResult.stdout || ""}\n${pobResult.stderr || ""}`.trim();
    throw new Error(`Could not build NinjaLensPobHost-x64.exe.${detail ? `\n${detail}` : ""}`);
  }
  console.log(`Built ${pobOutput}`);
}
