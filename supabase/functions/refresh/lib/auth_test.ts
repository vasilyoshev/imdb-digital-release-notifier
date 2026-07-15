import { assertEquals } from "jsr:@std/assert@1";
import { roleFromAuthHeader } from "./auth.ts";

function jwt(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

Deno.test("extracts role from a bearer JWT", () => {
  assertEquals(roleFromAuthHeader(`Bearer ${jwt({ role: "service_role" })}`), "service_role");
  assertEquals(roleFromAuthHeader(`Bearer ${jwt({ role: "authenticated" })}`), "authenticated");
});

Deno.test("null on missing/malformed headers", () => {
  assertEquals(roleFromAuthHeader(null), null);
  assertEquals(roleFromAuthHeader("Bearer not.a"), null);
  assertEquals(roleFromAuthHeader("Bearer a.!!!.c"), null);
});
