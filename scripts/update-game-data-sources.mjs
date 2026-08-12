import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(projectRoot, "scripts", "game-data-sources.json");
const maximumBytes = 2 * 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function request(url, accept = "application/vnd.github+json") {
  const response = await fetch(url, {
    redirect: "error",
    headers: {
      Accept: accept,
      "User-Agent": "GloamCore-game-data-updater",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`Source discovery failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maximumBytes) throw new Error(`Source discovery response is outside its reviewed size limit: ${url}`);
  return bytes;
}

async function json(url) {
  return JSON.parse((await request(url)).toString("utf8"));
}

async function commitFromTag(tag) {
  const reference = await json(`https://api.github.com/repos/grindinggear/atlastree-export/git/ref/tags/${encodeURIComponent(tag)}`);
  let object = reference.object;
  if (object?.type === "tag") object = (await json(object.url)).object;
  if (object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(String(object.sha))) throw new Error(`Atlas tag ${tag} does not resolve to a commit.`);
  return json(`https://api.github.com/repos/grindinggear/atlastree-export/commits/${object.sha}`);
}

const releases = await json("https://api.github.com/repos/grindinggear/atlastree-export/releases?per_page=100");
const release = releases.find((entry) => !entry.draft && /^\d+\.\d+\.\d+$/.test(String(entry.tag_name)));
if (!release) throw new Error("No supported official Atlas release tag was found.");
const gameVersion = release.tag_name;
const atlasCommit = await commitFromTag(gameVersion);
const atlasUrl = `https://raw.githubusercontent.com/grindinggear/atlastree-export/${encodeURIComponent(gameVersion)}/data.json`;
const atlasBytes = await request(atlasUrl, "application/json");
const atlasJson = JSON.parse(atlasBytes.toString("utf8"));
if (atlasJson.tree !== "Atlas" || !atlasJson.nodes || Object.keys(atlasJson.nodes).length < 900) throw new Error("The discovered official Atlas export failed its minimum schema check.");

const officialAtlasPage = (await request(
  "https://www.pathofexile.com/fullscreen-atlas-skill-tree",
  "text/html",
)).toString("utf8");
const assetRoot = /baseUrl:\s*"([^"]+)"/.exec(officialAtlasPage)?.[1];
const pathMapText = /paths\s*:\s*(\{[^\r\n]+\})/.exec(officialAtlasPage)?.[1];
if (!assetRoot?.startsWith("https://web.poecdn.com/") || !pathMapText) {
  throw new Error("The official Atlas page no longer exposes its reviewed link-format script path.");
}
const pathMap = JSON.parse(pathMapText);
if (!/^[a-z0-9.]+$/i.test(String(pathMap.main || ""))) {
  throw new Error("The official Atlas page returned an invalid main script identifier.");
}
const atlasLinkScriptUrl = `${assetRoot.replace(/\/$/, "")}/${pathMap.main}.js`;
const atlasLinkScriptBytes = await request(atlasLinkScriptUrl, "text/javascript");
const atlasLinkScript = atlasLinkScriptBytes.toString("utf8");
const atlasLinkVersion = Number(/define\('PoE\/PassiveSkillTree\/Version',\[\],function\(\)\{return (\d+)\}\)/.exec(atlasLinkScript)?.[1]);
const reviewedEncodingMarkers = [
  "encoder.appendInt(CurrentVersion)",
  "encoder.appendInt8(data.characterClass)",
  "encoder.appendInt8(data.hashes.length)",
  "encoder.appendInt16(data.hashes[i])",
  'data.atlas?"atlas":"passive"',
];
if (atlasLinkVersion !== 6 || reviewedEncodingMarkers.some((marker) => !atlasLinkScript.includes(marker))) {
  throw new Error(`Official Atlas link format ${atlasLinkVersion || "unknown"} differs from the reviewed version-6 encoder; code review is required before publishing new packs.`);
}

const repository = await json("https://api.github.com/repos/HeartofPhos/exile-leveling");
const navigatorCommit = await json(`https://api.github.com/repos/HeartofPhos/exile-leveling/commits/${encodeURIComponent(repository.default_branch)}`);
if (!/^[a-f0-9]{40}$/.test(String(navigatorCommit.sha))) throw new Error("The Navigator source did not resolve to a commit.");
const leagueFamily = gameVersion.split(".").slice(0, 2).join(".");
const navigatorMessage = String(navigatorCommit.commit?.message || "").replace(/\s+/g, " ").trim();
if (Date.parse(navigatorCommit.commit?.committer?.date) < Date.parse(atlasCommit.commit?.committer?.date)) {
  throw new Error(`The latest Navigator source predates official Atlas ${gameVersion}; refusing to pair them.`);
}
if (!new RegExp(`(^|\\D)${leagueFamily.replace(".", "\\.")}(\\D|$)`).test(navigatorMessage)) {
  throw new Error(`The latest Navigator commit does not explicitly identify league family ${leagueFamily}.`);
}
const navigatorRoot = `https://raw.githubusercontent.com/HeartofPhos/exile-leveling/${navigatorCommit.sha}/common/data`;
const files = [
  "json/areas.json",
  "json/gems.json",
  "json/quests.json",
  ...Array.from({ length: 10 }, (_, index) => `routes/act-${index + 1}.txt`),
];
const fileEntries = await Promise.all(files.map(async (file) => {
  const bytes = await request(`${navigatorRoot}/${file}`, file.endsWith(".json") ? "application/json" : "text/plain");
  if (file.endsWith(".json")) JSON.parse(bytes.toString("utf8"));
  return [file, sha256(bytes)];
}));

const next = {
  schemaVersion: 1,
  gameVersion,
  atlas: {
    revision: atlasCommit.sha,
    releasedAt: atlasCommit.commit.committer.date,
    url: atlasUrl,
    sha256: sha256(atlasBytes),
    linkFormat: {
      version: atlasLinkVersion,
      url: atlasLinkScriptUrl,
      sha256: sha256(atlasLinkScriptBytes),
    },
  },
  navigator: {
    revision: navigatorCommit.sha,
    releasedAt: navigatorCommit.commit.committer.date,
    compatibilityEvidence: `Source commit message explicitly references ${leagueFamily}: ${navigatorMessage}`,
    root: navigatorRoot,
    files: Object.fromEntries(fileEntries),
  },
};
const serialized = `${JSON.stringify(next, null, 2)}\n`;
const current = fs.readFileSync(lockPath, "utf8");
if (serialized === current) {
  console.log(`Game-data sources are current for PoE ${gameVersion}.`);
} else {
  fs.writeFileSync(lockPath, serialized, "utf8");
  console.log(`Updated source lock for PoE ${gameVersion}; generated packs must pass review before publication.`);
}
