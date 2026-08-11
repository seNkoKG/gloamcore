import { ChevronDown, ClipboardCheck, ExternalLink, LoaderCircle, Search, Waypoints } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import clusterBackPayload from "../../public/data/toolkit/cluster-back-v1.json";
import { bridge } from "../lib/bridge";
import { buildOfficialTradeBrowserUrl } from "../lib/price-check/official-trade-route";
import {
  buildClusterBackTradeQuery,
  eligibleClusterBackNotables,
  inspectCopiedClusterBack,
  isClusterBackData,
  type ClusterBackData,
  type ClusterBackNotable,
} from "../lib/toolkit/cluster-back";
import type { OfficialTradeListingsResult } from "../lib/price-check/types";
import "../cluster-back.css";

function notableIcon(notable: ClusterBackNotable | null | undefined) {
  return notable?.icon ? new URL(notable.icon, document.baseURI).href : "";
}

function bundledIcon(path: string) {
  return new URL(path, document.baseURI).href;
}

function NotablePicker({
  label,
  notables,
  value,
  excluded,
  detailsRef,
  onChange,
}: {
  label: string;
  notables: ClusterBackNotable[];
  value: string;
  excluded: string;
  detailsRef: RefObject<HTMLDetailsElement>;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = notables.find((notable) => notable.name === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return notables.filter((notable) => notable.name !== excluded
      && (!needle || notable.name.toLocaleLowerCase().includes(needle)));
  }, [excluded, notables, query]);

  const choose = (name: string) => {
    onChange(name);
    setQuery("");
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return <label className="cluster-notable-field">
    <span>{label}</span>
    <details ref={detailsRef} className="cluster-notable-picker">
      <summary>
        {selected ? <img src={notableIcon(selected)} alt=""/> : <span className="cluster-notable-placeholder"><Waypoints size={18}/></span>}
        <strong>{selected?.name || "Choose notable"}</strong>
        <ChevronDown size={14}/>
      </summary>
      <div className="cluster-notable-menu">
        <div className="cluster-notable-search"><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a notable…" aria-label={`Search ${label}`}/></div>
        <div className="cluster-notable-options">
          {selected && <button type="button" className="is-clear" onClick={() => choose("")}>Clear selection</button>}
          {filtered.map((notable) => <button type="button" key={notable.name} className={notable.name === value ? "is-selected" : ""} onClick={() => choose(notable.name)}>
            <img src={notableIcon(notable)} alt=""/><span>{notable.name}</span>
          </button>)}
          {!filtered.length && <p>No matching notable.</p>}
        </div>
      </div>
    </details>
  </label>;
}

export function ClusterBackPanel({ league }: { league: string }) {
  const data: ClusterBackData | null = isClusterBackData(clusterBackPayload) ? clusterBackPayload : null;
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [baseTag, setBaseTag] = useState("");
  const [trade, setTrade] = useState<OfficialTradeListingsResult | null>(null);
  const [verification, setVerification] = useState<ReturnType<typeof inspectCopiedClusterBack> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const firstPicker = useRef<HTMLDetailsElement>(null);
  const secondPicker = useRef<HTMLDetailsElement>(null);

  const currentNotables = useMemo(
    () => data?.notables.filter((notable) => !notable.legacyOnly) || [],
    [data],
  );
  const allCandidates = useMemo(
    () => data ? eligibleClusterBackNotables(data, first, second) : [],
    [data, first, second],
  );
  const candidates = useMemo(
    () => data ? eligibleClusterBackNotables(data, first, second, baseTag) : [],
    [baseTag, data, first, second],
  );
  const validBaseTags = useMemo(
    () => new Set(allCandidates.flatMap((candidate) => candidate.baseTags)),
    [allCandidates],
  );
  const selectedFirst = currentNotables.find((notable) => notable.name === first);
  const selectedSecond = currentNotables.find((notable) => notable.name === second);

  const openPicker = (picker: RefObject<HTMLDetailsElement>) => {
    if (!picker.current) return;
    picker.current.open = true;
    requestAnimationFrame(() => picker.current?.querySelector("input")?.focus());
  };

  useEffect(() => {
    if (baseTag && !validBaseTags.has(baseTag)) setBaseTag("");
    setTrade(null);
  }, [baseTag, first, second, validBaseTags]);

  const findListings = async () => {
    if (!data) return;
    setBusy(true);
    setMessage("");
    try {
      if (!bridge.getOfficialTradeListings) throw new Error("Official Trade search is available in the Windows app.");
      const tradeQuery = buildClusterBackTradeQuery(data, first, second, candidates, baseTag);
      const result = await bridge.getOfficialTradeListings({ league, tradeQuery, api: "trade", force: true });
      setTrade(result);
      if (result.error) setMessage(result.error);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openTrade = async () => {
    if (!data) return;
    try {
      const tradeQuery = buildClusterBackTradeQuery(data, first, second, candidates, baseTag);
      await bridge.openExternal(buildOfficialTradeBrowserUrl({ league, tradeQuery, searchId: trade?.searchId }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const verifyClipboard = async () => {
    if (!data) return;
    setMessage("");
    try {
      const capture = await bridge.readClipboardItem();
      setVerification(inspectCopiedClusterBack(data, capture.text));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  if (!data) return <div className="cluster-back-loading">Bundled Cluster Back data failed its integrity check.</div>;

  return <div className="cluster-back-workbench">
    <section className="cluster-back-config">
      <header><Waypoints size={19}/><div><h2>Cluster Back</h2><p>Keep two wanted notables at the front of an 8-passive large cluster.</p></div></header>
      <div className="cluster-jewel-stage">
        <div className="cluster-jewel-ring" aria-label="Large Cluster Jewel notable layout">
          <span className="cluster-jewel-orbit"/>
          <img className="cluster-jewel-art" src={bundledIcon(data.largeJewelIcon)} alt="Large Cluster Jewel"/>
          <span className="cluster-jewel-small-socket is-left"/><span className="cluster-jewel-small-socket is-right"/><span className="cluster-jewel-small-socket is-bottom"/>
          <div className="cluster-position is-back" title="A compatible notable here is skipped while pathing between both front notables.">
            {candidates.length === 1 ? <img src={notableIcon(candidates[0].notable)} alt=""/> : <strong>{candidates.length || "?"}</strong>}
            <span>Back options</span>
          </div>
          <button type="button" className={`cluster-position is-front-left ${selectedFirst ? "is-filled" : ""}`} onClick={() => openPicker(firstPicker)} aria-label="Choose left front notable">
            {selectedFirst ? <img src={notableIcon(selectedFirst)} alt=""/> : <strong>+</strong>}<span>Front A</span>
          </button>
          <button type="button" className={`cluster-position is-front-right ${selectedSecond ? "is-filled" : ""}`} onClick={() => openPicker(secondPicker)} aria-label="Choose right front notable">
            {selectedSecond ? <img src={notableIcon(selectedSecond)} alt=""/> : <strong>+</strong>}<span>Front B</span>
          </button>
        </div>
        <p>Choose the two teal front positions. Craftable notables for the skippable back position appear on the right.</p>
      </div>
      <div className="cluster-back-fields">
        <NotablePicker label="Front notable A" notables={currentNotables} value={first} excluded={second} detailsRef={firstPicker} onChange={setFirst}/>
        <NotablePicker label="Front notable B" notables={currentNotables} value={second} excluded={first} detailsRef={secondPicker} onChange={setSecond}/>
        <label>Large Cluster Jewel type<select value={baseTag} onChange={(event) => setBaseTag(event.target.value)}><option value="">Any compatible type</option>{data.bases.map((base) => <option key={base.tag} value={base.tag} disabled={!validBaseTags.has(base.tag)}>{base.name}</option>)}</select></label>
      </div>
      <div className="cluster-back-actions">
        <button type="button" className="is-primary" disabled={busy || !candidates.length} onClick={findListings}>{busy ? <LoaderCircle className="is-spinning" size={14}/> : <Search size={14}/>} Search official trade</button>
        <button type="button" disabled={!candidates.length} onClick={openTrade}><ExternalLink size={14}/> Open query</button>
        <button type="button" onClick={verifyClipboard}><ClipboardCheck size={14}/> Verify copied jewel</button>
      </div>
      {message && <p className="cluster-back-message" role="alert">{message}</p>}
      {trade && <div className="cluster-back-trade"><strong>{trade.total.toLocaleString()} matches</strong><span>{trade.listings.length ? trade.listings.slice(0, 5).map((listing) => listing.price ? `${listing.price.amount} ${listing.price.currency}` : "unpriced").join(" · ") : "No priced online listings returned."}</span></div>}
      {verification && <div className={`cluster-back-verification ${verification.valid ? "is-valid" : "is-invalid"}`}>
        {verification.valid && verification.back && <img src={notableIcon(verification.back)} alt=""/>}
        <span><strong>{verification.valid ? `${verification.back?.name} is at the back` : "Jewel could not be verified"}</strong><span>{verification.valid ? `${verification.base?.name} · ${verification.notables.map((notable) => notable.name).join(" → ")}` : verification.errors.join(" ")}</span></span>
      </div>}
    </section>
    <aside className="cluster-back-results">
      <header><span>Eligible back notables</span><strong>{candidates.length}</strong></header>
      {!first || !second ? <p>Choose two different front notables.</p> : !candidates.length ? <p>No current notable can satisfy ordering, spawn-base, mod-group, and affix-slot constraints.</p> : <div>{candidates.map((candidate) => <article key={candidate.notable.name}><img src={notableIcon(candidate.notable)} alt=""/><span><strong>{candidate.notable.name}</strong><small>PoB order {candidate.notable.sortOrder}</small></span><em>{candidate.baseTags.length} base{candidate.baseTags.length === 1 ? "" : "s"}</em></article>)}</div>}
      <footer>Exact result requires three notable modifiers on an 8-passive Large Cluster Jewel. Data comes from installed PoB ordering, current Wiki spawn weights, and official Trade stat IDs.</footer>
    </aside>
  </div>;
}
