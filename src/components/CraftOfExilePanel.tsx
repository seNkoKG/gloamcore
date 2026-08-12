import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { bridge, isDesktop } from "../lib/bridge";

const CRAFT_OF_EXILE_URL = "https://beta.craftofexile.com/?game=poe1";

export function CraftOfExilePanel() {
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
        void bridge.openCraftOfExile({
          x: bounds.left,
          y: bounds.top,
          width: bounds.width,
          height: bounds.height,
        }).then((visible) => {
          if (disposed) return;
          if (!visible) throw new Error("The Craft of Exile view could not fit inside the app.");
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
      void bridge.hideCraftOfExile().catch(() => undefined);
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
      await bridge.openExternal(CRAFT_OF_EXILE_URL);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(null);
    }
  };

  return (
    <section className={clsx("craft-page", embedded && "craft-page--embedded")}>
      {embedded && isDesktop ? (
        <div ref={viewportRef} className="craft-embedded-viewport">
          {opening === "app" && <Loader2 className="is-spinning" size={22} />}
        </div>
      ) : (
        <>
          <div className="stash-header">
            <div>
              <p className="eyebrow">CRAFTING WORKSPACE</p>
              <h1>Craft of Exile</h1>
            </div>
          </div>
          <div className="stash-provider-card">
            <div className="stash-empty">
              <ShieldCheck size={30} />
              <h2>Use the real Craft of Exile inside GloamCore</h2>
              <p>
                Craft of Exile runs in a dedicated browser profile without Node, Electron,
                filesystem, download, or clipboard-read access. Its settings and inventory
                remain owned by that isolated site session.
              </p>
              <div className="stash-provider-actions">
                <button
                  type="button"
                  className="stash-button stash-button--primary"
                  disabled={opening != null}
                  onClick={() => void openInApp()}
                >
                  {opening === "app" ? <Loader2 className="is-spinning" size={15} /> : <ExternalLink size={15} />}
                  {isDesktop ? "Retry inside app" : "Open Craft of Exile"}
                </button>
              </div>
              <small className="stash-provider-note">
                Craft of Exile is an independent service. Its privacy policy and terms apply.
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
