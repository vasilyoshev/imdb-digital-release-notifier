import { AwsClient } from "npm:aws4fetch@1.0.20";
import type { Medium } from "./types.ts";
import type { EventKind } from "./events.ts";

export interface DigestEvent {
  movieTitle: string;
  year: number | null;
  medium: Medium;
  event: EventKind;
  effectiveDate: string;
}

const GROUPS: { kind: EventKind; heading: string }[] = [
  { kind: "released", heading: "Out now" },
  { kind: "announced", heading: "Dates announced" },
  { kind: "date_changed", heading: "Dates changed" },
];

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function line(e: DigestEvent): string {
  const year = e.year ? ` (${e.year})` : "";
  return `<li><strong>${esc(e.movieTitle)}</strong>${year} — ${e.medium}, ${e.effectiveDate}</li>`;
}

export function buildDigest(
  events: DigestEvent[],
  appUrl: string,
): { subject: string; html: string } | null {
  if (events.length === 0) return null;
  const subject = `${events.length} release update${events.length === 1 ? "" : "s"}`;
  const sections = GROUPS
    .map(({ kind, heading }) => {
      const group = events.filter((e) => e.event === kind);
      if (!group.length) return "";
      return `<h3>${heading}</h3><ul>${group.map(line).join("")}</ul>`;
    })
    .join("");
  const html =
    `<div style="font-family:sans-serif;max-width:36rem">${sections}` +
    `<p><a href="${appUrl}">Open the dashboard</a></p></div>`;
  return { subject, html };
}

export interface SesConfig {
  accessKeyId: string;
  secretAccessKey: string;
  /** SES region, e.g. "eu-central-1"; used for both the endpoint host and SigV4. */
  region: string;
}

/** Pure SES v2 SendEmail payload for the owner digest. No I/O, so it's unit-testable. */
export function buildSesPayload(
  from: string,
  to: string,
  digest: { subject: string; html: string },
) {
  return {
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: digest.subject, Charset: "UTF-8" },
        Body: { Html: { Data: digest.html, Charset: "UTF-8" } },
      },
    },
  };
}

export async function sendDigest(
  ses: SesConfig,
  from: string,
  to: string,
  digest: { subject: string; html: string },
): Promise<void> {
  const client = new AwsClient({
    accessKeyId: ses.accessKeyId,
    secretAccessKey: ses.secretAccessKey,
    region: ses.region,
    // SES signs under the "ses" service name; without this aws4fetch infers "email"
    // from the email.<region>.amazonaws.com host and the signature fails.
    service: "ses",
  });
  const res = await client.fetch(
    `https://email.${ses.region}.amazonaws.com/v2/email/outbound-emails`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSesPayload(from, to, digest)),
    },
  );
  if (!res.ok) throw new Error(`SES HTTP ${res.status}: ${await res.text()}`);
}
