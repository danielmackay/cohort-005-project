// PROTOTYPE — re-run of check 4b (opt-in) for ticket #26, using the same write the client SDK makes.
import { signUserToken } from "@knocklabs/node";
const APP = "http://localhost:5199";
const { KNOCK_PUBLIC_API_KEY: PK, KNOCK_SIGNING_KEY: SK, KNOCK_FEED_CHANNEL_ID: CH } = process.env;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const kid = (id) => `cadence-user-${id}`;
async function knockAs(id, method, path, body) {
  const token = await signUserToken(kid(id), { signingKey: SK, expiresInSeconds: 120 });
  const r = await fetch(`https://api.knock.app/v1${path}`, { method, headers: { Authorization: `Bearer ${PK}`, "X-Knock-User-Token": token, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const total = async (id) => (await knockAs(id, "GET", `/users/${kid(id)}/feeds/${CH}`)).json.meta.total_count;
async function enroll(recipientId) {
  const c = (await fetch(`${APP}/api/switch-user`, { method: "POST", body: new URLSearchParams({ userId: 5 }), redirect: "manual" })).headers.get("set-cookie").split(";")[0];
  await fetch(`${APP}/prototype/knock`, { method: "POST", headers: { Cookie: c }, body: new URLSearchParams({ intent: "new-enrollment", userId: recipientId }) });
  await wait(4000);
}
const SARAH = 2;
const setFeed = (value) => knockAs(SARAH, "PUT", `/users/${kid(SARAH)}/preferences/default`, { categories: { enrollments: { channel_types: { in_app_feed: value } } } });

console.log("before:", await total(SARAH));
let r = await setFeed(true);
console.log("opt in:", r.status, JSON.stringify(r.json.categories));
await wait(1500); await enroll(SARAH);
console.log("after opt-in + trigger (expect +1):", await total(SARAH));
r = await setFeed(false);
console.log("opt out:", r.status, JSON.stringify(r.json.categories));
await wait(1500); await enroll(SARAH);
console.log("after opt-out + trigger (expect no change):", await total(SARAH));
// Does a user token let Sarah write someone else's preferences?
const other = await knockAs(SARAH, "PUT", `/users/${kid(3)}/preferences/default`, { categories: { enrollments: true } });
console.log("Sarah writing Marcus's preferences:", other.status);
