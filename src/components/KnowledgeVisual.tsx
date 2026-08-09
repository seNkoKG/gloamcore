import type { LucideIcon } from "lucide-react";
import {
  Anvil,
  Badge,
  Bug,
  Circle,
  CircleDot,
  Coins,
  Component,
  Droplets,
  FlaskConical,
  Gem,
  Map,
  PawPrint,
  ScrollText,
  Shield,
  Sparkles,
  Swords,
  Tag,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { KnowledgeEntry } from "../types";

function fallbackIcon(entry: KnowledgeEntry): LucideIcon {
  const context = [
    entry.itemClass,
    entry.frameType,
    entry.modifierDomain,
    entry.generationType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (entry.kind === "modifier") {
    if (/craft|bench/.test(context)) return Anvil;
    if (/flask/.test(context)) return FlaskConical;
    if (/atlas|area|map/.test(context)) return Map;
    if (/monster|bestiary|beast/.test(context)) return PawPrint;
    if (/jewel/.test(context)) return Gem;
    if (/implicit|enchant|corrupt|eldritch/.test(context)) return Sparkles;
    return Tag;
  }

  if (/currency|gold|coin/.test(context)) return Coins;
  if (/divination/.test(context)) return ScrollText;
  if (/support gem/.test(context)) return Component;
  if (/gem|jewel/.test(context)) return Gem;
  if (/flask|tincture/.test(context)) return FlaskConical;
  if (/map|invitation|memory|logbook/.test(context)) return Map;
  if (/armour|helmet|glove|boot|shield/.test(context)) return Shield;
  if (/weapon|sword|axe|mace|bow|claw|dagger|staff|wand|sceptre|quiver/.test(context)) {
    return Swords;
  }
  if (/belt|ring|amulet/.test(context)) return Circle;
  if (/fossil|resonator/.test(context)) return CircleDot;
  if (/oil/.test(context)) return Droplets;
  if (/scarab|bug/.test(context)) return Bug;
  if (/beast/.test(context)) return PawPrint;
  if (/tattoo|omen/.test(context)) return Badge;
  return Sparkles;
}

export function KnowledgeVisual({
  entry,
  size = 24,
}: {
  entry: KnowledgeEntry;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [entry.icon]);

  if (entry.icon && !failed) {
    return (
      <img
        src={entry.icon}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  const Icon = fallbackIcon(entry);
  return <Icon aria-hidden size={size} strokeWidth={1.65} />;
}
