/**
 * Web-push subscription on the client (SPEC §8). Subscribe must be driven by a
 * user gesture: request permission, subscribe with the VAPID public key, then
 * upsert the subscription (endpoint + keys) into `push_subscriptions`.
 */
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** This browser can do service workers + push + notifications. */
export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** The VAPID public key is present in the build (backend push is provisioned). */
export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY);
}

/** base64url VAPID key → Uint8Array, the form pushManager.subscribe wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Subscribe this device and persist it. Reuses an existing browser subscription
 * if one is present. Throws with a user-facing message on permission denial or
 * a missing VAPID key.
 */
export async function subscribeThisDevice(): Promise<void> {
  if (!pushSupported()) throw new Error("This browser doesn't support notifications.");
  if (!VAPID_PUBLIC_KEY) {
    throw new Error("Push isn't configured yet (the VAPID key is missing from this build).");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was blocked. Allow it in the browser to continue.");
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("The push subscription was incomplete — try again.");
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: "endpoint" },
    );
  if (error) throw error;
}
