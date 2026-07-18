import { assertEquals } from "jsr:@std/assert@1";
import { buildGlobalCascade, computeEffective, dateInZone, hourInZone } from "./dates.ts";
import type { RawDate } from "./types.ts";

const SUPPORTED = ["US", "GB", "BG", "DE", "FR"];

const raw: RawDate[] = [
  { region: "US", medium: "digital", date: "2026-08-01" },
  { region: "GB", medium: "digital", date: "2026-07-20" },
  { region: "US", medium: "theatrical", date: "2026-05-01" },
];

Deno.test("earliest date across all regions wins, regardless of cascade order", () => {
  // GB 2026-07-20 is earlier than US 2026-08-01 → GB, even though US is first.
  assertEquals(
    computeEffective(raw, ["BG", "US", "GB"], "digital"),
    { date: "2026-07-20", region: "GB" },
  );
});

Deno.test("earliest wins even from a region outside the cascade", () => {
  const withPL: RawDate[] = [
    { region: "US", medium: "digital", date: "2025-11-26" },
    { region: "PL", medium: "digital", date: "2003-12-26" }, // earliest, not in cascade
  ];
  assertEquals(
    computeEffective(withPL, ["BG", "US", "GB"], "digital"),
    { date: "2003-12-26", region: "PL" },
  );
});

Deno.test("ties break by cascade priority then region code", () => {
  const tie: RawDate[] = [
    { region: "GB", medium: "digital", date: "2026-07-20" },
    { region: "US", medium: "digital", date: "2026-07-20" },
  ];
  // US precedes GB in this cascade → US wins the same-date tie.
  assertEquals(computeEffective(tie, ["US", "GB"], "digital"), { date: "2026-07-20", region: "US" });
});

Deno.test("null when no region has the medium", () => {
  assertEquals(computeEffective(raw, ["BG"], "digital")?.date, "2026-07-20"); // still earliest, cascade ignored
  assertEquals(computeEffective([], ["BG", "US", "GB"], "theatrical"), null);
  assertEquals(
    computeEffective([{ region: "US", medium: "digital", date: "2026-01-01" }], ["US"], "theatrical"),
    null,
  );
});

Deno.test("buildGlobalCascade returns a lone user's cascade verbatim (v1-equivalent)", () => {
  assertEquals(buildGlobalCascade([["BG", "US", "GB"]], SUPPORTED), ["BG", "US", "GB"]);
});

Deno.test("buildGlobalCascade merges by best rank, ties by supported position", () => {
  // owner BG,US,GB + second user US,DE:
  //   US best rank 0 (user2), BG 0 (owner) → tie, US before BG by supported pos.
  //   GB rank 2, DE rank 1 → DE before GB.
  assertEquals(
    buildGlobalCascade([["BG", "US", "GB"], ["US", "DE"]], SUPPORTED),
    ["US", "BG", "DE", "GB"],
  );
});

Deno.test("buildGlobalCascade tolerates empty input", () => {
  assertEquals(buildGlobalCascade([], SUPPORTED), []);
  assertEquals(buildGlobalCascade([[]], SUPPORTED), []);
});

Deno.test("dateInZone formats as YYYY-MM-DD in the given zone", () => {
  // 2026-01-05T22:30Z is 2026-01-06 00:30 in Sofia (UTC+2, winter)
  assertEquals(dateInZone("Europe/Sofia", new Date("2026-01-05T22:30:00Z")), "2026-01-06");
});

Deno.test("hourInZone uses h23 in the given zone", () => {
  // 06:00Z in July = 09:00 Sofia (UTC+3, summer)
  assertEquals(hourInZone("Europe/Sofia", new Date("2026-07-15T06:00:00Z")), 9);
  // 22:30Z in January = 00:30 Sofia next day
  assertEquals(hourInZone("Europe/Sofia", new Date("2026-01-05T22:30:00Z")), 0);
  // A different zone resolves independently: 06:00Z = 01:00 New York (winter)
  assertEquals(hourInZone("America/New_York", new Date("2026-01-05T06:00:00Z")), 1);
});
