import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildDigest, type DigestEvent } from "./email.ts";

const events: DigestEvent[] = [
  { movieTitle: "Dune 3", year: 2026, medium: "digital", event: "released", effectiveDate: "2026-07-15" },
  { movieTitle: "Akira", year: 2027, medium: "theatrical", event: "announced", effectiveDate: "2027-03-01" },
  { movieTitle: "Heat 2", year: 2026, medium: "digital", event: "date_changed", effectiveDate: "2026-11-05" },
];

Deno.test("empty events → null (zero-event runs send nothing)", () => {
  assertEquals(buildDigest([], "https://app.example"), null);
});

Deno.test("digest groups by kind and counts in the subject", () => {
  const digest = buildDigest(events, "https://app.example");
  assert(digest);
  assertEquals(digest.subject, "3 release updates");
  assertStringIncludes(digest.html, "Out now");
  assertStringIncludes(digest.html, "Dates announced");
  assertStringIncludes(digest.html, "Dates changed");
  assertStringIncludes(digest.html, "Dune 3");
  assertStringIncludes(digest.html, "digital");
  assertStringIncludes(digest.html, "2027-03-01");
  assertStringIncludes(digest.html, "https://app.example");
});

Deno.test("single event subject is singular", () => {
  const digest = buildDigest([events[0]], "https://app.example");
  assert(digest);
  assertEquals(digest.subject, "1 release update");
});

Deno.test("html escapes movie titles", () => {
  const digest = buildDigest(
    [{ movieTitle: "<script>x</script>", year: null, medium: "digital", event: "released", effectiveDate: "2026-01-01" }],
    "https://app.example",
  );
  assert(digest);
  assert(!digest.html.includes("<script>"));
});
