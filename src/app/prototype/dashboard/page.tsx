"use client";
// PROTOTYPE — wayfinder ticket #8: dashboard + calendar UI prototype.
// Three variants of the reworked app's UI, switchable via ?variant= and the
// floating bottom bar (or ← / → keys). Throwaway: this whole route is judged,
// picked apart, then deleted — the winner is rebuilt properly in the new SPA.
//
// Plan: three variants on /prototype/dashboard —
//   A: Console — dense desktop table + Upcoming/History side rail
//   B: Calendar-first — month grid hero, poster rail, history drawer
//   C: Phone app — mobile column with bottom tabs (Films/Calendar/Feed/Settings)
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PrototypeSwitcher } from "./switcher";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

const VARIANTS = [
  { key: "A", name: "Console (table + side rail)", Component: VariantA },
  { key: "B", name: "Calendar-first", Component: VariantB },
  { key: "C", name: "Phone app (bottom tabs)", Component: VariantC },
];

const Prototype = () => {
  const searchParams = useSearchParams();
  const key = searchParams.get("variant") ?? "A";
  const variant = VARIANTS.find((v) => v.key === key) ?? VARIANTS[0];

  return (
    <>
      <variant.Component />
      <PrototypeSwitcher
        variants={VARIANTS.map(({ key, name }) => ({ key, name }))}
        current={variant.key}
      />
    </>
  );
};

export default function PrototypeDashboardPage() {
  return (
    <Suspense>
      <Prototype />
    </Suspense>
  );
}
