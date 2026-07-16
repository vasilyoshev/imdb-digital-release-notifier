import { assertEquals } from "jsr:@std/assert@1";
import { detectMediumEvents, type MediumLogState } from "./events.ts";

const TODAY = "2026-07-15";
const clean: MediumLogState = { announcedEver: false, releasedEver: false, lastLoggedDate: null };

Deno.test("no effective date → no events", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: null, state: clean, isNewMovie: true, today: TODAY }),
    [],
  );
});

Deno.test("future date, never announced → announced (notifiable even for new movies)", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-09-01", state: clean, isNewMovie: true, today: TODAY }),
    [{ event: "announced", effectiveDate: "2026-09-01", pastFactOnFirstObservation: false }],
  );
});

Deno.test("past date on a NEW movie → released, seeded silent", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: "2020-01-01", state: clean, isNewMovie: true, today: TODAY }),
    [{ event: "released", effectiveDate: "2020-01-01", pastFactOnFirstObservation: true }],
  );
});

Deno.test("date equal to today on a NEW movie → released, NOT silent (present fact)", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: TODAY, state: clean, isNewMovie: true, today: TODAY }),
    [{ event: "released", effectiveDate: TODAY, pastFactOnFirstObservation: false }],
  );
});

Deno.test("past date appearing on a KNOWN movie → released fires (announced suppressed same-run)", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-07-10", state: clean, isNewMovie: false, today: TODAY }),
    [{ event: "released", effectiveDate: "2026-07-10", pastFactOnFirstObservation: false }],
  );
});

Deno.test("announced date arriving (≤ today) → released once", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: false, lastLoggedDate: "2026-07-15" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-07-15", state, isNewMovie: false, today: TODAY }),
    [{ event: "released", effectiveDate: "2026-07-15", pastFactOnFirstObservation: false }],
  );
});

Deno.test("released ever → nothing more, even if the date moves", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: true, lastLoggedDate: "2026-07-01" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-12-01", state, isNewMovie: false, today: TODAY }),
    [],
  );
});

Deno.test("announced date moved (future→future) → date_changed", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: false, lastLoggedDate: "2026-09-01" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-10-01", state, isNewMovie: false, today: TODAY }),
    [{ event: "date_changed", effectiveDate: "2026-10-01", pastFactOnFirstObservation: false }],
  );
});

Deno.test("moved earlier also fires date_changed", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: false, lastLoggedDate: "2026-10-01" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-08-20", state, isNewMovie: false, today: TODAY }),
    [{ event: "date_changed", effectiveDate: "2026-08-20", pastFactOnFirstObservation: false }],
  );
});

Deno.test("same date as last logged → silence (flap A→B→A across days re-notifies; same date doesn't)", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: false, lastLoggedDate: "2026-09-01" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-09-01", state, isNewMovie: false, today: TODAY }),
    [],
  );
});
