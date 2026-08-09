import {
  BookOpen,
  Box,
  ExternalLink,
  FlaskConical,
  Layers3,
  MapPin,
  Tag,
  X,
} from "lucide-react";
import { bridge } from "../lib/bridge";
import {
  craftOfExileUrl,
  isCraftableKnowledgeEntry,
  knowledgeWikiUrl,
  poeDbUrl,
} from "../lib/knowledge";
import type { KnowledgeEntry } from "../types";
import { KnowledgeVisual } from "./KnowledgeVisual";

function DetailLine({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="knowledge-detail-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function KnowledgeDrawer({
  entry,
  onClose,
}: {
  entry: KnowledgeEntry;
  onClose: () => void;
}) {
  const acquisition = [
    entry.dropText,
    entry.dropAreas.length
      ? `Restricted areas: ${entry.dropAreas.join(", ")}`
      : undefined,
    entry.dropMonsters.length
      ? `Specific monsters: ${entry.dropMonsters.join(", ")}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  const craftable = isCraftableKnowledgeEntry(entry);

  return (
    <aside
      className={`details-drawer knowledge-drawer knowledge-drawer--${entry.frameType || entry.kind}`}
      aria-label={`${entry.name} knowledge details`}
    >
      <div className="details-topline">
        <div>
          <span>NINJA INTEL</span>
          <i>•</i>
          <span>{entry.kind === "item" ? "Item database" : "Modifier database"}</span>
        </div>
        <button type="button" onClick={onClose} title="Close knowledge details" aria-label="Close knowledge details">
          <X size={17} />
        </button>
      </div>

      <div className="details-identity knowledge-identity">
        <div className={`details-icon${entry.icon ? " details-icon--game-art" : ""}`}>
          <KnowledgeVisual entry={entry} size={29} />
        </div>
        <div>
          <span>{entry.kind === "item" ? entry.itemClass || "Item" : `${entry.generationType} modifier`}</span>
          <h2>{entry.name}</h2>
          {(entry.baseType || entry.modifierName) && <p>{entry.baseType || entry.modifierName}</p>}
        </div>
      </div>

      <section className="details-section knowledge-overview">
        <div className="details-section-heading">
          <div>
            <BookOpen size={15} />
            <span>{entry.kind === "item" ? "What it is" : "Modifier rule"}</span>
          </div>
          <strong>PoE Wiki Cargo</strong>
        </div>
        <p>{entry.description || entry.statText || "No readable description is available for this entry."}</p>
        <div className="item-intel-tags">
          {entry.rarity && <span>{entry.rarity}</span>}
          {entry.tier && <span>{entry.tier}</span>}
          {entry.requiredLevel != null && <span>Requires {entry.requiredLevel}</span>}
          {entry.dropLevel != null && <span>Drops at {entry.dropLevel}+</span>}
          {entry.generationType && <span>{entry.generationType}</span>}
        </div>
      </section>

      {entry.kind === "item" ? (
        <section className="details-section knowledge-record">
          <div className="details-section-heading">
            <div>
              <Box size={15} />
              <span>Game record</span>
            </div>
          </div>
          <DetailLine label="Base type" value={entry.baseType} />
          <DetailLine label="Item class" value={entry.itemClass} />
          <DetailLine label="Released" value={entry.releaseVersion && `Patch ${entry.releaseVersion}`} />
          <DetailLine label="Natural drops" value={entry.dropEnabled == null ? undefined : entry.dropEnabled ? "Enabled" : "Disabled"} />
          <DetailLine label="Metadata ID" value={entry.metadataId} />
        </section>
      ) : (
        <section className="details-section knowledge-record">
          <div className="details-section-heading">
            <div>
              <Layers3 size={15} />
              <span>Modifier record</span>
            </div>
          </div>
          <DetailLine
            label="Generation"
            value={
              entry.generationType &&
              `${entry.generationType}${
                entry.generationTypeId != null
                  ? ` (${entry.generationTypeId})`
                  : ""
              }`
            }
          />
          <DetailLine
            label="Domain"
            value={
              entry.modifierDomain &&
              `${entry.modifierDomain}${
                entry.modifierDomainId != null
                  ? ` (${entry.modifierDomainId})`
                  : ""
              }`
            }
          />
          <DetailLine label="Internal ID" value={entry.modifierId} />
          <DetailLine label="Modifier type" value={entry.modifierType} />
          <DetailLine label="Mod groups" value={entry.modifierGroups.join(", ")} />
        </section>
      )}

      {acquisition.length > 0 && (
        <section className="details-section knowledge-acquisition">
          <div className="details-section-heading">
            <div>
              <MapPin size={15} />
              <span>Acquisition</span>
            </div>
          </div>
          {acquisition.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      )}

      {(entry.tags.length > 0 || entry.acquisitionTags.length > 0) && (
        <section className="details-section knowledge-tags-section">
          <div className="details-section-heading">
            <div>
              <Tag size={15} />
              <span>Tags</span>
            </div>
          </div>
          <div className="knowledge-tag-cloud">
            {[...entry.tags, ...entry.acquisitionTags].map((tag) => (
              <span key={tag}>{tag.replace(/_/g, " ")}</span>
            ))}
          </div>
        </section>
      )}

      <div className="details-links knowledge-links">
        <button type="button" onClick={() => void bridge.openExternal(knowledgeWikiUrl(entry))}>
          <BookOpen size={14} />
          Open Wiki
        </button>
        {craftable && (
          <button type="button" className="craft-link" onClick={() => void bridge.openExternal(craftOfExileUrl())}>
            <FlaskConical size={14} />
            Craft of Exile
          </button>
        )}
        <button type="button" onClick={() => void bridge.openExternal(poeDbUrl(entry))}>
          <ExternalLink size={14} />
          PoEDB
        </button>
      </div>

      <p className="knowledge-attribution">
        Live reference data from PoE Wiki Cargo. Crafting calculations stay with Craft of Exile; Ninja Lens does not copy its engine.
      </p>
    </aside>
  );
}
