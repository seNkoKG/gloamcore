"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const physicalFs = process.versions.electron ? require("original-fs") : fs;

const CACHE_PREFIX = "ninja-lens-packaged-pob-";
const EXPECTED_ENGINE_VERSION = "2.66.1";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function minimalBuild(level) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="${level}" targetVersion="3_0" bandit="None" className="Scion" ascendClassName="None" mainSocketGroup="1" viewMode="CALCS" pantheonMajorGod="None" pantheonMinorGod="None" />
  <Import />
  <Calcs />
  <Skills activeSkillSet="1" sortGemsByDPS="false"><SkillSet id="1" /></Skills>
  <Tree activeSpec="1"><Spec title="Default" treeVersion="3_29" classId="0" ascendClassId="0" nodes="" /></Tree>
  <Items activeItemSet="1"><ItemSet id="1" /></Items>
  <Config activeConfigSet="1"><ConfigSet id="1" /></Config>
  <Notes />
</PathOfBuilding>`;
}

function assertRegularFile(fileName, label) {
  invariant(physicalFs.existsSync(fileName), `${label} is missing: ${fileName}`);
  invariant(physicalFs.statSync(fileName).isFile(), `${label} is not a regular file: ${fileName}`);
}

function resolvePackagedLayout(executablePath, resourcesArgument, realpath = fs.realpathSync) {
  invariant(typeof executablePath === "string" && executablePath.length > 0, "The packaged executable path is required.");
  invariant(typeof resourcesArgument === "string" && resourcesArgument.length > 0, "The packaged resources path is required.");
  const resourcesPath = realpath(path.resolve(resourcesArgument));
  const expectedResourcesPath = realpath(path.join(path.dirname(executablePath), "resources"));
  const samePath = process.platform === "win32"
    ? resourcesPath.toLowerCase() === expectedResourcesPath.toLowerCase()
    : resourcesPath === expectedResourcesPath;
  invariant(samePath, "The supplied resources path does not belong to the executable under test.");
  return Object.freeze({
    resourcesPath,
    appAsar: path.join(resourcesPath, "app.asar"),
    bundledHost: path.join(resourcesPath, "pob-engine", "NinjaLensPobHost-x64.exe"),
  });
}

function removeOwnedCache(cacheRoot) {
  const resolved = path.resolve(cacheRoot);
  invariant(path.dirname(resolved) === path.resolve(os.tmpdir()), "Refusing to remove a cache outside the system temporary directory.");
  invariant(path.basename(resolved).startsWith(CACHE_PREFIX), "Refusing to remove an unrecognized temporary cache.");
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function main() {
  invariant(Boolean(process.versions.electron), "The packaged smoke must run through the Electron executable.");
  const { resourcesPath, appAsar, bundledHost } = resolvePackagedLayout(process.execPath, process.argv[2]);
  assertRegularFile(appAsar, "Packaged app.asar");
  assertRegularFile(bundledHost, "Bundled PoB host");

  const { createPobEngineDispatcher } = require(path.join(appAsar, "electron", "pob-engine-dispatch.cjs"));
  const { createPobPlannerDispatcher } = require(path.join(appAsar, "electron", "pob-planner-dispatch.cjs"));
  invariant(typeof createPobEngineDispatcher === "function", "The packaged PoB engine dispatcher is unavailable.");
  invariant(typeof createPobPlannerDispatcher === "function", "The packaged passive-tree dispatcher is unavailable.");

  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), CACHE_PREFIX));
  const engine = createPobEngineDispatcher({ engineOptions: { resourcesPath, cacheRoot } });
  const planner = createPobPlannerDispatcher();
  try {
    const diagnosis = await engine.diagnose();
    invariant(diagnosis?.ok === true, `PoB diagnosis failed closed: ${diagnosis?.code || "unknown"}`);
    invariant(diagnosis.authoritative === true && diagnosis.available === true, "PoB diagnosis is not authoritative and available.");
    invariant(diagnosis.engine?.number === EXPECTED_ENGINE_VERSION, `Unexpected PoB version: ${diagnosis.engine?.number || "missing"}`);
    invariant(diagnosis.host?.mode === "bundled-prebuilt", `The packaged PoB host is not being used: ${diagnosis.host?.mode || "missing"}`);

    const tree = await planner.load({ game: "poe1" });
    invariant(Object.isFrozen(tree), "The dispatched passive tree is mutable.");
    invariant(Array.isArray(tree?.nodes) && tree.nodes.length > 2_000, "The packaged PoE 1 passive tree is incomplete.");
    invariant(Array.isArray(tree?.groups) && tree.groups.length > 0, "The packaged PoE 1 passive tree has no groups.");

    const calculation = await engine.calculate({
      xml: minimalBuild(1),
      name: "packaged release smoke",
    });
    invariant(calculation?.ok === true, `PoB calculation failed closed: ${calculation?.code || "unknown"}`);
    invariant(calculation.authoritative === true, "The packaged PoB calculation is not authoritative.");
    invariant(calculation.engine?.version === EXPECTED_ENGINE_VERSION, `Unexpected calculation engine: ${calculation.engine?.version || "missing"}`);
    invariant(typeof calculation.engine?.hostFingerprint === "string" && calculation.engine.hostFingerprint.length > 0, "The packaged PoB host fingerprint is missing.");
    invariant(calculation.calculation?.scalarCount > 100, "The packaged PoB calculation returned too few scalar results.");
    invariant(Number.isFinite(calculation.calculation?.stats?.Life), "The packaged PoB calculation returned no finite Life value.");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      electron: process.versions.electron,
      engine: calculation.engine.version,
      host: diagnosis.host.mode,
      treeVersion: tree.version,
      treeNodes: tree.nodes.length,
      treeGroups: tree.groups.length,
      scalarCount: calculation.calculation.scalarCount,
      life: calculation.calculation.stats.Life,
    })}\n`);
  } finally {
    engine.dispose();
    planner.dispose();
    removeOwnedCache(cacheRoot);
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(`Packaged PoB/passive-tree smoke failed: ${error?.stack || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  _internals: {
    minimalBuild,
    resolvePackagedLayout,
  },
};
