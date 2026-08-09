import clsx from "clsx";

export function CurrencyMark({
  unit,
  size = "small",
}: {
  unit: string;
  size?: "small" | "medium";
}) {
  const normalized = unit.toLowerCase().replace(/\s+orb$/i, "");
  const knownLabels: Record<string, string> = {
    chaos: "Chaos",
    divine: "Divine",
    exalted: "Exalted",
  };
  const label =
    knownLabels[normalized] ||
    normalized
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <span
      className={clsx(
        "currency-mark",
        `currency-mark--${normalized}`,
        `currency-mark--${size}`,
      )}
      aria-label={`${label} currency`}
      title={`${label} Orb`}
    >
      {label}
    </span>
  );
}
