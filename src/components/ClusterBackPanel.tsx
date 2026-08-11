import { ClipboardCheck, ExternalLink, LoaderCircle, Search, Waypoints } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bridge } from "../lib/bridge";
import { buildOfficialTradeBrowserUrl } from "../lib/price-check/official-trade-route";
import {
  buildClusterBackTradeQuery,
  eligibleClusterBackNotables,
  inspectCopiedClusterBack,
  type ClusterBackData,
} from "../lib/toolkit/cluster-back";
import type { OfficialTradeListingsResult } from "../lib/price-check/types";
import "../cluster-back.css";

export function ClusterBackPanel({ league }: { league: string }) {
  const [data, setData] = useState<ClusterBackData | null>(null);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [baseTag, setBaseTag] = useState("");
  const [trade, setTrade] = useState<OfficialTradeListingsResult | null>(null);
  const [verification, setVerification] = useState<ReturnType<typeof inspectCopiedClusterBack> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/data/toolkit/cluster-back-v1.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Cluster data returned HTTP ${response.status}.`);
        return response.json() as Promise<ClusterBackData>;
      })
      .then((payload) => {
        if (!active) return;
        if (payload.schema !== 1 || payload.bases.length !== 17 || payload.notables.length !== 107) {
          throw new Error("Bundled Cluster Back data failed its integrity check.");
        }
        setData(payload);
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
  }, []);

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

  if (!data) return <div className="cluster-back-loading"><LoaderCircle className="is-spinning" size={18}/> {message || "Loading verified PoB cluster ordering…"}</div>;

  return <div className="cluster-back-workbench">
    <section className="cluster-back-config">
      <header><Waypoints size={19}/><div><h2>Cluster Back</h2><p>Keep two wanted notables at the front of an 8-passive large cluster.</p></div></header>
      <div className="cluster-back-fields">
        <label>Front notable A<select value={first} onChange={(event) => setFirst(event.target.value)}><option value="">Choose notable…</option>{currentNotables.map((notable) => <option key={notable.name} value={notable.name} disabled={notable.name === second}>{notable.name}</option>)}</select></label>
        <label>Front notable B<select value={second} onChange={(event) => setSecond(event.target.value)}><option value="">Choose notable…</option>{currentNotables.map((notable) => <option key={notable.name} value={notable.name} disabled={notable.name === first}>{notable.name}</option>)}</select></label>
        <label>Large-cluster base<select value={baseTag} onChange={(event) => setBaseTag(event.target.value)}><option value="">Any compatible base</option>{data.bases.map((base) => <option key={base.tag} value={base.tag} disabled={!validBaseTags.has(base.tag)}>{base.name}</option>)}</select></label>
      </div>
      <div className="cluster-back-actions">
        <button type="button" className="is-primary" disabled={busy || !candidates.length} onClick={findListings}>{busy ? <LoaderCircle className="is-spinning" size={14}/> : <Search size={14}/>} Search official trade</button>
        <button type="button" disabled={!candidates.length} onClick={openTrade}><ExternalLink size={14}/> Open query</button>
        <button type="button" onClick={verifyClipboard}><ClipboardCheck size={14}/> Verify copied jewel</button>
      </div>
      {message && <p className="cluster-back-message" role="alert">{message}</p>}
      {trade && <div className="cluster-back-trade"><strong>{trade.total.toLocaleString()} matches</strong><span>{trade.listings.length ? trade.listings.slice(0, 5).map((listing) => listing.price ? `${listing.price.amount} ${listing.price.currency}` : "unpriced").join(" · ") : "No priced online listings returned."}</span></div>}
      {verification && <div className={`cluster-back-verification ${verification.valid ? "is-valid" : "is-invalid"}`}><strong>{verification.valid ? `${verification.back?.name} is at the back` : "Jewel could not be verified"}</strong><span>{verification.valid ? `${verification.base?.name} · ${verification.notables.map((notable) => notable.name).join(" → ")}` : verification.errors.join(" ")}</span></div>}
    </section>
    <aside className="cluster-back-results">
      <header><span>Eligible back notables</span><strong>{candidates.length}</strong></header>
      {!first || !second ? <p>Choose two different front notables.</p> : !candidates.length ? <p>No current notable can satisfy ordering, spawn-base, mod-group, and affix-slot constraints.</p> : <div>{candidates.map((candidate) => <article key={candidate.notable.name}><span><strong>{candidate.notable.name}</strong><small>PoB order {candidate.notable.sortOrder}</small></span><em>{candidate.baseTags.length} base{candidate.baseTags.length === 1 ? "" : "s"}</em></article>)}</div>}
      <footer>Exact result requires three notable modifiers on an 8-passive Large Cluster Jewel. Data comes from installed PoB ordering, current Wiki spawn weights, and official Trade stat IDs.</footer>
    </aside>
  </div>;
}
