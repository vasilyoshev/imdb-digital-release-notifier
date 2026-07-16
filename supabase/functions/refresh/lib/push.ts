import * as webpush from "jsr:@negrel/webpush@0.5.0";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** RFC 8030: 404/410 mean the subscription is gone — prune it. */
export function isStaleStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

export async function sendPushes(
  vapidKeysJson: string,
  contact: string,
  subs: SubRow[],
  messages: PushMessage[],
): Promise<{ sent: number; staleEndpoints: string[] }> {
  if (subs.length === 0 || messages.length === 0) return { sent: 0, staleEndpoints: [] };
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidKeysJson), { extractable: false });
  const appServer = await webpush.ApplicationServer.new({ contactInformation: contact, vapidKeys });
  const stale = new Set<string>();
  let sent = 0;
  for (const sub of subs) {
    const subscriber = appServer.subscribe({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    });
    for (const msg of messages) {
      if (stale.has(sub.endpoint)) break;
      try {
        await subscriber.pushTextMessage(JSON.stringify(msg), {});
        sent++;
      } catch (err) {
        const status = err instanceof webpush.PushMessageError
          ? err.response?.status
          : undefined;
        if (isStaleStatus(status)) stale.add(sub.endpoint);
        else console.error(`push to ${sub.endpoint} failed:`, err);
      }
    }
  }
  return { sent, staleEndpoints: [...stale] };
}
