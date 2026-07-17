import { assertEquals } from "jsr:@std/assert@1";
import { buildRadarRows, radarWindow } from "./radar.ts";

Deno.test("radarWindow anchors recent behind and upcoming ahead of today", () => {
  assertEquals(radarWindow("2026-07-17", "recent", 45, 90), { gte: "2026-06-02", lte: "2026-07-17" });
  assertEquals(radarWindow("2026-07-17", "upcoming", 45, 90), { gte: "2026-07-17", lte: "2026-10-15" });
  // Month/year boundary arithmetic.
  assertEquals(radarWindow("2026-01-10", "recent", 45, 90).gte, "2025-11-26");
});

Deno.test("buildRadarRows filters out-of-window leaks and unhydrated, ranks recent newest-first", () => {
  const range = { gte: "2026-06-02", lte: "2026-07-17" };
  const digital = new Map<number, string>([
    [1, "2026-07-10"], // in window
    [2, "2026-08-01"], // leak: after lte → drop
    [3, "2026-07-15"], // in window (newer than 1)
    [4, "2026-05-01"], // leak: before gte → drop
    // 5 has no hydrated date → drop
  ]);
  assertEquals(buildRadarRows([1, 2, 3, 4, 5], "US", "recent", range, digital), [
    { region: "US", window: "recent", movie_id: 3, rank: 0, digital_date: "2026-07-15" },
    { region: "US", window: "recent", movie_id: 1, rank: 1, digital_date: "2026-07-10" },
  ]);
});

Deno.test("buildRadarRows ranks upcoming soonest-first and dedupes", () => {
  const range = { gte: "2026-07-17", lte: "2026-10-15" };
  const digital = new Map<number, string>([[7, "2026-09-01"], [8, "2026-08-01"]]);
  assertEquals(buildRadarRows([7, 8, 7], "GB", "upcoming", range, digital), [
    { region: "GB", window: "upcoming", movie_id: 8, rank: 0, digital_date: "2026-08-01" },
    { region: "GB", window: "upcoming", movie_id: 7, rank: 1, digital_date: "2026-09-01" },
  ]);
});
