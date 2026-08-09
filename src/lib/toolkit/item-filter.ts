export type FilterVisibility = "Show" | "Hide" | "Minimal";

export interface FilterStatement {
  key: string;
  operator: "" | "=" | "!" | "==" | "!=" | ">" | ">=" | "<" | "<=";
  values: string[];
  indent: string;
  comment: string;
  raw: string;
  lineIndex: number;
}

export interface ItemFilterBlock {
  id: string;
  visibility: FilterVisibility;
  /** Authored header retained byte-for-byte except for an explicit visibility edit. */
  headerLine: string;
  headerComment: string;
  tier: string;
  startLine: number;
  endLine: number;
  leadingLines: string[];
  bodyLines: string[];
  statements: FilterStatement[];
  continues: boolean;
  removedLineIndexes: number[];
  dirty: boolean;
}

export interface ItemFilterDocument {
  eol: "\n" | "\r\n";
  preamble: string[];
  blocks: ItemFilterBlock[];
  trailing: string[];
}

export type FilterIntent =
  | {
      kind: "visibility";
      blockId: string;
      tier: string;
      value: FilterVisibility;
      createdAt: number;
    }
  | {
      kind: "action";
      blockId: string;
      tier: string;
      action: string;
      values: string[] | null;
      createdAt: number;
    }
  | {
      kind: "move-base";
      blockId: string;
      tier: string;
      baseType: string;
      targetTier: string;
      targetBlockId?: string;
      createdAt: number;
    };

export interface FilterReplayResult {
  document: ItemFilterDocument;
  applied: FilterIntent[];
  skipped: Array<{ intent: FilterIntent; reason: string }>;
}

export interface FilterItemFacts {
  itemClass: string;
  baseType: string;
  rarity: string;
  itemLevel?: number;
  quality?: number;
  linkedSockets?: number;
  sockets?: number;
  stackSize?: number;
  corrupted?: boolean;
  identified?: boolean;
  fractured?: boolean;
  synthesised?: boolean;
  mirrored?: boolean;
  replica?: boolean;
  foulborn?: boolean;
  vestigial?: boolean;
  scourged?: boolean;
  blightedMap?: boolean;
  uberBlightedMap?: boolean;
  gemLevel?: number;
  mapTier?: number;
  memoryStrands?: number;
  width?: number;
  height?: number;
  influences?: string[];
  socketGroups?: string[][];
  hasImplicitMod?: boolean;
  hasEnchantment?: boolean;
}

export interface FilterBlockMatch {
  block: ItemFilterBlock;
  matches: boolean;
  hasUnknowns: boolean;
  firstMatch: boolean;
}

