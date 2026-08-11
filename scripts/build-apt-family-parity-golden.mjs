import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APT_FAMILY_PARITY_FIXTURES } from "./apt-family-parity-fixtures.mjs";

const PINNED_VERSION = "3.29.104";
const PINNED_COMMIT = "adb6c287bd978a70701e2b65d744dd677c52fb65";
const STALE_CATEGORIES = [
  "Charm",
  "Graft",
  "Memory Line",
  "Metamorph Sample",
  "Sentinel",
  "Voidstone",
];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(
  ROOT,
  "src/lib/price-check/fixtures/apt-family-parity-v3.29.104.json",
);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasArg(name) {
  return process.argv.includes(name);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readSourceFile(sourceRoot, relativePath) {
  const absolute = path.join(sourceRoot, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`Missing APT source file: ${absolute}`);
  return fs.readFileSync(absolute);
}

function parseNdjson(buffer) {
  return buffer.toString("utf8").trim().split(/\r?\n/).map(JSON.parse);
}

function sameStrings(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function validateCoverage(sourceRoot, itemRows) {
  const enumSource = readSourceFile(
    sourceRoot,
    "renderer/src/parser/meta.ts",
  ).toString("utf8");
  const enumCategories = [...enumSource.matchAll(/^\s+\w+\s*=\s*'([^']+)'/gm)]
    .map((match) => match[1]);
  const currentCategories = new Set(
    itemRows.flatMap((item) => item.craftable?.category ? [item.craftable.category] : []),
  );
  if (itemRows.some((item) => item.namespace === "CAPTURED_BEAST")) currentCategories.add("Captured Beast");
  if (itemRows.some((item) => item.namespace === "DIVINATION_CARD")) currentCategories.add("Divination Card");
  if (itemRows.some((item) => item.namespace === "GEM")) currentCategories.add("Gem");
  if (itemRows.some((item) => item.namespace === "ITEM" && item.tradeTag)) currentCategories.add("Currency");

  const current = [...currentCategories].sort();
  const stale = enumCategories.filter((category) => !currentCategories.has(category)).sort();
  if (current.length !== 47) throw new Error(`Expected 47 executable categories, found ${current.length}.`);
  if (!sameStrings(stale, STALE_CATEGORIES)) {
    throw new Error(`Pinned enum-only category drift: ${JSON.stringify(stale)}.`);
  }
  const currentEnum = enumCategories.filter((category) => currentCategories.has(category));
  if (currentEnum.length !== 46 || !currentCategories.has("Unique Fragment")) {
    throw new Error("Expected 46 current enum categories plus Unique Fragment.");
  }

  const categoryFixtures = APT_FAMILY_PARITY_FIXTURES.filter((fixture) => fixture.kind === "category");
  const fixtureCategories = categoryFixtures.map((fixture) => fixture.category).sort();
  if (!sameStrings(fixtureCategories, current)) {
    throw new Error("Category fixtures do not exactly cover the pinned executable database categories.");
  }
  for (const fixture of categoryFixtures) {
    const matches = itemRows.filter((item) => item.refName === fixture.baseRef);
    const isSpecial = (
      (fixture.category === "Captured Beast" && matches.some((item) => item.namespace === "CAPTURED_BEAST")) ||
      (fixture.category === "Divination Card" && matches.some((item) => item.namespace === "DIVINATION_CARD")) ||
      (fixture.category === "Gem" && matches.some((item) => item.namespace === "GEM")) ||
      (fixture.category === "Currency" && matches.some((item) => item.namespace === "ITEM" && item.tradeTag))
    );
    if (!isSpecial && !matches.some((item) => item.craftable?.category === fixture.category)) {
      throw new Error(`${fixture.id} does not prove ${fixture.category} from ${fixture.baseRef}.`);
    }
  }
  return { current, currentEnum: currentEnum.sort(), stale };
}

function harnessSource(fixtures) {
  return `import { createApp } from 'vue'
import { init } from './assets/data'
import { parseClipboard } from './parser'
import { statSourcesTotal } from './parser/modifiers'
import { createPresets } from './web/price-check/filters/create-presets'
import { apiToSatisfySearch } from './web/price-check/trade/common'
import { CATEGORY_TO_TRADE_ID, createTradeRequest } from './web/price-check/trade/pathofexile-trade'
import { createTradeRequest as createBulkRequest } from './web/price-check/trade/pathofexile-bulk'
import { getTradeEndpoint } from './web/price-check/trade/common'
import { INTERNAL_TRADE_IDS } from './web/price-check/filters/interfaces'
import { defaultConfig, updateConfig } from './web/Config'
import ItemModifierText from './web/ui/ItemModifierText.vue'

const fixtures = ${JSON.stringify(fixtures)}
const options = {
  league: 'Allflame',
  currency: undefined,
  collapseListings: 'api',
  activateStockFilter: false,
  searchStatRange: 10,
  useEn: true
}

function clean(value) {
  return JSON.parse(JSON.stringify(value))
}

let englishItemLabels
let englishCategoryLabels

function renderedStatText(filter) {
  const firstTradeId = filter.tradeId[0]
  let text = filter.text
  if (INTERNAL_TRADE_IDS.includes(firstTradeId)) {
    const key = firstTradeId.startsWith('item.') ? firstTradeId.slice(5) : firstTradeId
    const template = englishItemLabels[key]
    if (typeof template !== 'string') {
      throw new Error('Missing pinned English UI label for ' + firstTradeId)
    }
    text = template.split('{0}').join('#').split('{1}').join('#')
  }
  const roll = filter.roll?.value
  const target = document.createElement('div')
  const app = createApp(ItemModifierText, { text, roll })
  app.mount(target)
  const rendered = target.textContent ?? ''
  app.unmount()
  return rendered
}

function normalizedStat(filter) {
  return clean({
    tradeId: filter.tradeId,
    statRef: filter.statRef,
    text: filter.text,
    displayText: renderedStatText(filter),
    tag: filter.tag,
    oils: filter.oils,
    not: filter.not,
    roll: filter.roll && {
      value: filter.roll.value,
      min: filter.roll.min,
      max: filter.roll.max,
      default: filter.roll.default,
      bounds: filter.roll.bounds,
      tradeInvert: filter.roll.tradeInvert,
      dp: filter.roll.dp,
      isNegated: filter.roll.isNegated
    },
    option: filter.option,
    hidden: filter.hidden,
    disabled: filter.disabled
  })
}

function normalizedParsedStat(stat) {
  return clean({
    ref: stat.stat.ref,
    trade: stat.stat.trade,
    better: stat.stat.better,
    matcher: stat.translation.string,
    matcherValue: stat.translation.value,
    negate: stat.translation.negate,
    roll: stat.roll && {
      value: stat.roll.value,
      min: stat.roll.min,
      max: stat.roll.max,
      dp: stat.roll.dp,
      unscalable: stat.roll.unscalable,
      legacy: stat.roll.legacy
    }
  })
}

function normalizedModifier(modifier) {
  return clean({
    info: modifier.info,
    stats: modifier.stats.map(normalizedParsedStat)
  })
}

function normalizedCalculatedStat(calc) {
  return clean({
    ref: calc.stat.ref,
    trade: calc.stat.trade,
    better: calc.stat.better,
    type: calc.type,
    sources: calc.sources.map(source => ({
      modifier: source.modifier.info,
      stat: normalizedParsedStat(source.stat),
      contributes: source.contributes
    }))
  })
}

function pinnedFunctionOracles() {
  const source = 'renderer/src/parser/modifiers.ts#statSourcesTotal'
  const known = {
    modifier: {} as any,
    stat: {} as any,
    contributes: { value: 20, min: 18, max: 22 }
  }
  const missing = { modifier: {} as any, stat: {} as any }
  const negativeA = {
    modifier: {} as any,
    stat: {} as any,
    contributes: { value: -5, min: -7, max: -3 }
  }
  const negativeB = {
    modifier: {} as any,
    stat: {} as any,
    contributes: { value: -2, min: -4, max: -1 }
  }
  return clean({
    statSourcesTotal: {
      origin: 'direct-pinned-function-execution',
      source,
      executableItemInvariant: false,
      caveat: 'A same-ref calculated item with a missing roll reaches a later roll.dp non-null assertion in APT v3.29.104.',
      sumWithMissingContribution: {
        mode: 'sum',
        inputs: [known.contributes, null],
        result: statSourcesTotal([known, missing] as any)
      },
      maxStartsAtZero: {
        mode: 'max',
        inputs: [negativeA.contributes, negativeB.contributes],
        result: statSourcesTotal([negativeA, negativeB] as any, 'max')
      }
    }
  })
}

function renderedIdentityLabel(search) {
  if (search.name) return search.name
  if (search.baseType) return search.baseType
  if (search.category) {
    const tradeId = CATEGORY_TO_TRADE_ID.get(search.category)
    const category = tradeId && englishCategoryLabels[tradeId.replace('.', '_')]
    if (!category) throw new Error('Missing pinned English category label for ' + search.category)
    return englishCategoryLabels.prop.replace('{0}', category)
  }
  return '??? Report if you see this text'
}

function filtersForIdentitySelection(filters, selection) {
  const selected = clean(filters)
  const relaxed = selected.searchRelaxed
  if (selection === 'exact') {
    if (relaxed) relaxed.disabled = true
    return selected
  }
  if (!relaxed) throw new Error('Cannot select missing relaxed identity')
  relaxed.disabled = false
  if (relaxed.sub) relaxed.sub.disabled = selection !== 'sub'
  return selected
}

function identityQueryFromRequest(request) {
  const query = request.query
  return clean({
    name: query.name,
    type: query.type,
    category: query.filters?.type_filters?.filters?.category?.option
  })
}

function normalizedIdentityState(filters, stats) {
  const sourceEntries = [
    ['exact', filters.searchExact],
    ...(filters.searchRelaxed ? [['relaxed', filters.searchRelaxed]] : []),
    ...(filters.searchRelaxed?.sub ? [['sub', filters.searchRelaxed.sub]] : [])
  ]
  const active = !filters.searchRelaxed || filters.searchRelaxed.disabled
    ? 'exact'
    : (filters.searchRelaxed.sub && !filters.searchRelaxed.sub.disabled)
        ? 'sub'
        : 'relaxed'
  const activeParent = active === 'exact' ? filters.searchExact : filters.searchRelaxed
  const searches = sourceEntries.map(([key, search]) => {
    const selected = filtersForIdentitySelection(filters, key)
    const request = createTradeRequest(selected, stats)
    return clean({
      key,
      label: renderedIdentityLabel(search),
      disabled: key === 'exact' ? false : Boolean(search.disabled),
      query: identityQueryFromRequest(request)
    })
  })
  return clean({
    active,
    primaryLabel: renderedIdentityLabel(activeParent),
    subVisible: active !== 'exact' && Boolean(filters.searchRelaxed?.sub),
    searches
  })
}

function normalizedIdentity(filters, stats, api) {
  const state = normalizedIdentityState(filters, stats)
  const selections = state.searches.map(search => search.key)
  const alternates = api === 'bulk'
    ? []
    : selections.filter(key => key !== state.active).map(key => {
        const selected = filtersForIdentitySelection(filters, key)
        const request = createTradeRequest(selected, stats)
        const browserPayload = request
        const browserUrl = 'https://' + getTradeEndpoint() + '/trade/search/' +
          selected.trade.league + '?q=' + JSON.stringify(browserPayload)
        return clean({
          key,
          identity: normalizedIdentityState(selected, stats),
          request,
          browserPayload,
          browserUrl
        })
      })
  return clean({ ...state, alternates })
}

async function runFixtures() {
  await init('en')
  updateConfig(defaultConfig())
  const englishMessages = await fetch('/data/en/app_i18n.json').then(response => {
    if (!response.ok) throw new Error('Unable to load pinned English UI labels: ' + response.status)
    return response.json()
  })
  englishItemLabels = englishMessages.item
  englishCategoryLabels = englishMessages.item_category
  const cases = []
  for (const fixture of fixtures) {
    const parsed = parseClipboard(fixture.raw)
    if (parsed.isErr()) throw new Error(fixture.id + ': ' + parsed.error)
    const item = parsed.value
    const created = createPresets(item, options)
    const presets = created.presets.map((preset) => {
      const api = apiToSatisfySearch(item, preset.stats, preset.filters)
      const have = item.info.refName === 'Chaos Orb'
        ? ['divine']
        : item.info.refName === 'Divine Orb'
          ? ['chaos']
          : ['divine', 'chaos']
      const request = api === 'bulk'
        ? createBulkRequest(preset.filters, item, have)
        : createTradeRequest(preset.filters, preset.stats)
      const browserPayload = api === 'bulk' ? { exchange: request.query } : request
      const browserRoute = api === 'bulk' ? 'exchange' : 'search'
      const browserUrl = 'https://' + getTradeEndpoint() + '/trade/' + browserRoute + '/' +
        preset.filters.trade.league + '?q=' + JSON.stringify(browserPayload)
      return clean({
        id: preset.id,
        itemFilters: preset.filters,
        identity: normalizedIdentity(preset.filters, preset.stats, api),
        stats: preset.stats.map(normalizedStat),
        api,
        request,
        browserPayload,
        browserUrl
      })
    })
    cases.push(clean({
      id: fixture.id,
      item: {
        category: item.category,
        rarity: item.rarity,
        name: item.name,
        baseType: item.baseType,
        info: {
          name: item.info.name,
          refName: item.info.refName,
          namespace: item.info.namespace,
          tradeTag: item.info.tradeTag,
          exchangeable: item.info.exchangeable,
          craftable: item.info.craftable,
          unique: item.info.unique,
          gem: item.info.gem
        },
        itemLevel: item.itemLevel,
        quality: item.quality,
        gemLevel: item.gemLevel,
        mapTier: item.mapTier,
        mapBlighted: item.mapBlighted,
        mapCompletionReward: item.mapCompletionReward && {
          name: item.mapCompletionReward.name,
          refName: item.mapCompletionReward.refName,
          nameTrade: item.mapCompletionReward.nameTrade
        },
        mapArea: item.mapArea && {
          name: item.mapArea.name,
          refName: item.mapArea.refName,
          tradeDisc: item.mapArea.tradeDisc
        },
        areaLevel: item.areaLevel,
        areaItemQuantity: item.areaItemQuantity,
        areaItemRarity: item.areaItemRarity,
        areaPackSize: item.areaPackSize,
        chartSulphur: item.chartSulphur,
        basePercentile: item.basePercentile,
        talismanTier: item.talismanTier,
        sockets: item.sockets,
        stackSize: item.stackSize,
        imbuedGem: item.imbuedGem,
        isUnidentified: item.isUnidentified,
        isCorrupted: item.isCorrupted,
        isUnmodifiable: item.isUnmodifiable,
        isMirrored: item.isMirrored,
        isSplit: item.isSplit,
        isSynthesised: item.isSynthesised,
        isFractured: item.isFractured,
        isVeiled: item.isVeiled,
        isFoil: item.isFoil,
        isFoulborn: item.isFoulborn,
        isVestigial: item.isVestigial,
        influences: item.influences,
        parsedModifiers: item.newMods.map(normalizedModifier),
        calculatedStats: item.statsByType.map(normalizedCalculatedStat),
        unknownModifiers: item.unknownModifiers
      },
      active: created.active,
      presets
    }))
  }
  return { cases, referenceOracles: pinnedFunctionOracles() }
}

let payload
try {
  payload = await runFixtures()
} catch (error) {
  payload = { error: error instanceof Error ? error.stack : String(error) }
}
const response = await fetch('/__apt_family_result', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
if (!response.ok) throw new Error('Reference result upload failed: ' + response.status)
document.body.textContent = 'done'
setTimeout(() => window.close(), 0)
`;
}

function viteConfigSource() {
  return `import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  base: '/',
  publicDir: 'public',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ipc': path.resolve(__dirname, './ipc')
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true
  }
})
`;
}

function mimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function executeReference(sourceRoot, dependencyRenderer, fixtures) {
  const dependencyModules = path.resolve(dependencyRenderer, "node_modules");
  if (!fs.statSync(dependencyModules).isDirectory()) {
    throw new Error(`APT dependency node_modules not found: ${dependencyModules}`);
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ninja-apt-family-"));
  const nodeModulesLink = path.join(tempRoot, "node_modules");
  let server;
  let browser;
  let timeoutHandle;
  try {
    fs.cpSync(path.join(sourceRoot, "renderer/src"), path.join(tempRoot, "src"), { recursive: true });
    fs.cpSync(path.join(sourceRoot, "renderer/public"), path.join(tempRoot, "public"), { recursive: true });
    fs.cpSync(path.join(sourceRoot, "ipc"), path.join(tempRoot, "ipc"), { recursive: true });
    fs.symlinkSync(dependencyModules, nodeModulesLink, "junction");
    fs.writeFileSync(path.join(tempRoot, "src/apt-family-reference.ts"), harnessSource(fixtures));
    fs.writeFileSync(path.join(tempRoot, "vite.config.mts"), viteConfigSource());
    fs.writeFileSync(
      path.join(tempRoot, "index.html"),
      '<!doctype html><html><body><script type="module" src="/src/apt-family-reference.ts"></script></body></html>',
    );

    const node = process.execPath;
    const indexResult = spawnSync(node, [path.join(tempRoot, "src/assets/make-index-files.mjs")], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (indexResult.status !== 0) {
      throw new Error(`APT index generation failed:\n${indexResult.stdout}\n${indexResult.stderr}`);
    }
    const viteBin = path.join(dependencyModules, "vite/bin/vite.js");
    const buildResult = spawnSync(node, [viteBin, "build", "--config", path.join(tempRoot, "vite.config.mts")], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (buildResult.status !== 0) {
      throw new Error(`APT reference build failed:\n${buildResult.stdout}\n${buildResult.stderr}`);
    }

    const distRoot = path.resolve(tempRoot, "dist");
    let resolveResult;
    let rejectResult;
    const resultPromise = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    server = createServer((request, response) => {
      if (request.method === "POST" && request.url === "/__apt_family_result") {
        const chunks = [];
        let size = 0;
        request.on("data", (chunk) => {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) request.destroy(new Error("APT result exceeded 64 MiB."));
          else chunks.push(chunk);
        });
        request.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            response.writeHead(204).end();
            resolveResult(parsed);
          } catch (error) {
            response.writeHead(400).end();
            rejectResult(error);
          }
        });
        request.on("error", rejectResult);
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const absolute = path.resolve(distRoot, relative);
      if (absolute !== distRoot && !absolute.startsWith(`${distRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": mimeType(absolute) });
      fs.createReadStream(absolute).pipe(response);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to bind APT reference server.");

    const edgeCandidates = [
      process.env.GLOAMCORE_APT_EDGE,
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    ].filter(Boolean);
    const edge = edgeCandidates.find((candidate) => fs.existsSync(candidate));
    if (!edge) throw new Error("Microsoft Edge was not found. Set GLOAMCORE_APT_EDGE.");
    browser = spawn(edge, [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-gpu",
      "--no-default-browser-check",
      "--no-first-run",
      `--user-data-dir=${path.join(tempRoot, "edge-profile")}`,
      `http://127.0.0.1:${address.port}/`,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let browserErrors = "";
    browser.stderr.on("data", (chunk) => {
      if (browserErrors.length < 16_384) browserErrors += chunk.toString("utf8");
    });
    const browserExit = new Promise((_, reject) => {
      browser.once("exit", (code) => reject(new Error(
        `APT reference browser exited before returning data (${code}).\n${browserErrors}`,
      )));
    });
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("APT reference browser timed out.")), 120_000);
    });
    return await Promise.race([resultPromise, browserExit, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (browser && browser.exitCode == null) {
      const exited = new Promise((resolve) => browser.once("exit", resolve));
      browser.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(nodeModulesLink)) fs.unlinkSync(nodeModulesLink);
    const tempParent = fs.realpathSync(path.dirname(tempRoot));
    const expectedParent = fs.realpathSync(os.tmpdir());
    if (tempParent !== expectedParent || !path.basename(tempRoot).startsWith("ninja-apt-family-")) {
      throw new Error(`Refusing to remove unexpected temporary path: ${tempRoot}`);
    }
    fs.rmSync(tempRoot, { recursive: true });
  }
}

async function main() {
  const sourceRoot = path.resolve(readArg("--source") || process.env.GLOAMCORE_APT_SOURCE || "");
  const dependencyRenderer = path.resolve(
    readArg("--dependencies") || process.env.GLOAMCORE_APT_DEPENDENCIES || "",
  );
  const output = path.resolve(readArg("--output") || DEFAULT_OUTPUT);
  const probeFixturesPath = readArg("--probe-fixtures");
  const write = hasArg("--write");
  if (!sourceRoot || sourceRoot === path.parse(sourceRoot).root) {
    throw new Error("Pass --source <Awakened PoE Trade checkout>.");
  }
  if (!dependencyRenderer || dependencyRenderer === path.parse(dependencyRenderer).root) {
    throw new Error("Pass --dependencies <APT renderer with node_modules>.");
  }
  const commit = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 10_000,
  }).stdout.trim();
  if (commit !== PINNED_COMMIT) throw new Error(`Expected ${PINNED_COMMIT}, found ${commit || "no commit"}.`);
  const sourceStatus = spawnSync(
    "git",
    ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=no"],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (sourceStatus.status !== 0) {
    throw new Error(`Unable to verify pinned APT worktree cleanliness: ${sourceStatus.stderr.trim()}`);
  }
  if (sourceStatus.stdout.trim()) {
    throw new Error("Pinned APT worktree has tracked changes; reference execution would not prove the pinned commit.");
  }

  const itemsSource = readSourceFile(sourceRoot, "renderer/public/data/en/items.ndjson");
  const statsSource = readSourceFile(sourceRoot, "renderer/public/data/en/stats.ndjson");
  const clientSource = readSourceFile(sourceRoot, "renderer/public/data/en/client_strings.js");
  const coverage = validateCoverage(sourceRoot, parseNdjson(itemsSource));
  const fixtures = probeFixturesPath
    ? JSON.parse(fs.readFileSync(path.resolve(probeFixturesPath), "utf8"))
    : APT_FAMILY_PARITY_FIXTURES;
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error("Probe fixtures must be a non-empty JSON array.");
  }
  const reference = await executeReference(sourceRoot, dependencyRenderer, fixtures);
  if (reference.error) throw new Error(`APT reference harness failed:\n${reference.error}`);
  if (!Array.isArray(reference.cases) || reference.cases.length !== fixtures.length) {
    throw new Error("APT reference harness returned incomplete cases.");
  }
  if (probeFixturesPath) {
    process.stdout.write(`${JSON.stringify(reference, null, 2)}\n`);
    return;
  }
  const aptCases = new Map(reference.cases.map((entry) => [entry.id, entry]));
  const cases = fixtures.map((fixture) => {
    const apt = aptCases.get(fixture.id);
    if (!apt) throw new Error(`APT reference output missing ${fixture.id}.`);
    if (fixture.category !== undefined && apt.item.category !== fixture.category) {
      throw new Error(`${fixture.id} parsed as ${apt.item.category}, expected ${fixture.category}.`);
    }
    return { ...fixture, apt };
  });
  const referenceOracles = reference.referenceOracles;
  if (!referenceOracles?.statSourcesTotal) {
    throw new Error("APT reference harness returned incomplete direct-function oracles.");
  }
  const aptOutputProjection = {
    cases: cases.map(({ id, apt }) => ({ id, apt })),
    referenceOracles,
  };
  const golden = {
    schema: 4,
    source: {
      project: "Awakened PoE Trade",
      version: PINNED_VERSION,
      commit: PINNED_COMMIT,
      itemsSha256: sha256(itemsSource),
      statsSha256: sha256(statsSource),
      clientStringsSha256: sha256(clientSource),
      fixturesSha256: sha256(JSON.stringify(APT_FAMILY_PARITY_FIXTURES)),
      aptOutputsSha256: sha256(JSON.stringify(aptOutputProjection)),
    },
    coverage: {
      executableCategories: coverage.current,
      currentEnumCategories: coverage.currentEnum,
      staleEnumOnlyCategories: coverage.stale,
      categoryFixtures: cases.filter((entry) => entry.kind === "category").length,
      branchFixtures: cases.filter((entry) => entry.kind === "branch").length,
    },
    referenceOracles,
    cases,
  };
  const serialized = `${JSON.stringify(golden, null, 2)}\n`;
  if (write) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, serialized);
    console.log(`Wrote ${path.relative(ROOT, output)} (${cases.length} cases).`);
    return;
  }
  if (!fs.existsSync(output)) throw new Error(`Golden not found: ${output}. Run with --write.`);
  const checkedIn = fs.readFileSync(output, "utf8");
  if (checkedIn !== serialized) throw new Error(`APT family golden is stale: ${output}.`);
  console.log(`Verified ${path.relative(ROOT, output)} (${cases.length} cases).`);
}

await main();
