/**
 * Calculator-model estimates for PoE 3.29 socket colours. Constants and recipe
 * costs follow the public Siveran chromatic model; the distribution engine here
 * is an independent multinomial implementation, not a measured game guarantee.
 */
export interface SocketColourChances {
  r: number;
  g: number;
  b: number;
  w: number;
}

export interface SocketRecolorInput {
  requirementStrength: number;
  requirementDexterity: number;
  requirementIntelligence: number;
  itemLevel: number;
  quality: number;
  sockets: number;
  red: number;
  green: number;
  blue: number;
}

export type SocketRecipeKey =
  | "natural"
  | "chromatic"
  | "nonwhite-2"
  | "nonwhite-3"
  | "nonwhite-4"
  | "trichromatism";

export interface SocketRecipeResult {
  key: SocketRecipeKey;
  label: string;
  chance: number;
  averageAttempts: number;
  chromaticCost: number | null;
  omenCost: number | null;
  averageChaos: number | null;
}

export interface SocketCurrencyRates {
  chromaticChaos: number;
  trichromatismChaos: number;
}

type Counts = [number, number, number, number];

interface Recipe {
  key: SocketRecipeKey;
  label: string;
  guaranteedNonWhite: number;
  forced: Counts;
  chromatics: number | null;
  omens: number | null;
}

const RECIPES: Recipe[] = [
  {
    key: "chromatic",
    label: "Chromatic Orb",
    guaranteedNonWhite: 1,
    forced: [0, 0, 0, 0],
    chromatics: 1,
    omens: null,
  },
  {
    key: "nonwhite-2",
    label: "2 Non-White",
    guaranteedNonWhite: 2,
    forced: [0, 0, 0, 0],
    chromatics: 5,
    omens: null,
  },
  {
    key: "nonwhite-3",
    label: "3 Non-White",
    guaranteedNonWhite: 3,
    forced: [0, 0, 0, 0],
    chromatics: 20,
    omens: null,
  },
  {
    key: "nonwhite-4",
    label: "4 Non-White",
    guaranteedNonWhite: 4,
    forced: [0, 0, 0, 0],
    chromatics: 75,
    omens: null,
  },
  {
    key: "trichromatism",
    label: "Omen of Trichromatism",
    guaranteedNonWhite: 0,
    forced: [1, 1, 1, 0],
    chromatics: null,
    omens: 1,
  },
  {
    key: "natural",
    label: "Natural roll",
    guaranteedNonWhite: 0,
    forced: [0, 0, 0, 0],
    chromatics: null,
    omens: null,
  },
];

const factorial = (value: number) => {
  let result = 1;
  for (let number = 2; number <= value; number += 1) result *= number;
  return result;
};

const arrangements = ([r, g, b, w]: Counts) =>
  factorial(r + g + b + w) /
  (factorial(r) * factorial(g) * factorial(b) * factorial(w));

const ZERO_COUNTS: Counts = [0, 0, 0, 0];

function targetChance(
  full: SocketColourChances,
  rgb: SocketColourChances,
  target: Counts,
  rgbTarget: Counts,
) {
  return arrangements(rgbTarget) * arrangements(target) *
    full.r ** target[0] * full.g ** target[1] *
    full.b ** target[2] * full.w ** target[3] *
    rgb.r ** rgbTarget[0] * rgb.g ** rgbTarget[1] * rgb.b ** rgbTarget[2];
}

type OutcomeLeaf = (
  full: SocketColourChances,
  rgb: SocketColourChances,
  target: Counts,
  rgbTarget: Counts,
) => number;

