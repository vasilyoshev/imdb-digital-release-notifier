import { assertEquals } from "jsr:@std/assert@1";
import { computeEffective, sofiaHour, sofiaToday } from "./dates.ts";
import type { RawDate } from "./types.ts";

const raw: RawDate[] = [
  { region: "US", medium: "digital", date: "2026-08-01" },
  { region: "GB", medium: "digital", date: "2026-07-20" },
  { region: "US", medium: "theatrical", date: "2026-05-01" },
];

Deno.test("first region in order wins even with a later date", () => {
  assertEquals(
    computeEffective(raw, ["BG", "US", "GB"], "digital"),
    { date: "2026-08-01", region: "US" },
  );
});

Deno.test("falls through regions without a date for the medium", () => {
  assertEquals(
    computeEffective(raw, ["BG", "GB", "US"], "digital"),
    { date: "2026-07-20", region: "GB" },
  );
});

Deno.test("null when no region has the medium", () => {
  assertEquals(computeEffective(raw, ["BG"], "digital"), null);
  assertEquals(computeEffective([], ["BG", "US", "GB"], "theatrical"), null);
});

Deno.test("sofiaToday formats as YYYY-MM-DD in Europe/Sofia", () => {
  // 2026-01-05T22:30Z is 2026-01-06 00:30 in Sofia (UTC+2, winter)
  assertEquals(sofiaToday(new Date("2026-01-05T22:30:00Z")), "2026-01-06");
});

Deno.test("sofiaHour uses h23 in Europe/Sofia", () => {
  // 06:00Z in July = 09:00 Sofia (UTC+3, summer)
  assertEquals(sofiaHour(new Date("2026-07-15T06:00:00Z")), 9);
  // 22:30Z in January = 00:30 Sofia next day
  assertEquals(sofiaHour(new Date("2026-01-05T22:30:00Z")), 0);
});
