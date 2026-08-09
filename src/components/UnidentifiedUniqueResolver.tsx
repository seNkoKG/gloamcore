import type { ParsedPoeItem } from "../lib/price-check/types";
import {
  uniqueIdentityProfile,
  uniqueIdentityProfilesForBase,
  type PinnedUniqueIdentityProfile,
} from "../lib/price-check/magic-base-type";

export function unidentifiedUniqueCandidates(
  item: ParsedPoeItem | null | undefined,
): PinnedUniqueIdentityProfile[] {
  if (
    !item ||
    item.rarity !== "unique" ||
    item.identified ||
    uniqueIdentityProfile(item.name, item)
  ) return [];
  return uniqueIdentityProfilesForBase(item.baseType || item.name, item);
}

interface UnidentifiedUniqueResolverProps {
  item: ParsedPoeItem;
  compact?: boolean;
  onIdentify: (name: string) => void;
}

/**
 * Awakened-style identity picker for an unidentified unique base. Trade cannot
 * know which unique was copied until the user selects one; a sole candidate is
 * resolved automatically by PriceCheckApp before this component is rendered.
 */
export function UnidentifiedUniqueResolver({
  item,
  compact = false,
  onIdentify,
}: UnidentifiedUniqueResolverProps) {
  const candidates = unidentifiedUniqueCandidates(item);
  if (candidates.length <= 1) return null;

  return (
    <section
      className={compact ? "pco-unique-resolver" : "pc-unique-resolver"}
      aria-label={`Choose the unidentified ${item.baseType} identity`}
    >
      <strong>WHICH {item.baseType.toUpperCase()}?</strong>
      <div>
        {candidates.map((candidate) => (
          <button
            type="button"
            key={candidate.name}
            onClick={() => onIdentify(candidate.name)}
            title={`Price check as ${candidate.name}`}
          >
            {candidate.icon ? <img src={candidate.icon} alt="" /> : null}
            <span>{candidate.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