function enumerateOutcomes(
  full: SocketColourChances,
  rgb: SocketColourChances,
  target: Counts,
  free: number,
  freeBranch: number,
  rgbOnly: number,
  rgbOnlyBranch: number,
  rgbTarget: Counts,
  leaf: OutcomeLeaf,
): number {
  const go = (
    nextTarget: Counts,
    nextFree: number,
    nextFreeBranch: number,
    nextRgbOnly: number,
    nextRgbBranch: number,
    nextRgbTarget: Counts,
  ) => enumerateOutcomes(
    full,
    rgb,
    nextTarget,
    nextFree,
    nextFreeBranch,
    nextRgbOnly,
    nextRgbBranch,
    nextRgbTarget,
    leaf,
  );

  if (free > 0) {
    let chance = 0;
    for (let colour = 0; colour < 4; colour += 1) {
      if (freeBranch > colour + 1) continue;
      const next = [...target] as Counts;
      next[colour] += 1;
      chance += go(next, free - 1, colour + 1, rgbOnly, 1, rgbTarget);
    }
    return chance;
  }

  if (rgbOnly > 0) {
    let chance = 0;
    for (let colour = 0; colour < 3; colour += 1) {
      if (rgbOnlyBranch > colour + 1 || target[colour] <= 0) continue;
      const nextTarget = [...target] as Counts;
      const nextRgbTarget = [...rgbTarget] as Counts;
      nextTarget[colour] -= 1;
      nextRgbTarget[colour] += 1;
      chance += go(
        nextTarget,
        free,
        0,
        rgbOnly - 1,
        colour + 1,
        nextRgbTarget,
      );
    }
    return chance;
  }

  return leaf(full, rgb, target, rgbTarget);
}

const collisionLeaf: OutcomeLeaf = (full, rgb, target, rgbTarget) => {
  const total: Counts = [
    target[0] + rgbTarget[0],
    target[1] + rgbTarget[1],
    target[2] + rgbTarget[2],
    target[3] + rgbTarget[3],
  ];
  const unordered = targetChance(full, rgb, target, rgbTarget);
  return unordered ** 2 / arrangements(total);
};

function applyChromaticCollision(
  chance: number,
  full: SocketColourChances,
  rgb: SocketColourChances,
  sockets: number,
) {
  const base = enumerateOutcomes(
    full, rgb, ZERO_COUNTS, sockets, 1, 0, 1, ZERO_COUNTS, collisionLeaf,
  );
  const allWhite = full.w ** sockets;
  const collisionOnGuaranteed = allWhite * enumerateOutcomes(
    full, rgb, ZERO_COUNTS, sockets, 1, 1, 1, ZERO_COUNTS, collisionLeaf,
  );
  const collision = base + (1 - base) * collisionOnGuaranteed;
  return 1 - (1 - chance) ** (1 / (1 - Math.min(collision, 1 - chance)));
}

export function baseSocketColourChances(
  strength: number,
  dexterity: number,
  intelligence: number,
): SocketColourChances {
  const requirements = [strength, dexterity, intelligence];
  if (requirements.some((value) => !Number.isFinite(value) || value < 0)) {
    return { r: 0, g: 0, b: 0, w: 0 };
  }
  const total = strength + dexterity + intelligence;
  if (total <= 0) return { r: 0, g: 0, b: 0, w: 0 };
  const active = requirements.filter((value) => value > 0).length;
  if (active === 1) {
    const chance = (index: number) =>
      requirements[index] > 0
        ? (0.9 * (10 + requirements[index])) / (total + 20)
        : 0.05 + 4.5 / (total + 20);
    return { r: chance(0), g: chance(1), b: chance(2), w: 0 };
  }
  if (active === 2) {
    const chance = (index: number) =>
      requirements[index] > 0 ? (0.9 * requirements[index]) / total : 0.1;
    return { r: chance(0), g: chance(1), b: chance(2), w: 0 };
  }
  return {
    r: strength / total,
    g: dexterity / total,
    b: intelligence / total,
    w: 0,
  };
}

export function whiteSocketChance(itemLevel: number, quality: number) {
  if (!Number.isFinite(itemLevel) || itemLevel < 1 || !Number.isFinite(quality)) return 0;
  return Math.max(
    0,
    Math.min(
      1,
      1 -
        0.00375 *
          Math.max(itemLevel - 14, 1) *
          (1 + Math.min(Math.max(quality, 0), 30) / 100),
    ),
  );
}

