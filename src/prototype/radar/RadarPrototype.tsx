/**
 * PROTOTYPE (ticket #42) — three variants of the anonymous Digital Release
 * Radar on ?prototype=radar, switchable via ?variant=A|B|C (or ←/→ keys).
 * Throwaway: dev-only mount in App.tsx; delete the src/prototype tree when
 * the ticket resolves.
 */
import { useEffect, useState } from "react";
import { VariantA, NAME as NAME_A } from "./VariantA";
import { VariantB, NAME as NAME_B } from "./VariantB";
import { VariantC, NAME as NAME_C } from "./VariantC";
import type { Region } from "./data";

const VARIANTS = ["A", "B", "C"] as const;
type VariantKey = (typeof VARIANTS)[number];
const NAMES: Record<VariantKey, string> = { A: NAME_A, B: NAME_B, C: NAME_C };

function readVariant(): VariantKey {
  const v = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return (VARIANTS as readonly string[]).includes(v ?? "") ? (v as VariantKey) : "A";
}

export default function RadarPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);
  const [region, setRegion] = useState<Region>("BG");

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      {variant === "A" && <VariantA region={region} onRegion={setRegion} />}
      {variant === "B" && <VariantB region={region} onRegion={setRegion} />}
      {variant === "C" && <VariantC region={region} onRegion={setRegion} />}

      {!import.meta.env.PROD && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-1 rounded-full border border-primary/50 bg-neutral px-2 py-1 shadow-xl">
            <button className="btn btn-ghost btn-xs btn-circle text-neutral-content" onClick={() => go(-1)} aria-label="Previous variant">
              ←
            </button>
            <span className="px-2 font-mono text-xs text-neutral-content">
              {variant} — {NAMES[variant]}
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
