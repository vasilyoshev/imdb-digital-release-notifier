// One-time VAPID key generation (spec §8). Run:
//   npx deno run --allow-net scripts/generate-vapid.ts
// Put the printed JSON in VAPID_KEYS_JSON (single line).
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const keys = await webpush.generateVapidKeys({ extractable: true });
const exported = await webpush.exportVapidKeys(keys);
console.log(JSON.stringify(exported));
