import { assertEquals } from "jsr:@std/assert";
import { buildSesPayload } from "./email.ts";

Deno.test(
  "buildSesPayload wraps the digest into a SES v2 Simple payload with UTF-8 charset",
  () => {
    const payload = buildSesPayload(
      "IMDb Release Notifier <noreply@send.yoshevbot.uk>",
      "owner@example.com",
      { subject: "2 release updates", html: "<div>hi</div>" }
    );
    assertEquals(payload, {
      FromEmailAddress: "IMDb Release Notifier <noreply@send.yoshevbot.uk>",
      Destination: { ToAddresses: ["owner@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "2 release updates", Charset: "UTF-8" },
          Body: { Html: { Data: "<div>hi</div>", Charset: "UTF-8" } },
        },
      },
    });
  }
);
