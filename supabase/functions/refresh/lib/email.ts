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

export async function sendDigest(
  apiKey: string,
  from: string,
  to: string,
  digest: { subject: string; html: string },
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: digest.subject, html: digest.html }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
}