const VISIBILITY = /^(Show|Hide|Minimal)(?:\s*(?:#(.*))?)?$/;
const STATEMENT = /^(\s*)([A-Za-z][A-Za-z0-9]*)(?:\s+(!=|>=|<=|==|!|>|<|=))?(?:\s+(.*?))?\s*$/;
const TIER_TAGS = [
  /\$tier\s*(?:->|[:=])\s*([^#$]+?)(?=\s+\$|$)/i,
  /(?:^|\s)#\s*(?:tier|t)\s*[:=]\s*([^#]+?)\s*$/i,
  /(?:^|\s)#\s*([a-z0-9_. -]+-tier)\b/i,
  /(?:^|\s)#\s*(t\d+(?:\s+[a-z][a-z0-9 -]*)?)\s*$/i,
];

const ACTION_KEYS = new Set([
  "SetTextColor",
  "SetBorderColor",
  "SetBackgroundColor",
  "SetFontSize",
  "PlayAlertSound",
  "PlayAlertSoundPositional",
  "CustomAlertSound",
  "CustomAlertSoundOptional",
  "MinimapIcon",
  "PlayEffect",
  "DisableDropSound",
  "EnableDropSound",
  "DisableDropSoundIfAlertSound",
  "EnableDropSoundIfAlertSound",
  "Continue",
]);

function splitComment(value: string): { value: string; comment: string } {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character === "#" && !quoted) {
      return {
        value: value.slice(0, index).trimEnd(),
        comment: value.slice(index),
      };
    }
  }
  return { value: value.trimEnd(), comment: "" };
}

function tokenizeValues(value: string) {
  const result: string[] = [];
  const expression = /"((?:\\.|[^"\\])*)"|(\S+)/g;
  for (const match of value.matchAll(expression)) {
    result.push(
      match[1] != null
        ? match[1].replace(/\\(["\\])/g, "$1")
        : match[2] || "",
    );
  }
  return result;
}

function parseTier(lines: string[]) {
  for (const line of lines) {
    for (const expression of TIER_TAGS) {
      const match = expression.exec(line);
      if (match?.[1]) return match[1].trim();
    }
  }
  return "Uncategorised";
}

function compactIdentity(value: string) {
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  return hash.toString(36);
}

/** Match upstream's condition fingerprint: appearance edits are not identity. */
function stableBlockIdentity(
  tier: string,
  headerComment: string,
  statements: FilterStatement[],
) {
  const setConditions = new Set(["basetype", "class", "hasexplicitmod", "hasimplicitmod"]);
  const conditions = statements
    .filter((entry) => !ACTION_KEYS.has(entry.key))
    .map((entry) => {
      const key = entry.key.toLowerCase();
      const values = entry.values.map((value) => value.toLowerCase());
      if (setConditions.has(key)) values.sort();
      return `${key}|${entry.operator || "="}|${values.join("\x1f")}`;
    })
    .sort();
  return `block-${compactIdentity([
    `tier:${tier.toLowerCase()}`,
    `comment:${headerComment.toLowerCase()}`,
    ...conditions,
  ].join("\n"))}`;
}

function parseStatement(line: string, lineIndex: number): FilterStatement | null {
  const { value, comment } = splitComment(line);
  if (!value.trim() || value.trimStart().startsWith("#")) return null;
  const match = STATEMENT.exec(value);
  if (!match) return null;
  return {
    indent: match[1] || "",
    key: match[2] || "",
    operator: (match[3] || "") as FilterStatement["operator"],
    values: tokenizeValues(match[4] || ""),
    comment,
    raw: line,
    lineIndex,
  };
}

/** Parse the official item-filter block format while retaining untouched lines. */
export function parseItemFilter(text: string): ItemFilterDocument {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (VISIBILITY.test(line.trim())) starts.push(index);
  });
  if (starts.length === 0) {
    return { eol, preamble: lines, blocks: [], trailing: [] };
  }

  const bodyEnds = starts.map((startLine, index) => {
    const nextStart = starts[index + 1] ?? lines.length;
    let boundary = nextStart;
    while (boundary > startLine + 1) {
      const line = lines[boundary - 1] || "";
      if (line.trim() && !line.trimStart().startsWith("#")) break;
      boundary -= 1;
    }
    return boundary;
  });
  const preamble = lines.slice(0, starts[0]);
  const blocks: ItemFilterBlock[] = [];
  const identityOccurrences = new Map<string, number>();
  let trailing: string[] = [];
  for (let blockIndex = 0; blockIndex < starts.length; blockIndex += 1) {
    const startLine = starts[blockIndex];
    const bodyEnd = bodyEnds[blockIndex];
    const endLine = bodyEnd - 1;
    const headerLine = lines[startLine] || "Show";
    const header = headerLine.trim();
    const match = VISIBILITY.exec(header);
    const visibility = (match?.[1] || "Show") as FilterVisibility;
    const headerComment = match?.[2]?.trim() || "";
    const bodyLines = lines.slice(startLine + 1, bodyEnd);
    const leadingLines =
      blockIndex === 0
        ? []
        : lines.slice(bodyEnds[blockIndex - 1], startLine);
    const statements = bodyLines
      .map((line, lineIndex) => parseStatement(line, lineIndex))
      .filter(Boolean) as FilterStatement[];
    const tier = parseTier([
      ...(blockIndex === 0 ? preamble : leadingLines),
      header,
      ...bodyLines,
    ]);
    const identity = stableBlockIdentity(tier, headerComment, statements);
    const occurrence = identityOccurrences.get(identity) || 0;
    identityOccurrences.set(identity, occurrence + 1);
    blocks.push({
      id: `${identity}::${occurrence}`,
      visibility,
      headerLine,
      headerComment,
      tier,
      startLine,
      endLine,
      leadingLines,
      bodyLines,
      statements,
      continues: statements.some((entry) => entry.key === "Continue"),
      removedLineIndexes: [],
      dirty: false,
    });
  }
  trailing = lines.slice(bodyEnds.at(-1) || lines.length);
  return { eol, preamble, blocks, trailing };
}

