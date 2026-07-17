import { assertEquals } from "jsr:@std/assert@1";
import { type DeliverableEvent, selectDeliveries, selectForHydration } from "./pipeline.ts";

Deno.test("selectForHydration: never-hydrated first, then oldest, cap carries remainder", () => {
  const active = [
    { id: 1, refreshed_at: "2026-07-10T00:00:00Z" },
    { id: 2, refreshed_at: null }, // never hydrated → most stale
    { id: 3, refreshed_at: "2026-07-01T00:00:00Z" }, // older than 1
    { id: 4, refreshed_at: null },
  ];
  const plan = selectForHydration(active, 2);
  assertEquals(plan.toHydrate, [2, 4]); // both nulls first, tie broken by id
  assertEquals(plan.deferred, 2);

  const plan3 = selectForHydration(active, 3);
  assertEquals(plan3.toHydrate, [2, 4, 3]); // then oldest refreshed_at
  assertEquals(plan3.deferred, 1);
});

Deno.test("selectForHydration: non-positive / non-finite cap hydrates all", () => {
  const active = [
    { id: 1, refreshed_at: "2026-07-10T00:00:00Z" },
    { id: 2, refreshed_at: null },
  ];
  assertEquals(selectForHydration(active, 0), { toHydrate: [2, 1], deferred: 0 });
  assertEquals(selectForHydration(active, Infinity), { toHydrate: [2, 1], deferred: 0 });
  assertEquals(selectForHydration(active, 99), { toHydrate: [2, 1], deferred: 0 });
});

const events: DeliverableEvent[] = [
  { id: 10, movie_id: 1, created_at: "2026-07-17T03:00:00Z" }, // after follow → deliver
  { id: 11, movie_id: 2, created_at: "2026-07-01T03:00:00Z" }, // before follow → replay, skip
  { id: 12, movie_id: 3, created_at: "2026-07-17T03:00:00Z" }, // not followed → skip
  { id: 13, movie_id: 1, created_at: "2026-07-17T04:00:00Z" }, // already delivered → skip
];
const followedSince = new Map([[1, "2026-07-05T00:00:00Z"], [2, "2026-07-05T00:00:00Z"]]);

Deno.test("selectDeliveries applies all four gates", () => {
  assertEquals(selectDeliveries(events, followedSince, new Set([13]), false), [10]);
});

Deno.test("selectDeliveries: paused user gets nothing", () => {
  assertEquals(selectDeliveries(events, followedSince, new Set(), true), []);
});