export function socketColourChances(
  input: SocketRecolorInput,
): SocketColourChances {
  const base = baseSocketColourChances(
    input.requirementStrength,
    input.requirementDexterity,
    input.requirementIntelligence,
  );
  if (input.itemLevel < 1 || base.r + base.g + base.b <= 0) return { r: 0, g: 0, b: 0, w: 0 };
  const white = whiteSocketChance(input.itemLevel, input.quality);
  const coloured = 1 - white;
  return {
    r: base.r * coloured,
    g: base.g * coloured,
    b: base.b * coloured,
    w: white,
  };
}

export function calculateSocketRecipes(
  input: SocketRecolorInput,
  rates: SocketCurrencyRates = {
    chromaticChaos: 1,
    trichromatismChaos: 300,
  },
) {
  const wanted = input.red + input.green + input.blue;
  const numeric = [
    input.requirementStrength,
    input.requirementDexterity,
    input.requirementIntelligence,
    input.itemLevel,
    input.quality,
    input.sockets,
    input.red,
    input.green,
    input.blue,
  ];
  if (
    numeric.some((value) => !Number.isFinite(value)) ||
    [input.sockets, input.red, input.green, input.blue].some((value) => !Number.isInteger(value)) ||
    input.requirementStrength < 0 ||
    input.requirementDexterity < 0 ||
    input.requirementIntelligence < 0 ||
    input.quality < 0 ||
    input.red < 0 || input.green < 0 || input.blue < 0 ||
    input.sockets < 1 ||
    input.sockets > 6 ||
    wanted < 1 ||
    wanted > input.sockets ||
    input.itemLevel < 1 ||
    input.requirementStrength +
      input.requirementDexterity +
      input.requirementIntelligence <=
      0
  ) {
    return [];
  }
  const rgb = baseSocketColourChances(
    input.requirementStrength,
    input.requirementDexterity,
    input.requirementIntelligence,
  );
  const full = socketColourChances(input);
  const results: SocketRecipeResult[] = [];
  for (const recipe of RECIPES) {
    const forcedCount = recipe.forced[0] + recipe.forced[1] + recipe.forced[2];
    const fits = recipe.guaranteedNonWhite <= input.sockets &&
      recipe.forced[0] <= input.red &&
      recipe.forced[1] <= input.green &&
      recipe.forced[2] <= input.blue;
    if (!fits && !(recipe.key === "trichromatism" && input.sockets >= forcedCount)) continue;

    const target: Counts = [
      Math.max(0, input.red - recipe.forced[0]),
      Math.max(0, input.green - recipe.forced[1]),
      Math.max(0, input.blue - recipe.forced[2]),
      0,
    ];
    let flexible = input.sockets - wanted;
    if (recipe.key === "trichromatism") {
      if (input.red === 0) flexible -= 1;
      if (input.green === 0) flexible -= 1;
      if (input.blue === 0) flexible -= 1;
      if (flexible < 0) continue;
    }
    const guaranteed = recipe.key === "chromatic" && wanted > 1
      ? 0
      : recipe.guaranteedNonWhite;
    let chance = enumerateOutcomes(
      full,
      rgb,
      target,
      flexible,
      1,
      guaranteed,
      1,
      ZERO_COUNTS,
      targetChance,
    );
    if (recipe.key === "chromatic") {
      chance = applyChromaticCollision(chance, full, rgb, input.sockets);
    }
    if (chance <= 0) continue;
    const averageAttempts = 1 / chance;
    const chromaticCost =
      recipe.chromatics == null ? null : recipe.chromatics * averageAttempts;
    const omenCost =
      recipe.omens == null ? null : recipe.omens * averageAttempts;
    const averageChaos =
      chromaticCost != null
        ? Number.isFinite(rates.chromaticChaos) && rates.chromaticChaos >= 0
          ? chromaticCost * rates.chromaticChaos
          : null
        : omenCost != null
          ? Number.isFinite(rates.trichromatismChaos) && rates.trichromatismChaos >= 0
            ? omenCost * rates.trichromatismChaos
            : null
          : null;
    results.push({
      key: recipe.key,
      label: recipe.label,
      chance,
      averageAttempts,
      chromaticCost,
      omenCost,
      averageChaos,
    });
  }
  return results.sort((left, right) => {
    if (left.averageChaos == null) return 1;
    if (right.averageChaos == null) return -1;
    return left.averageChaos - right.averageChaos;
  });
}