function quoteValue(value: string) {
  if (/^[A-Za-z0-9_.:+%/-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function serializeStatement(statement: FilterStatement) {
  const values = statement.values.map(quoteValue).join(" ");
  const operator = statement.operator ? ` ${statement.operator}` : "";
  const payload = values ? ` ${values}` : "";
  const comment = statement.comment ? ` ${statement.comment.trimStart()}` : "";
  return `${statement.indent || "    "}${statement.key}${operator}${payload}${comment}`;
}

function serializeBlock(block: ItemFilterBlock) {
  const header = /^(\s*)(Show|Hide|Minimal)(.*)$/.test(block.headerLine)
    ? block.headerLine.replace(
        /^(\s*)(Show|Hide|Minimal)(.*)$/,
        (_line, leading: string, _visibility: string, remainder: string) =>
          `${leading}${block.visibility}${remainder}`,
      )
    : `${block.visibility}${block.headerComment ? ` # ${block.headerComment}` : ""}`;
  if (!block.dirty) return [header, ...block.bodyLines];
  const removed = new Set(block.removedLineIndexes);
  const byLine = new Map(
    block.statements
      .filter((statement) => statement.lineIndex >= 0)
      .map((statement) => [statement.lineIndex, statement]),
  );
  const body = block.bodyLines.flatMap((line, lineIndex) => {
    if (removed.has(lineIndex)) return [];
    const statement = byLine.get(lineIndex);
    if (!statement || statement.raw) return [line];
    return [serializeStatement(statement)];
  });
  body.push(
    ...block.statements
      .filter((statement) => statement.lineIndex < 0)
      .map(serializeStatement),
  );
  return [header, ...body];
}

export function serializeItemFilter(document: ItemFilterDocument) {
  const output = [...document.preamble];
  document.blocks.forEach((block, index) => {
    if (index > 0) output.push(...block.leadingLines);
    output.push(...serializeBlock(block));
  });
  output.push(...document.trailing);
  return output.join(document.eol);
}

function replaceBlock(
  document: ItemFilterDocument,
  blockId: string,
  update: (block: ItemFilterBlock) => ItemFilterBlock,
) {
  return {
    ...document,
    blocks: document.blocks.map((block) =>
      block.id === blockId ? update(block) : block,
    ),
  };
}

function positiveTextOperator(operator: FilterStatement["operator"]) {
  return operator === "" || operator === "=" || operator === "==";
}

function compareText(
  actual: string,
  operator: FilterStatement["operator"],
  values: string[],
) {
  const current = actual.toLowerCase();
  const matches = values.some((value) => {
    const expected = value.toLowerCase();
    return operator === "==" ? current === expected : current.includes(expected);
  });
  return operator === "!" || operator === "!=" ? !matches : matches;
}

function targetCanMatchBaseType(target: ItemFilterBlock, baseType: string) {
  const conditions = target.statements.filter((entry) => entry.key === "BaseType");
  const firstPositive = conditions.find((entry) => positiveTextOperator(entry.operator));
  return conditions.every((entry) => {
    const values = entry === firstPositive
      ? Array.from(new Set([...entry.values, baseType]))
      : entry.values;
    return compareText(baseType, entry.operator, values);
  });
}

function hasTierAnnotation(line: string) {
  return TIER_TAGS.some((expression) => expression.test(line));
}

export function setBlockVisibility(
  document: ItemFilterDocument,
  blockId: string,
  value: FilterVisibility,
) {
  return replaceBlock(document, blockId, (block) => ({
    ...block,
    visibility: value,
    dirty: true,
  }));
}

export function setBlockAction(
  document: ItemFilterDocument,
  blockId: string,
  action: string,
  values: string[],
) {
  if (!ACTION_KEYS.has(action)) throw new Error(`Unsupported filter action: ${action}`);
  return replaceBlock(document, blockId, (block) => {
    const existing = block.statements.findIndex((entry) => entry.key === action);
    const next: FilterStatement = {
      key: action,
      operator: "",
      values,
      indent: "    ",
      comment: "",
      raw: "",
      lineIndex: -1,
    };
    const statements = [...block.statements];
    if (existing >= 0) {
      statements[existing] = {
        ...next,
        lineIndex: statements[existing].lineIndex,
        indent: statements[existing].indent,
        comment: statements[existing].comment,
      };
    }
    else statements.push(next);
    return { ...block, statements, dirty: true };
  });
}

export function removeBlockAction(
  document: ItemFilterDocument,
  blockId: string,
  action: string,
) {
  if (!ACTION_KEYS.has(action)) throw new Error(`Unsupported filter action: ${action}`);
  return replaceBlock(document, blockId, (block) => {
    const removedLineIndexes = [...block.removedLineIndexes];
    const statements = block.statements.filter((entry) => {
      if (entry.key !== action) return true;
      if (entry.lineIndex >= 0) removedLineIndexes.push(entry.lineIndex);
      return false;
    });
    return { ...block, statements, removedLineIndexes, dirty: true };
  });
}

export function moveBaseType(
  document: ItemFilterDocument,
  blockId: string,
  baseType: string,
  targetBlockIdOrTier: string,
) {
  const source = document.blocks.find((block) => block.id === blockId);
  const exactTarget = document.blocks.find((block) => block.id === targetBlockIdOrTier);
  const tierTargets = document.blocks.filter((block) => block.tier === targetBlockIdOrTier);
  const target = exactTarget || (tierTargets.length === 1 ? tierTargets[0] : undefined);
  const baseExists = source?.statements.some(
    (entry) => entry.key === "BaseType" && positiveTextOperator(entry.operator) && entry.values.includes(baseType),
  );
  if (
    !source ||
    !target ||
    source.id === target.id ||
    !baseExists ||
    !targetCanMatchBaseType(target, baseType)
  ) return document;
  let emptiedBaseCondition = false;
  let next = replaceBlock(document, source.id, (block) => {
    const removedLineIndexes = [...block.removedLineIndexes];
    const statements = block.statements
      .map((entry) =>
        entry.key === "BaseType" && positiveTextOperator(entry.operator)
          ? {
              ...entry,
              values: entry.values.filter((value) => value !== baseType),
              raw: "",
            }
          : entry,
      )
      .filter((entry) => {
        const keep = entry.key !== "BaseType" || entry.values.length > 0;
        if (!keep) emptiedBaseCondition = true;
        if (!keep && entry.lineIndex >= 0) removedLineIndexes.push(entry.lineIndex);
        return keep;
      });
    return { ...block, statements, removedLineIndexes, dirty: true };
  });
  if (emptiedBaseCondition) {
    const sourceIndex = next.blocks.findIndex((block) => block.id === source.id);
    const blocks = next.blocks.filter((block) => block.id !== source.id);
    if (sourceIndex === 0 && blocks[0]?.leadingLines.length) {
      next = {
        ...next,
        preamble: [
          ...next.preamble.filter((line) => !hasTierAnnotation(line)),
          ...blocks[0].leadingLines,
        ],
        blocks: [{ ...blocks[0], leadingLines: [] }, ...blocks.slice(1)],
      };
    } else next = { ...next, blocks };
  }
  next = replaceBlock(next, target.id, (block) => {
    const statements = [...block.statements];
    const index = statements.findIndex((entry) =>
      entry.key === "BaseType" && positiveTextOperator(entry.operator)
    );
    if (index >= 0) {
      statements[index] = {
        ...statements[index],
        values: Array.from(new Set([...statements[index].values, baseType])),
        raw: "",
      };
    } else {
      statements.unshift({
        key: "BaseType",
        operator: "==",
        values: [baseType],
        indent: "    ",
        comment: "",
        raw: "",
        lineIndex: -1,
      });
    }
    return { ...block, statements, dirty: true };
  });
  return next;
}

function resolveIntentBlock(document: ItemFilterDocument, intent: FilterIntent) {
  const exact = document.blocks.find((block) => block.id === intent.blockId);
  const family = intent.blockId.replace(/::\d+$/, "");
  const familyMatches = document.blocks.filter((block) => block.id.replace(/::\d+$/, "") === family);
  if (exact && familyMatches.length === 1) return exact;
  const tierMatches = document.blocks.filter((block) => block.tier === intent.tier);
  return tierMatches.length === 1 ? tierMatches[0] : undefined;
}

function resolveIntentTarget(document: ItemFilterDocument, intent: Extract<FilterIntent, { kind: "move-base" }>) {
  const exact = intent.targetBlockId
    ? document.blocks.find((block) => block.id === intent.targetBlockId)
    : undefined;
  const family = intent.targetBlockId?.replace(/::\d+$/, "");
  const familyMatches = family
    ? document.blocks.filter((block) => block.id.replace(/::\d+$/, "") === family)
    : [];
  if (exact && familyMatches.length === 1) return exact;
  const tierMatches = document.blocks.filter((block) => block.tier === intent.targetTier);
  return tierMatches.length === 1 ? tierMatches[0] : undefined;
}

/** Replay local edits after an online filter refresh without blindly patching line numbers. */
export function replayFilterIntents(
  document: ItemFilterDocument,
  intents: FilterIntent[],
): FilterReplayResult {
  let next = document;
  const applied: FilterIntent[] = [];
  const skipped: FilterReplayResult["skipped"] = [];
  for (const intent of intents) {
    const block = resolveIntentBlock(next, intent);
    if (!block) {
      const count = next.blocks.filter((entry) => entry.tier === intent.tier).length;
      skipped.push({
        intent,
        reason: count > 1
          ? `Tier ${intent.tier} is ambiguous (${count} blocks); choose the exact block again.`
          : `Tier ${intent.tier} no longer exists.`,
      });
      continue;
    }
    if (intent.kind === "visibility") {
      next = setBlockVisibility(next, block.id, intent.value);
    } else if (intent.kind === "action") {
      next = intent.values == null
        ? removeBlockAction(next, block.id, intent.action)
        : setBlockAction(next, block.id, intent.action, intent.values);
    } else {
      const target = resolveIntentTarget(next, intent);
      const baseExists = block.statements.some(
        (entry) => entry.key === "BaseType" && positiveTextOperator(entry.operator) && entry.values.includes(intent.baseType),
      );
      if (!target || !baseExists) {
        skipped.push({
          intent,
          reason: !target
            ? `Target tier ${intent.targetTier} is missing or ambiguous.`
            : `${intent.baseType} is no longer in the source block.`,
        });
        continue;
      }
      const moved = moveBaseType(next, block.id, intent.baseType, target.id);
      if (moved === next) {
        skipped.push({
          intent,
          reason: `${intent.baseType} cannot satisfy the target block's BaseType conditions.`,
        });
        continue;
      }
      next = moved;
    }
    applied.push(intent);
  }
  return { document: next, applied, skipped };
}

export function validateItemFilter(document: ItemFilterDocument) {
  const problems: string[] = [];
  document.blocks.forEach((block, index) => {
    block.statements.forEach((statement) => {
      if (
        ["BaseType", "Class", "Rarity", "HasExplicitMod", "HasImplicitMod"].includes(
          statement.key,
        ) &&
        statement.values.length === 0
      ) {
        problems.push(`Block ${index + 1} has an empty ${statement.key} condition.`);
      }
    });
  });
  return problems;
}

function compareNumber(
  actual: number,
  operator: FilterStatement["operator"],
  expected: number,
) {
  if (operator === "!" || operator === "!=") return actual !== expected;
  if (operator === ">") return actual > expected;
  if (operator === ">=") return actual >= expected;
  if (operator === "<") return actual < expected;
  if (operator === "<=") return actual <= expected;
  return actual === expected;
}

const RARITY_ORDER = ["normal", "magic", "rare", "unique"];

function compareRarity(
  actual: string,
  operator: FilterStatement["operator"],
  expected: string,
) {
  const actualIndex = RARITY_ORDER.indexOf(actual.toLowerCase());
  const expectedIndex = RARITY_ORDER.indexOf(expected.toLowerCase());
  if (actualIndex < 0 || expectedIndex < 0) return compareText(actual, operator, [expected]);
  return compareNumber(actualIndex, operator, expectedIndex);
}

function socketConditionResult(
  statement: FilterStatement,
  item: FilterItemFacts,
  grouped: boolean,
): true | false | "unknown" {
  const token = statement.values[0] || "";
  const match = /^(\d+)?([RGBADW]+)?$/i.exec(token);
  if (!match) return "unknown";
  const minimumCount = match[1] ? Number(match[1]) : 0;
  const wantedColors = [...(match[2] || "").toUpperCase()];
  const negated = statement.operator === "!" || statement.operator === "!=";
  const positiveOperator = negated ? "=" : statement.operator;
  const groups = item.socketGroups;
  if (!groups?.length) {
    if (wantedColors.length || grouped) return "unknown";
    return item.sockets == null
      ? "unknown"
      : compareNumber(item.sockets, statement.operator, minimumCount);
  }
  const candidates = grouped ? groups : [groups.flat()];
  const matchesCandidate = candidates.some((colors) => {
    if (!compareNumber(colors.length, positiveOperator, minimumCount)) return false;
    const available = new Map<string, number>();
    colors.forEach((color) => available.set(color.toUpperCase(), (available.get(color.toUpperCase()) || 0) + 1));
    const needed = new Map<string, number>();
    wantedColors.forEach((color) => needed.set(color, (needed.get(color) || 0) + 1));
    return [...needed].every(([color, count]) => (available.get(color) || 0) >= count);
  });
  return negated ? !matchesCandidate : matchesCandidate;
}

function statementResult(
  statement: FilterStatement,
  item: FilterItemFacts,
): true | false | "unknown" {
  if (ACTION_KEYS.has(statement.key)) return true;
  if (statement.key === "Class") {
    return compareText(item.itemClass, statement.operator, statement.values);
  }
  if (statement.key === "BaseType") {
    return compareText(item.baseType, statement.operator, statement.values);
  }
  if (statement.key === "Rarity") {
    const expected = statement.values[0];
    if (!expected) return "unknown";
    const operator = statement.operator || "=";
    return operator === "=" || operator === "==" || operator === "!" || operator === "!="
      ? compareText(item.rarity, operator === "=" ? "==" : operator, statement.values)
      : compareRarity(item.rarity, operator, expected);
  }
  if (statement.key === "Sockets") {
    return socketConditionResult(statement, item, false);
  }
  if (statement.key === "SocketGroup") {
    return socketConditionResult(statement, item, true);
  }
  if (statement.key === "HasInfluence") {
    if (!item.influences) return "unknown";
    const actual = item.influences.map((entry) => entry.toLowerCase());
    const matches = statement.values.some((entry) =>
      entry.toLowerCase() === "none"
        ? actual.length === 0
        : actual.includes(entry.toLowerCase()),
    );
    return statement.operator === "!" || statement.operator === "!=" ? !matches : matches;
  }
  const numeric: Record<string, number | undefined> = {
    ItemLevel: item.itemLevel,
    Quality: item.quality,
    LinkedSockets: item.linkedSockets,
    Sockets: item.sockets,
    StackSize: item.stackSize,
    GemLevel: item.gemLevel,
    MapTier: item.mapTier,
    MemoryStrands: item.memoryStrands,
    Width: item.width,
    Height: item.height,
  };
  if (statement.key in numeric) {
    const actual = numeric[statement.key];
    const expected = Number(statement.values[0]);
    return actual == null || !Number.isFinite(expected)
      ? "unknown"
      : compareNumber(actual, statement.operator, expected);
  }
  const booleans: Record<string, boolean | undefined> = {
    Corrupted: item.corrupted,
    Identified: item.identified,
    FracturedItem: item.fractured,
    SynthesisedItem: item.synthesised,
    Mirrored: item.mirrored,
    Replica: item.replica,
    Foulborn: item.foulborn,
    Vestigial: item.vestigial,
    Scourged: item.scourged,
    BlightedMap: item.blightedMap,
    UberBlightedMap: item.uberBlightedMap,
    HasImplicitMod: item.hasImplicitMod,
    AnyEnchantment: item.hasEnchantment,
  };
  if (statement.key in booleans) {
    const actual = booleans[statement.key];
    if (actual == null) return "unknown";
    const expected = statement.values.length
      ? statement.values[0]?.toLowerCase() !== "false"
      : true;
    const matches = actual === expected;
    return statement.operator === "!" || statement.operator === "!=" ? !matches : matches;
  }
  return "unknown";
}

/** Evaluate in file order. Unknown future conditions never become an accidental match. */
export function findMatchingFilterBlocks(
  document: ItemFilterDocument,
  item: FilterItemFacts,
) {
  const results: FilterBlockMatch[] = [];
  let foundAny = false;
  let terminated = false;
  for (const block of document.blocks) {
    if (terminated) {
      results.push({ block, matches: false, hasUnknowns: false, firstMatch: false });
      continue;
    }
    const outcomes = block.statements.map((statement) =>
      statementResult(statement, item),
    );
    const hasUnknowns = outcomes.includes("unknown");
    const matches = !outcomes.includes(false) && !hasUnknowns;
    const firstMatch = matches && !foundAny;
    results.push({ block, matches, hasUnknowns, firstMatch });
    if (matches) {
      foundAny = true;
      if (!block.continues) terminated = true;
    }
  }
  return results;
}
