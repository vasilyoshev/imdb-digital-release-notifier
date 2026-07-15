"use client";
// PROTOTYPE — floating variant switcher. Not part of any design being judged.
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const PrototypeSwitcher = ({
  variants,
  current,
}: {
  variants: { key: string; name: string }[];
  current: string;
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const idx = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  const go = (dir: 1 | -1) => {
    const next = variants[(idx + dir + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", next.key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full bg-neutral text-neutral-content px-3 py-1.5 shadow-lg text-sm">
      <button
        className="btn btn-xs btn-circle btn-ghost"
        onClick={() => go(-1)}
        aria-label="Previous variant"
      >
        ←
      </button>
      <span className="whitespace-nowrap font-medium">
        {variants[idx].key} — {variants[idx].name}
      </span>
      <button
        className="btn btn-xs btn-circle btn-ghost"
        onClick={() => go(1)}
        aria-label="Next variant"
      >
        →
      </button>
    </div>
  );
};
