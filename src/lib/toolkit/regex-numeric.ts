function digitRange(first: number, last: number) {
  if (first === last) return String(first);
  if (first === 0 && last === 9) return "\\d";
  return `[${first}-${last}]`;
}

function trailingDigits(count: number) {
  if (count === 0) return "";
  if (count === 1) return "\\d";
  return `\\d{${count}}`;
}

/** A canonical, non-negative integer pattern whose value is at least minimum. */
export function minimumNumberRegex(minimum: number) {
  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    throw new RangeError("Minimum must be a non-negative safe integer.");
  }
  if (minimum === 0) return "(?:0|[1-9]\\d*)";
  if (minimum === 1) return "[1-9]\\d*";

  const digits = String(minimum);
  const alternatives: string[] = [];
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = Number(digits[index]);
    const first = index === digits.length - 1 ? digit : digit + 1;
    if (first > 9) continue;
    alternatives.push(
      `${digits.slice(0, index)}${digitRange(first, 9)}${trailingDigits(
        digits.length - index - 1,
      )}`,
    );
  }
  alternatives.push(`[1-9]\\d{${digits.length},}`);
  return `(?:${alternatives.join("|")})`;
}
