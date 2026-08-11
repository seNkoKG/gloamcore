import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { bridge, isDesktop } from "../lib/bridge";

const WEALTHY_EXILE_URL = "https://wealthyexile.com/stash";

export function StashWealthPanel({ league: _league }: { league: string }) {
  const [opening, setOpening] = useState<"app" | null>(isDesktop ? "app" : null);
  const [error, setError] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState(isDesktop);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!embedded || !isDesktop || !viewport) return;
    let disposed = false;
    let frame = 0;
    let opened = false;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = viewport.getBoundingClientRect();
        if (bounds.width < 1 || bounds.height < 1) return;
        void bridge.openWealthyExile({
          x: bounds.left,
          y: bounds.top,
          width: bounds.width,
          height: bounds.height,
        }).then((visible) => {
          if (disposed) return;
          if (!visible) throw new Error("The Wealthy Exile view could not fit inside the app.");
          if (!opened) {
            opened = true;
            setOpening(null);
          }
        }).catch((cause) => {
          if (disposed) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setEmbedded(false);
          setOpening(null);
        });
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    sync();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      void bridge.hideWealthyExile().catch(() => undefined);
    };
  }, [embedded]);

  const openInApp = async () => {
    setOpening("app");
    setError(null);
    if (isDesktop) {
      setEmbedded(true);
      return;
    }
    try {
      await bridge.openExternal(WEALTHY_EXILE_URL);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(null);
    }
  };

  return (
    <section className={clsx("stash-page", embedded && "stash-page--embedded")}>
      {embedded && isDesktop ? (
        <div ref={viewportRef} className="stash-embedded-viewport">
          {opening === "app" && <Loader2 className="is-spinning" size={22} />}
        </div>
      ) : (
        <>
          <div className="stash-header">
            <div>
              <p className="eyebrow">STASH WEALTH</p>
              <h1>Wealthy Exile</h1>
            </div>
          </div>
          <div className="stash-provider-card">
            <div className="stash-empty">
              <ShieldCheck size={30} />
              <h2>Use Wealthy Exile without sharing its OAuth access</h2>
              <p>
                The app embeds the real Wealthy Exile website in an isolated browser view.
                Wealthy Exile owns the Path of Exile sign-in and stash connection. The app
                does not read its cookies, OAuth tokens, or stash responses.
              </p>
              <div className="stash-provider-actions">
                <button
                  type="button"
                  className="stash-button stash-button--primary"
                  disabled={opening != null}
                  onClick={() => void openInApp()}
                >
                  {opening === "app" ? <Loader2 className="is-spinning" size={15} /> : <ExternalLink size={15} />}
                  {isDesktop ? "Retry inside app" : "Open Wealthy Exile"}
                </button>
              </div>
              <small className="stash-provider-note">
                Wealthy Exile is an independent service. Its terms and privacy policy apply.
              </small>
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="stash-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
