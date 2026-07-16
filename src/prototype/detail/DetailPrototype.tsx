/**
 * PROTOTYPE (ticket #43) — the movie detail view, three presentations on
 * ?prototype=detail&variant=A|B|C (←/→ keys cycle). The host page is the
 * winning Console radar (ticket #42, Variant A); click any table row to
 * open the detail. Throwaway: dev-only mount in App.tsx.
 */
import { useEffect, useState } from "react";
import { VariantA as ConsoleRadar } from "../radar/VariantA";
import type { RadarMovie, Region } from "../radar/data";
import { DetailA, NAME as NAME_A } from "./DetailA";
import { DetailB, NAME as NAME_B } from "./DetailB";
import { DetailC, NAME as NAME_C } from "./DetailC";

const VARIANTS = ["A", "B", "C"] as const;
type VariantKey = (typeof VARIANTS)[number];
const NAMES: Record<VariantKey, string> = { A: NAME_A, B: NAME_B, C: NAME_C };

function readVariant(): VariantKey {
  const v = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return (VARIANTS as readonly string[]).includes(v ?? "") ? (v as VariantKey) : "A";
}

export default function DetailPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);
  const [region, setRegion] = useState<Region>("BG");
  const [movie, setMovie] = useState<RadarMovie | null>(null);

  const go = (dir: 1 | -1) => {
    const next = VARIANTS[(VARIANTS.indexOf(variant) + dir + VARIANTS.length) % VARIANTS.length];
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
    setVariant(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "Escape") setMovie(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const close = () => setMovie(null);

  return (
    <>
      <ConsoleRadar region={region} onRegion={setRegion} onSelect={setMovie} />

      {movie && variant === "A" && <DetailA movie={movie} region={region} onClose={close} />}
      {movie && variant === "B" && <DetailB movie={movie} region={region} onClose={close} />}
      {movie && variant === "C" && <DetailC movie={movie} region={region} onClose={close} />}

      {!import.meta.env.PROD && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-1 rounded-full border border-primary/50 bg-neutral px-2 py-1 shadow-xl">
            <button className="btn btn-ghost btn-xs btn-circle text-neutral-content" onClick={() => go(-1)} aria-label="Previous variant">
              ←
            </button>
            <span className="px-2 font-mono text-xs text-neutral-content">
              detail {variant} — {NAMES[variant]}
              {!movie && <span className="opacity-50"> · click a row</span>}
            </span>
            <button className="btn btn-ghost btn-xs btn-circle text-neutral-content" onClick={() => go(1)} aria-label="Next variant">
              →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
