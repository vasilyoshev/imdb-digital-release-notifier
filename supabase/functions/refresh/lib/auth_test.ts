import { assertEquals } from "jsr:@std/assert@1";
import { claimsFromAuthHeader } from "./auth.ts";

function jwt(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

Deno.test("extracts role and sub from a bearer JWT", () => {
  assertEquals(
    claimsFromAuthHeader(`Bearer ${jwt({ role: "service_role" })}`),
    { role: "service_role", sub: undefined },
  );
  assertEquals(
    claimsFromAuthHeader(`Bearer ${jwt({ role: "authenticated", sub: "abc-123" })}`),
    { role: "authenticated", sub: "abc-123" },
  );
});

Deno.test("null on missing/malformed headers", () => {
  assertEquals(claimsFromAuthHeader(null), null);
  assertEquals(claimsFromAuthHeader("Bearer not.a"), null);
  assertEquals(claimsFromAuthHeader("Bearer a.!!!.c"), null);
  assertEquals(claimsFromAuthHeader(`Bearer ${jwt({ nope: true })}`), null);
});
