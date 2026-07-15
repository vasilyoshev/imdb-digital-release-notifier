import { assert, assertEquals } from "jsr:@std/assert@1";
import { isStaleStatus } from "./push.ts";

Deno.test("404 and 410 mark a subscription stale; others don't", () => {
  assert(isStaleStatus(404));
  assert(isStaleStatus(410));
  assertEquals(isStaleStatus(201), false);
  assertEquals(isStaleStatus(500), false);
  assertEquals(isStaleStatus(undefined), false);
});
