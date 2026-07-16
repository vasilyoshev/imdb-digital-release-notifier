// Print the browser-facing VAPID application-server key (base64url) derived
// from the existing VAPID_KEYS_JSON secret — this is the public value that
// ships in the frontend as VITE_VAPID_PUBLIC_KEY. Run:
//   npx deno run --allow-env --env-file=supabase/functions/.env scripts/vapid-public-key.ts
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const json = Deno.env.get("VAPID_KEYS_JSON");
if (!json) {
  console.error("VAPID_KEYS_JSON is not set");
  Deno.exit(1);
}

const keys = await webpush.importVapidKeys(JSON.parse(json), { extractable: true });
console.log(await webpush.exportApplicationServerKey(keys));
