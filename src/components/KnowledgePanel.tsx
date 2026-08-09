import clsx from "clsx";
import {
  BookOpen,
  ChevronRight,
  Database,
  FlaskConical,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { bridge } from "../lib/bridge";
import { normalizeKnowledgeSearch } from "../lib/knowledge";
import type { CacheEnvelope, KnowledgeEntry, RawKnowledgeSearchResponse } from "../types";
import { KnowledgeVisual } from "./KnowledgeVisual";

const suggestedSearches = [
  "Divine Orb",
  "maximum Life",
  "Mageblood",
  "Fire Damage",
  "Cluster Jewel",
  "Allflame",
];

type KnowledgeFilter = "all" | "item" | "modifier";

export const KnowledgePanel = forwardRef<
  HTMLInputElement,
  { onSelect: (entry: KnowledgeEntry) => void }
>(function KnowledgePanel({ onSelect }, inputRef) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<KnowledgeFilter>("all");
  const [results, setResults] = useState<KnowledgeEntry[]>([]);
  const [envelope, setEnvelope] =
    useState<CacheEnvelope<RawKnowledgeSearchResponse> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const runSearch = useCallback(
    async (force = false) => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        requestId.current += 1;
        setResults([]);
        setEnvelope(null);
        setError("");
        setLoading(false);
        return;
      }
      const currentRequest = ++requestId.current;
      setLoading(true);
      setError("");
      try {
        const next = await bridge.searchKnowledge({
          query: trimmed,
          limit: 30,
          force,
        });
        if (currentRequest !== requestId.current) return;
        setEnvelope(next);
        setResults(normalizeKnowledgeSearch(next.data, trimmed));
      } catch (reason) {
        if (currentRequest !== requestId.current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setResults([]);
        setEnvelope(null);
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void runSearch(false);
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [runSearch]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? results
        : results.filter((entry) => entry.kind === filter),
    [filter, results],
  );
  const itemCount = results.filter((entry) => entry.kind === "item").length;
  const modifierCount = results.length - itemCount;

  return (
    <section className="knowledge-panel" aria-label="Path of Exile knowledge database">
      <header className="knowledge-hero">
        <div className="knowledge-hero-mark">
          <Database size={24} />
        </div>
        <div>
          <span>LIVE GAME DATABASE</span>
          <h1>Ninja Intel</h1>
          <p>
            Search items and modifiers without leaving your market workflow.
            Results update from PoE Wiki Cargo and remain available from cache.
          </p>
        </div>
        <div className="knowledge-source-pill">
          <i />
          AUTO-UPDATED
        </div>
      </header>

      <div className="knowledge-search-shell">
        <Search size={20} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search an item, base, modifier or tag..."
          aria-label="Search PoE knowledge"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="knowledge-clear"
            onClick={() => setQuery("")}
            aria-label="Clear knowledge search"
          >
            <X size={16} />
          </button>
        )}
        <button
          type="button"
          className="knowledge-refresh"
          onClick={() => void runSearch(true)}
          disabled={query.trim().length < 2 || loading}
          title="Refresh this knowledge search"
        >
          <RefreshCw size={16} className={loading ? "is-spinning" : undefined} />
          Refresh
        </button>
      </div>

      {!query.trim() && (
        <div className="knowledge-start">
          <div>
            <BookOpen size={18} />
            <span>Start with something useful</span>
          </div>
          <div className="knowledge-suggestions">
            {suggestedSearches.map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => setQuery(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
          <section className="knowledge-capabilities">
            <article>
              <Database size={18} />
              <div>
                <strong>Items & bases</strong>
                <span>Requirements, acquisition, metadata and patch origin</span>
              </div>
            </article>
            <article>
              <Tag size={18} />
              <div>
                <strong>Modifier intelligence</strong>
                <span>Affix type, tier, level, tags and internal mod groups</span>
              </div>
            </article>
            <article>
              <FlaskConical size={18} />
              <div>
                <strong>Craft handoff</strong>
                <span>Jump directly into Craft of Exile for specialist simulation</span>
              </div>
            </article>
          </section>
        </div>
      )}

      {query.trim() && (
        <>
          <div className="knowledge-results-bar">
            <div className="knowledge-tabs" role="tablist" aria-label="Knowledge result type">
              {(
                [
                  ["all", "All", results.length],
                  ["item", "Items", itemCount],
                  ["modifier", "Modifiers", modifierCount],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  className={filter === value ? "is-active" : undefined}
                  key={value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            <span className={clsx(envelope?.stale && "is-stale")}>
              {loading
                ? "Searching live data..."
                : envelope?.stale
                  ? "Offline cache"
                  : envelope
                    ? "PoE Wiki live"
                    : "Ready"}
            </span>
          </div>

          {loading && results.length === 0 ? (
            <div className="knowledge-loading" aria-label="Searching PoE knowledge">
              {Array.from({ length: 8 }, (_value, index) => (
                <span key={index} />
              ))}
            </div>
          ) : error ? (
            <div className="knowledge-empty is-error">
              <Database size={27} />
              <h3>Knowledge search is unavailable</h3>
              <p>{error}</p>
              <button type="button" onClick={() => void runSearch(true)}>
                Try again
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="knowledge-empty">
              <Search size={27} />
              <h3>No matching {filter === "all" ? "entries" : `${filter}s`}</h3>
              <p>Try a shorter item name, modifier phrase or crafting tag.</p>
            </div>
          ) : (
            <div className="knowledge-grid">
              {visible.map((entry) => (
                <button
                  type="button"
                  className={clsx(
                    "knowledge-result-card",
                    `knowledge-result-card--${entry.kind}`,
                    entry.frameType && `knowledge-result-card--${entry.frameType}`,
                    entry.icon && "knowledge-result-card--game-art",
                  )}
                  key={entry.key}
                  onClick={() => onSelect(entry)}
                >
                  <span className="knowledge-result-icon">
                    <KnowledgeVisual entry={entry} size={22} />
                  </span>
                  <span className="knowledge-result-copy">
                    <small>
                      {entry.kind === "item"
                        ? entry.itemClass || "Item"
                        : `${entry.generationType} modifier${
                            entry.modifierDomain
                              ? ` · ${entry.modifierDomain}`
                              : ""
                          }`}
                    </small>
                    <strong>{entry.name}</strong>
                    <em>
                      {entry.kind === "item"
                        ? entry.baseType || entry.description || "PoE item database entry"
                        : [entry.modifierName, entry.tier].filter(Boolean).join(" · ") || entry.modifierType}
                    </em>
                    <span>
                      {entry.requiredLevel != null && <i>LVL {entry.requiredLevel}</i>}
                      {entry.tags.slice(0, 3).map((tag) => (
                        <i key={tag}>{tag.replace(/_/g, " ")}</i>
                      ))}
                    </span>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
});
